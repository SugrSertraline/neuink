package org.neuink.server;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import static org.junit.jupiter.api.Assertions.*;

@EnabledIfEnvironmentVariable(named="NEUINK_INTEGRATION",matches="true")
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT)
class RevisionWatchHttpTest {
    @LocalServerPort int port;
    @Autowired AuthService auth;
    @Autowired SyncService sync;
    @Autowired ObjectMapper json;
    @Autowired org.springframework.jdbc.core.JdbcTemplate db;
    @Autowired org.springframework.transaction.support.TransactionTemplate transactions;
    final HttpClient http=HttpClient.newHttpClient();
    record Fixture(String user,String session,String token,String library,String epoch) {}
    Fixture fixture() {
        String name="watch-"+Api.token().substring(0,12);
        auth.createAdmin(name,"test-password-only");
        var session=auth.login(json.valueToTree(Map.of("username",name,"password","test-password-only")));
        var library=json.valueToTree(sync.createLibrary((String)session.get("account_id"),json.valueToTree(Map.of("name","watch"))));
        return new Fixture((String)session.get("account_id"),(String)session.get("session_id"),(String)session.get("access_token"),library.path("id").asText(),library.path("epoch").asText());
    }
    HttpRequest request(Fixture f,String query,String token) {
        var builder=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/v1/libraries/"+f.library()+"/revision?epoch="+f.epoch()+query)).timeout(Duration.ofSeconds(10));
        if(token!=null) builder.header("Authorization","Bearer "+token);
        return builder.GET().build();
    }
    JsonNode ok(HttpResponse<String> response) throws Exception {
        assertEquals(200,response.statusCode(),response.body());
        assertTrue(response.headers().firstValue("Cache-Control").orElse("").contains("no-store"));
        return json.readTree(response.body());
    }
    @Test void revisionIsSmallAuthorizedAndDoesNotConsumeChanges() throws Exception {
        var f=fixture();
        assertEquals(401,http.send(request(f,"",null),HttpResponse.BodyHandlers.ofString()).statusCode());
        var other=fixture();
        assertEquals(404,http.send(request(f,"",other.token()),HttpResponse.BodyHandlers.ofString()).statusCode());
        var initial=ok(http.send(request(f,"",f.token()),HttpResponse.BodyHandlers.ofString()));
        assertEquals(0,initial.path("revision").asLong());assertFalse(initial.path("changed").asBoolean());assertTrue(initial.has("server_id"));assertFalse(initial.has("changes"));
        assertEquals(400,http.send(request(f,"&revision=1",f.token()),HttpResponse.BodyHandlers.ofString()).statusCode());
        assertEquals(400,http.send(request(f,"&wait_ms=25001",f.token()),HttpResponse.BodyHandlers.ofString()).statusCode());
        assertEquals(400,http.send(request(f,"&revision=-1",f.token()),HttpResponse.BodyHandlers.ofString()).statusCode());
        put(f,"first",null);
        var updated=ok(http.send(request(f,"&wait_ms=2000",f.token()),HttpResponse.BodyHandlers.ofString()));
        assertEquals(1,updated.path("revision").asLong());assertTrue(updated.path("changed").asBoolean());
        assertEquals(1,json.valueToTree(sync.changes(f.user(),f.library(),f.epoch(),0)).path("changes").size());
        db.update("UPDATE libraries SET minimum_revision=1 WHERE id=?",f.library());
        assertEquals(409,http.send(request(f,"",f.token()),HttpResponse.BodyHandlers.ofString()).statusCode());
        var wrong=new Fixture(f.user(),f.session(),f.token(),f.library(),"wrong");
        assertEquals(409,http.send(request(wrong,"",f.token()),HttpResponse.BodyHandlers.ofString()).statusCode());
    }
    void put(Fixture f,String operation,Long base) {
        var node=json.createObjectNode().put("operation_id",operation).put("object_id","note:watch").put("kind","note");
        if(base==null)node.putNull("base_revision");else node.put("base_revision",base);
        node.putObject("mutation").put("action","put").putObject("content").put("text",operation);
        sync.apply(f.user(),f.library(),json.valueToTree(Map.of("epoch",f.epoch(),"operation",node)));
    }
    @Test void asynchronousWaitWakesOnCommitAndRechecksRevocation() throws Exception {
        var f=fixture();
        var pending=http.sendAsync(request(f,"&wait_ms=5000",f.token()),HttpResponse.BodyHandlers.ofString());
        Thread.sleep(200);assertFalse(pending.isDone());put(f,"update",null);
        var changed=ok(pending.get(4,TimeUnit.SECONDS));assertEquals(1,changed.path("revision").asLong());
        var revoked=http.sendAsync(request(f,"&revision=1&wait_ms=5000",f.token()),HttpResponse.BodyHandlers.ofString());
        Thread.sleep(200);auth.revoke(new AuthService.Identity(f.user(),f.session(),true),f.session());
        assertEquals(401,revoked.get(4,TimeUnit.SECONDS).statusCode());
    }
    @Test void timeoutReturnsCurrentRevisionAndRetentionChangesInterruptWait() throws Exception {
        var f=fixture();
        long start=System.nanoTime();
        var empty=ok(http.send(request(f,"&wait_ms=100",f.token()),HttpResponse.BodyHandlers.ofString()));
        assertFalse(empty.path("changed").asBoolean());assertTrue(System.nanoTime()-start>=TimeUnit.MILLISECONDS.toNanos(70));
        put(f,"first",null);
        var pending=http.sendAsync(request(f,"&revision=1&wait_ms=5000",f.token()),HttpResponse.BodyHandlers.ofString());
        Thread.sleep(200);
        transactions.executeWithoutResult(tx->{
            put(f,"second",1L);
            db.update("UPDATE libraries SET minimum_revision=2 WHERE id=?",f.library());
        });
        assertEquals(409,pending.get(4,TimeUnit.SECONDS).statusCode());
    }
}
