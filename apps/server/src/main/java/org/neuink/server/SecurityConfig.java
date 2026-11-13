package org.neuink.server;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.util.List;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter;
import org.springframework.web.filter.OncePerRequestFilter;

@Configuration
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication
class SecurityConfig {
    static final String[] PUBLIC = {"/health","/ready","/.well-known/neuink-sync","/v1/auth/register","/v1/auth/login","/v1/auth/refresh","/v1/auth/reset"};
    @Bean SecurityFilterChain security(HttpSecurity http,AuthService auth) throws Exception {
        return http.csrf(csrf->csrf.disable())
            .sessionManagement(session->session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .requestCache(cache->cache.disable())
            .authorizeHttpRequests(requests->requests.requestMatchers(PUBLIC).permitAll().requestMatchers("/admin", "/admin/", "/admin/index.html", "/admin/admin.js", "/admin/admin.css", "/admin/api/login").permitAll().anyRequest().authenticated())
            .exceptionHandling(errors->errors.authenticationEntryPoint((req,res,error)->write(res,401,"login_required")).accessDeniedHandler((req,res,error)->write(res,403,"forbidden")))
            .addFilterBefore(new BearerFilter(auth),AnonymousAuthenticationFilter.class).build();
    }
    static void write(HttpServletResponse response,int status,String code) throws IOException {
        response.setStatus(status); response.setContentType("application/json"); response.getWriter().write("{\"error\":\""+code+"\"}");
    }
    static final class BearerFilter extends OncePerRequestFilter {
        private final AuthService auth;
        BearerFilter(AuthService auth) { this.auth=auth; }
        private void admin(HttpServletRequest request,HttpServletResponse response,FilterChain chain) throws ServletException,IOException {
            response.setHeader("Cache-Control","no-store");
            response.setHeader("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
            response.setHeader("Referrer-Policy","no-referrer");
            response.setHeader("X-Content-Type-Options","nosniff");
            String path=request.getRequestURI();
            try {
                boolean safe=List.of("GET","HEAD","OPTIONS").contains(request.getMethod());
                if(!safe && !"1".equals(request.getHeader("X-Neuink-Admin"))) throw Api.fail(403,"csrf_required");
                // Custom header plus JSON denies cross-origin form/login CSRF. No CORS
                // permissions are granted. Authenticated writes also bind to this session.
                if(!safe && (request.getContentType()==null || !request.getContentType().startsWith("application/json"))) throw Api.fail(403,"csrf_required");
                if(path.startsWith("/admin/api/") && !path.equals("/admin/api/login")) {
                    String token=AdminWeb.cookie(request);
                    if(!Api.hash(token)) throw Api.fail(401,"login_required");
                    var identity=auth.authenticate("Bearer "+token);
                    if(!identity.admin()) throw Api.fail(403,"admin_required");
                    if(!safe && !java.security.MessageDigest.isEqual(AdminWeb.csrf(token).getBytes(java.nio.charset.StandardCharsets.UTF_8),
                        java.util.Objects.toString(request.getHeader("X-CSRF-Token"),"").getBytes(java.nio.charset.StandardCharsets.UTF_8))) throw Api.fail(403,"csrf_required");
                    SecurityContextHolder.getContext().setAuthentication(UsernamePasswordAuthenticationToken.authenticated(identity,null,List.of()));
                }
            } catch(Api.Failure failure) { write(response,failure.status,failure.code); return; }
            catch(org.springframework.dao.DataAccessException ignored) { write(response,503,"storage_unavailable"); return; }
            chain.doFilter(new BoundedRequest(request),response);
        }
        @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain) throws ServletException,IOException {
            if(request.getContentLengthLong()>8*1024*1024) { write(response,413,"request_too_large"); return; }
            if(request.getRequestURI().equals("/admin") || request.getRequestURI().startsWith("/admin/")) {
                admin(request,response,chain); return;
            }
            if(!List.of(PUBLIC).contains(request.getRequestURI())) {
                try {
                    var identity=auth.authenticate(request.getHeader("Authorization"));
                    SecurityContextHolder.getContext().setAuthentication(UsernamePasswordAuthenticationToken.authenticated(identity,null,List.of()));
                } catch(Api.Failure failure) { write(response,failure.status,failure.code); return; }
                catch(org.springframework.dao.DataAccessException ignored) { write(response,503,"storage_unavailable"); return; }
            }
            chain.doFilter(new BoundedRequest(request),response);
        }
    }
}
