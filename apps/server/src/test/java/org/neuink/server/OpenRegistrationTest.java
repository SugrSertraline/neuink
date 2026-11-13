package org.neuink.server;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.junit.jupiter.api.Assertions.*;
@EnabledIfEnvironmentVariable(named="NEUINK_INTEGRATION",matches="true")
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties="NEUINK_INVITE_REQUIRED=false")
class OpenRegistrationTest {
    @Autowired AuthService auth;@Autowired ObjectMapper json;@Autowired JdbcTemplate db;
    @Test void registrationWithoutInviteCreatesOrdinaryAccountAndCanLogin() {
        String name="open-"+Api.token().substring(0,12);
        var request=json.valueToTree(Map.of("username",name,"password","test-password-only"));
        var created=auth.register(request);String id=(String)created.get("account_id");
        assertFalse(db.queryForObject("SELECT admin FROM users WHERE id=?",Boolean.class,id));
        assertEquals(2147483648L,db.queryForObject("SELECT quota FROM users WHERE id=?",Long.class,id));
        var login=auth.login(request);assertEquals(id,login.get("account_id"));
        assertThrows(RuntimeException.class,()->auth.register(request));
        assertThrows(RuntimeException.class,()->auth.register(json.valueToTree(Map.of("username",name+"-bad","password","test-password-only","invite","invalid"))));
    }
}
