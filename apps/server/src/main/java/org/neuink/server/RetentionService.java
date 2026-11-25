package org.neuink.server;

import java.io.IOException;
import java.nio.file.*;
import org.springframework.beans.factory.annotation.Value;
import org.neuink.server.persistence.RetentionServiceMapper;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/** Owner locks serialize reference publication, upload completion and reclamation.
 * A durable deleting job precedes filesystem deletion, making each boundary retryable. */
@Service
class RetentionService {
    static final long HISTORY_SECONDS=30L*86400, GRACE_SECONDS=7L*86400;
    private final RetentionServiceMapper db;
    private final TransactionTemplate transactions;
    private final Path storage;
    RetentionService(RetentionServiceMapper db,TransactionTemplate transactions,@Value("${neuink.storage}") String storage) {
        this.db=db;this.transactions=transactions;this.storage=Path.of(storage).toAbsolutePath().normalize();
    }
    private void lock(String owner) { db.lockOwner(owner); }
    boolean referenced(String owner,String hash,long now) {
        return Boolean.TRUE.equals(db.isReferenced(owner, hash, owner, hash, owner, hash, now)) || db.isParseInput(owner, hash);
    }
    void expire(String owner,long now) {
        transactions.executeWithoutResult(tx->{
            lock(owner);
            // Keep current records forever, including tombstone identities. Their
            // former body remains in history for thirty days after deletion.
            var libraries=db.lockLibraries(owner);
            for(var row:libraries) {
                String library=(String)row.get("id");
                Long floor=db.expiredRevision(library, now-HISTORY_SECONDS);
                db.deleteExpiredHistory(library, now-HISTORY_SECONDS);
                db.advanceMinimumRevision(floor, library);
            }
        });
    }
    void collect(String owner,long now) {
        transactions.executeWithoutResult(tx->{
            lock(owner);
            for(var row:db.listBlobs(owner)) {
                String hash=(String)row.get("hash");
                if(referenced(owner,hash,now)) db.deleteCollection(owner, hash);
                else db.insertCollection(owner, hash, now);
            }
            for(var row:db.listCandidates(owner, now-GRACE_SECONDS)) {
                String hash=(String)row.get("hash");
                if(referenced(owner,hash,now)) {db.deleteCollection(owner, hash);continue;}
                // Remove eligibility for new references BEFORE touching bytes.
                db.deleteBlob(owner, hash);
                db.markDeleting(owner, hash);
            }
        });
        finish(owner);
    }
    void finish(String owner) {
        transactions.executeWithoutResult(tx->{
            lock(owner);
            for(var row:db.listDeleting(owner)) {
                String hash=(String)row.get("hash");
                if(!Api.hash(owner)||!Api.hash(hash)) throw Api.fail(500,"invalid_gc_identity");
                // An intervening new upload may have republished the same hash.
                if(!db.findBlob(owner, hash).isEmpty()) {
                    db.deleteCollection(owner, hash);continue;
                }
                try {Files.deleteIfExists(storage.resolve("blobs").resolve(owner).resolve(hash));}
                catch(IOException ignored) {continue;}
                db.deleteCollection(owner, hash);
            }
        });
    }
    @Scheduled(fixedDelayString="${neuink.retention-delay-ms:3600000}",initialDelayString="${neuink.retention-delay-ms:3600000}")
    public void scheduled() {
        for(String owner:db.listOwners()) {
            try {long now=Api.now();expire(owner,now);collect(owner,now);}
            catch(RuntimeException ignored) {org.slf4j.LoggerFactory.getLogger(RetentionService.class).warn("Storage maintenance deferred; will retry");}
        }
    }
}
