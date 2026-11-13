package org.neuink.server;

import java.io.IOException;
import java.nio.file.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/** Owner locks serialize reference publication, upload completion and reclamation.
 * A durable deleting job precedes filesystem deletion, making each boundary retryable. */
@Service
class RetentionService {
    static final long HISTORY_SECONDS=30L*86400, GRACE_SECONDS=7L*86400;
    private final JdbcTemplate db;
    private final TransactionTemplate transactions;
    private final Path storage;
    RetentionService(JdbcTemplate db,TransactionTemplate transactions,@Value("${neuink.storage}") String storage) {
        this.db=db;this.transactions=transactions;this.storage=Path.of(storage).toAbsolutePath().normalize();
    }
    private void lock(String owner) { db.queryForObject("SELECT id FROM users WHERE id=? FOR UPDATE",String.class,owner); }
    boolean referenced(String owner,String hash,long now) {
        return Boolean.TRUE.equals(db.queryForObject("""
            SELECT EXISTS(SELECT 1 FROM objects o JOIN libraries l ON l.id=o.library_id
                WHERE l.owner=? AND o.content->'_files' @> jsonb_build_array(jsonb_build_object('hash',?::text)))
            OR EXISTS(SELECT 1 FROM changes c JOIN libraries l ON l.id=c.library_id
                WHERE l.owner=? AND c.content->'_files' @> jsonb_build_array(jsonb_build_object('hash',?::text)))
            OR EXISTS(SELECT 1 FROM uploads WHERE owner=? AND hash=? AND expires_at>?)
            """,Boolean.class,owner,hash,owner,hash,owner,hash,now));
    }
    void expire(String owner,long now) {
        transactions.executeWithoutResult(tx->{
            lock(owner);
            // Keep current records forever, including tombstone identities. Their
            // former body remains in history for thirty days after deletion.
            var libraries=db.queryForList("SELECT id FROM libraries WHERE owner=? ORDER BY id FOR UPDATE",owner);
            for(var row:libraries) {
                String library=(String)row.get("id");
                Long floor=db.queryForObject("""
                    SELECT COALESCE(MAX(c.revision),0) FROM changes c WHERE c.library_id=? AND c.created_at<?
                    AND NOT EXISTS(SELECT 1 FROM objects o WHERE o.library_id=c.library_id AND o.id=c.object_id AND o.revision=c.revision)
                    """,Long.class,library,now-HISTORY_SECONDS);
                db.update("""
                    DELETE FROM changes c WHERE c.library_id=? AND c.created_at<?
                    AND NOT EXISTS(SELECT 1 FROM objects o WHERE o.library_id=c.library_id AND o.id=c.object_id AND o.revision=c.revision)
                    """,library,now-HISTORY_SECONDS);
                db.update("UPDATE libraries SET minimum_revision=GREATEST(minimum_revision,?) WHERE id=?",floor,library);
            }
        });
    }
    void collect(String owner,long now) {
        transactions.executeWithoutResult(tx->{
            lock(owner);
            for(var row:db.queryForList("SELECT hash FROM blobs WHERE owner=?",owner)) {
                String hash=(String)row.get("hash");
                if(referenced(owner,hash,now)) db.update("DELETE FROM blob_gc WHERE owner=? AND hash=?",owner,hash);
                else db.update("INSERT INTO blob_gc(owner,hash,candidate_at) VALUES(?,?,?) ON CONFLICT DO NOTHING",owner,hash,now);
            }
            for(var row:db.queryForList("SELECT hash FROM blob_gc WHERE owner=? AND NOT deleting AND candidate_at<=? ORDER BY hash LIMIT 100",owner,now-GRACE_SECONDS)) {
                String hash=(String)row.get("hash");
                if(referenced(owner,hash,now)) {db.update("DELETE FROM blob_gc WHERE owner=? AND hash=?",owner,hash);continue;}
                // Remove eligibility for new references BEFORE touching bytes.
                db.update("DELETE FROM blobs WHERE owner=? AND hash=?",owner,hash);
                db.update("UPDATE blob_gc SET deleting=TRUE WHERE owner=? AND hash=?",owner,hash);
            }
        });
        finish(owner);
    }
    void finish(String owner) {
        transactions.executeWithoutResult(tx->{
            lock(owner);
            for(var row:db.queryForList("SELECT hash FROM blob_gc WHERE owner=? AND deleting ORDER BY hash LIMIT 100",owner)) {
                String hash=(String)row.get("hash");
                if(!Api.hash(owner)||!Api.hash(hash)) throw Api.fail(500,"invalid_gc_identity");
                // An intervening new upload may have republished the same hash.
                if(!db.queryForList("SELECT hash FROM blobs WHERE owner=? AND hash=?",owner,hash).isEmpty()) {
                    db.update("DELETE FROM blob_gc WHERE owner=? AND hash=?",owner,hash);continue;
                }
                try {Files.deleteIfExists(storage.resolve("blobs").resolve(owner).resolve(hash));}
                catch(IOException ignored) {continue;}
                db.update("DELETE FROM blob_gc WHERE owner=? AND hash=?",owner,hash);
            }
        });
    }
    @Scheduled(fixedDelayString="${neuink.retention-delay-ms:3600000}",initialDelayString="${neuink.retention-delay-ms:3600000}")
    public void scheduled() {
        for(String owner:db.queryForList("SELECT id FROM users ORDER BY id",String.class)) {
            try {long now=Api.now();expire(owner,now);collect(owner,now);}
            catch(RuntimeException ignored) {org.slf4j.LoggerFactory.getLogger(RetentionService.class).warn("Storage maintenance deferred; will retry");}
        }
    }
}
