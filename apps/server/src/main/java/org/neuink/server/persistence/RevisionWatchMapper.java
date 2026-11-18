package org.neuink.server.persistence;

import java.util.Map;
import org.apache.ibatis.annotations.*;

/** One read-only metadata snapshot; never reads changes, objects or attachment bodies. */
@Mapper
public interface RevisionWatchMapper {
    @Select("""
        SELECT l.id,l.revision,l.minimum_revision
        FROM sessions s JOIN users u ON u.id=s.user_id
        LEFT JOIN libraries l ON l.id=#{library} AND l.owner=u.id
        WHERE s.id=#{session} AND s.user_id=#{user} AND s.access_hash=#{accessHash}
          AND s.access_expires>#{now} AND NOT s.revoked AND NOT u.disabled
        """)
    @Options(timeout=2)
    Map<String,Object> state(@Param("library") String library,@Param("session") String session,
        @Param("user") String user,@Param("accessHash") String accessHash,@Param("now") long now);
}
