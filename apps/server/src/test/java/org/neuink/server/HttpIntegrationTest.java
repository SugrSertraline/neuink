package org.neuink.server;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import static org.junit.jupiter.api.Assertions.*;

@EnabledIfEnvironmentVariable(named="NEUINK_INTEGRATION",matches="true")
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT)
class HttpIntegrationTest {
    @LocalServerPort int port;
    @Autowired AuthService auth;
    @Autowired ObjectMapper json;
    @Autowired org.springframework.jdbc.core.JdbcTemplate db;
    @Autowired UploadCleanup cleanup;
    final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    HttpRequest request(String method,String path,String token,String body) {
        var builder=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+path)).timeout(Duration.ofSeconds(30)).header("Content-Type","application/json");
        if(token!=null) builder.header("Authorization","Bearer "+token);
        return builder.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(body)).build();
    }
    HttpResponse<String> call(String method,String path,String token,Object body) throws Exception {
        return http.send(request(method,path,token,body==null?null:json.writeValueAsString(body)),HttpResponse.BodyHandlers.ofString());
    }
    JsonNode ok(HttpResponse<String> response) throws Exception { assertEquals(200,response.statusCode()); return json.readTree(response.body()); }
    ObjectNode op(String id,Long revision,String text,String operation) {
        var node=json.createObjectNode().put("operation_id",operation).put("object_id",id).put("kind","note");
        if(revision==null) node.putNull("base_revision"); else node.put("base_revision",revision);
        node.putObject("mutation").put("action","put").putObject("content").put("text",text); return node;
    }
    @Test void avatarPersistsWithRevisionChecksAndOldClientCompatibility() throws Exception {
        String name="avatar-"+Api.token().substring(0,12);auth.createAdmin(name,"test-password-only");
        String access=ok(call("POST","/v1/auth/login",null,Map.of("username",name,"password","test-password-only"))).path("access_token").asText();
        var initial=(ObjectNode)ok(call("GET","/v1/profile",access,null));
        var bytes=new java.io.ByteArrayOutputStream();javax.imageio.ImageIO.write(new java.awt.image.BufferedImage(256,256,java.awt.image.BufferedImage.TYPE_INT_ARGB),"png",bytes);
        String avatar="data:image/png;base64,"+Base64.getEncoder().encodeToString(bytes.toByteArray());
        initial.put("avatar",avatar);ok(call("PATCH","/v1/profile",access,initial));
        assertEquals(409,call("PATCH","/v1/profile",access,initial).statusCode());
        var current=(ObjectNode)ok(call("GET","/v1/profile",access,null));assertEquals(avatar,current.path("avatar").asText());
        current.remove("avatar");ok(call("PATCH","/v1/profile",access,current));
        current=(ObjectNode)ok(call("GET","/v1/profile",access,null));assertEquals(avatar,current.path("avatar").asText());
        current.put("avatar","https://example.test/avatar.png");assertEquals(400,call("PATCH","/v1/profile",access,current).statusCode());
        current.put("avatar","data:image/png;base64,broken");assertEquals(400,call("PATCH","/v1/profile",access,current).statusCode());
        bytes.reset();javax.imageio.ImageIO.write(new java.awt.image.BufferedImage(257,256,java.awt.image.BufferedImage.TYPE_INT_ARGB),"png",bytes);
        current.put("avatar","data:image/png;base64,"+Base64.getEncoder().encodeToString(bytes.toByteArray()));assertEquals(400,call("PATCH","/v1/profile",access,current).statusCode());
        current.put("avatar","");ok(call("PATCH","/v1/profile",access,current));assertEquals("",ok(call("GET","/v1/profile",access,null)).path("avatar").asText());
    }
    @Test void ordinaryAccountHasOneFixedLibraryEvenWithConcurrentCreation() throws Exception {
        String name="single-"+Api.token().substring(0,12);
        auth.register(json.valueToTree(Map.of("username",name,"password","test-password-only","invite",auth.invite())));
        var session=ok(call("POST","/v1/auth/login",null,Map.of("username",name,"password","test-password-only")));String access=session.path("access_token").asText();
        var first=java.util.concurrent.CompletableFuture.supplyAsync(()->{try{return call("POST","/v1/libraries",access,Map.of("name","Ignored first name"));}catch(Exception e){throw new RuntimeException(e);}});
        var second=java.util.concurrent.CompletableFuture.supplyAsync(()->{try{return call("POST","/v1/libraries/default",access,Map.of());}catch(Exception e){throw new RuntimeException(e);}});
        var left=ok(first.get());var right=ok(second.get());assertEquals(left.path("id"),right.path("id"));assertEquals("我的资料库",left.path("name").asText());
        var repeated=ok(call("POST","/v1/libraries",access,Map.of("name","Cannot rename")));assertEquals(left.path("id"),repeated.path("id"));assertEquals("我的资料库",repeated.path("name").asText());
        assertEquals(1,db.queryForObject("SELECT count(*) FROM libraries WHERE owner=?",Integer.class,session.path("account_id").asText()));
        String admin="legacy-"+Api.token().substring(0,12);auth.createAdmin(admin,"test-password-only");
        var legacy=ok(call("POST","/v1/auth/login",null,Map.of("username",admin,"password","test-password-only")));String legacyAccess=legacy.path("access_token").asText();
        ok(call("POST","/v1/libraries",legacyAccess,Map.of("name","Legacy A")));ok(call("POST","/v1/libraries",legacyAccess,Map.of("name","Legacy B")));
        assertEquals(409,call("POST","/v1/libraries/default",legacyAccess,Map.of()).statusCode());
        assertEquals(2,db.queryForObject("SELECT count(*) FROM libraries WHERE owner=?",Integer.class,legacy.path("account_id").asText()));
    }
    @Test void staleChildRollsBackWholeDeletionGroupAndReplayIsIdempotent() throws Exception {
        String name="delete-group-"+Api.token().substring(0,12);auth.createAdmin(name,"test-password-only");
        var session=ok(call("POST","/v1/auth/login",null,Map.of("username",name,"password","test-password-only")));String access=session.path("access_token").asText();
        var library=ok(call("POST","/v1/libraries",access,Map.of("name","atomic deletion")));String id=library.path("id").asText(),epoch=library.path("epoch").asText();
        String path="/v1/libraries/"+id+"/operations";
        ok(call("POST",path,access,Map.of("epoch",epoch,"operation",op("parent",null,"original","parent-new"))));
        ok(call("POST",path,access,Map.of("epoch",epoch,"operation",op("child",null,"original","child-new"))));
        ok(call("POST",path,access,Map.of("epoch",epoch,"operation",op("child",2L,"concurrent edit","child-edit"))));
        var parent=op("parent",1L,"unused","parent-delete");parent.putObject("mutation").put("action","delete");
        var child=op("child",2L,"unused","child-delete");child.putObject("mutation").put("action","delete");
        var body=Map.of("epoch",epoch,"operations",List.of(parent,child));
        assertEquals(409,call("POST",path+"/delete-group",access,body).statusCode());
        assertEquals(0,db.queryForObject("SELECT count(*) FROM objects WHERE library_id=? AND deleted",Integer.class,id));
        assertEquals(3L,db.queryForObject("SELECT revision FROM libraries WHERE id=?",Long.class,id));
        child.put("base_revision",3L);
        var applied=ok(call("POST",path+"/delete-group",access,body));assertEquals(2,applied.path("revisions").size());
        assertEquals(applied,ok(call("POST",path+"/delete-group",access,body)));
        assertEquals(5L,db.queryForObject("SELECT revision FROM libraries WHERE id=?",Long.class,id));
        assertEquals(2,db.queryForObject("SELECT count(*) FROM objects WHERE library_id=? AND deleted",Integer.class,id));
    }
    @Test void previewCountsOnlyOwnedMatchingBlobsAndRequiresLibraryOwnership() throws Exception {
        String name="preview-"+Api.token().substring(0,12);auth.createAdmin(name,"test-password-only");
        String second="preview-other-"+Api.token().substring(0,12);auth.createAdmin(second,"test-password-only");
        var session=ok(call("POST","/v1/auth/login",null,Map.of("username",name,"password","test-password-only")));
        var other=ok(call("POST","/v1/auth/login",null,Map.of("username",second,"password","test-password-only")));
        String access=session.path("access_token").asText(),owner=session.path("account_id").asText();
        var library=ok(call("POST","/v1/libraries",access,Map.of("name","preview")));String id=library.path("id").asText();
        String ownHash=Api.digest("own"),otherHash=Api.digest("other");
        db.update("INSERT INTO blobs(owner,hash,size) VALUES(?,?,7)",owner,ownHash);
        db.update("INSERT INTO blobs(owner,hash,size) VALUES(?,?,9)",other.path("account_id").asText(),otherHash);
        var body=Map.of("files",List.of(Map.of("hash",ownHash,"size",7),Map.of("hash",otherHash,"size",9)),"ids",List.of("note:absent"));
        var result=ok(call("POST","/v1/libraries/"+id+"/preview",access,body));
        assertEquals(7,result.path("existing_attachment_bytes").asLong());assertEquals(9,result.path("new_attachment_bytes").asLong());
        assertEquals(404,call("POST","/v1/libraries/"+id+"/preview",other.path("access_token").asText(),body).statusCode());
        assertEquals(400,call("POST","/v1/libraries/"+id+"/preview",access,Map.of("files",List.of(Map.of("hash",ownHash,"size",7),Map.of("hash",ownHash,"size",7)),"ids",List.of())).statusCode());
    }
    @Test void adminWebsiteUsesSecureCookiesAndRevocableSessions() throws Exception {
        String name="web-"+Api.token().substring(0,12);auth.createAdmin(name,"test-password-only");
        assertEquals(200,call("GET","/admin/index.html",null,null).statusCode());
        var body=json.writeValueAsString(Map.of("username",name,"password","test-password-only"));
        var login=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/admin/api/login"))
            .header("Content-Type","application/json").header("X-Neuink-Admin","1").POST(HttpRequest.BodyPublishers.ofString(body)).build();
        var response=http.send(login,HttpResponse.BodyHandlers.ofString());var value=ok(response);
        assertFalse(value.has("access_token"));String csrf=value.path("csrf").asText();
        String setCookie=response.headers().firstValue("Set-Cookie").orElseThrow();
        assertTrue(setCookie.contains("Secure"));assertTrue(setCookie.contains("HttpOnly"));
        String cookie=setCookie.split(";",2)[0];
        for(boolean valid:List.of(false,true)) {
            var update=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/admin/api/registration"))
                .header("Content-Type","application/json").header("Cookie",cookie).header("X-Neuink-Admin","1")
                .header("X-CSRF-Token",valid?csrf:"wrong")
                .method("PATCH",HttpRequest.BodyPublishers.ofString("{\"max_accounts\":100}")).build();
            assertEquals(valid?200:403,http.send(update,HttpResponse.BodyHandlers.ofString()).statusCode());
        }
        var logout=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/admin/api/logout"))
            .header("Content-Type","application/json").header("Cookie",cookie).header("X-Neuink-Admin","1")
            .header("X-CSRF-Token",csrf).POST(HttpRequest.BodyPublishers.ofString("{}")).build();
        assertEquals(200,http.send(logout,HttpResponse.BodyHandlers.ofString()).statusCode());
        var status=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/admin/api/session")).header("Cookie",cookie).GET().build();
        assertEquals(401,http.send(status,HttpResponse.BodyHandlers.ofString()).statusCode());
    }
    @Test void largeManifestsAndCurrentMetadataAreCountedOnce() throws Exception {
        String name="manifest-"+Api.token().substring(0,12);auth.createAdmin(name,"test-password-only");
        var session=ok(call("POST","/v1/auth/login",null,Map.of("username",name,"password","test-password-only")));
        String access=session.path("access_token").asText(),user=session.path("account_id").asText();
        var library=ok(call("POST","/v1/libraries",access,Map.of("name","manifest-isolation")));
        String id=library.path("id").asText(),epoch=library.path("epoch").asText();
        var node=op("large",null,"body","large-first");
        var content=(ObjectNode)node.path("mutation").path("content");var files=content.putArray("_files");
        for(int i=0;i<257;i++) {
            String hash=Api.digest("image-"+i);db.update("INSERT INTO blobs(owner,hash,size) VALUES(?,?,?)",user,hash,1);
            files.addObject().put("hash",hash).put("size",1);
        }
        ok(call("POST","/v1/libraries/"+id+"/operations",access,Map.of("epoch",epoch,"operation",node)));
        long bytes=db.queryForObject("SELECT octet_length(content::text) FROM objects WHERE library_id=? AND id='large'",Long.class,id);
        assertEquals(bytes,new StorageUsage(db).metadata(user));
        node.put("operation_id","large-second").put("base_revision",1);content.put("text","second");
        ok(call("POST","/v1/libraries/"+id+"/operations",access,Map.of("epoch",epoch,"operation",node)));
        long next=db.queryForObject("SELECT octet_length(content::text) FROM objects WHERE library_id=? AND id='large'",Long.class,id);
        assertEquals(bytes+next,new StorageUsage(db).metadata(user));
        node.put("operation_id","large-missing").put("base_revision",2);files.addObject().put("hash","f".repeat(64)).put("size",1);
        assertEquals(409,call("POST","/v1/libraries/"+id+"/operations",access,Map.of("epoch",epoch,"operation",node)).statusCode());
    }
    @Test void accountsConcurrentConflictHistoryDeletionAndResumableAttachment() throws Exception {
        String suffix=Api.token().substring(0,12), name="owner-"+suffix;
        auth.createAdmin(name,"test-password-only");
        String invite=auth.invite();
        ok(call("POST","/v1/auth/register",null,Map.of("username","other-"+suffix,"password","test-password-only","invite",invite)));
        assertEquals(400,call("POST","/v1/auth/register",null,Map.of("username","repeat-"+suffix,"password","test-password-only","invite",invite)).statusCode());
        var first=ok(call("POST","/v1/auth/login",null,Map.of("username",name,"password","test-password-only")));
        String access=first.path("access_token").asText();
        var second=ok(call("POST","/v1/auth/login",null,Map.of("username","other-"+suffix,"password","test-password-only")));
        String other=second.path("access_token").asText();
        String otherId=second.path("account_id").asText();
        assertEquals(403,call("GET","/v1/admin/users",other,null).statusCode());
        ok(call("PATCH","/v1/admin/users/"+otherId,access,Map.of("quota",1024,"disabled",true)));
        assertEquals(401,call("GET","/v1/me",other,null).statusCode());
        assertEquals(401,call("POST","/v1/auth/login",null,Map.of("username","other-"+suffix,"password","test-password-only")).statusCode());
        ok(call("PATCH","/v1/admin/users/"+otherId,access,Map.of("disabled",false)));
        assertEquals(401,call("GET","/v1/me",other,null).statusCode());
        other=ok(call("POST","/v1/auth/login",null,Map.of("username","other-"+suffix,"password","test-password-only"))).path("access_token").asText();
        assertEquals(507,call("POST","/v1/uploads",other,Map.of("hash","1".repeat(64),"size",1025)).statusCode());
        assertEquals(409,call("PATCH","/v1/admin/users/"+first.path("account_id").asText(),access,Map.of("disabled",true)).statusCode());
        assertFalse(ok(call("GET","/v1/admin/audit",access,null)).isEmpty());
        var expired=ok(call("POST","/v1/uploads",other,Map.of("hash","2".repeat(64),"size",512)));
        db.update("UPDATE uploads SET expires_at=0 WHERE id=?",expired.path("id").asText());
        assertTrue(cleanup.clean()>0);
        assertEquals(404,call("GET","/v1/uploads/"+expired.path("id").asText(),other,null).statusCode());
        assertEquals(401,call("GET","/v1/libraries",null,null).statusCode());
        var library=ok(call("POST","/v1/libraries",access,Map.of("name","Isolated integration")));
        String id=library.path("id").asText(),epoch=library.path("epoch").asText(),route="/v1/libraries/"+id;
        assertEquals(404,call("GET",route+"/changes?epoch="+epoch,other,null).statusCode());
        ObjectNode original=op("n",null,"base","original");
        var originalBody=Map.of("epoch",epoch,"operation",original);
        assertEquals(1,ok(call("POST",route+"/operations",access,originalBody)).path("revision").asLong());
        assertEquals(1,ok(call("POST",route+"/operations",access,originalBody)).path("revision").asLong());
        assertEquals(409,call("POST",route+"/operations",access,Map.of("epoch",epoch,"operation",op("n",1L,"different","original"))).statusCode());
        var left=http.sendAsync(request("POST",route+"/operations",access,json.writeValueAsString(Map.of("epoch",epoch,"operation",op("n",1L,"left","left")))),HttpResponse.BodyHandlers.ofString());
        var right=http.sendAsync(request("POST",route+"/operations",access,json.writeValueAsString(Map.of("epoch",epoch,"operation",op("n",1L,"right","right")))),HttpResponse.BodyHandlers.ofString());
        var statuses=new ArrayList<>(List.of(left.join().statusCode(),right.join().statusCode())); Collections.sort(statuses); assertEquals(List.of(200,409),statuses);
        assertEquals(2,ok(call("GET",route+"/objects/n/versions",access,null)).path("versions").size());
        assertEquals(404,call("GET",route+"/objects/n/versions",other,null).statusCode());
        var delete=op("n",1L,"unused","delete"); delete.set("mutation",json.createObjectNode().put("action","delete"));
        assertEquals(409,call("POST",route+"/operations",access,Map.of("epoch",epoch,"operation",delete)).statusCode());
        delete.put("base_revision",2); assertEquals(3,ok(call("POST",route+"/operations",access,Map.of("epoch",epoch,"operation",delete))).path("revision").asLong());
        var restore=op("n",3L,"restored","restore");
        assertEquals(409,call("POST",route+"/operations",access,Map.of("epoch",epoch,"operation",restore)).statusCode());
        ((ObjectNode)restore.get("mutation")).put("action","restore");
        assertEquals(4,ok(call("POST",route+"/operations",access,Map.of("epoch",epoch,"operation",restore))).path("revision").asLong());
        assertEquals(4,ok(call("GET",route+"/changes?epoch="+epoch,access,null)).path("changes").size());
        assertEquals(409,call("GET",route+"/changes?epoch=old",access,null).statusCode());
        byte[] content=new byte[BlobService.CHUNK+19]; new Random(1).nextBytes(content); String hash=Api.digest(content);
        var upload=ok(call("POST","/v1/uploads",access,Map.of("hash",hash,"size",content.length))); String uploadPath="/v1/uploads/"+upload.path("id").asText();
        assertEquals(404,call("GET",uploadPath,other,null).statusCode());
        var chunk=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+uploadPath+"?offset=0")).header("Authorization","Bearer "+access).header("Content-Type","application/octet-stream").PUT(HttpRequest.BodyPublishers.ofByteArray(content,0,BlobService.CHUNK)).build();
        assertEquals(200,http.send(chunk,HttpResponse.BodyHandlers.discarding()).statusCode());
        assertEquals(409,http.send(chunk,HttpResponse.BodyHandlers.discarding()).statusCode());
        assertEquals(BlobService.CHUNK,ok(call("GET",uploadPath,access,null)).path("offset").asInt());
        var resumed=ok(call("POST","/v1/uploads",access,Map.of("hash",hash,"size",content.length)));
        assertEquals(upload.path("id").asText(),resumed.path("id").asText());
        assertEquals(BlobService.CHUNK,resumed.path("offset").asInt());
        assertEquals(400,call("POST",uploadPath+"/complete",access,Map.of()).statusCode());
        var tail=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+uploadPath+"?offset="+BlobService.CHUNK)).header("Authorization","Bearer "+access).header("Content-Type","application/octet-stream").PUT(HttpRequest.BodyPublishers.ofByteArray(content,BlobService.CHUNK,19)).build();
        assertEquals(200,http.send(tail,HttpResponse.BodyHandlers.discarding()).statusCode());
        ok(call("POST",uploadPath+"/complete",access,Map.of())); ok(call("POST",uploadPath+"/complete",access,Map.of()));
        assertTrue(ok(call("POST","/v1/uploads",access,Map.of("hash",hash,"size",content.length))).path("complete").asBoolean());
        assertEquals(404,call("GET","/v1/blobs/"+hash,other,null).statusCode());
        var download=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/v1/blobs/"+hash)).header("Authorization","Bearer "+access).header("Range","bytes="+BlobService.CHUNK+"-").GET().build();
        var downloaded=http.send(download,HttpResponse.BodyHandlers.ofByteArray()); assertEquals(206,downloaded.statusCode()); assertArrayEquals(Arrays.copyOfRange(content,BlobService.CHUNK,content.length),downloaded.body());
        var withFile=op("with-file",null,"document","manifest");
        ((ObjectNode)withFile.path("mutation").path("content")).putArray("_files").addObject().put("hash",hash).put("size",content.length);
        ok(call("POST",route+"/operations",access,Map.of("epoch",epoch,"operation",withFile)));
        var firstPage=ok(call("GET",route+"/changes?epoch="+epoch,access,null));
        assertTrue(firstPage.path("has_more").asBoolean());
        assertEquals(4,firstPage.path("changes").size());
        var nextPage=ok(call("GET",route+"/changes?epoch="+epoch+"&revision="+firstPage.path("revision").asLong(),access,null));
        assertFalse(nextPage.path("has_more").asBoolean());
        assertEquals("with-file",nextPage.path("changes").get(0).path("object_id").asText());
        var missingFile=op("missing-file",null,"document","missing-manifest");
        ((ObjectNode)missingFile.path("mutation").path("content")).putArray("_files").addObject().put("hash","0".repeat(64)).put("size",7);
        assertEquals(409,call("POST",route+"/operations",access,Map.of("epoch",epoch,"operation",missingFile)).statusCode());
        var bad=ok(call("POST","/v1/uploads",access,Map.of("hash","0".repeat(64),"size",3)));
        String badPath="/v1/uploads/"+bad.path("id").asText();
        var badChunk=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+badPath+"?offset=0")).header("Authorization","Bearer "+access).header("Content-Type","application/octet-stream").PUT(HttpRequest.BodyPublishers.ofByteArray(new byte[]{1,2,3})).build();
        assertEquals(200,http.send(badChunk,HttpResponse.BodyHandlers.discarding()).statusCode());
        assertEquals(400,call("POST",badPath+"/complete",access,Map.of()).statusCode());
        assertEquals(404,call("DELETE",badPath,other,null).statusCode());
        ok(call("DELETE",badPath,access,null));
        assertEquals(404,call("GET",badPath,access,null).statusCode());
        assertEquals(404,call("GET","/v1/blobs/"+"0".repeat(64),access,null).statusCode());
        String refreshRequest=Api.token();
        var refreshBody=Map.of("refresh_token",first.path("refresh_token").asText(),"request_id",refreshRequest);
        var refreshed=ok(call("POST","/v1/auth/refresh",null,refreshBody));
        var replayed=ok(call("POST","/v1/auth/refresh",null,refreshBody));
        assertEquals(refreshed.path("access_token"),replayed.path("access_token"));
        assertEquals(refreshed.path("refresh_token"),replayed.path("refresh_token"));
        assertEquals(401,call("POST","/v1/auth/refresh",null,Map.of("refresh_token",first.path("refresh_token").asText(),"request_id",Api.token())).statusCode());
        assertEquals(401,call("GET","/v1/me",access,null).statusCode());
        String next=refreshed.path("access_token").asText();
        ok(call("POST","/v1/auth/logout",next,Map.of())); assertEquals(401,call("GET","/v1/me",next,null).statusCode());
    }
}
