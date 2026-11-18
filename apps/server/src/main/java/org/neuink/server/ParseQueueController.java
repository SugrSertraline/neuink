package org.neuink.server;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.nio.file.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/v1/parse/tasks")
class ParseQueueController {
    private final ParseQueue queue;
    private final Path storage;
    ParseQueueController(ParseQueue queue,@Value("${neuink.storage}") String storage) { this.queue=queue; this.storage=Path.of(storage).toAbsolutePath().normalize(); }
    @PostMapping Object submit(Authentication principal,@RequestBody JsonNode body) {
        return queue.submit(AuthController.identity(principal).user(),body);
    }
    @GetMapping("/{id}") Object status(Authentication principal,@PathVariable String id) {
        return queue.status(AuthController.identity(principal).user(),id);
    }
    @DeleteMapping("/{id}") Object cancel(Authentication principal,@PathVariable String id) {
        queue.cancel(AuthController.identity(principal).user(),id); return Map.of("ok",true);
    }
    @GetMapping("/{id}/result") ResponseEntity<FileSystemResource> result(Authentication principal,@PathVariable String id) {
        var task=queue.status(AuthController.identity(principal).user(),id);
        if(!"succeeded".equals(task.get("state"))) throw Api.fail(409,"parse_result_not_ready");
        Path file=storage.resolve("parse-results").resolve(id+".zip");
        if(!Files.isRegularFile(file)) throw Api.fail(503,"parse_result_missing");
        return ResponseEntity.ok().header("Content-Type","application/zip").header("Cache-Control","private, no-store").body(new FileSystemResource(file));
    }
}
