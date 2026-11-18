package org.neuink.server;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.*;
import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import org.neuink.server.persistence.ParseTaskMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/** One outstanding MinerU job across workers. Ambiguous submissions are never replayed. */
@Component
class ParseWorker {
    private final ParseTaskMapper db;
    private final TransactionTemplate transactions;
    private final ObjectMapper json;
    private final HttpClient http=HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(10)).build();
    private final Path storage;
    private final URI upstream;
    private final boolean enabled;
    private static final long MAX_RESULT=256L*1024*1024;
    private static final long RETENTION_SECONDS=24L*60*60;
    ParseWorker(ParseTaskMapper db, TransactionTemplate transactions,ObjectMapper json,
                @Value("${neuink.storage}") String storage,
                @Value("${neuink.parse.upstream:http://127.0.0.1:8000}") String upstream,
                @Value("${neuink.parse.enabled:false}") boolean enabled) {
        this.db=db; this.transactions=transactions; this.json=json;
        this.storage=Path.of(storage).toAbsolutePath().normalize();
        this.upstream=URI.create(upstream.endsWith("/")?upstream:upstream+"/");
        if(!"http".equals(this.upstream.getScheme()) || this.upstream.getHost()==null || this.upstream.getUserInfo()!=null || this.upstream.getQuery()!=null || this.upstream.getFragment()!=null) throw new IllegalArgumentException("Invalid parse upstream");
        this.enabled=enabled;
    }
    @Scheduled(fixedDelayString="${neuink.parse.poll-ms:3000}",initialDelayString="${neuink.parse.poll-ms:3000}")
    public void tick() {
        if(!enabled) return;
        try {
            Map<String,Object> task=transactions.execute(tx->{
                if(!db.lockScheduler()) return null;
                var active=db.active();
                if(active!=null) {
                    if("submitting".equals(active.get("state")) && ((Number)active.get("updated_at")).longValue()<Api.now()-900)
                        db.uncertain((String)active.get("id"),Api.now());
                    else if("running".equals(active.get("state"))) poll(active);
                    return null;
                }
                var next=db.next();
                if(next!=null && db.claim((String)next.get("id"),Api.now())==1) return next;
                return null;
            });
            if(task!=null) submit(task);
        } catch(Exception error) {
            org.slf4j.LoggerFactory.getLogger(ParseWorker.class).warn("Parse queue polling failed; will retry");
        }
    }
    private void submit(Map<String,Object> task) {
        String id=(String)task.get("id"), owner=(String)task.get("owner"), hash=(String)task.get("blob_hash");
        if(!Api.hash(id)||!Api.hash(owner)||!Api.hash(hash)) {db.fail(id,"invalid_task",Api.now());return;}
        String boundary="neuink"+UUID.randomUUID().toString().replace("-","");
        try {
            Path file=storage.resolve("blobs").resolve(owner).resolve(hash);
            byte[] first=("--"+boundary+"\r\nContent-Disposition: form-data; name=\"files\"; filename=\"paper.pdf\"\r\nContent-Type: application/pdf\r\n\r\n").getBytes(StandardCharsets.UTF_8);
            byte[] last=("\r\n--"+boundary+"\r\nContent-Disposition: form-data; name=\"response_format_zip\"\r\n\r\ntrue\r\n--"+boundary+"\r\nContent-Disposition: form-data; name=\"return_content_list\"\r\n\r\ntrue\r\n--"+boundary+"\r\nContent-Disposition: form-data; name=\"return_middle_json\"\r\n\r\ntrue\r\n--"+boundary+"\r\nContent-Disposition: form-data; name=\"return_images\"\r\n\r\ntrue\r\n--"+boundary+"--\r\n").getBytes(StandardCharsets.UTF_8);
            var request=HttpRequest.newBuilder(upstream.resolve("tasks")).timeout(Duration.ofMinutes(5)).header("Content-Type","multipart/form-data; boundary="+boundary)
                .POST(HttpRequest.BodyPublishers.concat(HttpRequest.BodyPublishers.ofByteArray(first),HttpRequest.BodyPublishers.ofFile(file),HttpRequest.BodyPublishers.ofByteArray(last))).build();
            var response=http.send(request,HttpResponse.BodyHandlers.ofString());
            if(response.statusCode()>=500) {db.uncertain(id,Api.now());return;}
            if(response.statusCode()!=202) {db.fail(id,"mineru_submission_http_"+response.statusCode(),Api.now());return;}
            String upstreamId=json.readTree(response.body()).path("task_id").asText();
            if(!upstreamId.matches("[A-Za-z0-9_-]{1,128}")) {db.uncertain(id,Api.now());return;}
            db.running(id,upstreamId,Api.now());
        } catch(Exception error) {
            // MinerU may have accepted the request before the connection failed.
            db.uncertain(id,Api.now());
        }
    }
    @Scheduled(fixedDelayString="${neuink.parse.cleanup-ms:3600000}",initialDelayString="${neuink.parse.cleanup-ms:3600000}")
    public void cleanup() {
        if(!enabled) return;
        try {
            transactions.executeWithoutResult(tx->{
                if(!db.lockScheduler()) return;
                long before=Api.now()-RETENTION_SECONDS;
                for(var row:db.expired(before)) {
                    String id=(String)row.get("id");
                    if(!Api.hash(id)) continue;
                    try { Files.deleteIfExists(storage.resolve("parse-results").resolve(id+".zip")); }
                    catch(IOException error) {continue;}
                    db.deleteExpired(id,before);
                }
            });
        } catch(Exception error) {
            org.slf4j.LoggerFactory.getLogger(ParseWorker.class).warn("Parse task cleanup deferred; will retry");
        }
    }
    private void poll(Map<String,Object> task) {
        String id=(String)task.get("id"), upstreamId=(String)task.get("upstream_id");
        if(!Api.hash(id)||upstreamId==null||!upstreamId.matches("[A-Za-z0-9_-]{1,128}")) {db.fail(id,"mineru_invalid_task",Api.now());return;}
        try {
            var request=HttpRequest.newBuilder(upstream.resolve("tasks/"+upstreamId+"/result")).timeout(Duration.ofSeconds(60)).GET().build();
            var response=http.send(request,HttpResponse.BodyHandlers.ofInputStream());
            try(InputStream stream=response.body()) {
                if(response.statusCode()==202) return;
                if(response.statusCode()==404) {db.fail(id,"mineru_task_missing",Api.now());return;}
                if(response.statusCode()==409) {db.fail(id,"mineru_failed",Api.now());return;}
                if(response.statusCode()!=200) return;
                Path directory=storage.resolve("parse-results"); Files.createDirectories(directory);
                Path tmp=Files.createTempFile(directory,"result-",".tmp");
                try {
                    try(OutputStream out=Files.newOutputStream(tmp)) {
                        byte[] buffer=new byte[65536]; long total=0; int n;
                        while((n=stream.read(buffer))!=-1) {total+=n;if(total>MAX_RESULT) {db.fail(id,"parse_result_too_large",Api.now());return;}out.write(buffer,0,n);}
                    }
                    try(InputStream verify=Files.newInputStream(tmp)) {if(verify.read()!=0x50||verify.read()!=0x4b) {db.fail(id,"mineru_invalid_result",Api.now());return;}}
                    Files.move(tmp,directory.resolve(id+".zip"),StandardCopyOption.REPLACE_EXISTING);
                    db.succeed(id,Api.now());
                } finally {Files.deleteIfExists(tmp);}
            }
        } catch(Exception error) {
            org.slf4j.LoggerFactory.getLogger(ParseWorker.class).warn("MinerU result temporarily unavailable; will retry");
        }
    }
}
