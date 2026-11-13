package org.neuink.server;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@Service
class StorageCleanup {
    private final JdbcTemplate db;private final TransactionTemplate transactions;
    StorageCleanup(JdbcTemplate db,TransactionTemplate transactions) {this.db=db;this.transactions=transactions;}
    private List<Map<String,Object>> rows(String owner) {
        return db.queryForList("""
            SELECT c.library_id,c.revision,COALESCE(octet_length(c.content::text),0) AS bytes
            FROM changes c JOIN libraries l ON l.id=c.library_id WHERE l.owner=?
            AND NOT EXISTS(SELECT 1 FROM objects o WHERE o.library_id=c.library_id AND o.id=c.object_id AND o.revision=c.revision)
            ORDER BY c.library_id,c.revision
            """,owner);
    }
    private Map<String,Object> previewLocked(String owner) {
        var rows=rows(owner);long bytes=rows.stream().mapToLong(r->((Number)r.get("bytes")).longValue()).sum();
        return Map.of("token",Api.digest(owner+rows.toString()),"versions",rows.size(),"metadata_bytes",bytes,
            "grace_days",7,"history_days",30);
    }
    Object preview(String owner) {
        return transactions.execute(tx->{db.queryForObject("SELECT id FROM users WHERE id=? FOR UPDATE",String.class,owner);return previewLocked(owner);});
    }
    Object clear(String owner,String token) {
        return transactions.execute(tx->{
            db.queryForObject("SELECT id FROM users WHERE id=? FOR UPDATE",String.class,owner);
            var preview=previewLocked(owner);
            if(!preview.get("token").equals(token)) throw Api.fail(409,"cleanup_preview_changed");
            for(var row:rows(owner)) {
                db.update("DELETE FROM changes WHERE library_id=? AND revision=?",row.get("library_id"),row.get("revision"));
                db.update("UPDATE libraries SET minimum_revision=GREATEST(minimum_revision,?) WHERE id=?",row.get("revision"),row.get("library_id"));
            }
            db.update("INSERT INTO admin_audit(actor,action,subject,occurred_at) VALUES(?,'clear_own_history',?,?)",owner,owner,Api.now());
            return Map.of("ok",true,"removed_versions",preview.get("versions"),"released_metadata_bytes",preview.get("metadata_bytes"));
        });
    }
}
@RestController
class StorageCleanupController {
    private final StorageCleanup cleanup;
    StorageCleanupController(StorageCleanup cleanup) {this.cleanup=cleanup;}
    @GetMapping("/v1/storage/cleanup") Object preview(Authentication principal) {return cleanup.preview(AuthController.identity(principal).user());}
    @PostMapping("/v1/storage/cleanup") Object clear(Authentication principal,@RequestBody JsonNode request) {return cleanup.clear(AuthController.identity(principal).user(),Api.text(request,"token",64));}
}
