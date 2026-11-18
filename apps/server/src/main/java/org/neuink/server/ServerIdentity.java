package org.neuink.server;

import java.util.Map;
import org.neuink.server.persistence.ServerIdentityMapper;
import org.springframework.stereotype.Component;
import org.springframework.context.annotation.DependsOn;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@Component
@DependsOn("flywayInitializer")
class ServerIdentity {
    final String id; final String epoch;
    ServerIdentity(ServerIdentityMapper db) {
        db.insertIdentity(Api.token(), Api.token());
        Map<String,Object> row = db.readIdentity();
        id = (String)row.get("id"); epoch = (String)row.get("epoch");
    }
}

@RestController
class DiscoveryController {
    private final ServerIdentity identity; private final ServerIdentityMapper db;
    private final boolean parseEnabled;
    DiscoveryController(ServerIdentity identity, ServerIdentityMapper db, @org.springframework.beans.factory.annotation.Value("${neuink.parse.enabled:false}") boolean parseEnabled) { this.identity = identity; this.db = db; this.parseEnabled=parseEnabled; }
    @GetMapping("/.well-known/neuink-sync") Map<String,Object> discover() {
        var capabilities=new java.util.ArrayList<>(java.util.List.of("reading_state_v1","user_collections_v1","revision_watch_v1"));
        if(parseEnabled) capabilities.add("account_parse_v1");
        return Map.of("protocol_version",1,"server_id",identity.id,"epoch",identity.epoch,"max_chunk_bytes",4194304,"registration","invite","capabilities",capabilities);
    }
    @GetMapping("/health") String health() { return "ok"; }
    @GetMapping("/ready") Map<String,Boolean> ready() { db.probe(); return Map.of("ready",true); }
}
