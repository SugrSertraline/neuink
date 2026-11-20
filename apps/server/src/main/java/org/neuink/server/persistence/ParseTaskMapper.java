package org.neuink.server.persistence;

import java.util.Map;
import java.util.List;
import org.apache.ibatis.annotations.*;

/** Queries for account-scoped parsing jobs. Caller owns transaction boundaries. */
@Mapper
public interface ParseTaskMapper {
    @Select("SELECT id FROM users WHERE id=#{owner} AND NOT disabled FOR UPDATE")
    String lockOwner(@Param("owner") String owner);

    @Select("SELECT size FROM blobs WHERE owner=#{owner} AND hash=#{hash}")
    Long blobSize(@Param("owner") String owner, @Param("hash") String hash);

    @Select("SELECT count(*) FROM parse_tasks WHERE owner=#{owner} AND state IN ('queued','submitting','running')")
    long activeCount(@Param("owner") String owner);

    @Insert("INSERT INTO parse_tasks(id,owner,blob_hash,state,created_at,updated_at) VALUES(#{id},#{owner},#{hash},'queued',#{now},#{now})")
    int insert(@Param("id") String id, @Param("owner") String owner, @Param("hash") String hash, @Param("now") long now);

    @Select("SELECT id,blob_hash,state,created_at,updated_at,error_code FROM parse_tasks WHERE id=#{id} AND owner=#{owner}")
    Map<String,Object> find(@Param("id") String id, @Param("owner") String owner);

    @Select("SELECT count(*) FROM parse_tasks q JOIN parse_tasks t ON t.id=#{id} AND t.owner=#{owner} WHERE q.state='queued' AND q.sequence<t.sequence")
    long ahead(@Param("id") String id, @Param("owner") String owner);

    @Update("UPDATE parse_tasks SET state='canceled',updated_at=#{now} WHERE id=#{id} AND owner=#{owner} AND state='queued'")
    int cancel(@Param("id") String id, @Param("owner") String owner, @Param("now") long now);

    @Select("SELECT pg_try_advisory_xact_lock(78244301)")
    boolean lockScheduler();
    @Select("SELECT id,owner,blob_hash,state,upstream_id,updated_at FROM parse_tasks WHERE state IN ('submitting','running','uncertain') ORDER BY sequence LIMIT 1 FOR UPDATE")
    Map<String,Object> active();
    @Select("SELECT id,owner,blob_hash,state,upstream_id,updated_at FROM parse_tasks WHERE state='queued' ORDER BY sequence LIMIT 1 FOR UPDATE SKIP LOCKED")
    Map<String,Object> next();
    @Update("UPDATE parse_tasks SET state='submitting',updated_at=#{now} WHERE id=#{id} AND state='queued'")
    int claim(@Param("id") String id,@Param("now") long now);
    @Update("UPDATE parse_tasks SET state='running',upstream_id=#{upstream},updated_at=#{now} WHERE id=#{id} AND state='submitting'")
    int running(@Param("id") String id,@Param("upstream") String upstream,@Param("now") long now);
    @Update("UPDATE parse_tasks SET state='failed',error_code=#{error},updated_at=#{now} WHERE id=#{id} AND state IN ('submitting','running')")
    int fail(@Param("id") String id,@Param("error") String error,@Param("now") long now);
    @Update("UPDATE parse_tasks SET state='uncertain',error_code='submission_uncertain',updated_at=#{now} WHERE id=#{id} AND state='submitting'")
    int uncertain(@Param("id") String id,@Param("now") long now);
    @Update("UPDATE parse_tasks SET state='failed',error_code='administrator_released',updated_at=#{now} WHERE id=#{id} AND state='uncertain'")
    int releaseUncertain(@Param("id") String id,@Param("now") long now);
    @Update("UPDATE parse_tasks SET state='succeeded',updated_at=#{now} WHERE id=#{id} AND state='running'")
    int succeed(@Param("id") String id,@Param("now") long now);
    @Select("SELECT id FROM parse_tasks WHERE state IN ('succeeded','failed','canceled') AND updated_at<#{before} ORDER BY updated_at,id LIMIT 100 FOR UPDATE SKIP LOCKED")
    List<Map<String,Object>> expired(@Param("before") long before);
    @Delete("DELETE FROM parse_tasks WHERE id=#{id} AND state IN ('succeeded','failed','canceled') AND updated_at<#{before}")
    int deleteExpired(@Param("id") String id,@Param("before") long before);
}
