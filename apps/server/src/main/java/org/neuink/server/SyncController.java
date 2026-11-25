package org.neuink.server;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
class SyncController {
    private final SyncService sync;
    SyncController(SyncService sync) { this.sync=sync; }
    @GetMapping("/v1/libraries") Object libraries(Authentication principal) { return sync.libraries(AuthController.identity(principal).user()); }
    @PostMapping("/v1/libraries") Object create(Authentication principal,@RequestBody JsonNode request) { var identity=AuthController.identity(principal); return identity.admin()?sync.createLibrary(identity.user(),request):sync.defaultLibrary(identity.user()); }
    @PostMapping("/v1/libraries/default") Object defaultLibrary(Authentication principal) { return sync.defaultLibrary(AuthController.identity(principal).user()); }
    @GetMapping("/v1/libraries/{id}/changes") Object changes(Authentication principal,@PathVariable String id,@RequestParam String epoch,@RequestParam(defaultValue="0") long revision) { return sync.changes(AuthController.identity(principal).user(),id,epoch,revision); }
    @GetMapping("/v1/libraries/{id}/snapshot") Object snapshot(Authentication principal,@PathVariable String id,@RequestParam String epoch,@RequestParam(defaultValue="-1") long revision,@RequestParam(defaultValue="") String after) { return sync.snapshot(AuthController.identity(principal).user(),id,epoch,revision,after); }
    @PostMapping("/v1/libraries/{id}/operations") Object apply(Authentication principal,@PathVariable String id,@RequestBody JsonNode request) { return sync.apply(AuthController.identity(principal).user(),id,request); }
    @PostMapping("/v1/libraries/{id}/operations/delete-group") Object deleteGroup(Authentication principal,@PathVariable String id,@RequestBody JsonNode request) { return sync.deleteGroup(AuthController.identity(principal).user(),id,request); }
    @GetMapping("/v1/libraries/{id}/objects/{object}/versions") Object history(Authentication principal,@PathVariable String id,@PathVariable String object,@RequestParam(defaultValue="9223372036854775807") long before) { return sync.history(AuthController.identity(principal).user(),id,object,before); }
}
