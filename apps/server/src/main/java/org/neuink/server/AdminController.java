package org.neuink.server;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
class AdminController {
    private final AdminService admin;
    AdminController(AdminService admin) { this.admin = admin; }
    @GetMapping("/v1/admin/registration") Object registration(Authentication principal) {
        return admin.registration(AuthController.identity(principal).user());
    }
    @PatchMapping("/v1/admin/registration") Object registration(Authentication principal,@RequestBody JsonNode request) {
        return admin.registration(AuthController.identity(principal).user(),request);
    }
    @GetMapping("/v1/admin/users") Object users(Authentication principal, @RequestParam(defaultValue="") String after) {
        return admin.users(AuthController.identity(principal).user(), after);
    }
    @PatchMapping("/v1/admin/users/{id}") Object update(Authentication principal, @PathVariable String id, @RequestBody JsonNode request) {
        return admin.update(AuthController.identity(principal).user(), id, request);
    }
    @GetMapping("/v1/admin/audit") Object audit(Authentication principal, @RequestParam(defaultValue="9223372036854775807") long before) {
        return admin.audit(AuthController.identity(principal).user(), before);
    }
}
