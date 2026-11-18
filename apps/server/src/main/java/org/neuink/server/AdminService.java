package org.neuink.server;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
class AdminService {
    private final JdbcTemplate db;
    private final TransactionTemplate transactions;
    AdminService(JdbcTemplate db, TransactionTemplate transactions) {
        this.db = db; this.transactions = transactions;
    }
    private void authorized(String actor) {
        if (!Boolean.TRUE.equals(db.queryForObject(
                "SELECT EXISTS(SELECT 1 FROM users WHERE id=? AND admin AND NOT disabled)", Boolean.class, actor))) {
            throw Api.fail(403, "admin_required");
        }
    }
    Object users(String actor, String after) {
        authorized(actor);
        if (!after.isEmpty() && !Api.hash(after)) throw Api.fail(400, "invalid_cursor");
        return db.queryForList("SELECT u.id,u.username,u.admin,u.disabled,u.quota,u.last_login_at,"
                + "(SELECT COUNT(DISTINCT s.device_name) FROM sessions s WHERE s.user_id=u.id AND NOT s.revoked AND s.refresh_expires>? AND s.absolute_expires>?) AS device_count,"
                + "(SELECT COUNT(*) FROM sessions s WHERE s.user_id=u.id AND NOT s.revoked AND s.refresh_expires>? AND s.absolute_expires>?) AS session_count,"
                + "COALESCE((SELECT SUM(b.size) FROM blobs b WHERE b.owner=u.id),0)::BIGINT AS used_bytes "
                + "FROM users u WHERE u.id>? ORDER BY u.id LIMIT 100", Api.now(),Api.now(),Api.now(),Api.now(),after);
    }
    Object files(String actor,String subject,String after) {
        authorized(actor);
        if(!Api.hash(subject) || (!after.isEmpty() && !Api.hash(after))) throw Api.fail(400,"invalid_cursor");
        if(!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM users WHERE id=?)",Boolean.class,subject))) throw Api.fail(404,"account_missing");
        var rows=db.queryForList("SELECT hash,size FROM blobs WHERE owner=? AND hash>? ORDER BY hash LIMIT 101",subject,after);
        boolean more=rows.size()>100;
        var page=new java.util.ArrayList<>(rows.subList(0,Math.min(100,rows.size())));
        if(!page.isEmpty()) {
            var params=new java.util.ArrayList<Object>(); params.add(subject);
            for(var file:page) { params.add(file.get("hash")); file.put("references",new java.util.ArrayList<Map<String,Object>>()); }
            String placeholders=String.join(",",java.util.Collections.nCopies(page.size(),"?"));
            var refs=db.queryForList("""
                SELECT hash,library_name,object_id,name FROM (
                    SELECT refs.*,ROW_NUMBER() OVER(PARTITION BY hash ORDER BY library_name,object_id,name) AS position FROM (
                        SELECT DISTINCT r.value->>'hash' AS hash,l.name AS library_name,o.id AS object_id,LEFT(r.value->>'name',1024) AS name
                        FROM libraries l JOIN objects o ON o.library_id=l.id
                        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(o.content#>'{document,resources}')='array' THEN o.content#>'{document,resources}' ELSE '[]'::jsonb END) r(value)
                        WHERE l.owner=? AND NOT o.deleted AND r.value->>'hash' IN (
                """+placeholders+") ) refs) numbered WHERE position<=11 ORDER BY hash,position",params.toArray());
            for(var file:page) {
                file.put("references",refs.stream().filter(ref->file.get("hash").equals(ref.get("hash"))).toList());
            }
        }
        return Map.of("items",page,"next",more?page.getLast().get("hash"):"");
    }
    Object devices(String actor,String subject) {
        authorized(actor);
        if(!Api.hash(subject)) throw Api.fail(400,"invalid_account");
        if(!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM users WHERE id=?)",Boolean.class,subject))) throw Api.fail(404,"account_missing");
        return db.queryForList("SELECT id,device_name,created_at,login_ip,user_agent,last_seen_at,LEAST(refresh_expires,absolute_expires) AS expires_at FROM sessions WHERE user_id=? AND NOT revoked AND refresh_expires>? AND absolute_expires>? ORDER BY last_seen_at DESC NULLS LAST,created_at DESC NULLS LAST,id LIMIT 200",subject,Api.now(),Api.now());
    }
    Object revokeDevice(String actor,String subject,String session) {
        if(!Api.hash(subject)||!Api.hash(session)) throw Api.fail(400,"invalid_account");
        return transactions.execute(tx -> {
            db.queryForList("SELECT id FROM users WHERE admin ORDER BY id FOR UPDATE");
            authorized(actor);
            if(db.update("UPDATE sessions SET revoked=TRUE WHERE id=? AND user_id=? AND NOT revoked",session,subject)!=1) throw Api.fail(404,"session_missing");
            audit(actor,"admin_session_revoked",subject);
            return Map.of("ok",true);
        });
    }
    Object update(String actor, String subject, JsonNode request) {
        if (!Api.hash(subject)) throw Api.fail(400, "invalid_account");
        JsonNode quota = request.get("quota"), disabled = request.get("disabled");
        if (quota == null && disabled == null) throw Api.fail(400, "empty_update");
        if (quota != null && (!quota.isIntegralNumber() || !quota.canConvertToLong() || quota.longValue() < 0)) throw Api.fail(400, "invalid_quota");
        if (disabled != null && !disabled.isBoolean()) throw Api.fail(400, "invalid_disabled");
        return transactions.execute(tx -> {
            // Serialize account administration and recheck authority inside the transaction.
            db.queryForList("SELECT id FROM users WHERE admin ORDER BY id FOR UPDATE");
            authorized(actor);
            var rows = db.queryForList("SELECT admin,disabled FROM users WHERE id=? FOR UPDATE", subject);
            if (rows.isEmpty()) throw Api.fail(404, "account_missing");
            if (disabled != null && disabled.booleanValue()) {
                if (actor.equals(subject)) throw Api.fail(409, "cannot_disable_self");
                if ((boolean) rows.getFirst().get("admin") && !(boolean) rows.getFirst().get("disabled")
                        && db.queryForObject("SELECT COUNT(*) FROM users WHERE admin AND NOT disabled", Long.class) <= 1) {
                    throw Api.fail(409, "last_admin_required");
                }
            }
            if (quota != null) {
                db.update("UPDATE users SET quota=? WHERE id=?", quota.longValue(), subject);
                audit(actor, "quota_changed", subject);
            }
            if (disabled != null) {
                db.update("UPDATE users SET disabled=? WHERE id=?", disabled.booleanValue(), subject);
                if (disabled.booleanValue()) db.update("UPDATE sessions SET revoked=TRUE WHERE user_id=?", subject);
                audit(actor, disabled.booleanValue() ? "account_disabled" : "account_enabled", subject);
            }
            return Map.of("ok", true);
        });
    }
    void record(String actor, String action, String subject) { authorized(actor); audit(actor, action, subject); }
    private void audit(String actor, String action, String subject) {
        db.update("INSERT INTO admin_audit(actor,action,subject,occurred_at) VALUES(?,?,?,?)", actor, action, subject, Api.now());
    }
    Object registration(String actor) {
        authorized(actor);
        return db.queryForMap("SELECT max_accounts,(SELECT COUNT(*) FROM users WHERE NOT admin) AS registered FROM registration_policy WHERE id=1");
    }
    Object registration(String actor, JsonNode request) {
        authorized(actor);
        JsonNode maximum=request.get("max_accounts");
        if(maximum==null || !maximum.isIntegralNumber() || !maximum.canConvertToInt() || maximum.intValue()<0) throw Api.fail(400,"invalid_registration_limit");
        return transactions.execute(tx -> {
            authorized(actor);
            db.update("UPDATE registration_policy SET max_accounts=? WHERE id=1",maximum.intValue());
            audit(actor,"registration_limit_changed",actor);
            return Map.of("ok",true);
        });
    }
    Object audit(String actor, long before) {
        authorized(actor);
        if (before < 1) throw Api.fail(400, "invalid_cursor");
        return db.queryForList("SELECT id,actor,action,subject,occurred_at FROM admin_audit WHERE id<? ORDER BY id DESC LIMIT 100", before);
    }
}
