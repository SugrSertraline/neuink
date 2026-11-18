package org.neuink.server.persistence;

import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.*;

/** SQL boundary for UploadCleanup; transaction ownership remains with the service. */
@Mapper
public interface UploadCleanupMapper {
    @Select("SELECT id FROM uploads WHERE expires_at<=#{now} ORDER BY expires_at,id LIMIT 100 FOR UPDATE SKIP LOCKED")
    List<Map<String, Object>> lockExpiredUploads(@Param("now") long now);

    @Update("DELETE FROM uploads WHERE id=#{id}")
    int deleteUpload(@Param("id") String id);
}
