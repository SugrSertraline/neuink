package org.neuink.server;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
class StoragePreview {
    private final JdbcTemplate db;
    StoragePreview(JdbcTemplate db) {this.db=db;}
    @PostMapping("/v1/libraries/{library}/preview")
    Object preview(Authentication principal,@PathVariable String library,@RequestBody JsonNode request) {
        String owner=AuthController.identity(principal).user();
        if(!Api.hash(library)||db.queryForList("SELECT id FROM libraries WHERE id=? AND owner=?",library,owner).isEmpty()) throw Api.fail(404,"library_missing");
        JsonNode files=request.path("files"),ids=request.path("ids");
        if(!files.isArray()||files.size()>4096||!ids.isArray()||ids.size()>4096) throw Api.fail(400,"invalid_preview");
        var hashes=new HashSet<String>();long total=0;
        for(JsonNode file:files) {
            String hash=Api.text(file,"hash",64);JsonNode size=file.path("size");
            if(!Api.hash(hash)||!hashes.add(hash)||!size.isIntegralNumber()||!size.canConvertToLong()||size.longValue()<0||size.longValue()>2147483648L) throw Api.fail(400,"invalid_preview");
            total+=size.longValue();
        }
        for(JsonNode id:ids) {if(!id.isTextual()||id.asText().isEmpty()||id.asText().length()>512) throw Api.fail(400,"invalid_preview");}
        long existing=db.queryForObject("SELECT COALESCE(sum(b.size),0)::BIGINT FROM jsonb_to_recordset(?::jsonb) AS f(hash text,size bigint) JOIN blobs b ON b.owner=? AND b.hash=f.hash AND b.size=f.size",Long.class,files.toString(),owner);
        long overlaps=db.queryForObject("SELECT count(*) FROM objects WHERE library_id=? AND id IN (SELECT jsonb_array_elements_text(?::jsonb))",Long.class,library,ids.toString());
        return Map.of("new_attachment_bytes",total-existing,"existing_attachment_bytes",existing,"overlapping_objects",overlaps);
    }
}
