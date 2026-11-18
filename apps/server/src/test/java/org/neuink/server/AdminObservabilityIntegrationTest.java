package org.neuink.server;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.junit.jupiter.api.Assertions.*;

@EnabledIfEnvironmentVariable(named="NEUINK_INTEGRATION",matches="true")
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT)
class AdminObservabilityIntegrationTest {
    @org.springframework.boot.test.web.server.LocalServerPort int port;
    @Autowired AuthService auth;
    @Autowired AdminService admin;
    @Autowired JdbcTemplate db;
    @Autowired ObjectMapper json;

    @Test void administratorCreatesAccountsAndListsOnlyTheirFiles() throws Exception {
        String name="admin-files-"+Api.token().substring(0,12);
        auth.createAdmin(name,"test-password-only");
        String actor=db.queryForObject("SELECT id FROM users WHERE username=?",String.class,name);
        String username="created-"+Api.token().substring(0,12);
        var request=json.valueToTree(Map.of("username",username,"password","initial-password-only","quota",987654L));
        var account=auth.createAccount(actor,request);String subject=(String)account.get("account_id");
        assertEquals(987654L,db.queryForObject("SELECT quota FROM users WHERE id=?",Long.class,subject));
        assertFalse(db.queryForObject("SELECT admin FROM users WHERE id=?",Boolean.class,subject));
        assertNotNull(auth.login(json.valueToTree(Map.of("username",username,"password","initial-password-only"))).get("access_token"));
        assertEquals(409,assertThrows(Api.Failure.class,()->auth.createAccount(actor,request)).status);
        assertEquals(403,assertThrows(Api.Failure.class,()->auth.createAccount(subject,request)).status);
        assertEquals(403,assertThrows(Api.Failure.class,()->admin.files(subject,actor,"")).status);
        String library=Api.token(),foreignLibrary=Api.token(),hash=Api.token();
        db.update("INSERT INTO libraries(id,owner,name) VALUES(?,?,?),(?,?,?)",library,subject,"Target library",foreignLibrary,actor,"Private library");
        db.update("INSERT INTO blobs(owner,hash,size) VALUES(?,?,123),(?,?,999)",subject,hash,actor,Api.token());
        String content=json.writeValueAsString(Map.of("document",Map.of("resources",List.of(Map.of("hash",hash,"name","paper.pdf","size",123)))));
        db.update("INSERT INTO objects(library_id,id,kind,content,revision,deleted) VALUES(?,?,?,?::jsonb,1,FALSE),(?,?,?,?::jsonb,1,FALSE)",library,"entry:one","entry",content,foreignLibrary,"entry:foreign","entry",content);
        @SuppressWarnings("unchecked") var result=(Map<String,Object>)admin.files(actor,subject,"");
        @SuppressWarnings("unchecked") var items=(List<Map<String,Object>>)result.get("items");
        assertEquals(1,items.size());assertEquals(hash,items.getFirst().get("hash"));
        @SuppressWarnings("unchecked") var refs=(List<Map<String,Object>>)items.getFirst().get("references");
        assertEquals(1,refs.size());assertEquals("Target library",refs.getFirst().get("library_name"));assertEquals("paper.pdf",refs.getFirst().get("name"));
        assertEquals("",result.get("next"));
        for(int i=0;i<101;i++)db.update("INSERT INTO blobs(owner,hash,size) VALUES(?,?,1)",subject,Api.token());
        @SuppressWarnings("unchecked") var first=(Map<String,Object>)admin.files(actor,subject,"");
        assertEquals(100,((List<?>)first.get("items")).size());assertFalse(((String)first.get("next")).isEmpty());
        @SuppressWarnings("unchecked") var last=(Map<String,Object>)admin.files(actor,subject,(String)first.get("next"));
        assertEquals(2,((List<?>)last.get("items")).size());assertEquals("",last.get("next"));
        int maximum=db.queryForObject("SELECT max_accounts FROM registration_policy WHERE id=1",Integer.class);
        try {db.update("UPDATE registration_policy SET max_accounts=0 WHERE id=1");assertEquals(409,assertThrows(Api.Failure.class,()->auth.createAccount(actor,request)).status);}
        finally {db.update("UPDATE registration_policy SET max_accounts=? WHERE id=1",maximum);}
    }

