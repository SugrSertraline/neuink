//! Read-only, versioned export of the first Workspace sync entities.
//! Does not bind an account, mutate files, recover journals, or send data.
mod entities;
pub(crate) mod files;
mod folds;
pub(crate) mod ideation;
mod metadata;
mod paragraph_translations;
mod references;
mod sentence_translations;
pub(crate) mod tags;
mod translation;
pub use ideation::export_ideation;
pub use tags::export_tags;

/// Source caches stay owned by their integration. Only an explicit independent
/// local copy participates in paper synchronization. Invalid markers fail closed.
pub fn is_source_cache(root: &Path, entry_id: &str) -> io::Result<bool> {
    id(entry_id)?;
    crate::entry_sources::is_source_managed_dir(&root.join("entries").join(entry_id))
        .map_err(io::Error::other)
}
#[cfg(test)]
mod tests;

use files::Files;
use neuink_domain::{ContentItem, EntryMeta, PdfParseStatus};
use neuink_sync_protocol::{
    document::{EntityDocument, Resource, ENTITY_SCHEMA_VERSION},
    ObjectKind,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::{collections::BTreeSet, io, path::Path};

#[derive(Clone, Debug, Serialize)]
pub struct ExportNotice {
    pub code: &'static str,
    pub entity_id: String,
    pub message: &'static str,
}

/// Only the manifest is serializable; host file locations stay in Files.
#[derive(Debug, Serialize)]
pub struct ExportManifest {
    pub schema_version: u16,
    pub entry_id: String,
    pub documents: Vec<EntityDocument>,
    pub attachment_bytes: u64,
    pub unique_attachment_bytes: u64,
    pub notices: Vec<ExportNotice>,
    /// References to tags/other entries outside this single-entry bundle. The
    /// library coordinator must resolve them before claiming a complete export.
    pub required_entities: Vec<String>,
}

pub struct ExportBundle {
    manifest: ExportManifest,
    files: Files,
}

impl ExportBundle {
    pub fn manifest(&self) -> &ExportManifest {
        &self.manifest
    }
}

pub(super) fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}
fn decode<T: serde::de::DeserializeOwned>(bytes: &[u8]) -> io::Result<T> {
    serde_json::from_slice(bytes).map_err(|_| invalid("本地结构化文档格式无效，未导出"))
}
fn id(value: &str) -> io::Result<()> {
    crate::tag_reading::validate_id(value).map_err(|_| invalid("实体标识无效"))
}
fn entity(kind: &str, id: &str) -> String {
    format!("{kind}:{id}")
}

struct Exporter {
    files: Files,
    manifest: ExportManifest,
}

impl Exporter {
    fn notice(&mut self, code: &'static str, entity_id: &str, message: &'static str) {
        if !self
            .manifest
            .notices
            .iter()
            .any(|n| n.code == code && n.entity_id == entity_id)
        {
            self.manifest.notices.push(ExportNotice {
                code,
                entity_id: entity_id.into(),
                message,
            });
        }
    }

    fn document(
        &mut self,
        key: String,
        kind: ObjectKind,
        payload: Value,
        resources: Vec<Resource>,
        references: Vec<String>,
    ) -> io::Result<()> {
        let document = EntityDocument {
            schema_version: ENTITY_SCHEMA_VERSION,
            entity_id: key,
            kind,
            payload,
            resources,
            references,
        };
        document.validate().map_err(invalid)?;
        if self
            .manifest
            .documents
            .iter()
            .any(|old| old.entity_id == document.entity_id)
        {
            return Err(invalid("实体标识重复"));
        }
        self.manifest.documents.push(document);
        Ok(())
    }
}

/// Export a coherent, read-only snapshot for one active entry. Missing resources
/// block this entry instead of publishing a silently incomplete paper.
pub fn export_entry(root: &Path, entry_id: &str) -> io::Result<ExportBundle> {
    id(entry_id)?;
    let _guard = crate::tag_transaction::lock_metadata().map_err(io::Error::other)?;
    export_entry_locked(root, entry_id)
}

pub(crate) fn export_entry_locked(root: &Path, entry_id: &str) -> io::Result<ExportBundle> {
    export_entry_location(root, entry_id, false)
}

pub(crate) fn export_trashed_entry_locked(root: &Path, entry_id: &str) -> io::Result<ExportBundle> {
    export_entry_location(root, entry_id, true)
}

