use neuink_sync_protocol::document::EntityDocument;
use serde_json::{json, Value};
use std::collections::BTreeMap;

/// Confirmed ideation is a self-contained snapshot. Its entry references are
/// provenance, unlike the structural dependencies of notes, parses and tags.
pub(super) fn required_references(document: &EntityDocument) -> &[String] {
    if document.entity_id == "board:ideation" && document.kind == neuink_sync_protocol::ObjectKind::Board {
        &[]
    } else {
        &document.references
    }
}

pub(super) fn encode(document: &EntityDocument) -> Result<Value, String> {
    document.validate().map_err(str::to_owned)?;
    let mut hashes = BTreeMap::new();
    for resource in &document.resources {
        if hashes
            .insert(&resource.hash, resource.size)
            .is_some_and(|size| size != resource.size)
        {
            return Err("附件哈希重复但大小不一致".into());
        }
    }
    if hashes.len() > 4096 {
        return Err("该实体附件超过 4096 个，已保留本地内容；请拆分来源资料后重试".into());
    }
    let files: Vec<_> = hashes
        .into_iter()
        .map(|(hash, size)| json!({"hash":hash,"size":size}))
        .collect();
    let value = json!({"document":document,"_files":files});
    if serde_json::to_vec(&value)
        .map_err(|_| "实体编码失败")?
        .len()
        > 2 * 1024 * 1024 - 4096
    {
        return Err("实体清单超过操作大小限制".into());
    }
    Ok(value)
}

pub(super) fn decode(value: &Value) -> Result<EntityDocument, String> {
    let document: EntityDocument =
        serde_json::from_value(value["document"].clone()).map_err(|_| "远端同步实体格式不兼容")?;
    if encode(&document)? != *value {
        return Err("远端附件声明与实体引用不一致".into());
    }
    Ok(document)
}

pub(super) fn entry_id(document: &EntityDocument) -> Result<String, String> {
    let value = if document.kind == neuink_sync_protocol::ObjectKind::Entry {
        &document.payload["entry"]["id"]
    } else {
        &document.payload["entry_id"]
    };
    value
        .as_str()
        .filter(|id| {
            !id.is_empty()
                && id.len() <= 128
                && id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        })
        .map(str::to_owned)
        .ok_or("远端条目标识无效".into())
}

pub(super) fn owner(document: &EntityDocument) -> Result<String, String> {
    if document.kind == neuink_sync_protocol::ObjectKind::Tag
        || document.entity_id == "board:ideation"
    {
        Ok(document.entity_id.clone())
    } else {
        entry_id(document)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_ideation_provenance_is_optional() {
        let mut document = EntityDocument { schema_version: 1, entity_id: "board:ideation".into(),
            kind: neuink_sync_protocol::ObjectKind::Board, payload: json!({}),
            references: vec!["entry:source".into()], resources: vec![] };
        assert!(required_references(&document).is_empty());
        document.entity_id = "entry:example".into();
        assert_eq!(required_references(&document), document.references.as_slice());
    }
    #[test]
    fn large_image_manifest_roundtrips_without_truncation() {
        let document = EntityDocument {
            schema_version: 1,
            entity_id: "parse:example".into(),
            kind: neuink_sync_protocol::ObjectKind::ParseSnapshot,
            payload: json!({"entry_id":"example"}),
            references: vec![],
            resources: (0..257)
                .map(|index| neuink_sync_protocol::document::Resource {
                    name: format!("images/{index}.png"),
                    hash: blake3::hash(index.to_string().as_bytes())
                        .to_hex()
                        .to_string(),
                    size: 1024,
                })
                .collect(),
        };
        let wire = encode(&document).unwrap();
        assert_eq!(wire["_files"].as_array().unwrap().len(), 257);
        assert_eq!(decode(&wire).unwrap(), document);
    }
}
