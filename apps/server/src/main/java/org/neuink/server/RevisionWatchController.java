package org.neuink.server;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.context.request.async.DeferredResult;

@RestController
class RevisionWatchController {
    private final RevisionWatch watch;
    RevisionWatchController(RevisionWatch watch) { this.watch=watch; }
    @GetMapping("/v1/libraries/{id}/revision")
    DeferredResult<Object> revision(Authentication principal,@RequestHeader("Authorization") String authorization,
        @PathVariable String id,@RequestParam String epoch,@RequestParam(defaultValue="0") long revision,
        @RequestParam(name="wait_ms",defaultValue="0") long waitMillis,HttpServletResponse response) {
        response.setHeader("Cache-Control","no-store");
        return watch.watch(AuthController.identity(principal),authorization,id,epoch,revision,waitMillis);
    }
}
