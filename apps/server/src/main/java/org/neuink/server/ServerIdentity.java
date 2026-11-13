package org.neuink.server;

import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.context.annotation.DependsOn;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@Component
@DependsOn("flywayInitializer")
class ServerIdentity {
    final String id; final String epoch;
    ServerIdentity(JdbcTemplate db) {
        db.update("INSERT INTO server_identity(singleton,id,epoch) VALUES(TRUE,?,?) ON CONFLICT DO NOTHING", Api.token(), Api.token());
        Map<String,Object> row = db.queryForMap("SELECT id,epoch FROM server_identity WHERE singleton=TRUE");
        id = (String)row.get("id"); epoch = (String)row.get("epoch");
    }
}

@RestController
class DiscoveryController {
    private final ServerIdentity identity; private final JdbcTemplate db;
    DiscoveryController(ServerIdentity identity, JdbcTemplate db) { this.identity = identity; this.db = db; }
    @GetMapping("/.well-known/neuink-sync") Map<String,Object> discover() {
        return Map.of("protocol_version",1,"server_id",identity.id,"epoch",identity.epoch,"max_chunk_bytes",4194304,"registration","invite");
    }
    @GetMapping("/health") String health() { return "ok"; }
    @GetMapping("/ready") Map<String,Boolean> ready() { db.queryForObject("SELECT 1",Integer.class); return Map.of("ready",true); }
}
