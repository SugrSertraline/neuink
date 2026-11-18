package org.neuink.server;

import java.sql.Connection;
import java.sql.DriverManager;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import static org.junit.jupiter.api.Assertions.*;

/** No application context: both migrations and fixtures stay in this test's schema. */
@EnabledIfEnvironmentVariable(named="NEUINK_INTEGRATION",matches="true")
class AdminMigrationUpgradeTest {
    @Test void v9ParsingDataSurvivesAdminObservabilityMigrations() throws Exception {
        String url=requiredEnvironment("NEUINK_DATABASE_URL");
        String user=requiredEnvironment("NEUINK_DATABASE_USER");
        String password=requiredEnvironment("NEUINK_DATABASE_PASSWORD");
        String schema="neuink_v9_upgrade_"+UUID.randomUUID().toString().replace("-","");
        String identifier=ownedSchemaIdentifier(schema);
        try(Connection connection=DriverManager.getConnection(url,user,password)) {
            boolean created=false;
            try {
                // No IF NOT EXISTS: an unexpected collision must never claim another schema.
                try(var statement=connection.createStatement()) {
                    statement.execute("CREATE SCHEMA "+identifier);
                }
                created=true;
                Flyway old=migration(url,user,password,schema,"9");
                assertEquals(9,old.migrate().migrationsExecuted);
                assertEquals("9",old.info().current().getVersion().getVersion());
                connection.setSchema(schema);
                var db=new JdbcTemplate(new SingleConnectionDataSource(connection,true));
                assertEquals(schema,db.queryForObject("SELECT current_schema()",String.class));
                seedLegacyData(db);
                var before=legacyData(db);
                Long lastSequence=db.queryForObject("SELECT MAX(sequence) FROM parse_tasks",Long.class);

                Flyway upgraded=migration(url,user,password,schema,"11");
                assertEquals(2,upgraded.migrate().migrationsExecuted);
                upgraded.validate();
                assertEquals("11",upgraded.info().current().getVersion().getVersion());
                assertEquals(before,legacyData(db));

                var columns=db.queryForMap("""
                    SELECT u.last_login_at,s.created_at,s.login_ip,s.user_agent,s.last_seen_at
                    FROM users u JOIN sessions s ON s.user_id=u.id
                    """);
                assertEquals(5,columns.size());
                assertTrue(columns.values().stream().allMatch(value->value==null));
                assertEquals(1,db.update("UPDATE users SET last_login_at=? WHERE id=?",1120L,"1".repeat(64)));
                assertEquals(1,db.update("UPDATE sessions SET created_at=?,login_ip=?,user_agent=?,last_seen_at=? WHERE id=?",
                    1100L,"127.0.0.1","Synthetic migration test",1121L,"2".repeat(64)));
                assertEquals(Map.of("last_login_at",1120L,"created_at",1100L,"login_ip","127.0.0.1",
                    "user_agent","Synthetic migration test","last_seen_at",1121L),db.queryForMap("""
                    SELECT u.last_login_at,s.created_at,s.login_ip,s.user_agent,s.last_seen_at
                    FROM users u JOIN sessions s ON s.user_id=u.id
                    """));
                db.update("INSERT INTO parse_tasks(id,owner,blob_hash,state,created_at,updated_at) VALUES(?,?,?,'queued',?,?)",
                    "a".repeat(64),"1".repeat(64),"6".repeat(64),1130L,1130L);
                assertTrue(db.queryForObject("SELECT sequence FROM parse_tasks WHERE id=?",Long.class,"a".repeat(64))>lastSequence);
            } finally {
                if(created) {
                    // The generated identifier is revalidated; never use Flyway.clean().
                    connection.setSchema("pg_catalog");
                    try(var statement=connection.createStatement()) {
                        statement.execute("DROP SCHEMA "+ownedSchemaIdentifier(schema)+" CASCADE");
                    }
                }
            }
        }
    }

    private static Flyway migration(String url,String user,String password,String schema,String target) {
        ownedSchemaIdentifier(schema);
        return Flyway.configure().dataSource(url,user,password)
            .locations("classpath:db/migration").schemas(schema).defaultSchema(schema)
            .createSchemas(false).cleanDisabled(true).target(target).load();
    }

    private static String requiredEnvironment(String name) {
        String value=System.getenv(name);
        assertNotNull(value,"Configure the isolated integration database: "+name);
        assertFalse(value.isBlank(),"Configure the isolated integration database: "+name);
        return value;
    }

    private static String ownedSchemaIdentifier(String schema) {
        if(!schema.matches("neuink_v9_upgrade_[0-9a-f]{32}")) {
            throw new IllegalArgumentException("Refusing a schema outside this migration test");
        }
        return "\""+schema+"\"";
    }

    private static void seedLegacyData(JdbcTemplate db) {
        String owner="1".repeat(64),library="5".repeat(64),blob="6".repeat(64);
        String content="{\"title\":\"Synthetic legacy item\"}";
        db.update("INSERT INTO users(id,username,password_hash,quota) VALUES(?,?,?,?)",
            owner,"legacy-migration-user","synthetic-test-hash",123456L);
        db.update("INSERT INTO sessions(id,user_id,device_name,access_hash,access_expires,refresh_hash,refresh_expires,absolute_expires) VALUES(?,?,?,?,?,?,?,?)",
            "2".repeat(64),owner,"Legacy device","3".repeat(64),2000L,"4".repeat(64),3000L,4000L);
        db.update("INSERT INTO libraries(id,owner,name,revision) VALUES(?,?,?,?)",library,owner,"Legacy library",7L);
        db.update("INSERT INTO blobs(owner,hash,size) VALUES(?,?,?)",owner,blob,4096L);
        db.update("INSERT INTO objects(library_id,id,kind,content,revision,deleted) VALUES(?,?,'entry',?::jsonb,7,FALSE)",
            library,"entry:legacy",content);
        db.update("INSERT INTO changes(library_id,revision,object_id,kind,content,deleted) VALUES(?,7,?,'entry',?::jsonb,FALSE)",
            library,"entry:legacy",content);
        db.update("INSERT INTO parse_tasks(id,owner,blob_hash,state,created_at,updated_at,upstream_id) VALUES(?,?,?,'running',?,?,?)",
            "7".repeat(64),owner,blob,1000L,1001L,"synthetic-upstream");
        db.update("INSERT INTO parse_tasks(id,owner,blob_hash,state,created_at,updated_at) VALUES(?,?,?,'queued',?,?)",
            "8".repeat(64),owner,blob,1002L,1002L);
    }

    private static Map<String,List<Map<String,Object>>> legacyData(JdbcTemplate db) {
        return Map.of(
            "users",db.queryForList("SELECT id,username,password_hash,admin,disabled,quota FROM users ORDER BY id"),
            "sessions",db.queryForList("SELECT id,user_id,device_name,access_hash,access_expires,refresh_hash,refresh_expires,absolute_expires,revoked FROM sessions ORDER BY id"),
            "libraries",db.queryForList("SELECT id,owner,name,revision FROM libraries ORDER BY id"),
            "blobs",db.queryForList("SELECT owner,hash,size FROM blobs ORDER BY owner,hash"),
            "objects",db.queryForList("SELECT library_id,id,kind,content::text,revision,deleted FROM objects ORDER BY library_id,id"),
            "changes",db.queryForList("SELECT library_id,revision,object_id,kind,content::text,deleted FROM changes ORDER BY library_id,revision"),
            "parse_tasks",db.queryForList("SELECT id,sequence,owner,blob_hash,state,created_at,updated_at,upstream_id,error_code FROM parse_tasks ORDER BY sequence"));
    }
}
