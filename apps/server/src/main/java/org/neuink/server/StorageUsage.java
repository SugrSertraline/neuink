package org.neuink.server;

import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

/** Logical quota includes current objects and retained historical JSON, not database indexes. */
@Component
class StorageUsage {
    private final JdbcTemplate db;
    StorageUsage(JdbcTemplate db) { this.db=db; }
    long metadata(String owner) {
        return db.queryForObject("SELECT COALESCE(SUM(bytes),0)::BIGINT FROM (SELECT octet_length(o.content::text) AS bytes FROM objects o JOIN libraries l ON l.id=o.library_id WHERE l.owner=? UNION ALL SELECT octet_length(c.content::text) FROM changes c JOIN libraries l ON l.id=c.library_id WHERE l.owner=? AND NOT EXISTS (SELECT 1 FROM objects o WHERE o.library_id=c.library_id AND o.id=c.object_id AND o.revision=c.revision)) s",Long.class,owner,owner);
    }
    long blobs(String owner) { return db.queryForObject("SELECT COALESCE(SUM(size),0)::BIGINT FROM blobs WHERE owner=?",Long.class,owner); }
    long reserved(String owner) { return db.queryForObject("SELECT COALESCE(SUM(size),0)::BIGINT FROM (SELECT MAX(u.size) AS size FROM uploads u WHERE owner=? AND expires_at>? AND NOT EXISTS(SELECT 1 FROM blobs b WHERE b.owner=u.owner AND b.hash=u.hash) GROUP BY u.hash) s",Long.class,owner,Api.now()); }
    Map<String,Object> details(String owner) {
        long files=blobs(owner), objects=metadata(owner), pending=reserved(owner);
        long quota=db.queryForObject("SELECT quota FROM users WHERE id=?",Long.class,owner);
        return Map.of("quota",quota,"file_bytes",files,"metadata_bytes",objects,"reserved_bytes",pending,"used_bytes",files+objects,"available_bytes",Math.max(0,quota-files-objects-pending));
    }
}

@RestController
class StorageController {
    private final StorageUsage usage;
    StorageController(StorageUsage usage) { this.usage=usage; }
    @GetMapping("/v1/storage") Object read(Authentication principal) { return usage.details(AuthController.identity(principal).user()); }
}
