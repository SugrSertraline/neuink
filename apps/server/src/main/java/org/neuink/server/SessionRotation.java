package org.neuink.server;

import com.fasterxml.jackson.databind.JsonNode;
import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/** Bounded replay using client-persisted request identity; no recoverable tokens in SQL. */
@Service
class SessionRotation {
    private final JdbcTemplate db;
    private final TransactionTemplate transactions;
    SessionRotation(JdbcTemplate db, TransactionTemplate transactions) { this.db=db; this.transactions=transactions; }
    private String derive(String secret, String request, String purpose) {
        try {
            Mac mac=Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8),"HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(("neuink-refresh-v1:"+purpose+":"+request).getBytes(StandardCharsets.UTF_8)));
        } catch(java.security.GeneralSecurityException ignored) { throw Api.fail(500,"token_generation_failed"); }
    }
    Object rotate(JsonNode request) {
        String previous=Api.text(request,"refresh_token",128), hash=Api.digest(previous);
        String id=request.has("request_id")?Api.text(request,"request_id",64):null;
        if(id!=null && !Api.hash(id)) throw Api.fail(400,"invalid_request_id");
        return transactions.execute(tx -> {
            var candidates=db.queryForList("SELECT user_id FROM sessions WHERE refresh_hash=? OR previous_refresh_hash=?",hash,hash);
            if(candidates.isEmpty()) throw Api.fail(401,"login_required");
            String user=(String)candidates.getFirst().get("user_id");
            if(db.queryForList("SELECT id FROM users WHERE id=? AND NOT disabled FOR UPDATE",user).isEmpty()) throw Api.fail(401,"login_required");
            var rows=db.queryForList("SELECT * FROM sessions WHERE user_id=? AND (refresh_hash=? OR previous_refresh_hash=?) FOR UPDATE",user,hash,hash);
            if(rows.isEmpty()) throw Api.fail(401,"login_required");
            var row=rows.getFirst(); long now=Api.now();
            if((boolean)row.get("revoked") || ((Number)row.get("absolute_expires")).longValue()<=now || ((Number)row.get("refresh_expires")).longValue()<=now) throw Api.fail(401,"login_required");
            String access=id==null?Api.token():derive(previous,id,"access");
            String refresh=id==null?Api.token():derive(previous,id,"refresh");
            if(!hash.equals(row.get("refresh_hash"))) {
                if(id==null || row.get("refresh_replay_until")==null || ((Number)row.get("refresh_replay_until")).longValue()<=now
                        || !Api.digest(id).equals(row.get("refresh_request_hash"))
                        || !Api.digest(access).equals(row.get("access_hash")) || !Api.digest(refresh).equals(row.get("refresh_hash"))) throw Api.fail(401,"login_required");
                return Map.of("account_id",user,"session_id",row.get("id"),"access_token",access,"refresh_token",refresh,
                        "expires_in",Math.max(0,((Number)row.get("access_expires")).longValue()-now));
            }
            db.update("UPDATE sessions SET access_hash=?,access_expires=?,refresh_hash=?,refresh_expires=LEAST(?,absolute_expires),previous_refresh_hash=?,refresh_request_hash=?,refresh_replay_until=? WHERE id=?",
                    Api.digest(access),now+900,Api.digest(refresh),now+2592000,id==null?null:hash,id==null?null:Api.digest(id),id==null?null:now+120,row.get("id"));
            return Map.of("account_id",user,"session_id",row.get("id"),"access_token",access,"refresh_token",refresh,"expires_in",900);
        });
    }
}
