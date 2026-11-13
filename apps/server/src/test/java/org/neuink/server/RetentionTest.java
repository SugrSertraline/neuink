package org.neuink.server;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.*;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.junit.jupiter.api.Assertions.*;

@EnabledIfEnvironmentVariable(named="NEUINK_INTEGRATION",matches="true")
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT)
class RetentionTest {
    @Autowired JdbcTemplate db; @Autowired AuthService auth;
    @Autowired SyncService sync; @Autowired RetentionService retention;
    @Autowired StorageCleanup cleanup;
    @Autowired ServerIdentity identity; @Autowired ObjectMapper json;
    @Value("${neuink.storage}") String storage;
    String owner() {
        String name="retention-"+Api.token().substring(0,12);auth.createAdmin(name,"test-password-only");
        return db.queryForObject("SELECT id FROM users WHERE username=?",String.class,name);
    }
    void apply(String user,String library,Long base,String action,Object content) {
        var operation=json.createObjectNode().put("operation_id",Api.token()).put("object_id","note:test").put("kind","note");
        if(base==null) operation.putNull("base_revision");else operation.put("base_revision",base);
        var mutation=operation.putObject("mutation").put("action",action);
        if(content!=null) mutation.set("content",json.valueToTree(content));
        sync.apply(user,library,json.valueToTree(Map.of("epoch",identity.epoch,"operation",operation)));
    }
    @Test void historyExpiryPublishesCursorFloorAndRetainsCurrentSnapshot() {
        String user=owner();String library=json.valueToTree(sync.createLibrary(user,json.valueToTree(Map.of("name","retention")))).path("id").asText();
        apply(user,library,null,"put",Map.of("text","original"));
        db.update("UPDATE changes SET created_at=0 WHERE library_id=?",library);
        apply(user,library,1L,"delete",null);
        retention.expire(user,Api.now());
        assertEquals(2,db.queryForObject("SELECT count(*) FROM changes WHERE library_id=?",Integer.class,library));
        retention.expire(user,Api.now()+RetentionService.HISTORY_SECONDS+1);
        assertEquals(1,db.queryForObject("SELECT count(*) FROM changes WHERE library_id=?",Integer.class,library));
        assertThrows(RuntimeException.class,()->sync.changes(user,library,identity.epoch,0));
        var snapshot=json.valueToTree(sync.snapshot(user,library,identity.epoch,-1,""));
        assertEquals(1,snapshot.path("minimum_revision").asInt());assertTrue(snapshot.path("objects").get(0).path("deleted").asBoolean());
        apply(user,library,2L,"restore",Map.of("text","restored"));
        assertThrows(RuntimeException.class,()->sync.snapshot(user,library,identity.epoch,2,""));
        retention.expire(user,Api.now()+RetentionService.HISTORY_SECONDS+1);
        assertEquals("restored",json.valueToTree(sync.snapshot(user,library,identity.epoch,-1,"")).path("objects").get(0).path("content").path("text").asText());
    }
    @Test void collectionWaitsRechecksReferencesAndRecoversInterruptedDeletion() throws Exception {
        String user=owner(),hash=Api.digest("retention fixture");long now=Api.now();
        Path directory=Path.of(storage,"blobs",user);Files.createDirectories(directory);Path file=directory.resolve(hash);Files.writeString(file,"fixture");
        db.update("INSERT INTO blobs(owner,hash,size) VALUES(?,?,7)",user,hash);
        retention.collect(user,now);retention.collect(user,now+RetentionService.GRACE_SECONDS-1);assertTrue(Files.exists(file));
        String upload=Api.token();db.update("INSERT INTO uploads(id,owner,hash,size,expires_at) VALUES(?,?,?,7,?)",upload,user,hash,now+2*RetentionService.GRACE_SECONDS);
        retention.collect(user,now+RetentionService.GRACE_SECONDS+1);assertTrue(Files.exists(file));
        assertEquals(0,db.queryForObject("SELECT count(*) FROM blob_gc WHERE owner=?",Integer.class,user));
        db.update("DELETE FROM uploads WHERE id=?",upload);
        retention.collect(user,now+RetentionService.GRACE_SECONDS+2);assertTrue(Files.exists(file));
        retention.collect(user,now+2*RetentionService.GRACE_SECONDS+3);assertFalse(Files.exists(file));
        // Simulate a committed deleting job and an interrupted file removal.
        Files.writeString(file,"fixture");db.update("INSERT INTO blob_gc(owner,hash,candidate_at,deleting) VALUES(?,?,0,TRUE)",user,hash);
        retention.finish(user);assertFalse(Files.exists(file));retention.finish(user);
        // A republished hash must survive a stale deletion job.
        Files.writeString(file,"fixture");db.update("INSERT INTO blobs(owner,hash,size) VALUES(?,?,7)",user,hash);
        db.update("INSERT INTO blob_gc(owner,hash,candidate_at,deleting) VALUES(?,?,0,TRUE)",user,hash);
        retention.finish(user);assertTrue(Files.exists(file));
    }
    @Test void earlyCleanupRequiresExactPreviewAndNeverRemovesCurrentContent() {
        String user=owner();String library=json.valueToTree(sync.createLibrary(user,json.valueToTree(Map.of("name","cleanup")))).path("id").asText();
        apply(user,library,null,"put",Map.of("text","first"));apply(user,library,1L,"put",Map.of("text","second"));
        var preview=json.valueToTree(cleanup.preview(user));assertEquals(1,preview.path("versions").asInt());
        apply(user,library,2L,"put",Map.of("text","third"));
        assertThrows(RuntimeException.class,()->cleanup.clear(user,preview.path("token").asText()));
        var latest=json.valueToTree(cleanup.preview(user));cleanup.clear(user,latest.path("token").asText());
        assertEquals(1,db.queryForObject("SELECT count(*) FROM changes WHERE library_id=?",Integer.class,library));
        assertEquals("third",json.valueToTree(sync.snapshot(user,library,identity.epoch,-1,"")).path("objects").get(0).path("content").path("text").asText());
        assertEquals(0,json.valueToTree(cleanup.preview(user)).path("versions").asInt());
    }

}
