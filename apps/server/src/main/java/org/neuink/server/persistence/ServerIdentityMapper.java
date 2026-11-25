package org.neuink.server.persistence;

import java.util.Map;
import org.apache.ibatis.annotations.*;

/** SQL boundary for ServerIdentity; transaction ownership remains with the service. */
@Mapper
public interface ServerIdentityMapper {
    @Update("INSERT INTO server_identity(singleton,id,epoch) VALUES(TRUE,#{id},#{epoch}) ON CONFLICT DO NOTHING")
    int insertIdentity(@Param("id") String id, @Param("epoch") String epoch);

    @Select("SELECT id,epoch FROM server_identity WHERE singleton=TRUE")
    Map<String, Object> readIdentity();

    @Select("SELECT 1")
    Integer probe();
}
