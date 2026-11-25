package org.neuink.server.persistence;

import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.*;

/** SQL boundary for BlobService; transaction ownership remains with the service. */
@Mapper
public interface BlobServiceMapper {
    @Select("<script>SELECT hash,size,offset_bytes FROM uploads WHERE id=#{id} AND owner=#{owner} AND expires_at&gt;#{now}<if test=\"lock\"> FOR UPDATE</if></script>")
    List<Map<String, Object>> findUpload(@Param("id") String id, @Param("owner") String owner, @Param("now") long now, @Param("lock") boolean lock);

    @Select("SELECT quota FROM users WHERE id=#{owner} FOR UPDATE")
    Long lockQuota(@Param("owner") String owner);

    @Update("DELETE FROM blob_gc WHERE owner=#{owner} AND hash=#{hash} AND NOT deleting")
    int cancelCollection(@Param("owner") String owner, @Param("hash") String hash);

    @Select("SELECT EXISTS(SELECT 1 FROM blobs WHERE owner=#{owner} AND hash=#{hash} AND size=#{size})")
    Boolean hasBlob(@Param("owner") String owner, @Param("hash") String hash, @Param("size") long size);

    @Select("SELECT id,offset_bytes FROM uploads WHERE owner=#{owner} AND hash=#{hash} AND size=#{size} AND expires_at>#{now} ORDER BY expires_at DESC LIMIT 1")
    List<Map<String, Object>> findPendingUpload(@Param("owner") String owner, @Param("hash") String hash, @Param("size") long size, @Param("now") long now);

    @Select("SELECT COALESCE(SUM(size),0)::BIGINT FROM uploads u WHERE owner=#{owner} AND expires_at>#{now} AND NOT EXISTS(SELECT 1 FROM blobs b WHERE b.owner=u.owner AND b.hash=u.hash)")
    Long reservedBytes(@Param("owner") String owner, @Param("now") long now);

    @Update("INSERT INTO uploads(id,owner,hash,size,expires_at) VALUES(#{id},#{owner},#{hash},#{size},#{expiresAt})")
    int insertUpload(@Param("id") String id, @Param("owner") String owner, @Param("hash") String hash, @Param("size") long size, @Param("expiresAt") long expiresAt);

    @Select("SELECT id FROM uploads WHERE id=#{id} AND owner=#{owner} FOR UPDATE")
    List<Map<String, Object>> lockUpload(@Param("id") String id, @Param("owner") String owner);

    @Update("UPDATE uploads SET expires_at=0 WHERE id=#{id}")
    int expireUpload(@Param("id") String id);

    @Update("DELETE FROM uploads WHERE id=#{id} AND owner=#{owner} AND expires_at=0")
    int deleteExpiredUpload(@Param("id") String id, @Param("owner") String owner);

    @Update("UPDATE uploads SET offset_bytes=#{next} WHERE id=#{id}")
    int updateOffset(@Param("next") long next, @Param("id") String id);

    @Select("SELECT id FROM users WHERE id=#{owner} FOR UPDATE")
    String lockOwner(@Param("owner") String owner);

    @Update("INSERT INTO blobs(owner,hash,size) VALUES(#{owner},#{hash},#{size}) ON CONFLICT DO NOTHING")
    int insertBlob(@Param("owner") String owner, @Param("hash") String hash, @Param("size") long size);

    @Select("SELECT size FROM blobs WHERE owner=#{owner} AND hash=#{hash}")
    List<Map<String, Object>> findBlob(@Param("owner") String owner, @Param("hash") String hash);
}
