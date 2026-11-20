package org.neuink.server.persistence;

import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.*;

/** SQL boundary for SessionRotation; transaction ownership remains with the service. */
@Mapper
public interface SessionRotationMapper {
    @Select("SELECT user_id FROM sessions WHERE refresh_hash=#{hash} OR previous_refresh_hash=#{hash2}")
    List<Map<String, Object>> findRefreshOwner(@Param("hash") String hash, @Param("hash2") String hash2);

    @Select("SELECT id FROM users WHERE id=#{user} AND NOT disabled FOR UPDATE")
    List<Map<String, Object>> lockEnabledUser(@Param("user") String user);

    @Select("SELECT * FROM sessions WHERE user_id=#{user} AND (refresh_hash=#{hash} OR previous_refresh_hash=#{hash3}) FOR UPDATE")
    List<Map<String, Object>> lockSession(@Param("user") String user, @Param("hash") String hash, @Param("hash3") String hash3);

    @Update("UPDATE sessions SET access_hash=#{accessHash},access_expires=#{accessExpires},refresh_hash=#{refreshHash},refresh_expires=LEAST(#{refreshExpires},absolute_expires),previous_refresh_hash=#{previousRefreshHash},refresh_request_hash=#{requestHash},refresh_replay_until=#{replayUntil} WHERE id=#{session}")
    int rotateSession(@Param("accessHash") String accessHash, @Param("accessExpires") long accessExpires, @Param("refreshHash") String refreshHash, @Param("refreshExpires") long refreshExpires, @Param("previousRefreshHash") String previousRefreshHash, @Param("requestHash") String requestHash, @Param("replayUntil") Long replayUntil, @Param("session") String session);
}
