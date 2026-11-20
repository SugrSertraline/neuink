package org.neuink.server;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.*;
import org.springframework.security.core.context.SecurityContextHolder;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class AdminWebTest {
    @Test void cookieWritesRequireSessionBoundCsrfAndAdminAuthority() throws Exception {
        var auth=mock(AuthService.class); String token="a".repeat(64);
        when(auth.authenticate("Bearer "+token)).thenReturn(new AuthService.Identity("u","s",true));
        var filter=new SecurityConfig.BearerFilter(auth);
        for(int mode=0; mode<4; mode++) {
            SecurityContextHolder.clearContext();
            var request=new MockHttpServletRequest("PATCH","/admin/api/users/"+"b".repeat(64));
            request.setCookies(new Cookie(AdminWeb.COOKIE,token));request.setContentType("application/json");
            if(mode>0)request.addHeader("X-Neuink-Admin","1");
            if(mode>1)request.addHeader("X-CSRF-Token",mode==2?"wrong":AdminWeb.csrf(token));
            var response=new MockHttpServletResponse();var chain=new MockFilterChain();
            filter.doFilter(request,response,chain);
            assertEquals(mode==3?200:403,response.getStatus());
            assertEquals(mode==3,chain.getRequest()!=null);
        }
        when(auth.authenticate("Bearer "+token)).thenReturn(new AuthService.Identity("u","s",false));
        var request=new MockHttpServletRequest("GET","/admin/api/users");request.setCookies(new Cookie(AdminWeb.COOKIE,token));
        var response=new MockHttpServletResponse();filter.doFilter(request,response,new MockFilterChain());assertEquals(403,response.getStatus());
        SecurityContextHolder.clearContext();
    }
    @Test void loginRejectsCrossOriginFormAndNeverReturnsAccessToken() throws Exception {
        var auth=mock(AuthService.class); var filter=new SecurityConfig.BearerFilter(auth);
        var request=new MockHttpServletRequest("POST","/admin/api/login");request.setContentType("application/x-www-form-urlencoded");
        var response=new MockHttpServletResponse();filter.doFilter(request,response,new MockFilterChain());assertEquals(403,response.getStatus());
        var json=new ObjectMapper();var body=json.createObjectNode().put("username","admin").put("password","test-password-only");
        String token="a".repeat(64);when(auth.login(body)).thenReturn(Map.of("access_token",token));
        when(auth.authenticate("Bearer "+token)).thenReturn(new AuthService.Identity("u","s",true));
        var admin=new AdminWeb(auth,mock(AdminService.class),mock(StorageUsage.class));
        var result=admin.login(body,response);
        assertEquals(Map.of("csrf",AdminWeb.csrf(token)),result);
        String cookie=response.getHeader("Set-Cookie");
        assertTrue(cookie.contains("HttpOnly"));assertTrue(cookie.contains("Secure"));assertTrue(cookie.contains("SameSite=Strict"));assertTrue(cookie.contains("Path=/admin"));
    }
}
