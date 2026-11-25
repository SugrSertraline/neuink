package org.neuink.server.persistence;

import org.apache.ibatis.annotations.*;

/** SQL boundary for FileManifest; transaction ownership remains with the service. */
@Mapper
public interface FileManifestMapper {
    @Select("SELECT count(*) FROM jsonb_to_recordset(#{filesJson}::jsonb) AS f(hash text, size bigint) JOIN blobs b ON b.owner=#{owner} AND b.hash=f.hash AND b.size=f.size")
    Long countMatchingFiles(@Param("filesJson") String filesJson, @Param("owner") String owner);

    @Update("DELETE FROM blob_gc WHERE owner=#{owner} AND hash IN (SELECT f.hash FROM jsonb_to_recordset(#{filesJson}::jsonb) AS f(hash text))")
    int cancelCollection(@Param("owner") String owner, @Param("filesJson") String filesJson);
}
