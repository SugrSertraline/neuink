package org.neuink.server;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.*;
import java.util.concurrent.Semaphore;
import java.util.function.Supplier;
import org.neuink.server.persistence.AuthServiceMapper;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
class AuthService {
    record Identity(String user, String session, boolean admin) {}
    @org.springframework.beans.factory.annotation.Value("${NEUINK_INVITE_REQUIRED:true}")
    private boolean inviteRequired = true;
    private final AuthServiceMapper db;
    private final TransactionTemplate transactions;
    private final Argon2PasswordEncoder passwords = new Argon2PasswordEncoder(16,32,1,19456,2);
    private final Semaphore slots = new Semaphore(4);
    private final String dummyHash = passwords.encode(Api.token());
    AuthService(AuthServiceMapper db, TransactionTemplate transactions) { this.db=db; this.transactions=transactions; }

    Identity authenticate(String authorization) {
        if (authorization == null || !authorization.startsWith("Bearer ") || authorization.length()>256) throw Api.fail(401,"login_required");
        var rows=db.findAccessSession(Api.digest(authorization.substring(7)), Api.now());
        if(rows.isEmpty()) throw Api.fail(401,"login_required");
        var row=rows.getFirst();
        long now=Api.now();
        if(row.get("last_seen_at")==null || ((Number)row.get("last_seen_at")).longValue()<now-60) {
            db.touchSession((String)row.get("id"),now,now-60);
        }
        return new Identity((String)row.get("user_id"),(String)row.get("id"),(boolean)row.get("admin"));
    }
    private <T> T passwordWork(Supplier<T> work) {
        if(!slots.tryAcquire()) throw Api.fail(429,"try_later");
        try { return work.get(); } finally { slots.release(); }
    }
    private String encode(String password) {
        if(password.length()<12 || password.getBytes(java.nio.charset.StandardCharsets.UTF_8).length>1024) throw Api.fail(400,"password_length");
        return passwordWork(()->passwords.encode(password));
    }
    private boolean verify(String password,String hash) { return passwordWork(()->passwords.matches(password,hash)); }
    private String username(JsonNode request) {
        String value=Api.text(request,"username",64).trim().toLowerCase(Locale.ROOT);
        if(!value.matches("[a-z0-9._@-]{3,64}")) throw Api.fail(400,"invalid_username");
        return value;
    }
    void createAdmin(String name,String password) {
        String normalized=name.trim().toLowerCase(Locale.ROOT);
        if(!normalized.matches("[a-z0-9._@-]{3,64}")) throw Api.fail(400,"invalid_username");
        db.insertAdministrator(Api.token(), normalized, encode(password));
    }
    String invite() {
        String token=Api.token();
        db.insertInvitation(Api.digest(token), Api.now()+86400);
        return token;
    }
    Map<String,Object> register(JsonNode request) {
        String name=username(request);
        var rawInvitation=request.get("invite");
        if(rawInvitation!=null && !rawInvitation.isTextual()) throw Api.fail(400,"invitation_invalid");
        String invitation=rawInvitation==null?"":rawInvitation.asText().trim();
        if(invitation.length()>128 || (inviteRequired && invitation.isEmpty())) throw Api.fail(400,"invitation_required");
        boolean useInvitation=!invitation.isEmpty();
        if(useInvitation && !Boolean.TRUE.equals(db.hasValidInvitation(Api.digest(invitation), Api.now()))) throw Api.fail(400,"invitation_invalid");
        String hash=encode(Api.text(request,"password",1024));
        return transactions.execute(tx->{
            int maximum=db.lockRegistrationLimit();
            long registered=db.countRegisteredUsers();
            if(registered>=maximum) throw Api.fail(409,"registration_full");
            if(useInvitation && db.consumeInvitation(Api.digest(invitation), Api.now())!=1) throw Api.fail(400,"invitation_invalid");
            String id=Api.token();
            try { db.insertUser(id, name, hash); }
            catch(org.springframework.dao.DuplicateKeyException ignored) { throw Api.fail(409,"username_taken"); }
            return Map.of("account_id",id);
        });
    }
    Map<String,Object> createAccount(String actor, JsonNode request) {
        String name=username(request);
        JsonNode quota=request.get("quota");
        if(quota!=null && (!quota.isIntegralNumber() || !quota.canConvertToLong() || quota.longValue()<0)) throw Api.fail(400,"invalid_quota");
        String hash=encode(Api.text(request,"password",1024));
        return transactions.execute(tx -> {
            db.lockAdministrators();
            if(!Boolean.TRUE.equals(db.isActiveAdmin(actor))) throw Api.fail(403,"admin_required");
            int maximum=db.lockRegistrationLimit();
            if(db.countRegisteredUsers()>=maximum) throw Api.fail(409,"registration_full");
            String id=Api.token();
            try { db.insertUserWithQuota(id,name,hash,quota==null?2147483648L:quota.longValue()); }
            catch(org.springframework.dao.DuplicateKeyException ignored) { throw Api.fail(409,"username_taken"); }
            return Map.of("account_id",id,"username",name);
        });
    }
    Map<String,Object> login(JsonNode request) {
        return login(request,null,null);
    }
    Map<String,Object> login(JsonNode request,String connectionIp,String userAgent) {
        String name=username(request),password=Api.text(request,"password",1024);
        int attempts=db.recordLoginAttempt(name, Api.now());
        if(attempts>15) throw Api.fail(429,"try_later");
        var rows=db.findLoginUser(name);
        String hash=rows.isEmpty()?dummyHash:(String)rows.getFirst().get("password_hash");
        boolean verified=verify(password,hash);
        if(rows.isEmpty() || !verified || (boolean)rows.getFirst().get("disabled")) throw Api.fail(401,"invalid_credentials");
        String id=(String)rows.getFirst().get("id");
        String device=request.path("device_name").asText("NeuInk");
        String deviceName=device.substring(0,Math.min(device.length(),80));
        return transactions.execute(tx->{
            var current=db.lockPassword(id);
            if(current.isEmpty() || !hash.equals(current.getFirst().get("password_hash"))) throw Api.fail(401,"invalid_credentials");
            String access=Api.token(), refresh=Api.token(),session=Api.token(); long now=Api.now();
            db.insertSession(session, id, deviceName, Api.digest(access), now+900, Api.digest(refresh), now+2592000, now+7776000);
            db.updateSessionMetadata(session,now,metadata(connectionIp,64),metadata(userAgent,512));
            db.recordSuccessfulLogin(id,now);
            return session(id,session,access,refresh);
        });
    }
    private static String metadata(String value,int limit) {
        if(value==null || value.isBlank()) return null;
        String clean=value.replaceAll("[\\p{Cntrl}]", "").trim();
        return clean.substring(0,Math.min(clean.length(),limit));
    }
    private Map<String,Object> session(String user,String id,String access,String refresh) {
        return Map.of("account_id",user,"session_id",id,"access_token",access,"refresh_token",refresh,"expires_in",900);
    }
    Map<String,Object> me(Identity identity) {
        var row=db.readAccount(identity.user());
        row.put("account_id",identity.user()); return row;
    }
    List<Map<String,Object>> devices(Identity identity) {
        var rows=db.listSessions(identity.user(), Api.now());
        for(var row:rows) row.put("current",identity.session().equals(row.get("id")));
        return rows;
    }
    void revoke(Identity identity,String session) { db.revokeSession(session, identity.user()); }
    void password(Identity identity,JsonNode request) {
        String old=Api.text(request,"old_password",1024),next=Api.text(request,"new_password",1024);
        String hash=db.readPassword(identity.user());
        if(!verify(old,hash)) throw Api.fail(401,"invalid_credentials");
        String encoded=encode(next);
        transactions.executeWithoutResult(tx->{
            if(db.compareAndSetPassword(encoded, identity.user(), hash)!=1) throw Api.fail(409,"password_changed");
            db.revokeUserSessions(identity.user());
        });
    }
    String issueReset(String user) {
        if(!Api.hash(user) || db.findUser(user).isEmpty()) throw Api.fail(404,"account_missing");
        String token=Api.token();
        db.insertResetToken(Api.digest(token), user, Api.now()+900);
        return token;
    }
    void reset(JsonNode request) {
        String hash=Api.digest(Api.text(request,"token",128));
        if(db.findResetToken(hash, Api.now()).isEmpty()) throw Api.fail(400,"reset_invalid");
        String password=encode(Api.text(request,"password",1024));
        transactions.executeWithoutResult(tx->{
            var rows=db.consumeResetToken(hash, Api.now());
            if(rows.isEmpty()) throw Api.fail(400,"reset_invalid");
            String user=(String)rows.getFirst().get("user_id");
            db.updatePassword(password, user);
            db.revokeUserSessions(user);
        });
    }
}
