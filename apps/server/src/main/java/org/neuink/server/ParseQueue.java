package org.neuink.server;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.LinkedHashMap;
import java.util.Map;
import org.neuink.server.persistence.ParseTaskMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/** Queue entries refer only to blobs owned by the authenticated account. */
@Service
class ParseQueue {
    private final ParseTaskMapper db;
    private final TransactionTemplate transactions;
    private final boolean enabled;
    private final long maxBytes;
    ParseQueue(ParseTaskMapper db, TransactionTemplate transactions,
               @Value("${neuink.parse.enabled:false}") boolean enabled,
               @Value("${neuink.parse.max-bytes:268435456}") long maxBytes) {
        this.db=db; this.transactions=transactions; this.enabled=enabled; this.maxBytes=maxBytes;
    }
    Map<String,Object> submit(String owner, JsonNode request) {
        if(!enabled) throw Api.fail(503,"parse_unavailable");
        String hash=Api.text(request,"blob_hash",64);
        if(!Api.hash(hash)) throw Api.fail(400,"invalid_blob");
        String id=Api.text(request,"request_id",64);
        if(!Api.hash(id)) throw Api.fail(400,"invalid_request_id");
        return transactions.execute(tx -> {
            if(db.lockOwner(owner)==null) throw Api.fail(401,"login_required");
            var existing=db.find(id,owner);
            if(existing!=null) {
                if(!hash.equals(existing.get("blob_hash"))) throw Api.fail(409,"request_id_reused");
                return status(owner,id);
            }
            Long size=db.blobSize(owner,hash);
            if(size==null) throw Api.fail(404,"blob_missing");
            if(size<=0 || size>maxBytes) throw Api.fail(413,"parse_file_too_large");
            if(db.activeCount(owner)>=10) throw Api.fail(429,"parse_queue_limit");
            db.insert(id,owner,hash,Api.now());
            return status(owner,id);
        });
    }
    Map<String,Object> status(String owner,String id) {
        if(!Api.hash(id)) throw Api.fail(404,"parse_task_missing");
        var row=db.find(id,owner);
        if(row==null) throw Api.fail(404,"parse_task_missing");
        var result=new LinkedHashMap<>(row);
        if("queued".equals(row.get("state"))) result.put("queue_position",db.ahead(id,owner)+1);
        return result;
    }
    void cancel(String owner,String id) {
        if(!Api.hash(id)) throw Api.fail(404,"parse_task_missing");
        if(db.cancel(id,owner,Api.now())!=1) {
            var row=db.find(id,owner);
            if(row==null) throw Api.fail(404,"parse_task_missing");
            if(!"canceled".equals(row.get("state"))) throw Api.fail(409,"parse_task_not_cancelable");
        }
    }
}
