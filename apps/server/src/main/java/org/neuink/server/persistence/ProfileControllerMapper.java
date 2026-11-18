package org.neuink.server.persistence;

import java.util.Map;
import org.apache.ibatis.annotations.*;

/** SQL boundary for ProfileController; transaction ownership remains with the service. */
@Mapper
public interface ProfileControllerMapper {
    @Select("SELECT username,nickname,full_name,email,bio,affiliation,avatar,profile_revision,quota,admin FROM users WHERE id=#{user}")
    Map<String, Object> readProfile(@Param("user") String user);

    @Select("SELECT COALESCE(SUM(size),0)::BIGINT FROM blobs WHERE owner=#{user}")
    Long usedBytes(@Param("user") String user);

    @Update("UPDATE users SET nickname=#{nickname},full_name=#{fullName},email=#{email},bio=#{bio},affiliation=#{affiliation},avatar=COALESCE(#{avatar},avatar),profile_revision=profile_revision+1 WHERE id=#{user} AND profile_revision=#{revision}")
    int updateProfile(@Param("nickname") String nickname, @Param("fullName") String fullName, @Param("email") String email, @Param("bio") String bio, @Param("affiliation") String affiliation, @Param("avatar") String avatar, @Param("user") String user, @Param("revision") long revision);
}
