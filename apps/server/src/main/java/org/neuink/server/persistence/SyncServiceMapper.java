package org.neuink.server.persistence;

import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.*;

/** SQL boundary for SyncService; transaction ownership remains with the service. */
@Mapper
public interface SyncServiceMapper {
    @Select("SELECT id FROM libraries WHERE id=#{library} AND owner=#{user}")
    List<Map<String, Object>> findLibrary(@Param("library") String library, @Param("user") String user);

    @Select("SELECT id,name,revision FROM libraries WHERE owner=#{user} ORDER BY id")
    List<Map<String, Object>> listLibraries(@Param("user") String user);

    @Select("SELECT id FROM users WHERE id=#{user} FOR UPDATE")
    String lockOwner(@Param("user") String user);

    @Update("UPDATE libraries SET name=#{name} WHERE id=#{id}")
    int renameLibrary(@Param("name") String name, @Param("id") String id);

    @Update("INSERT INTO libraries(id,owner,name) VALUES(#{id},#{owner},#{name})")
    int insertLibrary(@Param("id") String id, @Param("owner") String owner, @Param("name") String name);

    @Select("SELECT minimum_revision FROM libraries WHERE id=#{library} FOR SHARE")
    Long lockMinimumRevision(@Param("library") String library);

    @Select("SELECT revision,object_id,kind,content,deleted FROM changes WHERE library_id=#{library} AND revision>#{revision} ORDER BY revision LIMIT #{limit}")
    List<Map<String, Object>> listChanges(@Param("library") String library, @Param("revision") long revision, @Param("limit") int limit);

    @Select("SELECT revision,minimum_revision FROM libraries WHERE id=#{library} FOR SHARE")
    Map<String, Object> lockLibraryState(@Param("library") String library);

    @Select("SELECT id AS object_id,kind,content,revision,deleted FROM objects WHERE library_id=#{library} AND id>#{after} ORDER BY id LIMIT #{limit}")
    List<Map<String, Object>> listSnapshot(@Param("library") String library, @Param("after") String after, @Param("limit") int limit);

    @Select("SELECT revision,object_id,kind,content,deleted FROM changes WHERE library_id=#{library} AND object_id=#{object} AND revision<#{before} ORDER BY revision DESC LIMIT #{limit}")
    List<Map<String, Object>> listHistory(@Param("library") String library, @Param("object") String object, @Param("before") long before, @Param("limit") int limit);

    @Select("SELECT quota FROM users WHERE id=#{user} FOR UPDATE")
    Long lockQuota(@Param("user") String user);

    @Select("SELECT revision FROM libraries WHERE id=#{library} AND owner=#{user} FOR UPDATE")
    List<Map<String, Object>> lockLibrary(@Param("library") String library, @Param("user") String user);

    @Select("SELECT request_hash,result FROM operations WHERE library_id=#{library} AND id=#{operation}")
    List<Map<String, Object>> findOperation(@Param("library") String library, @Param("operation") String operation);

    @Select("SELECT revision,deleted,kind FROM objects WHERE library_id=#{library} AND id=#{object}")
    List<Map<String, Object>> findObject(@Param("library") String library, @Param("object") String object);

    @Select("SELECT octet_length(#{contentJson}::jsonb::text)")
    Long contentBytes(@Param("contentJson") String contentJson);

    @Update("UPDATE changes SET created_at=#{now} WHERE library_id=#{library} AND revision=#{revision}")
    int updateHistoryTime(@Param("now") long now, @Param("library") String library, @Param("revision") long revision);

    @Update("INSERT INTO objects(library_id,id,kind,content,revision,deleted) VALUES(#{library},#{object},#{kind},#{content}::jsonb,#{next},#{deleted}) ON CONFLICT(library_id,id) DO UPDATE SET content=EXCLUDED.content,revision=EXCLUDED.revision,deleted=EXCLUDED.deleted")
    int upsertObject(@Param("library") String library, @Param("object") String object, @Param("kind") String kind, @Param("content") String content, @Param("next") long next, @Param("deleted") boolean deleted);

    @Update("INSERT INTO changes(library_id,revision,object_id,kind,content,deleted) VALUES(#{library},#{next},#{object},#{kind},#{content}::jsonb,#{deleted})")
    int insertChange(@Param("library") String library, @Param("next") long next, @Param("object") String object, @Param("kind") String kind, @Param("content") String content, @Param("deleted") boolean deleted);

    @Update("UPDATE libraries SET revision=#{next} WHERE id=#{library}")
    int updateRevision(@Param("next") long next, @Param("library") String library);

    @Update("INSERT INTO operations(library_id,id,request_hash,result) VALUES(#{library},#{operation},#{requestHash},#{resultJson}::jsonb)")
    int insertOperation(@Param("library") String library, @Param("operation") String operation, @Param("requestHash") String requestHash, @Param("resultJson") String resultJson);
}
