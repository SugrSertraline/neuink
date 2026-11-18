package org.neuink.server;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.neuink.server.persistence.ParseTaskMapper;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.beans.factory.annotation.Value;
import java.nio.file.*;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import static org.junit.jupiter.api.Assertions.*;

@EnabledIfEnvironmentVariable(named="NEUINK_INTEGRATION", matches="true")
@SpringBootTest(properties={"neuink.parse.enabled=true","neuink.parse.poll-ms=3600000"})
class ParseQueueTest {
    @Autowired ParseQueue queue;
    @Autowired AuthService auth;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate oracle;
    @Autowired ParseTaskMapper mapper;
    @Autowired TransactionTemplate transactions;
    @Value("${neuink.storage}") String storage;

    @Test void accountIsolationQueueCapacityAndIdempotentCancel() {
        String owner=Api.token(), other=Api.token(), hash=Api.token();
        oracle.update("INSERT INTO users(id,username,password_hash) VALUES(?,?,?)",owner,"queue-"+owner,"test");
        oracle.update("INSERT INTO users(id,username,password_hash) VALUES(?,?,?)",other,"queue-"+other,"test");
        oracle.update("INSERT INTO blobs(owner,hash,size) VALUES(?,?,?)",owner,hash,25L*1024*1024);
        var body=json.createObjectNode().put("blob_hash",hash).put("request_id",Api.token());
        assertEquals(404,assertThrows(Api.Failure.class,()->queue.submit(other,body)).status);
        String first=(String)queue.submit(owner,body).get("id");
        assertEquals(first,queue.submit(owner,body).get("id"));
        assertEquals("queued",queue.status(owner,first).get("state"));
        assertEquals(404,assertThrows(Api.Failure.class,()->queue.status(other,first)).status);
        assertEquals(404,assertThrows(Api.Failure.class,()->queue.cancel(other,first)).status);
        for(int i=0;i<9;i++) {body.put("request_id",Api.token()); queue.submit(owner,body);}
        body.put("request_id",Api.token());
        assertEquals(429,assertThrows(Api.Failure.class,()->queue.submit(owner,body)).status);
        queue.cancel(owner,first); queue.cancel(owner,first);
        assertEquals("canceled",queue.status(owner,first).get("state"));
        assertEquals("queued",queue.submit(owner,body).get("state"));
    }

    @Test void workerSubmitsOnceAndRecoversResultAfterRestart() throws Exception {
        oracle.update("UPDATE parse_tasks SET state='canceled' WHERE state='queued'");
        String owner=Api.token(), hash=Api.token();
        oracle.update("INSERT INTO users(id,username,password_hash) VALUES(?,?,?)",owner,"worker-"+owner,"test");
        oracle.update("INSERT INTO blobs(owner,hash,size) VALUES(?,?,?)",owner,hash,10);
        Path input=Path.of(storage).resolve("blobs").resolve(owner).resolve(hash);
        Files.createDirectories(input.getParent()); Files.writeString(input,"test input");
        var server=com.sun.net.httpserver.HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        var submissions=new java.util.concurrent.atomic.AtomicInteger();
        var polls=new java.util.concurrent.atomic.AtomicInteger();
        var multipart=new java.util.concurrent.atomic.AtomicReference<String>();
        var zipBytes=new java.io.ByteArrayOutputStream();
        try(var zip=new java.util.zip.ZipOutputStream(zipBytes)) {
            zip.putNextEntry(new java.util.zip.ZipEntry("paper/auto/paper_content_list.json"));
            zip.write("[]".getBytes(StandardCharsets.UTF_8)); zip.closeEntry();
        }
        server.createContext("/tasks",exchange->{
            byte[] response;
            if("POST".equals(exchange.getRequestMethod())) {
                submissions.incrementAndGet(); multipart.set(new String(exchange.getRequestBody().readAllBytes(),StandardCharsets.UTF_8));
                response="{\"task_id\":\"upstream-1\",\"status\":\"pending\",\"queued_ahead\":0}".getBytes(StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(202,response.length);
            } else if(polls.getAndIncrement()==0) {
                response="{\"status\":\"processing\"}".getBytes(StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(202,response.length);
            } else {
                response=zipBytes.toByteArray();
                exchange.getResponseHeaders().set("Content-Type","application/zip");
                exchange.sendResponseHeaders(200,response.length);
            }
            try(var out=exchange.getResponseBody()) {out.write(response);}
        });
        server.start();
        try {
            var body=json.createObjectNode().put("blob_hash",hash).put("request_id",Api.token());
            String id=(String)queue.submit(owner,body).get("id");
            String url="http://127.0.0.1:"+server.getAddress().getPort();
            new ParseWorker(mapper,transactions,json,storage,url,true).tick();
            assertEquals("running",queue.status(owner,id).get("state"));
            new ParseWorker(mapper,transactions,json,storage,url,true).tick();
            assertEquals("running",queue.status(owner,id).get("state"));
            new ParseWorker(mapper,transactions,json,storage,url,true).tick();
            assertEquals("succeeded",queue.status(owner,id).get("state"));
            assertEquals(1,submissions.get());
            assertTrue(multipart.get().contains("name=\"files\""));
            assertTrue(multipart.get().contains("name=\"response_format_zip\"\r\n\r\ntrue"));
            assertTrue(multipart.get().contains("name=\"return_content_list\"\r\n\r\ntrue"));
            assertTrue(multipart.get().contains("name=\"return_middle_json\"\r\n\r\ntrue"));
            assertTrue(multipart.get().contains("name=\"return_images\"\r\n\r\ntrue"));
            assertArrayEquals(zipBytes.toByteArray(),Files.readAllBytes(Path.of(storage,"parse-results",id+".zip")));
            oracle.update("UPDATE parse_tasks SET updated_at=? WHERE id=?",Api.now()-90000,id);
            new ParseWorker(mapper,transactions,json,storage,url,true).cleanup();
            assertEquals(404,assertThrows(Api.Failure.class,()->queue.status(owner,id)).status);
            assertFalse(Files.exists(Path.of(storage,"parse-results",id+".zip")));
            assertEquals(1,oracle.queryForObject("SELECT count(*) FROM blobs WHERE owner=? AND hash=?",Integer.class,owner,hash));
        } finally {server.stop(0);}
    }

    @Test void uncertainSubmissionBlocksQueueAndCannotBeDismissedByUser() {
        oracle.update("UPDATE parse_tasks SET state='canceled' WHERE state='queued'");
        String owner=Api.token(),hash=Api.token();
        oracle.update("INSERT INTO users(id,username,password_hash) VALUES(?,?,?)",owner,"uncertain-"+owner,"test");
        oracle.update("INSERT INTO blobs(owner,hash,size) VALUES(?,?,?)",owner,hash,42);
        String first=Api.token(),second=Api.token();
        queue.submit(owner,json.createObjectNode().put("blob_hash",hash).put("request_id",first));
        queue.submit(owner,json.createObjectNode().put("blob_hash",hash).put("request_id",second));
        mapper.claim(first,Api.now()); mapper.uncertain(first,Api.now());
        assertEquals(409,assertThrows(Api.Failure.class,()->queue.cancel(owner,first)).status);
        var worker=new ParseWorker(mapper,transactions,json,storage,"http://127.0.0.1:1",true);
        worker.tick();
        assertEquals("uncertain",queue.status(owner,first).get("state"));
        assertEquals("queued",queue.status(owner,second).get("state"));
        oracle.update("UPDATE parse_tasks SET state='failed' WHERE id=?",first);
        queue.cancel(owner,second);
    }
}
