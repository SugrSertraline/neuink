package org.neuink.server;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.neuink.server.persistence.SyncServiceMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
class SyncService {
    // Each object can reach 2 MiB. Bound page bytes below the Rust client's
    // 16 MiB response ceiling, including JSON overhead and one look-ahead row.
    private static final int PAGE_SIZE=4;
    private static final Set<String> KINDS=Set.of("entry","note","annotation","tag","segment_note","card","board","translation","fold","parse_snapshot","reading_state","user_collection");
    private final StorageUsage usage;
    private final SyncServiceMapper db; private final TransactionTemplate transactions; private final ServerIdentity identity; private final ObjectMapper json; private final FileManifest files;
    SyncService(SyncServiceMapper db,TransactionTemplate transactions,ServerIdentity identity,ObjectMapper json,FileManifest files,StorageUsage usage) {
        this.db=db; this.transactions=transactions; this.identity=identity; this.json=json; this.files=files; this.usage=usage;
    }
    private JsonNode parse(Object value) {
        if(value==null) return json.nullNode();
        try { return json.readTree(value.toString()); } catch(java.io.IOException ignored) { throw Api.fail(500,"stored_content_invalid"); }
    }
    private String encode(JsonNode value) { return value.toString(); }
    private void owner(String user,String library) {
        if(!Api.hash(library) || db.findLibrary(library, user).isEmpty()) throw Api.fail(404,"library_missing");
    }
    Object libraries(String user) { return db.listLibraries(user); }
    Object defaultLibrary(String user) {
        return transactions.execute(tx->{
            db.lockOwner(user);
            var rows=db.listLibraries(user);
            // Preserve legacy libraries and bindings; never silently merge or delete them.
            if(rows.size()>1) throw Api.fail(409,"library_migration_required");
            if(rows.size()==1) {
                var row=rows.getFirst();db.renameLibrary("我的资料库", (String)row.get("id"));
                return Map.of("id",row.get("id"),"name","我的资料库","revision",row.get("revision"),"epoch",identity.epoch);
            }
            String id=Api.token();db.insertLibrary(id, user, "我的资料库");
            return Map.of("id",id,"name","我的资料库","revision",0,"epoch",identity.epoch);
        });
    }
    Object createLibrary(String user,JsonNode request) {
        String name=Api.text(request,"name",240).trim(), id=Api.token();
        db.insertLibrary(id, user, name);
        return Map.of("id",id,"epoch",identity.epoch,"revision",0);
    }
    Object changes(String user,String library,String epoch,long revision) {
        owner(user,library);
        if(!identity.epoch.equals(epoch)) throw Api.fail(409,"rebaseline_required");
        if(revision<0) throw Api.fail(400,"invalid_cursor");
        return transactions.execute(tx->{
        long minimum=db.lockMinimumRevision(library);
        if(revision<minimum) throw Api.fail(409,"cursor_expired");
        var rows=db.listChanges(library, revision, PAGE_SIZE+1);
        boolean more=rows.size()>PAGE_SIZE;
        var items=new ArrayList<Map<String,Object>>();
        for(var row:rows.subList(0,Math.min(rows.size(),PAGE_SIZE))) { row.put("content",parse(row.get("content"))); items.add(row); }
        long cursor=items.isEmpty()?revision:((Number)items.getLast().get("revision")).longValue();
        return Map.of("changes",items,"revision",cursor,"epoch",epoch,"has_more",more,"minimum_revision",minimum);
        });
    }
    Object snapshot(String user,String library,String epoch,long revision,String after) {
        owner(user,library);
        if(!identity.epoch.equals(epoch)) throw Api.fail(409,"rebaseline_required");
        if(after.length()>512 || revision < -1) throw Api.fail(400,"invalid_snapshot_cursor");
        return transactions.execute(tx->{
            var state=db.lockLibraryState(library);
            long current=((Number)state.get("revision")).longValue();
            if(revision!=-1 && revision!=current) throw Api.fail(409,"snapshot_changed");
            if(revision==-1 && !after.isEmpty()) throw Api.fail(400,"invalid_snapshot_cursor");
            var rows=db.listSnapshot(library, after, PAGE_SIZE+1);
            boolean more=rows.size()>PAGE_SIZE;
            var items=new ArrayList<Map<String,Object>>();
            for(var row:rows.subList(0,Math.min(rows.size(),PAGE_SIZE))) {row.put("content",parse(row.get("content")));items.add(row);}
            return Map.of("objects",items,"revision",current,"epoch",epoch,"has_more",more,
                "after",items.isEmpty()?after:items.getLast().get("object_id"),"minimum_revision",state.get("minimum_revision"));
        });
    }
    Object history(String user,String library,String object,long before) {
        owner(user,library);
        if(object.isEmpty() || object.length()>512 || before<0) throw Api.fail(400,"invalid_history_cursor");
        var rows=db.listHistory(library, object, before, PAGE_SIZE+1);
        boolean more=rows.size()>PAGE_SIZE;
        var items=new ArrayList<Map<String,Object>>();
        for(var row:rows.subList(0,Math.min(rows.size(),PAGE_SIZE))) { row.put("content",parse(row.get("content"))); items.add(row); }
        return Map.of("versions",items,"has_more",more,"before",items.isEmpty()?before:items.getLast().get("revision"));
    }
    Object deleteGroup(String user,String library,JsonNode request) {
        String epoch=Api.text(request,"epoch",128);
        var operations=request.path("operations");
        if(!operations.isArray() || operations.isEmpty() || operations.size()>4096) throw Api.fail(400,"invalid_operation");
        if(request.toString().getBytes(StandardCharsets.UTF_8).length>2*1024*1024) throw Api.fail(413,"operation_too_large");
        var ids=new HashSet<String>();
        for(var operation:operations) {
            if(!"delete".equals(operation.path("mutation").path("action").asText()) || !ids.add(Api.text(operation,"object_id",512))) throw Api.fail(400,"invalid_operation");
        }
        // apply() joins this transaction. Any stale child rolls back every
        // tombstone, revision and idempotency receipt in the entire group.
        return transactions.execute(tx->{
            var results=new ArrayList<Object>();
            for(var operation:operations) {
                var result=json.valueToTree(apply(user,library,json.valueToTree(Map.of("epoch",epoch,"operation",operation))));
                results.add(Map.of("operation_id",operation.path("operation_id").asText(),"revision",result.path("revision").longValue()));
            }
            return Map.of("revisions",results);
        });
    }
    Object apply(String user,String library,JsonNode request) {
        if(!identity.epoch.equals(Api.text(request,"epoch",128))) throw Api.fail(409,"rebaseline_required");
        JsonNode op=request.path("operation"), mutation=op.path("mutation");
        String operation=Api.text(op,"operation_id",128), object=Api.text(op,"object_id",512), kind=Api.text(op,"kind",32), action=Api.text(mutation,"action",16);
        if(!KINDS.contains(kind) || !Set.of("put","delete","restore").contains(action)) throw Api.fail(400,"invalid_operation");
        if(!action.equals("delete") && (!mutation.has("content") || mutation.get("content").isNull())) throw Api.fail(400,"invalid_content");
        JsonNode version=op.get("base_revision");
        Long base=null;
        if(version!=null && !version.isNull()) {
            if(!version.isIntegralNumber() || !version.canConvertToLong() || version.longValue()<0) throw Api.fail(400,"invalid_revision");
            base=version.longValue();
        }
        String payload=canonicalOperation(op);
        if(payload.getBytes(StandardCharsets.UTF_8).length>2*1024*1024) throw Api.fail(413,"object_too_large");
        final Long expected=base;
        return transactions.execute(tx->{
            long quota=db.lockQuota(user);
            var libraries=db.lockLibrary(library, user);
            if(libraries.isEmpty()) throw Api.fail(404,"library_missing");
            var replay=db.findOperation(library, operation);
            String hash=Api.digest(payload);
            if(!replay.isEmpty()) {
                if(!hash.equals(replay.getFirst().get("request_hash"))) throw Api.fail(409,"operation_reused");
                return parse(replay.getFirst().get("result"));
            }
            var previous=db.findObject(library, object);
            Long current=previous.isEmpty()?null:((Number)previous.getFirst().get("revision")).longValue();
            if(!Objects.equals(expected,current)) throw Api.fail(409,"revision_conflict");
            if(previous.isEmpty() && !action.equals("put")) throw Api.fail(400,"invalid_operation");
            if(!previous.isEmpty()) {
                var row=previous.getFirst();
                if(!kind.equals(row.get("kind"))) throw Api.fail(400,"kind_changed");
                if((boolean)row.get("deleted") && action.equals("put")) throw Api.fail(409,"restore_required");
                if(!(boolean)row.get("deleted") && action.equals("restore")) throw Api.fail(400,"not_deleted");
            }
            long old=((Number)libraries.getFirst().get("revision")).longValue();
            if(old==Long.MAX_VALUE) throw Api.fail(409,"revision_exhausted");
            long next=old+1;
            boolean deleted=action.equals("delete");
            if(!deleted) files.validate(user,mutation.get("content"));
            String content=deleted?null:encode(mutation.get("content"));
            if(!deleted) {
                long newBytes=db.contentBytes(content);
                if(usage.blobs(user)+usage.metadata(user)+usage.reserved(user)+newBytes>quota) throw Api.fail(507,"quota_exceeded");
            }
            if(current!=null) db.updateHistoryTime(Api.now(), library, current);
            db.upsertObject(library, object, kind, content, next, deleted);
            db.insertChange(library, next, object, kind, content, deleted);
            db.updateRevision(next, library);
            ObjectNode result=json.createObjectNode().put("revision",next).put("object_id",object);
            db.insertOperation(library, operation, hash, result.toString());
            return result;
        });
    }
    // Match the Rust protocol struct's field order, sorting arbitrary JSON object
    // keys inside content. An operation ID is never reusable for a different edit.
    String canonicalOperation(JsonNode op) {
        ObjectNode ordered=json.createObjectNode();
        for(String key:List.of("operation_id","object_id","kind","base_revision")) ordered.set(key,op.has(key)?op.get(key):json.nullNode());
        ObjectNode mutation=json.createObjectNode(); mutation.set("action",op.path("mutation").get("action"));
        if(!op.path("mutation").path("action").asText().equals("delete")) mutation.set("content",sort(op.path("mutation").get("content")));
        ordered.set("mutation",mutation); return ordered.toString();
    }
    private JsonNode sort(JsonNode value) {
        if(value.isObject()) {
            ObjectNode result=json.createObjectNode(); var keys=new TreeSet<String>(); value.fieldNames().forEachRemaining(keys::add);
            for(String key:keys) result.set(key,sort(value.get(key))); return result;
        }
        if(value.isArray()) { var result=json.createArrayNode(); value.forEach(item->result.add(sort(item))); return result; }
        return value;
    }
}
