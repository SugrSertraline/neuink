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
        return db.queryForList("SELECT u.id,u.username,u.admin,u.disabled,u.quota,"
                + "COALESCE((SELECT SUM(b.size) FROM blobs b WHERE b.owner=u.id),0)::BIGINT AS used_bytes "
                + "FROM users u WHERE u.id>? ORDER BY u.id LIMIT 100", after);
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
