package org.neuink.server;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.*;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
class AdminOperations {
    private final String statusPath;
    private final ObjectMapper json;
    AdminOperations(@Value("${NEUINK_BACKUP_STATUS:}") String statusPath,ObjectMapper json) { this.statusPath=statusPath; this.json=json; }
    @GetMapping("/admin/api/backup") Object backup(Authentication principal) {
        AuthController.admin(principal);
        if(statusPath.isBlank()) return Map.of("state","not_configured");
        try {
            Path path=Path.of(statusPath);
            if(Files.isSymbolicLink(path)||Files.size(path)>4096) return Map.of("state","unavailable");
            var source=json.readTree(Files.readAllBytes(path));
            String state=source.path("state").asText();
            if(!java.util.Set.of("running","succeeded","failed").contains(state)) return Map.of("state","unavailable");
            return Map.of("state",state,"last_attempt",source.path("last_attempt").asText(""),"last_success",source.path("last_success").asText(""));
        } catch(Exception ignored) { return Map.of("state","unavailable"); }
    }
}
