package org.neuink.server;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.*;
import java.util.zip.ZipFile;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.neuink.server.persistence.ParseTaskMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;
import static org.junit.jupiter.api.Assertions.*;

/** Explicit opt-in: synthetic PDF, isolated PostgreSQL and an existing MinerU service. */
@EnabledIfEnvironmentVariable(named="NEUINK_MINERU_LIVE",matches="true")
@SpringBootTest(properties={"neuink.parse.enabled=true","neuink.parse.poll-ms=3600000"})
class ParseMineruLiveTest {
    @Autowired ParseQueue queue;
    @Autowired ParseTaskMapper mapper;
    @Autowired TransactionTemplate transactions;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate db;
    @Value("${neuink.storage}") String storage;

    @Test void syntheticPdfProducesMineruZip() throws Exception {
        Path pdf=Path.of(System.getenv("NEUINK_TEST_PDF"));
        String endpoint=System.getenv("NEUINK_TEST_MINERU_URL");
        assertNotNull(endpoint);
        String owner=Api.token(),hash=Api.token(),id=Api.token();
        db.update("INSERT INTO users(id,username,password_hash) VALUES(?,?,?)",owner,"live-test-"+owner,"test");
        db.update("INSERT INTO blobs(owner,hash,size) VALUES(?,?,?)",owner,hash,Files.size(pdf));
        Path blob=Path.of(storage,"blobs",owner,hash); Files.createDirectories(blob.getParent()); Files.copy(pdf,blob);
        queue.submit(owner,json.createObjectNode().put("blob_hash",hash).put("request_id",id));
        var worker=new ParseWorker(mapper,transactions,json,storage,endpoint,true);
        long deadline=System.nanoTime()+java.time.Duration.ofMinutes(6).toNanos();
        while(System.nanoTime()<deadline) {
            worker.tick();
            String state=(String)queue.status(owner,id).get("state");
            if("succeeded".equals(state)) {
                try(var zip=new ZipFile(Path.of(storage,"parse-results",id+".zip").toFile())) {
                    assertTrue(zip.stream().anyMatch(e->e.getName().endsWith("_content_list.json")));
                }
                return;
            }
            if("failed".equals(state)||"uncertain".equals(state)) fail("MinerU task: "+state+" "+queue.status(owner,id).get("error_code"));
            Thread.sleep(3000);
        }
        fail("MinerU test timed out");
    }
}
