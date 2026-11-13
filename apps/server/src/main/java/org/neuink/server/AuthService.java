package org.neuink.server;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.*;
import java.util.concurrent.Semaphore;
import java.util.function.Supplier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
class AuthService {
    record Identity(String user, String session, boolean admin) {}
    @org.springframework.beans.factory.annotation.Value("${NEUINK_INVITE_REQUIRED:true}")
    private boolean inviteRequired = true;
    private final JdbcTemplate db;
    private final TransactionTemplate transactions;
    private final Argon2PasswordEncoder passwords = new Argon2PasswordEncoder(16,32,1,19456,2);
    private final Semaphore slots = new Semaphore(4);
    private final String dummyHash = passwords.encode(Api.token());
    AuthService(JdbcTemplate db, TransactionTemplate transactions) { this.db=db; this.transactions=transactions; }

    Identity authenticate(String authorization) {
        if (authorization == null || !authorization.startsWith("Bearer ") || authorization.length()>256) throw Api.fail(401,"login_required");
        var rows=db.queryForList("SELECT s.id,s.user_id,u.admin FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.access_hash=? AND s.access_expires>? AND NOT s.revoked AND NOT u.disabled",Api.digest(authorization.substring(7)),Api.now());
        if(rows.isEmpty()) throw Api.fail(401,"login_required");
        var row=rows.getFirst();
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
        db.update("INSERT INTO users(id,username,password_hash,admin) VALUES(?,?,?,TRUE)",Api.token(),normalized,encode(password));
    }
    String invite() {
        String token=Api.token();
        db.update("INSERT INTO invites(hash,expires_at) VALUES(?,?)",Api.digest(token),Api.now()+86400);
        return token;
    }
    Map<String,Object> register(JsonNode request) {
        String name=username(request);
        var rawInvitation=request.get("invite");
        if(rawInvitation!=null && !rawInvitation.isTextual()) throw Api.fail(400,"invitation_invalid");
        String invitation=rawInvitation==null?"":rawInvitation.asText().trim();
        if(invitation.length()>128 || (inviteRequired && invitation.isEmpty())) throw Api.fail(400,"invitation_required");
        boolean useInvitation=!invitation.isEmpty();
        if(useInvitation && !Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM invites WHERE hash=? AND NOT used AND expires_at>?)",Boolean.class,Api.digest(invitation),Api.now()))) throw Api.fail(400,"invitation_invalid");
        String hash=encode(Api.text(request,"password",1024));
        return transactions.execute(tx->{
            int maximum=db.queryForObject("SELECT max_accounts FROM registration_policy WHERE id=1 FOR UPDATE",Integer.class);
            long registered=db.queryForObject("SELECT COUNT(*) FROM users WHERE NOT admin",Long.class);
            if(registered>=maximum) throw Api.fail(409,"registration_full");
            if(useInvitation && db.update("UPDATE invites SET used=TRUE WHERE hash=? AND NOT used AND expires_at>?",Api.digest(invitation),Api.now())!=1) throw Api.fail(400,"invitation_invalid");
            String id=Api.token();
            try { db.update("INSERT INTO users(id,username,password_hash) VALUES(?,?,?)",id,name,hash); }
            catch(org.springframework.dao.DuplicateKeyException ignored) { throw Api.fail(409,"username_taken"); }
            return Map.of("account_id",id);
        });
    }
    Map<String,Object> login(JsonNode request) {
        String name=username(request),password=Api.text(request,"password",1024);
        int attempts=db.queryForObject("INSERT INTO auth_limits(name,attempts,window_start) VALUES(?,1,?) ON CONFLICT(name) DO UPDATE SET attempts=CASE WHEN auth_limits.window_start<EXCLUDED.window_start-300 THEN 1 ELSE auth_limits.attempts+1 END,window_start=CASE WHEN auth_limits.window_start<EXCLUDED.window_start-300 THEN EXCLUDED.window_start ELSE auth_limits.window_start END RETURNING attempts",Integer.class,name,Api.now());
        if(attempts>15) throw Api.fail(429,"try_later");
        var rows=db.queryForList("SELECT id,password_hash,disabled FROM users WHERE username=?",name);
        String hash=rows.isEmpty()?dummyHash:(String)rows.getFirst().get("password_hash");
        boolean verified=verify(password,hash);
        if(rows.isEmpty() || !verified || (boolean)rows.getFirst().get("disabled")) throw Api.fail(401,"invalid_credentials");
        String id=(String)rows.getFirst().get("id");
        String device=request.path("device_name").asText("NeuInk");
        String deviceName=device.substring(0,Math.min(device.length(),80));
        return transactions.execute(tx->{
            var current=db.queryForList("SELECT password_hash FROM users WHERE id=? AND NOT disabled FOR UPDATE",id);
            if(current.isEmpty() || !hash.equals(current.getFirst().get("password_hash"))) throw Api.fail(401,"invalid_credentials");
            String access=Api.token(), refresh=Api.token(),session=Api.token(); long now=Api.now();
            db.update("INSERT INTO sessions(id,user_id,device_name,access_hash,access_expires,refresh_hash,refresh_expires,absolute_expires) VALUES(?,?,?,?,?,?,?,?)",session,id,deviceName,Api.digest(access),now+900,Api.digest(refresh),now+2592000,now+7776000);
            return session(id,session,access,refresh);
        });
    }
    private Map<String,Object> session(String user,String id,String access,String refresh) {
        return Map.of("account_id",user,"session_id",id,"access_token",access,"refresh_token",refresh,"expires_in",900);
    }
    Map<String,Object> me(Identity identity) {
        var row=db.queryForMap("SELECT username,quota,admin FROM users WHERE id=?",identity.user());
        row.put("account_id",identity.user()); return row;
    }
    List<Map<String,Object>> devices(Identity identity) {
        var rows=db.queryForList("SELECT id,device_name AS name FROM sessions WHERE user_id=? AND NOT revoked AND refresh_expires>? ORDER BY id",identity.user(),Api.now());
        for(var row:rows) row.put("current",identity.session().equals(row.get("id")));
        return rows;
    }
    void revoke(Identity identity,String session) { db.update("UPDATE sessions SET revoked=TRUE WHERE id=? AND user_id=?",session,identity.user()); }
    void password(Identity identity,JsonNode request) {
        String old=Api.text(request,"old_password",1024),next=Api.text(request,"new_password",1024);
        String hash=db.queryForObject("SELECT password_hash FROM users WHERE id=?",String.class,identity.user());
        if(!verify(old,hash)) throw Api.fail(401,"invalid_credentials");
        String encoded=encode(next);
        transactions.executeWithoutResult(tx->{
            if(db.update("UPDATE users SET password_hash=? WHERE id=? AND password_hash=?",encoded,identity.user(),hash)!=1) throw Api.fail(409,"password_changed");
            db.update("UPDATE sessions SET revoked=TRUE WHERE user_id=?",identity.user());
        });
    }
    String issueReset(String user) {
        if(!Api.hash(user) || db.queryForList("SELECT id FROM users WHERE id=?",user).isEmpty()) throw Api.fail(404,"account_missing");
        String token=Api.token();
        db.update("INSERT INTO reset_tokens(hash,user_id,expires_at) VALUES(?,?,?)",Api.digest(token),user,Api.now()+900);
        return token;
    }
    void reset(JsonNode request) {
        String hash=Api.digest(Api.text(request,"token",128));
        if(db.queryForList("SELECT user_id FROM reset_tokens WHERE hash=? AND expires_at>?",hash,Api.now()).isEmpty()) throw Api.fail(400,"reset_invalid");
        String password=encode(Api.text(request,"password",1024));
        transactions.executeWithoutResult(tx->{
            var rows=db.queryForList("DELETE FROM reset_tokens WHERE hash=? AND expires_at>? RETURNING user_id",hash,Api.now());
            if(rows.isEmpty()) throw Api.fail(400,"reset_invalid");
            String user=(String)rows.getFirst().get("user_id");
            db.update("UPDATE users SET password_hash=? WHERE id=?",password,user);
            db.update("UPDATE sessions SET revoked=TRUE WHERE user_id=?",user);
        });
    }
}
