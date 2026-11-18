package org.neuink.server;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.*;
import org.neuink.server.persistence.StorageCleanupMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@Service
class StorageCleanup {
    private final StorageCleanupMapper db;private final TransactionTemplate transactions;
    StorageCleanup(StorageCleanupMapper db,TransactionTemplate transactions) {this.db=db;this.transactions=transactions;}
    private List<Map<String,Object>> rows(String owner) {
        return db.listHistory(owner);
    }
    private Map<String,Object> previewLocked(String owner) {
        var rows=rows(owner);long bytes=rows.stream().mapToLong(r->((Number)r.get("bytes")).longValue()).sum();
        return Map.of("token",Api.digest(owner+rows.toString()),"versions",rows.size(),"metadata_bytes",bytes,
            "grace_days",7,"history_days",30);
    }
    Object preview(String owner) {
        return transactions.execute(tx->{db.lockOwner(owner);return previewLocked(owner);});
    }
    Object clear(String owner,String token) {
        return transactions.execute(tx->{
            db.lockOwner(owner);
            var preview=previewLocked(owner);
            if(!preview.get("token").equals(token)) throw Api.fail(409,"cleanup_preview_changed");
            for(var row:rows(owner)) {
                db.deleteHistory((String)row.get("library_id"), ((Number)row.get("revision")).longValue());
                db.advanceMinimumRevision(((Number)row.get("revision")).longValue(), (String)row.get("library_id"));
            }
            db.insertAudit(owner, owner, Api.now());
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
