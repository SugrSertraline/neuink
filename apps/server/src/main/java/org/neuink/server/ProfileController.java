package org.neuink.server;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

/** Optional profile data is separate from login identity and recovery credentials. */
@RestController
class ProfileController {
    private final JdbcTemplate db;
    ProfileController(JdbcTemplate db) { this.db = db; }

    @GetMapping("/v1/profile") Object read(Authentication principal) {
        String user = AuthController.identity(principal).user();
        var profile = db.queryForMap("SELECT username,nickname,full_name,email,bio,affiliation,avatar,profile_revision,quota,admin FROM users WHERE id=?", user);
        profile.put("used_bytes", db.queryForObject("SELECT COALESCE(SUM(size),0)::BIGINT FROM blobs WHERE owner=?", Long.class, user));
        profile.put("email_verified", false);
        profile.put("avatar_upload_available", true);
        return profile;
    }

    @PatchMapping("/v1/profile") Object update(Authentication principal, @RequestBody JsonNode request) {
        String nickname = field(request,"nickname",80), name = field(request,"full_name",120);
        String email = field(request,"email",254), bio = field(request,"bio",1000), affiliation = field(request,"affiliation",200);
        if (!email.isEmpty() && !email.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+")) throw Api.fail(400,"invalid_email");
        JsonNode revision = request.get("profile_revision");
        if (revision == null || !revision.isIntegralNumber() || !revision.canConvertToLong() || revision.longValue()<0) throw Api.fail(400,"invalid_profile_revision");
        String avatar = request.has("avatar") ? ProfileAvatar.validate(request.get("avatar")) : null;
        int changed = db.update("UPDATE users SET nickname=?,full_name=?,email=?,bio=?,affiliation=?,avatar=COALESCE(?,avatar),profile_revision=profile_revision+1 WHERE id=? AND profile_revision=?",
            nickname,name,email,bio,affiliation,avatar,AuthController.identity(principal).user(),revision.longValue());
        if (changed != 1) throw Api.fail(409,"profile_changed");
        return Map.of("ok",true,"profile_revision",revision.longValue()+1);
    }

    private static String field(JsonNode request,String key,int limit) {
        JsonNode value = request.get(key);
        if (value == null || !value.isTextual()) throw Api.fail(400,"invalid_profile");
        String text = value.textValue().strip();
        if (text.codePointCount(0,text.length())>limit || text.codePoints().anyMatch(c -> Character.isISOControl(c))) throw Api.fail(400,"invalid_profile");
        return text;
    }
}
