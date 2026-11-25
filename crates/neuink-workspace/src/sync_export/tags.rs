use super::{decode, entity, files::Files, id, invalid};
use neuink_domain::TagMeta;
use neuink_sync_protocol::{document::EntityDocument, ObjectKind};
use std::{
    collections::{BTreeMap, BTreeSet},
    io,
    path::Path,
};

pub fn export_tags(root: &Path) -> io::Result<Vec<EntityDocument>> {
    let _guard = crate::tag_transaction::lock_metadata().map_err(io::Error::other)?;
    export_tags_locked(root)
}
pub(crate) fn export_tags_locked(root: &Path) -> io::Result<Vec<EntityDocument>> {
    let mut files = Files::new(root)?;
    for journal in ["tag-operation.journal.json", "sync-apply.journal.json"] {
        if files.read_optional(journal)?.is_some() {
            return Err(invalid("标签仍有待恢复保存"));
        }
    }
    let file: crate::workspace::WorkspaceFile = decode(&files.read("neuink.workspace.json")?)?;
    if file.schema_version != 1 {
        return Err(invalid("资料库格式版本不兼容"));
    }
    validate(&file.tags)?;
    let mut documents = file
        .tags
        .iter()
        .map(document)
        .collect::<io::Result<Vec<_>>>()?;
    documents.sort_by(|a, b| a.entity_id.cmp(&b.entity_id));
    files.verify()?;
    Ok(documents)
}
pub(crate) fn document(tag: &TagMeta) -> io::Result<EntityDocument> {
    tag.validate().map_err(|_| invalid("标签名称无效"))?;
    id(tag.id.as_str())?;
    if let Some(parent) = &tag.parent_id {
        id(parent.as_str())?;
    }
    Ok(EntityDocument {
        schema_version: 1,
        entity_id: entity("tag", tag.id.as_str()),
        kind: ObjectKind::Tag,
        payload: serde_json::json!({"tag":tag}),
        resources: Vec::new(),
        references: tag
            .parent_id
            .as_ref()
            .map(|p| vec![entity("tag", p.as_str())])
            .unwrap_or_default(),
    })
}
pub(crate) fn validate(tags: &[TagMeta]) -> io::Result<()> {
    let by_id: BTreeMap<_, _> = tags.iter().map(|t| (t.id.clone(), t)).collect();
    if by_id.len() != tags.len() {
        return Err(invalid("标签标识重复"));
    }
    let mut names = BTreeSet::new();
    for tag in tags {
        document(tag)?;
        if !names.insert((tag.parent_id.clone(), tag.name.to_ascii_lowercase())) {
            return Err(invalid("同一层级存在同名标签，需要核对，未按名称合并"));
        }
        let mut seen = BTreeSet::from([tag.id.clone()]);
        let mut parent = tag.parent_id.as_ref();
        while let Some(id) = parent {
            if !seen.insert(id.clone()) {
                return Err(invalid("标签父子关系形成循环"));
            }
            parent = by_id
                .get(id)
                .ok_or_else(|| invalid("标签父级缺失"))?
                .parent_id
                .as_ref();
        }
    }
    Ok(())
}
