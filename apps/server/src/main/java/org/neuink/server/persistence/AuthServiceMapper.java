package org.neuink.server.persistence;

import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.*;

/** SQL boundary for AuthService; transaction ownership remains with the service. */
@Mapper
public interface AuthServiceMapper {
    @Select("SELECT s.id,s.user_id,s.last_seen_at,u.admin FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.access_hash=#{accessHash} AND s.access_expires>#{now} AND NOT s.revoked AND NOT u.disabled")
    List<Map<String, Object>> findAccessSession(@Param("accessHash") String accessHash, @Param("now") long now);

    @Update("UPDATE sessions SET last_seen_at=#{now} WHERE id=#{session} AND (last_seen_at IS NULL OR last_seen_at<#{before})")
    int touchSession(@Param("session") String session, @Param("now") long now, @Param("before") long before);

    @Select("SELECT id FROM users WHERE admin ORDER BY id FOR UPDATE")
    List<Map<String, Object>> lockAdministrators();

    @Select("SELECT EXISTS(SELECT 1 FROM users WHERE id=#{actor} AND admin AND NOT disabled)")
    Boolean isActiveAdmin(@Param("actor") String actor);

    @Update("INSERT INTO users(id,username,password_hash,admin) VALUES(#{id},#{username},#{passwordHash},TRUE)")
    int insertAdministrator(@Param("id") String id, @Param("username") String username, @Param("passwordHash") String passwordHash);

    @Update("INSERT INTO invites(hash,expires_at) VALUES(#{hash},#{expiresAt})")
    int insertInvitation(@Param("hash") String hash, @Param("expiresAt") long expiresAt);

    @Select("SELECT EXISTS(SELECT 1 FROM invites WHERE hash=#{hash} AND NOT used AND expires_at>#{now})")
    Boolean hasValidInvitation(@Param("hash") String hash, @Param("now") long now);

    @Select("SELECT max_accounts FROM registration_policy WHERE id=1 FOR UPDATE")
    Integer lockRegistrationLimit();

    @Select("SELECT COUNT(*) FROM users WHERE NOT admin")
    Long countRegisteredUsers();

    @Update("UPDATE invites SET used=TRUE WHERE hash=#{hash} AND NOT used AND expires_at>#{now}")
    int consumeInvitation(@Param("hash") String hash, @Param("now") long now);

    @Update("INSERT INTO users(id,username,password_hash) VALUES(#{id},#{name},#{hash})")
    int insertUser(@Param("id") String id, @Param("name") String name, @Param("hash") String hash);

    @Insert("INSERT INTO users(id,username,password_hash,quota) VALUES(#{id},#{name},#{hash},#{quota})")
    int insertUserWithQuota(@Param("id") String id, @Param("name") String name, @Param("hash") String hash, @Param("quota") long quota);

    @Select(value = "INSERT INTO auth_limits(name,attempts,window_start) VALUES(#{username},1,#{now}) ON CONFLICT(name) DO UPDATE SET attempts=CASE WHEN auth_limits.window_start<EXCLUDED.window_start-300 THEN 1 ELSE auth_limits.attempts+1 END,window_start=CASE WHEN auth_limits.window_start<EXCLUDED.window_start-300 THEN EXCLUDED.window_start ELSE auth_limits.window_start END RETURNING attempts", affectData = true)
    @Options(flushCache = Options.FlushCachePolicy.TRUE, useCache = false)
    Integer recordLoginAttempt(@Param("username") String username, @Param("now") long now);

    @Select("SELECT id,password_hash,disabled FROM users WHERE username=#{name}")
    List<Map<String, Object>> findLoginUser(@Param("name") String name);

    @Select("SELECT password_hash FROM users WHERE id=#{id} AND NOT disabled FOR UPDATE")
    List<Map<String, Object>> lockPassword(@Param("id") String id);

    @Update("INSERT INTO sessions(id,user_id,device_name,access_hash,access_expires,refresh_hash,refresh_expires,absolute_expires) VALUES(#{id},#{user},#{deviceName},#{accessHash},#{accessExpires},#{refreshHash},#{refreshExpires},#{absoluteExpires})")
    int insertSession(@Param("id") String id, @Param("user") String user, @Param("deviceName") String deviceName, @Param("accessHash") String accessHash, @Param("accessExpires") long accessExpires, @Param("refreshHash") String refreshHash, @Param("refreshExpires") long refreshExpires, @Param("absoluteExpires") long absoluteExpires);

    @Update("UPDATE sessions SET created_at=#{now},login_ip=#{ip},user_agent=#{agent},last_seen_at=#{now} WHERE id=#{session}")
    int updateSessionMetadata(@Param("session") String session, @Param("now") long now, @Param("ip") String ip, @Param("agent") String agent);

    @Update("UPDATE users SET last_login_at=#{now} WHERE id=#{user}")
    int recordSuccessfulLogin(@Param("user") String user, @Param("now") long now);

    @Select("SELECT username,quota,admin FROM users WHERE id=#{user}")
    Map<String, Object> readAccount(@Param("user") String user);

    @Select("SELECT id,device_name AS name FROM sessions WHERE user_id=#{user} AND NOT revoked AND refresh_expires>#{now} ORDER BY id")
    List<Map<String, Object>> listSessions(@Param("user") String user, @Param("now") long now);

    @Update("UPDATE sessions SET revoked=TRUE WHERE id=#{session} AND user_id=#{user}")
    int revokeSession(@Param("session") String session, @Param("user") String user);

    @Select("SELECT password_hash FROM users WHERE id=#{user}")
    String readPassword(@Param("user") String user);

    @Update("UPDATE users SET password_hash=#{encoded} WHERE id=#{user} AND password_hash=#{previousHash}")
    int compareAndSetPassword(@Param("encoded") String encoded, @Param("user") String user, @Param("previousHash") String previousHash);

    @Update("UPDATE sessions SET revoked=TRUE WHERE user_id=#{user}")
    int revokeUserSessions(@Param("user") String user);

    @Select("SELECT id FROM users WHERE id=#{user}")
    List<Map<String, Object>> findUser(@Param("user") String user);

    @Update("INSERT INTO reset_tokens(hash,user_id,expires_at) VALUES(#{hash},#{user},#{expiresAt})")
    int insertResetToken(@Param("hash") String hash, @Param("user") String user, @Param("expiresAt") long expiresAt);

    @Select("SELECT user_id FROM reset_tokens WHERE hash=#{hash} AND expires_at>#{now}")
    List<Map<String, Object>> findResetToken(@Param("hash") String hash, @Param("now") long now);

    @Select(value = "DELETE FROM reset_tokens WHERE hash=#{hash} AND expires_at>#{now} RETURNING user_id", affectData = true)
    @Options(flushCache = Options.FlushCachePolicy.TRUE, useCache = false)
    List<Map<String, Object>> consumeResetToken(@Param("hash") String hash, @Param("now") long now);

    @Update("UPDATE users SET password_hash=#{password} WHERE id=#{user}")
    int updatePassword(@Param("password") String password, @Param("user") String user);
}
