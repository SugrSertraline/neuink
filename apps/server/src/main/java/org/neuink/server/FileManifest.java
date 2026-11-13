package org.neuink.server;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** Reserved _files manifest in content. Paths are never accepted as file identities. */
@Component
class FileManifest {
    private final JdbcTemplate db;
    FileManifest(JdbcTemplate db) { this.db = db; }

    void validate(String owner, JsonNode content) {
        if (content == null || !content.isObject() || !content.has("_files")) return;
        JsonNode files = content.get("_files");
        if (!files.isArray() || files.size() > 4096) throw Api.fail(400, "invalid_file_manifest");
        for (JsonNode file : files) {
            String hash = Api.text(file, "hash", 64);
            JsonNode size = file.get("size");
            if (!Api.hash(hash) || size == null || !size.isIntegralNumber() || !size.canConvertToLong()
                    || size.longValue() < 0 || size.longValue() > 2147483648L) {
                throw Api.fail(400, "invalid_file_manifest");
            }
        }
        // One bounded set lookup, not one database round-trip per image.
        Long matched = db.queryForObject("""
            SELECT count(*) FROM jsonb_to_recordset(?::jsonb) AS f(hash text, size bigint)
            JOIN blobs b ON b.owner=? AND b.hash=f.hash AND b.size=f.size
            """, Long.class, files.toString(), owner);
        if (matched == null || matched != files.size()) {
            throw Api.fail(409, "attachment_not_ready");
        }
        db.update("DELETE FROM blob_gc WHERE owner=? AND hash IN (SELECT f.hash FROM jsonb_to_recordset(?::jsonb) AS f(hash text))",owner,files.toString());
    }
}
