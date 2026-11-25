package org.neuink.server.persistence;

import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.*;

/** SQL boundary for AdminService; transaction ownership remains with the service. */
@Mapper
public interface AdminServiceMapper {
    @Select("SELECT EXISTS(SELECT 1 FROM users WHERE id=#{actor} AND admin AND NOT disabled)")
    Boolean isActiveAdmin(@Param("actor") String actor);

    @Select("""
        SELECT u.id,u.username,u.admin,u.disabled,u.quota,u.last_login_at,
            (SELECT COUNT(DISTINCT s.device_name) FROM sessions s WHERE s.user_id=u.id
                AND NOT s.revoked AND s.refresh_expires>#{now} AND s.absolute_expires>#{now}) AS device_count,
            (SELECT COUNT(*) FROM sessions s WHERE s.user_id=u.id
                AND NOT s.revoked AND s.refresh_expires>#{now} AND s.absolute_expires>#{now}) AS session_count,
            COALESCE((SELECT SUM(b.size) FROM blobs b WHERE b.owner=u.id),0)::BIGINT AS used_bytes
        FROM users u WHERE u.id>#{after} ORDER BY u.id LIMIT 100
        """)
    List<Map<String, Object>> listAccounts(@Param("after") String after, @Param("now") long now);

    @Select("SELECT EXISTS(SELECT 1 FROM users WHERE id=#{subject})")
    Boolean accountExists(@Param("subject") String subject);

    @Select("SELECT hash,size FROM blobs WHERE owner=#{subject} AND hash>#{after} ORDER BY hash LIMIT 101")
    List<Map<String, Object>> listFiles(@Param("subject") String subject, @Param("after") String after);

    @Select("""
        <script>
        SELECT hash,library_name,object_id,name FROM (
            SELECT refs.*,ROW_NUMBER() OVER(PARTITION BY hash ORDER BY library_name,object_id,name) AS position FROM (
                SELECT DISTINCT r.value->>'hash' AS hash,l.name AS library_name,o.id AS object_id,LEFT(r.value->>'name',1024) AS name
                FROM libraries l JOIN objects o ON o.library_id=l.id
                CROSS JOIN LATERAL jsonb_array_elements(
                    CASE WHEN jsonb_typeof(o.content#>'{document,resources}')='array'
                        THEN o.content#>'{document,resources}' ELSE '[]'::jsonb END) r(value)
                WHERE l.owner=#{subject} AND NOT o.deleted AND r.value->>'hash' IN
                <foreach collection="hashes" item="hash" open="(" separator="," close=")">#{hash}</foreach>
            ) refs
        ) numbered WHERE position&lt;=11 ORDER BY hash,position
        </script>
        """)
    List<Map<String, Object>> listFileReferences(@Param("subject") String subject, @Param("hashes") List<String> hashes);

    @Select("""
        SELECT id,device_name,created_at,login_ip,user_agent,last_seen_at,
            LEAST(refresh_expires,absolute_expires) AS expires_at FROM sessions
        WHERE user_id=#{subject} AND NOT revoked AND refresh_expires>#{now} AND absolute_expires>#{now}
        ORDER BY last_seen_at DESC NULLS LAST,created_at DESC NULLS LAST,id LIMIT 200
        """)
    List<Map<String, Object>> listDevices(@Param("subject") String subject, @Param("now") long now);

    @Update("UPDATE sessions SET revoked=TRUE WHERE id=#{session} AND user_id=#{subject} AND NOT revoked")
    int revokeActiveSession(@Param("session") String session, @Param("subject") String subject);

    @Select("SELECT id FROM users WHERE admin ORDER BY id FOR UPDATE")
    List<Map<String, Object>> lockAdministrators();

    @Select("SELECT admin,disabled FROM users WHERE id=#{subject} FOR UPDATE")
    List<Map<String, Object>> lockAccount(@Param("subject") String subject);

    @Select("SELECT COUNT(*) FROM users WHERE admin AND NOT disabled")
    Long countActiveAdministrators();

    @Update("UPDATE users SET quota=#{quota} WHERE id=#{user}")
    int updateQuota(@Param("quota") long quota, @Param("user") String user);

    @Update("UPDATE users SET disabled=#{disabled} WHERE id=#{user}")
    int updateDisabled(@Param("disabled") boolean disabled, @Param("user") String user);

    @Update("UPDATE sessions SET revoked=TRUE WHERE user_id=#{subject}")
    int revokeUserSessions(@Param("subject") String subject);

    @Update("INSERT INTO admin_audit(actor,action,subject,occurred_at) VALUES(#{actor},#{action},#{subject},#{occurredAt})")
    int insertAudit(@Param("actor") String actor, @Param("action") String action, @Param("subject") String subject, @Param("occurredAt") long occurredAt);

    @Select("SELECT max_accounts,(SELECT COUNT(*) FROM users WHERE NOT admin) AS registered FROM registration_policy WHERE id=1")
    Map<String, Object> readRegistrationPolicy();

    @Update("UPDATE registration_policy SET max_accounts=#{maximum} WHERE id=1")
    int updateRegistrationLimit(@Param("maximum") int maximum);

    @Select("SELECT id,actor,action,subject,occurred_at FROM admin_audit WHERE id<#{before} ORDER BY id DESC LIMIT 100")
    List<Map<String, Object>> listAudit(@Param("before") long before);
}
