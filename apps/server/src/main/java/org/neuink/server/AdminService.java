package org.neuink.server;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import org.neuink.server.persistence.AdminServiceMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
class AdminService {
    private final AdminServiceMapper db;
    private final TransactionTemplate transactions;
    AdminService(AdminServiceMapper db, TransactionTemplate transactions) {
        this.db = db; this.transactions = transactions;
    }
    private void authorized(String actor) {
        if (!Boolean.TRUE.equals(db.isActiveAdmin(actor))) {
            throw Api.fail(403, "admin_required");
        }
    }
    Object users(String actor, String after) {
        authorized(actor);
        if (!after.isEmpty() && !Api.hash(after)) throw Api.fail(400, "invalid_cursor");
        return db.listAccounts(after, Api.now());
    }
    Object files(String actor,String subject,String after) {
        authorized(actor);
        if(!Api.hash(subject) || (!after.isEmpty() && !Api.hash(after))) throw Api.fail(400,"invalid_cursor");
        if(!Boolean.TRUE.equals(db.accountExists(subject))) throw Api.fail(404,"account_missing");
        var rows=db.listFiles(subject,after);
        boolean more=rows.size()>100;
        var page=new java.util.ArrayList<>(rows.subList(0,Math.min(100,rows.size())));
        if(!page.isEmpty()) {
            var hashes=page.stream().map(file->(String)file.get("hash")).toList();
            var refs=db.listFileReferences(subject,hashes);
            for(var file:page) {
                file.put("references",refs.stream().filter(ref->file.get("hash").equals(ref.get("hash"))).toList());
            }
        }
        return Map.of("items",page,"next",more?page.getLast().get("hash"):"");
    }
    Object devices(String actor,String subject) {
        authorized(actor);
        if(!Api.hash(subject)) throw Api.fail(400,"invalid_account");
        if(!Boolean.TRUE.equals(db.accountExists(subject))) throw Api.fail(404,"account_missing");
        return db.listDevices(subject,Api.now());
    }
    Object revokeDevice(String actor,String subject,String session) {
        if(!Api.hash(subject)||!Api.hash(session)) throw Api.fail(400,"invalid_account");
        return transactions.execute(tx -> {
            db.lockAdministrators();
            authorized(actor);
            if(db.revokeActiveSession(session,subject)!=1) throw Api.fail(404,"session_missing");
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
            db.lockAdministrators();
            authorized(actor);
            var rows = db.lockAccount(subject);
            if (rows.isEmpty()) throw Api.fail(404, "account_missing");
            if (disabled != null && disabled.booleanValue()) {
                if (actor.equals(subject)) throw Api.fail(409, "cannot_disable_self");
                if ((boolean) rows.getFirst().get("admin") && !(boolean) rows.getFirst().get("disabled")
                        && db.countActiveAdministrators() <= 1) {
                    throw Api.fail(409, "last_admin_required");
                }
            }
            if (quota != null) {
                db.updateQuota(quota.longValue(), subject);
                audit(actor, "quota_changed", subject);
            }
            if (disabled != null) {
                db.updateDisabled(disabled.booleanValue(), subject);
                if (disabled.booleanValue()) db.revokeUserSessions(subject);
                audit(actor, disabled.booleanValue() ? "account_disabled" : "account_enabled", subject);
            }
            return Map.of("ok", true);
        });
    }
    void record(String actor, String action, String subject) { authorized(actor); audit(actor, action, subject); }
    private void audit(String actor, String action, String subject) {
        db.insertAudit(actor, action, subject, Api.now());
    }
    Object registration(String actor) {
        authorized(actor);
        return db.readRegistrationPolicy();
    }
    Object registration(String actor, JsonNode request) {
        authorized(actor);
        JsonNode maximum=request.get("max_accounts");
        if(maximum==null || !maximum.isIntegralNumber() || !maximum.canConvertToInt() || maximum.intValue()<0) throw Api.fail(400,"invalid_registration_limit");
        return transactions.execute(tx -> {
            authorized(actor);
            db.updateRegistrationLimit(maximum.intValue());
            audit(actor,"registration_limit_changed",actor);
            return Map.of("ok",true);
        });
    }
    Object audit(String actor, long before) {
        authorized(actor);
        if (before < 1) throw Api.fail(400, "invalid_cursor");
        return db.listAudit(before);
    }
}
