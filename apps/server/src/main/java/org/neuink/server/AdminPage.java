package org.neuink.server;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
@Controller
class AdminPage {
    @GetMapping({"/admin","/admin/"}) String index() { return "redirect:/admin/index.html"; }
}
