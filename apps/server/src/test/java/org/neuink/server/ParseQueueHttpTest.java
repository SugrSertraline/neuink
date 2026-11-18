package org.neuink.server;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.*;
import java.nio.file.*;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.junit.jupiter.api.Assertions.*;

@EnabledIfEnvironmentVariable(named="NEUINK_INTEGRATION",matches="true")
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"neuink.parse.enabled=true","neuink.parse.poll-ms=3600000"})
class ParseQueueHttpTest {
    @LocalServerPort int port;
    @Autowired AuthService auth;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate db;
    @Value("${neuink.storage}") String storage;
    final HttpClient http=HttpClient.newHttpClient();
    HttpResponse<byte[]> call(String method,String route,String token,Object body) throws Exception {
        var request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+route));
        if(token!=null) request.header("Authorization","Bearer "+token);
        request.header("Content-Type","application/json");
        request.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
        return http.send(request.build(),HttpResponse.BodyHandlers.ofByteArray());
    }
    String login(String username) throws Exception {
        auth.createAdmin(username,"test-password-only");
        var response=call("POST","/v1/auth/login",null,Map.of("username",username,"password","test-password-only"));
        assertEquals(200,response.statusCode());
        return json.readTree(response.body()).path("access_token").asText();
    }
    @Test void unauthenticatedAndOtherAccountsCannotReadOrCancelTasksOrResults() throws Exception {
        String owner=login("parse-owner-"+Api.token().substring(0,12));
        String other=login("parse-other-"+Api.token().substring(0,12));
        db.update("UPDATE users SET admin=false WHERE id=?",auth.authenticate("Bearer "+other).user());
        String ownerId=auth.authenticate("Bearer "+owner).user(), hash=Api.token(), id=Api.token();
        db.update("INSERT INTO blobs(owner,hash,size) VALUES(?,?,?)",ownerId,hash,42);
        var payload=Map.of("blob_hash",hash,"request_id",id);
        assertEquals(401,call("POST","/v1/parse/tasks",null,payload).statusCode());
        assertEquals(404,call("POST","/v1/parse/tasks",other,payload).statusCode());
        assertEquals(200,call("POST","/v1/parse/tasks",owner,payload).statusCode());
        String route="/v1/parse/tasks/"+id;
        assertEquals(401,call("GET",route,null,null).statusCode());
        assertEquals(401,call("GET",route+"/result",null,null).statusCode());
        assertEquals(404,call("GET",route,other,null).statusCode());
        assertEquals(404,call("DELETE",route,other,null).statusCode());
        assertEquals(404,call("GET",route+"/result",other,null).statusCode());
        assertEquals(409,call("GET",route+"/result",owner,null).statusCode());
        byte[] bytes={0x50,0x4b,3,4};
        Path result=Path.of(storage,"parse-results",id+".zip");
        Files.createDirectories(result.getParent()); Files.write(result,bytes);
        db.update("UPDATE parse_tasks SET state='succeeded' WHERE id=?",id);
        assertEquals(404,call("GET",route+"/result",other,null).statusCode());
        var response=call("GET",route+"/result",owner,null);
        assertEquals(200,response.statusCode()); assertArrayEquals(bytes,response.body());
        assertTrue(response.headers().firstValue("Content-Type").orElse("").startsWith("application/zip"));
        String uncertain=Api.token();
        assertEquals(200,call("POST","/v1/parse/tasks",owner,Map.of("blob_hash",hash,"request_id",uncertain)).statusCode());
        db.update("UPDATE parse_tasks SET state='uncertain' WHERE id=?",uncertain);
        String release="/v1/admin/parse/tasks/"+uncertain+"/release";
        assertEquals(403,call("POST",release,other,Map.of("confirm_upstream_stopped",true)).statusCode());
        assertEquals(400,call("POST",release,owner,Map.of()).statusCode());
        assertEquals(200,call("POST",release,owner,Map.of("confirm_upstream_stopped",true)).statusCode());
        assertEquals("failed",db.queryForObject("SELECT state FROM parse_tasks WHERE id=?",String.class,uncertain));
    }
}
