package org.neuink.server;

import org.apache.ibatis.session.SqlSessionFactory;
import org.apache.ibatis.session.LocalCacheScope;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.neuink.server.persistence.AuthServiceMapper;
import org.neuink.server.persistence.BlobServiceMapper;
import org.neuink.server.persistence.SyncServiceMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

import static org.junit.jupiter.api.Assertions.*;

/** JDBC is an independent test oracle here; production queries use MyBatis. */
@EnabledIfEnvironmentVariable(named = "NEUINK_INTEGRATION", matches = "true")
@SpringBootTest
class MyBatisPersistenceTest {
    @Autowired AuthServiceMapper accounts;
    @Autowired BlobServiceMapper blobs;
    @Autowired SyncServiceMapper sync;
    @Autowired TransactionTemplate transactions;
    @Autowired SqlSessionFactory sessions;
    @Autowired JdbcTemplate oracle;

    String user() {
        String id = Api.token();
        accounts.insertUser(id, "mapper-" + id, "synthetic-test-hash");
        return id;
    }

    @Test void lockQueriesAreNotServedFromSessionCache() {
        assertEquals(LocalCacheScope.STATEMENT, sessions.getConfiguration().getLocalCacheScope());
        assertFalse(sessions.getConfiguration().isCacheEnabled());
        String user = user();
        transactions.executeWithoutResult(tx -> {
            long original = blobs.lockQuota(user);
            oracle.update("UPDATE users SET quota=? WHERE id=?", original + 1, user);
            assertEquals(original + 1, blobs.lockQuota(user));
            tx.setRollbackOnly();
        });
    }

    @Test void returningMutationsCommitAndParticipateInRollback() {
        String user = user(), token = Api.token(), login = "limits-" + Api.token();
        accounts.insertResetToken(token, user, Api.now() + 900);
        assertEquals(1, accounts.recordLoginAttempt(login, Api.now()));
        assertEquals(1, oracle.queryForObject("SELECT attempts FROM auth_limits WHERE name=?", Integer.class, login));
        transactions.executeWithoutResult(tx -> {
            assertEquals(user, accounts.consumeResetToken(token, Api.now()).getFirst().get("user_id"));
            assertEquals(2, accounts.recordLoginAttempt(login, Api.now()));
            tx.setRollbackOnly();
        });
        assertEquals(1, accounts.findResetToken(token, Api.now()).size());
        assertEquals(1, oracle.queryForObject("SELECT attempts FROM auth_limits WHERE name=?", Integer.class, login));
        assertEquals(1, accounts.consumeResetToken(token, Api.now()).size());
        assertTrue(accounts.consumeResetToken(token, Api.now()).isEmpty());
    }

    @Test void jsonAndNullTombstoneFieldsKeepTheirWireShape() {
        String user = user(), library = Api.token();
        sync.insertLibrary(library, user, "Mapper test");
        sync.upsertObject(library, "note:one", "note", "{\"text\":\"中文\"}", 1, false);
        assertTrue(sync.listSnapshot(library, "", 10).getFirst().get("content").toString().contains("中文"));
        sync.upsertObject(library, "note:one", "note", null, 2, true);
        sync.insertChange(library, 2, "note:one", "note", null, true);
        var row = sync.listChanges(library, 0, 10).getFirst();
        assertTrue(row.containsKey("content"));
        assertNull(row.get("content"));
        assertEquals(true, row.get("deleted"));
        assertEquals(2L, ((Number) row.get("revision")).longValue());
    }

    @Test void userInputIsBoundAsDataIncludingQuotesAndSqlTokens() {
        String id = Api.token(), name = "quote-' OR 1=1 -- " + Api.token();
        accounts.insertUser(id, name, "synthetic-test-hash");
        assertEquals(id, accounts.findLoginUser(name).getFirst().get("id"));
        assertTrue(accounts.findLoginUser("' OR 1=1 --").isEmpty());
    }
}
