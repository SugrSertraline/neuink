package org.neuink.server;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
class AuthController {
    private final AuthService auth;
    private final SessionRotation rotation;
    private final AdminService audit;
    AuthController(AuthService auth,SessionRotation rotation,AdminService audit) { this.auth=auth; this.rotation=rotation; this.audit=audit; }
    static AuthService.Identity identity(Authentication principal) { return (AuthService.Identity)principal.getPrincipal(); }
    static void admin(Authentication principal) { if(!identity(principal).admin()) throw Api.fail(403,"admin_required"); }
    @PostMapping("/v1/auth/register") Object register(@RequestBody JsonNode request) { return auth.register(request); }
    @PostMapping("/v1/auth/login") Object login(@RequestBody JsonNode request) { return auth.login(request); }
    @PostMapping("/v1/auth/refresh") Object refresh(@RequestBody JsonNode request) { return rotation.rotate(request); }
    @PostMapping("/v1/auth/reset") Object reset(@RequestBody JsonNode request) { auth.reset(request); return Map.of("ok",true); }
    @GetMapping("/v1/me") Object me(Authentication principal) { return auth.me(identity(principal)); }
    @GetMapping("/v1/devices") Object devices(Authentication principal) { return auth.devices(identity(principal)); }
    @DeleteMapping("/v1/devices/{id}") Object revoke(Authentication principal,@PathVariable String id) { auth.revoke(identity(principal),id); return Map.of("ok",true); }
    @PostMapping("/v1/auth/logout") Object logout(Authentication principal) { auth.revoke(identity(principal),identity(principal).session()); return Map.of("ok",true); }
    @PostMapping("/v1/auth/password") Object password(Authentication principal,@RequestBody JsonNode request) { auth.password(identity(principal),request); return Map.of("ok",true); }
    @org.springframework.transaction.annotation.Transactional
    @PostMapping("/v1/admin/invites") Object invite(Authentication principal) { admin(principal); String token=auth.invite(); audit.record(identity(principal).user(),"invite_created",identity(principal).user()); return Map.of("invite",token); }
    @org.springframework.transaction.annotation.Transactional
    @PostMapping("/v1/admin/reset/{id}") Object reset(Authentication principal,@PathVariable String id) { admin(principal); String token=auth.issueReset(id); audit.record(identity(principal).user(),"reset_issued",id); return Map.of("reset_token",token); }
}
