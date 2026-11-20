package org.neuink.server;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.util.*;
import java.util.concurrent.*;
import org.neuink.server.persistence.RevisionWatchMapper;
import org.springframework.stereotype.Service;
import org.springframework.web.context.request.async.DeferredResult;

/** Library version hints. Only the normal delta API may advance a client's durable cursor. */
@Service
class RevisionWatch {
    private static final int MAX_WAITERS=512, MAX_PER_USER=8;
    private final RevisionWatchMapper db;
    private final ServerIdentity server;
    private final ConcurrentMap<UUID,Pending> pending=new ConcurrentHashMap<>();
    private final ScheduledExecutorService timer=Executors.newSingleThreadScheduledExecutor(r->{
        var thread=new Thread(r,"sync-revision-watch");thread.setDaemon(true);return thread;
    });
    private volatile boolean closing;
    record Key(String library,String user,String session,String accessHash) {}
    record Pending(Key key,String epoch,long revision,long deadline,DeferredResult<Object> response) {}
    RevisionWatch(RevisionWatchMapper db,ServerIdentity server) { this.db=db;this.server=server; }
    @PostConstruct void start() { timer.scheduleWithFixedDelay(this::poll,100,1000,TimeUnit.MILLISECONDS); }
    @PreDestroy void close() {
        closing=true;timer.shutdownNow();
        pending.forEach((id,waiter)->waiter.response().setErrorResult(Api.fail(503,"server_restarting")));
        pending.clear();
    }
    DeferredResult<Object> watch(AuthService.Identity identity,String authorization,String library,String epoch,long revision,long waitMillis) {
        if(waitMillis<0 || waitMillis>25000) throw Api.fail(400,"invalid_wait");
        if(revision<0) throw Api.fail(400,"invalid_cursor");
        if(!Api.hash(library)) throw Api.fail(404,"library_missing");
        if(authorization==null || !authorization.startsWith("Bearer ") || authorization.length()>256) throw Api.fail(401,"login_required");
        var key=new Key(library,identity.user(),identity.session(),Api.digest(authorization.substring(7)));
        var result=hint(key,epoch,revision,read(key));
        var response=new DeferredResult<Object>(waitMillis+2000);
        if(waitMillis==0 || (boolean)result.get("changed")) { response.setResult(result);return response; }
        var id=UUID.randomUUID();
        var waiter=new Pending(key,epoch,revision,System.nanoTime()+TimeUnit.MILLISECONDS.toNanos(waitMillis),response);
        response.onCompletion(()->pending.remove(id));
        response.onError(error->pending.remove(id));
        response.onTimeout(()->finish(id,waiter));
        synchronized(pending) {
            if(closing) throw Api.fail(503,"server_restarting");
            if(pending.size()>=MAX_WAITERS || pending.values().stream().filter(p->p.key().user().equals(key.user())).count()>=MAX_PER_USER)
                throw Api.fail(429,"too_many_watchers");
            pending.put(id,waiter);
        }
        // Registration races are harmless: the periodic read sees the committed version.
        return response;
    }
    private Map<String,Object> read(Key key) {
        try { return db.state(key.library(),key.session(),key.user(),key.accessHash(),Api.now()); }
        catch(org.springframework.dao.DataAccessException ignored) { throw Api.fail(503,"storage_unavailable"); }
    }
    private Map<String,Object> hint(Key key,String epoch,long revision,Map<String,Object> state) {
        if(state==null || state.isEmpty()) throw Api.fail(401,"login_required");
        if(state.get("id")==null) throw Api.fail(404,"library_missing");
        if(!server.epoch.equals(epoch)) throw Api.fail(409,"rebaseline_required");
        long minimum=((Number)state.get("minimum_revision")).longValue();
        long current=((Number)state.get("revision")).longValue();
        if(revision<minimum) throw Api.fail(409,"cursor_expired");
        if(revision>current) throw Api.fail(400,"invalid_cursor");
        return Map.of("server_id",server.id,"epoch",server.epoch,"revision",current,"changed",current>revision);
    }
    private void finish(UUID id,Pending waiter) {
        try { waiter.response().setResult(hint(waiter.key(),waiter.epoch(),waiter.revision(),read(waiter.key()))); }
        catch(RuntimeException error) { waiter.response().setErrorResult(error); }
        finally { pending.remove(id); }
    }
    void poll() {
        // One metadata query per distinct identity/library per tick, even with duplicate requests.
        var states=new HashMap<Key,Map<String,Object>>();
        pending.forEach((id,waiter)->{
            if(waiter.response().isSetOrExpired()) { pending.remove(id);return; }
            try {
                var state=states.computeIfAbsent(waiter.key(),this::read);
                var result=hint(waiter.key(),waiter.epoch(),waiter.revision(),state);
                if((boolean)result.get("changed") || System.nanoTime()>=waiter.deadline()) {
                    waiter.response().setResult(result);pending.remove(id);
                }
            } catch(RuntimeException error) { waiter.response().setErrorResult(error);pending.remove(id); }
        });
    }
    int waiting() { return pending.size(); }
}
