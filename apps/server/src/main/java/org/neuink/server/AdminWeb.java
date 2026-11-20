package org.neuink.server;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.*;
import java.util.Map;
import org.springframework.http.ResponseCookie;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

/** Short lived, same-origin admin sessions; no token is exposed to JavaScript. */
@RestController
class AdminWeb {
    static final String COOKIE = "neuink_admin";
    private final AuthService auth;
    private final AdminService admin;
    private final StorageUsage usage;
    AdminWeb(AuthService auth, AdminService admin, StorageUsage usage) {
        this.auth=auth; this.admin=admin; this.usage=usage;
    }
    static String cookie(HttpServletRequest request) {
        String found=null;
        if(request.getCookies()!=null) for(var cookie:request.getCookies()) if(COOKIE.equals(cookie.getName())) {
            if(found!=null) throw Api.fail(401,"login_required");
            found=cookie.getValue();
        }
        return found;
    }
    static String csrf(String access) { return Api.digest("neuink-admin-csrf:"+access); }
    private void cookie(HttpServletResponse response,String value,long seconds) {
        response.addHeader("Set-Cookie",ResponseCookie.from(COOKIE,value).path("/admin").httpOnly(true)
            .secure(true).sameSite("Strict").maxAge(seconds).build().toString());
    }
    @PostMapping("/admin/api/login") Object login(@RequestBody JsonNode request,HttpServletRequest connection,HttpServletResponse response) {
        return finishLogin(auth.login(request,connection.getRemoteAddr(),connection.getHeader("User-Agent")),response);
    }
    Object login(JsonNode request,HttpServletResponse response) { return finishLogin(auth.login(request),response); }
    private Object finishLogin(Map<String,Object> session,HttpServletResponse response) {
        String access=(String)session.get("access_token");
        var identity=auth.authenticate("Bearer "+access);
        if(!identity.admin()) { auth.revoke(identity,identity.session()); throw Api.fail(403,"admin_required"); }
        cookie(response,access,900);
        admin.record(identity.user(),"admin_login",identity.user());
        return Map.of("csrf",csrf(access));
    }
    @GetMapping("/admin/api/session") Object session(HttpServletRequest request,Authentication principal) {
        AuthController.admin(principal);
        return Map.of("csrf",csrf(cookie(request)),"account",auth.me(AuthController.identity(principal)));
    }
    @PostMapping("/admin/api/logout") Object logout(Authentication principal,HttpServletResponse response) {
        var identity=AuthController.identity(principal);
        auth.revoke(identity,identity.session()); cookie(response,"",0);
        admin.record(identity.user(),"admin_logout",identity.user());
        return Map.of("ok",true);
    }
    @GetMapping("/admin/api/users") Object users(Authentication p,@RequestParam(defaultValue="") String after) { return admin.users(AuthController.identity(p).user(),after); }
    @org.springframework.transaction.annotation.Transactional
    @PostMapping("/admin/api/users") Object create(Authentication p,@RequestBody JsonNode request) {
        AuthController.admin(p); String actor=AuthController.identity(p).user();
        var account=auth.createAccount(actor,request);
        admin.record(actor,"account_created",(String)account.get("account_id"));
        return account;
    }
    @GetMapping("/admin/api/users/{id}/files") Object files(Authentication p,@PathVariable String id,@RequestParam(defaultValue="") String after) { return admin.files(AuthController.identity(p).user(),id,after); }
    @GetMapping("/admin/api/users/{id}/devices") Object devices(Authentication p,@PathVariable String id) { return admin.devices(AuthController.identity(p).user(),id); }
    @DeleteMapping("/admin/api/users/{id}/devices/{session}") Object revokeDevice(Authentication p,@PathVariable String id,@PathVariable String session) { return admin.revokeDevice(AuthController.identity(p).user(),id,session); }
    @PatchMapping("/admin/api/users/{id}") Object update(Authentication p,@PathVariable String id,@RequestBody JsonNode request) { return admin.update(AuthController.identity(p).user(),id,request); }
    @GetMapping("/admin/api/users/{id}/storage") Object storage(Authentication p,@PathVariable String id) {
        AuthController.admin(p); if(!Api.hash(id)) throw Api.fail(400,"invalid_account"); return usage.details(id);
    }
    @GetMapping("/admin/api/registration") Object registration(Authentication p) { return admin.registration(AuthController.identity(p).user()); }
    @PatchMapping("/admin/api/registration") Object registration(Authentication p,@RequestBody JsonNode request) { return admin.registration(AuthController.identity(p).user(),request); }
    @GetMapping("/admin/api/audit") Object audit(Authentication p,@RequestParam(defaultValue="9223372036854775807") long before) { return admin.audit(AuthController.identity(p).user(),before); }
    @org.springframework.transaction.annotation.Transactional
    @PostMapping("/admin/api/invites") Object invite(Authentication p) {
        AuthController.admin(p); String invite=auth.invite(); admin.record(AuthController.identity(p).user(),"invite_created",AuthController.identity(p).user()); return Map.of("invite",invite);
    }
    @org.springframework.transaction.annotation.Transactional
    @PostMapping("/admin/api/reset/{id}") Object reset(Authentication p,@PathVariable String id) {
        AuthController.admin(p); String token=auth.issueReset(id); admin.record(AuthController.identity(p).user(),"reset_issued",id); return Map.of("reset_token",token);
    }
}
