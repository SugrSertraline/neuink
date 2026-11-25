package org.neuink.server.persistence;

import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.*;

/** SQL boundary for RetentionService; transaction ownership remains with the service. */
@Mapper
public interface RetentionServiceMapper {
    @Select("SELECT id FROM users WHERE id=#{owner} FOR UPDATE")
    String lockOwner(@Param("owner") String owner);

    @Select("SELECT EXISTS(SELECT 1 FROM objects o JOIN libraries l ON l.id=o.library_id WHERE l.owner=#{owner} AND o.content->'_files' @> jsonb_build_array(jsonb_build_object('hash',#{hash}::text))) OR EXISTS(SELECT 1 FROM changes c JOIN libraries l ON l.id=c.library_id WHERE l.owner=#{owner3} AND c.content->'_files' @> jsonb_build_array(jsonb_build_object('hash',#{hash4}::text))) OR EXISTS(SELECT 1 FROM uploads WHERE owner=#{owner5} AND hash=#{hash6} AND expires_at>#{now})")
    Boolean isReferenced(@Param("owner") String owner, @Param("hash") String hash, @Param("owner3") String owner3, @Param("hash4") String hash4, @Param("owner5") String owner5, @Param("hash6") String hash6, @Param("now") long now);

    @Select("SELECT EXISTS(SELECT 1 FROM parse_tasks WHERE owner=#{owner} AND blob_hash=#{hash})")
    boolean isParseInput(@Param("owner") String owner, @Param("hash") String hash);

    @Select("SELECT id FROM libraries WHERE owner=#{owner} ORDER BY id FOR UPDATE")
    List<Map<String, Object>> lockLibraries(@Param("owner") String owner);

    @Select("SELECT COALESCE(MAX(c.revision),0) FROM changes c WHERE c.library_id=#{library} AND c.created_at<#{before} AND NOT EXISTS(SELECT 1 FROM objects o WHERE o.library_id=c.library_id AND o.id=c.object_id AND o.revision=c.revision)")
    Long expiredRevision(@Param("library") String library, @Param("before") long before);

    @Update("DELETE FROM changes c WHERE c.library_id=#{library} AND c.created_at<#{before} AND NOT EXISTS(SELECT 1 FROM objects o WHERE o.library_id=c.library_id AND o.id=c.object_id AND o.revision=c.revision)")
    int deleteExpiredHistory(@Param("library") String library, @Param("before") long before);

    @Update("UPDATE libraries SET minimum_revision=GREATEST(minimum_revision,#{revision}) WHERE id=#{library}")
    int advanceMinimumRevision(@Param("revision") long revision, @Param("library") String library);

    @Select("SELECT hash FROM blobs WHERE owner=#{owner}")
    List<Map<String, Object>> listBlobs(@Param("owner") String owner);

    @Update("DELETE FROM blob_gc WHERE owner=#{owner} AND hash=#{hash}")
    int deleteCollection(@Param("owner") String owner, @Param("hash") String hash);

    @Update("INSERT INTO blob_gc(owner,hash,candidate_at) VALUES(#{owner},#{hash},#{now}) ON CONFLICT DO NOTHING")
    int insertCollection(@Param("owner") String owner, @Param("hash") String hash, @Param("now") long now);

    @Select("SELECT hash FROM blob_gc WHERE owner=#{owner} AND NOT deleting AND candidate_at<=#{before} ORDER BY hash LIMIT 100")
    List<Map<String, Object>> listCandidates(@Param("owner") String owner, @Param("before") long before);

    @Update("DELETE FROM blobs WHERE owner=#{owner} AND hash=#{hash}")
    int deleteBlob(@Param("owner") String owner, @Param("hash") String hash);

    @Update("UPDATE blob_gc SET deleting=TRUE WHERE owner=#{owner} AND hash=#{hash}")
    int markDeleting(@Param("owner") String owner, @Param("hash") String hash);

    @Select("SELECT hash FROM blob_gc WHERE owner=#{owner} AND deleting ORDER BY hash LIMIT 100")
    List<Map<String, Object>> listDeleting(@Param("owner") String owner);

    @Select("SELECT hash FROM blobs WHERE owner=#{owner} AND hash=#{hash}")
    List<Map<String, Object>> findBlob(@Param("owner") String owner, @Param("hash") String hash);

    @Select("SELECT id FROM users ORDER BY id")
    List<String> listOwners();
}
