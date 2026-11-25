package org.neuink.server;

import java.util.Map;
import org.neuink.server.persistence.StorageUsageMapper;
import org.springframework.stereotype.Component;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

/** Logical quota includes current objects and retained historical JSON, not database indexes. */
@Component
class StorageUsage {
    private final StorageUsageMapper db;
    StorageUsage(StorageUsageMapper db) { this.db=db; }
    long metadata(String owner) {
        return db.metadataBytes(owner, owner);
    }
    long blobs(String owner) { return db.blobBytes(owner); }
    long reserved(String owner) { return db.reservedBytes(owner, Api.now()); }
    Map<String,Object> details(String owner) {
        long files=blobs(owner), objects=metadata(owner), pending=reserved(owner);
        long quota=db.readQuota(owner);
        return Map.of("quota",quota,"file_bytes",files,"metadata_bytes",objects,"reserved_bytes",pending,"used_bytes",files+objects,"available_bytes",Math.max(0,quota-files-objects-pending));
    }
}

@RestController
class StorageController {
    private final StorageUsage usage;
    StorageController(StorageUsage usage) { this.usage=usage; }
    @GetMapping("/v1/storage") Object read(Authentication principal) { return usage.details(AuthController.identity(principal).user()); }
}
