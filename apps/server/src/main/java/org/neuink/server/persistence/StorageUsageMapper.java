package org.neuink.server.persistence;

import org.apache.ibatis.annotations.*;

/** SQL boundary for StorageUsage; transaction ownership remains with the service. */
@Mapper
public interface StorageUsageMapper {
    @Select("SELECT COALESCE(SUM(bytes),0)::BIGINT FROM (SELECT octet_length(o.content::text) AS bytes FROM objects o JOIN libraries l ON l.id=o.library_id WHERE l.owner=#{owner} UNION ALL SELECT octet_length(c.content::text) FROM changes c JOIN libraries l ON l.id=c.library_id WHERE l.owner=#{owner2} AND NOT EXISTS (SELECT 1 FROM objects o WHERE o.library_id=c.library_id AND o.id=c.object_id AND o.revision=c.revision)) s")
    Long metadataBytes(@Param("owner") String owner, @Param("owner2") String owner2);

    @Select("SELECT COALESCE(SUM(size),0)::BIGINT FROM blobs WHERE owner=#{owner}")
    Long blobBytes(@Param("owner") String owner);

    @Select("SELECT COALESCE(SUM(size),0)::BIGINT FROM (SELECT MAX(u.size) AS size FROM uploads u WHERE owner=#{owner} AND expires_at>#{now} AND NOT EXISTS(SELECT 1 FROM blobs b WHERE b.owner=u.owner AND b.hash=u.hash) GROUP BY u.hash) s")
    Long reservedBytes(@Param("owner") String owner, @Param("now") long now);

    @Select("SELECT quota FROM users WHERE id=#{owner}")
    Long readQuota(@Param("owner") String owner);
}
