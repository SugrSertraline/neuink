package org.neuink.server;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/** Only removes expired staging files; published blobs and historical references are untouched. */
@Component
class UploadCleanup {
    private final JdbcTemplate db;
    private final TransactionTemplate transactions;
    private final Path uploads;
    UploadCleanup(JdbcTemplate db, TransactionTemplate transactions, @Value("${neuink.storage}") String storage) {
        this.db = db; this.transactions = transactions;
        this.uploads = Path.of(storage).toAbsolutePath().normalize().resolve("uploads");
    }
    @Scheduled(fixedDelayString="${neuink.cleanup-delay-ms:300000}", initialDelayString="${neuink.cleanup-delay-ms:300000}")
    public void scheduled() {
        try { clean(); }
        catch (RuntimeException ignored) {
            // Do not log SQL exception details: they may contain credentials/paths.
            org.slf4j.LoggerFactory.getLogger(UploadCleanup.class).warn("Upload cleanup deferred; will retry");
        }
    }
    int clean() {
        Integer count = transactions.execute(tx -> {
            var rows = db.queryForList("SELECT id FROM uploads WHERE expires_at<=? ORDER BY expires_at,id LIMIT 100 FOR UPDATE SKIP LOCKED", Api.now());
            int removed = 0;
            for (var row : rows) {
                String id = (String) row.get("id");
                if (!Api.hash(id)) throw Api.fail(500, "invalid_stored_upload");
                try { Files.deleteIfExists(uploads.resolve(id)); }
                catch (IOException ignored) { continue; } // Keep the expired row for retry.
                db.update("DELETE FROM uploads WHERE id=?", id);
                removed++;
            }
            return removed;
        });
        return count == null ? 0 : count;
    }
}
