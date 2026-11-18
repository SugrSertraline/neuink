package org.neuink.server;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import org.neuink.server.persistence.ParseTaskMapper;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

@RestController
class ParseQueueAdminController {
    private final ParseTaskMapper db;
    private final AdminService audit;
    ParseQueueAdminController(ParseTaskMapper db,AdminService audit) {this.db=db;this.audit=audit;}

    /** Only use after manually verifying the unknown upstream job has stopped. */
    @Transactional
    @PostMapping("/v1/admin/parse/tasks/{id}/release")
    Object release(Authentication principal,@PathVariable String id,@RequestBody JsonNode body) {
        AuthController.admin(principal);
        if(!Api.hash(id)) throw Api.fail(404,"parse_task_missing");
        if(!body.path("confirm_upstream_stopped").isBoolean() || !body.path("confirm_upstream_stopped").booleanValue())
            throw Api.fail(400,"upstream_confirmation_required");
        if(db.releaseUncertain(id,Api.now())!=1) throw Api.fail(409,"parse_task_not_uncertain");
        String actor=AuthController.identity(principal).user();
        audit.record(actor,"parse_uncertain_released:"+id,actor);
        return Map.of("ok",true);
    }
}