    @Test void loginRecordsConnectionMetadataWithoutTrustingSpoofedForwardingHeaders() throws Exception {
        String name="admin-ip-"+Api.token().substring(0,12);
        auth.createAdmin(name,"test-password-only");
        String body=json.writeValueAsString(Map.of("username",name,"password","test-password-only","device_name","Browser"));
        var request=java.net.http.HttpRequest.newBuilder(java.net.URI.create("http://127.0.0.1:"+port+"/v1/auth/login"))
            .header("Content-Type","application/json").header("User-Agent","Admin Integration Browser/1.0")
            .header("X-Forwarded-For","203.0.113.99").POST(java.net.http.HttpRequest.BodyPublishers.ofString(body)).build();
        var response=java.net.http.HttpClient.newHttpClient().send(request,java.net.http.HttpResponse.BodyHandlers.ofString());
        assertEquals(200,response.statusCode());
        var session=json.readTree(response.body());
        String sessionId=session.path("session_id").asText(), userId=session.path("account_id").asText();
        var stored=db.queryForMap("SELECT login_ip,user_agent,last_seen_at FROM sessions WHERE id=?",sessionId);
        assertEquals("127.0.0.1",stored.get("login_ip"));
        assertEquals("Admin Integration Browser/1.0",stored.get("user_agent"));
        assertNotNull(stored.get("last_seen_at"));
        Long login=db.queryForObject("SELECT last_login_at FROM users WHERE id=?",Long.class,userId);
        assertThrows(Api.Failure.class,()->auth.login(json.valueToTree(Map.of("username",name,"password","incorrect-password"))));
        assertEquals(login,db.queryForObject("SELECT last_login_at FROM users WHERE id=?",Long.class,userId));
        db.update("UPDATE sessions SET last_seen_at=? WHERE id=?",Api.now()-120,sessionId);
        auth.authenticate("Bearer "+session.path("access_token").asText());
        Long seen=db.queryForObject("SELECT last_seen_at FROM sessions WHERE id=?",Long.class,sessionId);
        assertTrue(seen>=Api.now()-2);
        auth.authenticate("Bearer "+session.path("access_token").asText());
        assertEquals(seen,db.queryForObject("SELECT last_seen_at FROM sessions WHERE id=?",Long.class,sessionId));
    }

    @Test void successfulLoginPersistsTimeAndCountsOnlyRenewableSessions() {
        String name="admin-observe-"+Api.token().substring(0,12);
        auth.createAdmin(name,"test-password-only");
        String id=db.queryForObject("SELECT id FROM users WHERE username=?",String.class,name);
        assertNull(db.queryForObject("SELECT last_login_at FROM users WHERE id=?",Long.class,id));
        Map<String,Object> first=auth.login(json.valueToTree(Map.of("username",name,"password","test-password-only","device_name","Laptop")));
        Map<String,Object> second=auth.login(json.valueToTree(Map.of("username",name,"password","test-password-only","device_name","Laptop")));
        assertNotNull(db.queryForObject("SELECT last_login_at FROM users WHERE id=?",Long.class,id));
        var rows=admin.users(id,"");
        @SuppressWarnings("unchecked") var users=(List<Map<String,Object>>)rows;
        var user=users.stream().filter(u->u.get("id").equals(id)).findFirst().orElseThrow();
        assertEquals(1L,((Number)user.get("device_count")).longValue());
        assertEquals(2L,((Number)user.get("session_count")).longValue());
        assertEquals(2,((List<?>)admin.devices(id,id)).size());
        admin.revokeDevice(id,id,(String)first.get("session_id"));
        assertEquals(1,((List<?>)admin.devices(id,id)).size());
        db.update("UPDATE sessions SET absolute_expires=0 WHERE id=?",second.get("session_id"));
        assertEquals(0,((List<?>)admin.devices(id,id)).size());
        assertEquals(1,db.queryForObject("SELECT count(*) FROM admin_audit WHERE actor=? AND action='admin_session_revoked'",Integer.class,id));
    }
}
