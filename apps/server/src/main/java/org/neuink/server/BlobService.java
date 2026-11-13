package org.neuink.server;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.*;
import java.util.*;
import org.bouncycastle.crypto.digests.Blake3Digest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
class BlobService {
    static final int CHUNK=4*1024*1024;
    private final Path storage; private final JdbcTemplate db; private final TransactionTemplate transactions;
    BlobService(@Value("${neuink.storage}") String directory,JdbcTemplate db,TransactionTemplate transactions) throws IOException {
        storage=Path.of(directory).toAbsolutePath().normalize(); this.db=db; this.transactions=transactions;
        Files.createDirectories(storage.resolve("uploads")); Files.createDirectories(storage.resolve("blobs"));
    }
    private Path upload(String id) { if(!Api.hash(id)) throw Api.fail(400,"invalid_upload"); return storage.resolve("uploads").resolve(id); }
    private Map<String,Object> record(String owner,String id,boolean lock) {
        if(!Api.hash(id)) throw Api.fail(400,"invalid_upload");
        var rows=db.queryForList("SELECT hash,size,offset_bytes FROM uploads WHERE id=? AND owner=? AND expires_at>?"+(lock?" FOR UPDATE":""),id,owner,Api.now());
        if(rows.isEmpty()) throw Api.fail(404,"upload_missing"); return rows.getFirst();
    }
    Object create(String owner,JsonNode request) {
        String hash=Api.text(request,"hash",64); JsonNode length=request.get("size");
        if(!Api.hash(hash) || length==null || !length.isIntegralNumber() || !length.canConvertToLong() || length.longValue()<0 || length.longValue()>2147483648L) throw Api.fail(400,"invalid_blob");
        long size=length.longValue();
        return transactions.execute(tx->{
            long quota=db.queryForObject("SELECT quota FROM users WHERE id=? FOR UPDATE",Long.class,owner);
            db.update("DELETE FROM blob_gc WHERE owner=? AND hash=? AND NOT deleting",owner,hash);
            if(Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM blobs WHERE owner=? AND hash=? AND size=?)",Boolean.class,owner,hash,size))) return Map.of("complete",true,"hash",hash);
            // The owner lock serializes reservations across devices. Reuse an
            // unfinished identical upload rather than charging its size twice.
            var pending=db.queryForList("SELECT id,offset_bytes FROM uploads WHERE owner=? AND hash=? AND size=? AND expires_at>? ORDER BY expires_at DESC LIMIT 1",owner,hash,size,Api.now());
            if(!pending.isEmpty()) return Map.of("id",pending.getFirst().get("id"),"offset",pending.getFirst().get("offset_bytes"),"complete",false);
            long used=new StorageUsage(db).blobs(owner)+new StorageUsage(db).metadata(owner);
            long reserved=db.queryForObject("SELECT COALESCE(SUM(size),0)::BIGINT FROM uploads u WHERE owner=? AND expires_at>? AND NOT EXISTS(SELECT 1 FROM blobs b WHERE b.owner=u.owner AND b.hash=u.hash)",Long.class,owner,Api.now());
            if(used+reserved+size>quota) throw Api.fail(507,"quota_exceeded");
            String id=Api.token();
            try { Files.createFile(upload(id)); } catch(IOException ignored) { throw Api.fail(500,"file_error"); }
            db.update("INSERT INTO uploads(id,owner,hash,size,expires_at) VALUES(?,?,?,?,?)",id,owner,hash,size,Api.now()+86400);
            return Map.of("id",id,"offset",0,"complete",false);
        });
    }
    Object status(String owner,String id) {
        var row=record(owner,id,false);
        return Map.of("hash",row.get("hash"),"size",row.get("size"),"offset",row.get("offset_bytes"));
    }
    Object cancel(String owner,String id) {
        if(!Api.hash(id)) throw Api.fail(400,"invalid_upload");
        transactions.executeWithoutResult(tx -> {
            var rows=db.queryForList("SELECT id FROM uploads WHERE id=? AND owner=? FOR UPDATE",id,owner);
            if(rows.isEmpty()) throw Api.fail(404,"upload_missing");
            // Invalidate before removing bytes so a crash cannot resume a missing file.
            db.update("UPDATE uploads SET expires_at=0 WHERE id=?",id);
        });
        try { Files.deleteIfExists(upload(id)); }
        catch(IOException ignored) { throw Api.fail(503,"upload_cleanup_pending"); }
        db.update("DELETE FROM uploads WHERE id=? AND owner=? AND expires_at=0",id,owner);
        return Map.of("ok",true);
    }
    Object chunk(String owner,String id,long offset,byte[] bytes) {
        if(offset<0 || bytes.length>CHUNK) throw Api.fail(400,"invalid_chunk");
        return transactions.execute(tx->{
            var row=record(owner,id,true); long committed=((Number)row.get("offset_bytes")).longValue(), size=((Number)row.get("size")).longValue();
            if(offset!=committed || bytes.length>size-offset) throw Api.fail(409,"offset_mismatch");
            try(var file=FileChannel.open(upload(id),StandardOpenOption.WRITE)) {
                file.truncate(offset); file.position(offset); ByteBuffer buffer=ByteBuffer.wrap(bytes);
                while(buffer.hasRemaining()) file.write(buffer);
                file.force(true);
            } catch(IOException ignored) { throw Api.fail(500,"file_error"); }
            long next=offset+bytes.length;
            db.update("UPDATE uploads SET offset_bytes=? WHERE id=?",next,id);
            return Map.of("offset",next);
        });
    }
    static String fileHash(Path path) throws IOException {
        Blake3Digest digest=new Blake3Digest(); byte[] buffer=new byte[65536];
        try(var input=Files.newInputStream(path)) { for(int count;(count=input.read(buffer))!=-1;) digest.update(buffer,0,count); }
        byte[] hash=new byte[32]; digest.doFinal(hash,0); return HexFormat.of().formatHex(hash);
    }
    Object complete(String owner,String id) {
        return transactions.execute(tx->{
            db.queryForObject("SELECT id FROM users WHERE id=? FOR UPDATE",String.class,owner);
            var row=record(owner,id,true); long size=((Number)row.get("size")).longValue(); String hash=(String)row.get("hash");
            if(size!=((Number)row.get("offset_bytes")).longValue()) throw Api.fail(400,"upload_incomplete");
            try {
                Path source=upload(id);
                if(Files.size(source)!=size || !fileHash(source).equals(hash)) throw Api.fail(400,"hash_mismatch");
                Path directory=storage.resolve("blobs").resolve(owner); Files.createDirectories(directory);
                Path destination=directory.resolve(hash);
                if(!Files.exists(destination)) {
                    Path temporary=Files.createTempFile(directory,"upload-",".tmp");
                    try {
                        Files.copy(source,temporary,StandardCopyOption.REPLACE_EXISTING);
                        try(var file=FileChannel.open(temporary,StandardOpenOption.WRITE)) { file.force(true); }
                        try {
                            try { Files.move(temporary,destination,StandardCopyOption.ATOMIC_MOVE); }
                            catch(AtomicMoveNotSupportedException ignored) { Files.move(temporary,destination); }
                        } catch(FileAlreadyExistsException ignored) { /* Concurrent identical upload; verify below. */ }
                    } finally { Files.deleteIfExists(temporary); }
                }
                if(Files.size(destination)!=size || !fileHash(destination).equals(hash)) throw Api.fail(500,"stored_blob_corrupt");
            } catch(IOException ignored) { throw Api.fail(500,"file_error"); }
            db.update("INSERT INTO blobs(owner,hash,size) VALUES(?,?,?) ON CONFLICT DO NOTHING",owner,hash,size);
            return Map.of("hash",hash,"size",size);
        });
    }
    record Download(byte[] content,long size,long start,long end,boolean range) {}
    Download download(String owner,String hash,String offset,String range) {
        if(!Api.hash(hash)) throw Api.fail(400,"invalid_hash");
        var rows=db.queryForList("SELECT size FROM blobs WHERE owner=? AND hash=?",owner,hash);
        if(rows.isEmpty()) throw Api.fail(404,"blob_missing");
        long size=((Number)rows.getFirst().get("size")).longValue(), start=0,end;
        try {
            if(range!=null) {
                if(!range.matches("bytes=[0-9]+-[0-9]*")) throw Api.fail(416,"invalid_range");
                String[] parts=range.substring(6).split("-",-1); start=Long.parseLong(parts[0]);
                end=parts[1].isEmpty()?Math.min(size-1,start+CHUNK-1):Long.parseLong(parts[1]);
                if(start<0 || start>=size || end<start || end>=size || end-start>=CHUNK) throw Api.fail(416,"invalid_range");
            } else {
                if(offset!=null) start=Long.parseLong(offset);
                if(start<0 || start>size) throw Api.fail(400,"invalid_offset");
                end=start+Math.min(size-start,CHUNK)-1;
            }
        } catch(NumberFormatException ignored) { throw Api.fail(400,"invalid_offset"); }
        byte[] data=new byte[(int)Math.max(0,end-start+1)];
        try(var file=new RandomAccessFile(storage.resolve("blobs").resolve(owner).resolve(hash).toFile(),"r")) {
            if(file.length()!=size) throw Api.fail(500,"stored_blob_corrupt");
            file.seek(start); file.readFully(data);
        } catch(IOException ignored) { throw Api.fail(500,"file_error"); }
        return new Download(data,size,start,end,range!=null);
    }
}