fn export_entry_location(root: &Path, entry_id: &str, trashed: bool) -> io::Result<ExportBundle> {
    id(entry_id)?;
    if !trashed && is_source_cache(root, entry_id)? {
        return Err(invalid("来源缓存不参与云同步；请先明确导入为本地副本"));
    }
    let mut export = Exporter {
        files: if trashed {
            Files::for_trashed_entry(root, entry_id)?
        } else {
            Files::new(root)?
        },
        manifest: ExportManifest {
            schema_version: 1,
            entry_id: entry_id.into(),
            documents: Vec::new(),
            attachment_bytes: 0,
            unique_attachment_bytes: 0,
            notices: Vec::new(),
            required_entities: Vec::new(),
        },
    };
    for journal in [
        "tag-operation.journal.json",
        "content-operation.journal.json",
        "child-trash.journal.json",
        "source-note-import.journal.json",
        "sync-apply.journal.json",
    ] {
        if export.files.read_optional(journal)?.is_some() {
            return Err(invalid("资料库存在待恢复保存，请在应用中完成恢复后再同步"));
        }
    }
    let mut entry: EntryMeta = decode(
        &export
            .files
            .read(&format!("entries/{entry_id}/entry.meta.json"))?,
    )?;
    if entry.id.as_str() != entry_id {
        return Err(invalid("条目目录与实体标识不一致"));
    }
    entry.validate().map_err(|_| invalid("条目元数据无效"))?;
    let parsed = export.parse(entry_id)?;
    let mut resources = Vec::new();
    if let Some(pdf) = &mut entry.pdf {
        let resource = export
            .files
            .resource(&format!("entries/{entry_id}/paper.pdf"), "paper.pdf")?;
        pdf.content_hash = resource.hash.clone();
        pdf.file_name = pdf
            .file_name
            .rsplit(['/', '\\'])
            .next()
            .filter(|name| neuink_sync_protocol::document::portable_resource_name(name))
            .unwrap_or("paper.pdf")
            .to_owned();
        pdf.parse.message = None;
        pdf.parse.task_id = None;
        pdf.parse.endpoint = None;
        pdf.parse.status = if parsed {
            PdfParseStatus::Succeeded
        } else {
            PdfParseStatus::NotStarted
        };
        resources.push(resource);
    }
    let mut refs = BTreeSet::new();
    for tag in &entry.tags {
        id(tag.as_str())?;
        refs.insert(entity("tag", tag.as_str()));
    }
    for ContentItem::Note { note_id, .. } in &entry.contents {
        id(note_id.as_str())?;
        refs.insert(entity("note", note_id.as_str()));
    }
    if parsed {
        refs.insert(entity("parse", entry_id));
    }
    // Arbitrary user fields are retained. Local integration configuration lives
    // in separate files and is not read. Refuse explicit host-path field values.
    if entry
        .fields
        .values()
        .any(|value| references::host_path(value))
    {
        return Err(invalid("条目字段包含本机绝对路径，请先处理该字段再同步"));
    }
    export.notes(&entry)?;
    export.annotations(entry_id)?;
    export.segment_notes(entry_id)?;
    export.folds(entry_id)?;
    export.translation(entry_id)?;
    export.sentence_translations(entry_id)?;
    export.paragraph_translations(entry_id)?;
    export.document(
        entity("entry", entry_id),
        ObjectKind::Entry,
        json!({"entry":entry}),
        resources,
        refs.into_iter().collect(),
    )?;
    export.notice(
        "recovery_package_retained",
        entry_id,
        "当前导出覆盖已保存的片段快照；原始解析包仍保留，待完整重建验证后再优化",
    );
    export
        .manifest
        .documents
        .sort_by(|a, b| a.entity_id.cmp(&b.entity_id));
    let included: BTreeSet<_> = export
        .manifest
        .documents
        .iter()
        .map(|d| d.entity_id.as_str())
        .collect();
    export.manifest.required_entities = export
        .manifest
        .documents
        .iter()
        .flat_map(|d| &d.references)
        .filter(|key| !included.contains(key.as_str()))
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    if !export.manifest.required_entities.is_empty() {
        export.notice(
            "additional_entities_required",
            entry_id,
            "含标签或其他条目的来源引用，需要在整库同步时一并核对；单篇导出不表示依赖已齐全",
        );
    }
    let mut hashes = BTreeSet::new();
    for document in &export.manifest.documents {
        for resource in &document.resources {
            export.manifest.attachment_bytes += resource.size;
            if hashes.insert(&resource.hash) {
                export.manifest.unique_attachment_bytes += resource.size;
            }
        }
    }
    export.files.verify()?;
    Ok(ExportBundle {
        manifest: export.manifest,
        files: export.files,
    })
}
