package org.neuink.server.persistence;

import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.*;

/** SQL boundary for StoragePreview; transaction ownership remains with the service. */
@Mapper
public interface StoragePreviewMapper {
    @Select("SELECT id FROM libraries WHERE id=#{library} AND owner=#{owner}")
    List<Map<String, Object>> findLibrary(@Param("library") String library, @Param("owner") String owner);

    @Select("SELECT COALESCE(sum(b.size),0)::BIGINT FROM jsonb_to_recordset(#{filesJson}::jsonb) AS f(hash text,size bigint) JOIN blobs b ON b.owner=#{owner} AND b.hash=f.hash AND b.size=f.size")
    Long existingBytes(@Param("filesJson") String filesJson, @Param("owner") String owner);

    @Select("SELECT count(*) FROM objects WHERE library_id=#{library} AND id IN (SELECT jsonb_array_elements_text(#{idsJson}::jsonb))")
    Long countOverlaps(@Param("library") String library, @Param("idsJson") String idsJson);
}
