package org.neuink.server.persistence;

import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.*;

/** SQL boundary for StorageCleanup; transaction ownership remains with the service. */
@Mapper
public interface StorageCleanupMapper {
    @Select("SELECT c.library_id,c.revision,COALESCE(octet_length(c.content::text),0) AS bytes FROM changes c JOIN libraries l ON l.id=c.library_id WHERE l.owner=#{owner} AND NOT EXISTS(SELECT 1 FROM objects o WHERE o.library_id=c.library_id AND o.id=c.object_id AND o.revision=c.revision) ORDER BY c.library_id,c.revision")
    List<Map<String, Object>> listHistory(@Param("owner") String owner);

    @Select("SELECT id FROM users WHERE id=#{owner} FOR UPDATE")
    String lockOwner(@Param("owner") String owner);

    @Update("DELETE FROM changes WHERE library_id=#{library} AND revision=#{revision}")
    int deleteHistory(@Param("library") String library, @Param("revision") long revision);

    @Update("UPDATE libraries SET minimum_revision=GREATEST(minimum_revision,#{revision}) WHERE id=#{library}")
    int advanceMinimumRevision(@Param("revision") long revision, @Param("library") String library);

    @Update("INSERT INTO admin_audit(actor,action,subject,occurred_at) VALUES(#{actor},'clear_own_history',#{subject},#{occurredAt})")
    int insertAudit(@Param("actor") String actor, @Param("subject") String subject, @Param("occurredAt") long occurredAt);
}
