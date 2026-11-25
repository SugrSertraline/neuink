use super::{cache, error, journal::FileChange, Result};
use crate::{
    atomic_write,
    sync_export::files::{fingerprint, safe_path},
    Workspace,
};
use neuink_domain::{Annotation, EntryMeta, NoteId, SourceLink, SourceSegment};
use neuink_sync_protocol::{
    document::{EntityDocument, Resource},
    ObjectKind,
};
use serde::Deserialize;
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

pub(super) struct Rendered {
    pub root: tempfile::TempDir,
    files: BTreeMap<String, (String, u64, BTreeSet<String>)>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NoteContent {
    note_id: NoteId,
    title: String,
    markdown: String,
    links: Vec<SourceLink>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ParseContent {
    schema_version: u16,
    format: String,
    segments: Vec<SourceSegment>,
}

pub(super) fn image(path: &str) -> bool {
    matches!(
        Path::new(path)
            .extension()
            .and_then(|v| v.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "avif" | "bmp" | "tif" | "tiff" | "svg"
    )
}

impl Rendered {
    fn add(
        &mut self,
        workspace: &Workspace,
        relative: String,
        resource: &Resource,
        owner: &str,
    ) -> Result<()> {
        if let Some((hash, size, owners)) = self.files.get_mut(&relative) {
            if hash != &resource.hash || *size != resource.size {
                return Err("多个实体对同一资源声明不同内容".into());
            }
            owners.insert(owner.into());
            return Ok(());
        }
        let target = safe_path(&self.root.path().canonicalize().map_err(error)?, &relative)
            .map_err(error)?;
        cache::copy(
            &cache::blob_path(workspace, &resource.hash)?,
            &target,
            &resource.hash,
            resource.size,
        )?;
        self.files.insert(
            relative,
            (
                resource.hash.clone(),
                resource.size,
                BTreeSet::from([owner.into()]),
            ),
        );
        Ok(())
    }
    fn document(
        &mut self,
        workspace: &Workspace,
        relative: String,
        bytes: &[u8],
        owner: &str,
    ) -> Result<()> {
        let hash = blake3::hash(bytes).to_hex().to_string();
        let source = cache::blob_path(workspace, &hash)?;
        atomic_write(source, bytes).map_err(error)?;
        self.add(
            workspace,
            relative.clone(),
            &Resource {
                name: relative,
                hash,
                size: bytes.len() as u64,
            },
            owner,
        )
    }
    /// Collection files must also be published when their last member is deleted.
    /// Deleted members remain owners of the resulting file for this transaction.
    pub fn include_deletions(
        &mut self,
        workspace: &Workspace,
        groups: &BTreeMap<String, Vec<EntityDocument>>,
        deletions: &BTreeMap<String, Vec<EntityDocument>>,
    ) -> Result<()> {
        for (entry, removed) in deletions {
            for deleted in removed {
                let (file, field) = match deleted.kind {
                    ObjectKind::Annotation => ("paper.annotations.json", "annotation"),
                    ObjectKind::SegmentNote => ("segment-notes.json", "note"),
                    _ => continue,
                };
                let values = groups
                    .get(entry)
                    .ok_or("删除内容缺少所属条目")?
                    .iter()
                    .filter(|d| d.kind == deleted.kind)
                    .map(|d| d.payload[field].clone())
                    .collect::<Vec<_>>();
                let bytes = if deleted.kind == ObjectKind::Annotation {
                    let values: Vec<Annotation> = values
                        .into_iter()
                        .map(serde_json::from_value)
                        .collect::<std::result::Result<_, _>>()
                        .map_err(error)?;
                    serde_json::to_vec_pretty(&values).map_err(error)?
                } else {
                    let values: Vec<neuink_domain::SegmentBlockNote> = values
                        .into_iter()
                        .map(serde_json::from_value)
                        .collect::<std::result::Result<_, _>>()
                        .map_err(error)?;
                    serde_json::to_vec_pretty(&values).map_err(error)?
                };
                self.document(
                    workspace,
                    format!("entries/{entry}/{file}"),
                    &bytes,
                    &deleted.entity_id,
                )?;
            }
        }
        Ok(())
    }
    pub fn changes(
        &self,
        workspace: &Workspace,
        old: &[EntityDocument],
        changed: &BTreeSet<String>,
    ) -> Result<Vec<FileChange>> {
        let root = workspace.layout().root().canonicalize().map_err(error)?;
        let mut changes = Vec::new();
        for (relative, (hash, size, owners)) in &self.files {
            if owners.is_disjoint(changed) {
                continue;
            }
            let target = safe_path(&root, relative).map_err(error)?;
            let before = fingerprint(&target).map_err(error)?;
            if before.as_ref() == Some(&(hash.clone(), *size)) {
                continue;
            }
            if let Some((before_hash, before_size)) = &before {
                let entry = relative.split('/').nth(1).ok_or("资源条目标识缺失")?;
                if !old.iter().any(|d| d.entity_id == format!("entry:{entry}")) {
                    return Err("条目目录已存在其他内容，未覆盖".into());
                }
                if image(relative) || relative.ends_with("/paper.pdf") {
                    let declared = old.iter().flat_map(|d| &d.resources).any(|r| {
                        (r.name == *relative
                            || (r.name == "paper.pdf" && relative.ends_with("/paper.pdf")))
                            && &r.hash == before_hash
                    });
                    if !declared {
                        return Err("资源路径与现有未同步文件冲突，未覆盖".into());
                    }
                }
                // Keep old bytes available even if interrupted while replacing a later file.
                cache::copy(
                    &target,
                    &cache::blob_path(workspace, before_hash)?,
                    before_hash,
                    *before_size,
                )?;
            }
            changes.push(FileChange {
                relative: relative.clone(),
                before: before.map(|(h, _)| h),
                hash: hash.clone(),
                size: *size,
            });
        }
        // Publish the entry catalog only after its note files and attachments exist.
        changes.sort_by_key(|c| c.relative.ends_with("entry.meta.json"));
        Ok(changes)
    }
}

pub(super) fn render(
    workspace: &Workspace,
    entry_id: &str,
    documents: &[EntityDocument],
) -> Result<Rendered> {
    let mut result = Rendered {
        root: tempfile::tempdir().map_err(error)?,
        files: BTreeMap::new(),
    };
    let base = format!("entries/{entry_id}");
    let mut folds = BTreeMap::<String, crate::folding::FoldRecord>::new();
    let mut fold_owners = Vec::new();
    let mut segment_notes = Vec::<neuink_domain::SegmentBlockNote>::new();
    let mut segment_note_owners = Vec::new();
    let mut annotations = Vec::<Annotation>::new();
    let mut annotation_owners = Vec::new();
    for document in documents {
        document.validate().map_err(str::to_owned)?;
        let owner = &document.entity_id;
        let expected_key;
        match document.kind {
            ObjectKind::Entry => {
                let entry: EntryMeta =
                    serde_json::from_value(document.payload["entry"].clone()).map_err(error)?;
                if entry.id.as_str() != entry_id {
                    return Err("入站条目归属不一致".into());
                }
                entry.validate().map_err(error)?;
                expected_key = format!("entry:{entry_id}");
                result.document(
                    workspace,
                    format!("{base}/entry.meta.json"),
                    &serde_json::to_vec_pretty(&entry).map_err(error)?,
                    owner,
                )?;
            }
            ObjectKind::Note => {
                if document.payload["entry_id"] != entry_id {
                    return Err("入站笔记归属不一致".into());
                }
                let resource = document
                    .resources
                    .iter()
                    .find(|r| r.name == "note.json")
                    .ok_or("笔记正文附件缺失")?;
                let note: NoteContent =
                    serde_json::from_slice(&cache::read(workspace, resource)?).map_err(error)?;
                crate::tag_reading::validate_id(note.note_id.as_str()).map_err(error)?;
                expected_key = format!("note:{}", note.note_id);
                let _title = note.title; // Checked against the entry catalog by canonical re-export.
                let body = format!("---\nnote_id: {}\n---\n\n{}", note.note_id, note.markdown);
                result.document(
                    workspace,
                    format!("{base}/notes/{}.md", note.note_id),
                    body.as_bytes(),
                    owner,
                )?;
                result.document(
                    workspace,
                    format!("{base}/notes/{}.links.json", note.note_id),
                    &serde_json::to_vec_pretty(&note.links).map_err(error)?,
                    owner,
                )?;
            }
            ObjectKind::ParseSnapshot => {
                if document.payload["entry_id"] != entry_id {
                    return Err("解析快照归属不一致".into());
                }
                let resource = document
                    .resources
                    .iter()
                    .find(|r| r.name == "segments.json")
                    .ok_or("解析快照正文附件缺失")?;
                let parsed: ParseContent =
                    serde_json::from_slice(&cache::read(workspace, resource)?).map_err(error)?;
                if parsed.schema_version != 1 || parsed.format != "neuink.source-segments" {
                    return Err("解析快照版本不兼容".into());
                }
                expected_key = format!("parse:{entry_id}");
                let bytes = serde_json::to_vec_pretty(&parsed.segments).map_err(error)?;
                result.document(
                    workspace,
                    format!("{base}/paper.segments.json"),
                    &bytes,
                    owner,
                )?;
                result.document(
                    workspace,
                    format!("{base}/paper.reading-snapshot.json"),
                    &serde_json::to_vec(&crate::workspace::reading_snapshot::marker(&bytes))
                        .map_err(error)?,
                    owner,
                )?;
            }
            ObjectKind::Translation
                if document.entity_id == format!("paragraph-translation:{entry_id}") =>
            {
                if document.payload["entry_id"] != entry_id {
                    return Err("历史段落译文归属不一致".into());
                }
                let resource = document
                    .resources
                    .iter()
                    .find(|resource| resource.name == "paragraph-translations.json")
                    .ok_or("历史段落译文附件缺失")?;
                let records: BTreeMap<String, crate::paragraph_translation::ParagraphTranslation> =
                    serde_json::from_slice(&cache::read(workspace, resource)?).map_err(error)?;
                expected_key = format!("paragraph-translation:{entry_id}");
                result.document(
                    workspace,
                    format!("{base}/paper.paragraph-translations.json"),
                    &serde_json::to_vec_pretty(&records).map_err(error)?,
                    owner,
                )?;
            }
            ObjectKind::Translation
                if document.entity_id == format!("sentence-translation:{entry_id}") =>
            {
                if document.payload["entry_id"] != entry_id {
                    return Err("单句译文归属不一致".into());
                }
                let resource = document
                    .resources
                    .iter()
                    .find(|resource| resource.name == "sentence-translations.json")
                    .ok_or("单句译文正文附件缺失")?;
                let records: BTreeMap<
                    String,
                    crate::sentence_translation::SavedSentenceTranslation,
                > = serde_json::from_slice(&cache::read(workspace, resource)?).map_err(error)?;
                expected_key = format!("sentence-translation:{entry_id}");
                result.document(
                    workspace,
                    format!("{base}/paper.sentence-translations.json"),
                    &serde_json::to_vec_pretty(&records).map_err(error)?,
                    owner,
                )?;
            }
            ObjectKind::Translation => {
                if document.payload["entry_id"] != entry_id {
                    return Err("译文归属不一致".into());
                }
                let resource = document
                    .resources
                    .iter()
                    .find(|r| r.name == "translation.json")
                    .ok_or("译文正文缺失")?;
                let translation: crate::EntryTranslation =
                    serde_json::from_slice(&cache::read(workspace, resource)?).map_err(error)?;
                if translation.entry_id.as_str() != entry_id
                    || translation.task.is_some()
                    || translation.error.is_some()
                {
                    return Err("入站译文包含运行任务或归属错误".into());
                }
                expected_key = format!("translation:{entry_id}");
                result.document(
                    workspace,
                    format!("{base}/paper.translation.json"),
                    &serde_json::to_vec_pretty(&translation).map_err(error)?,
                    owner,
                )?;
            }
            ObjectKind::Fold => {
                if document.payload["entry_id"] != entry_id {
                    return Err("阅读详略归属不一致".into());
                }
                let record: crate::folding::FoldRecord =
                    serde_json::from_value(document.payload["record"].clone()).map_err(error)?;
                expected_key = format!("fold:{entry_id}:{}", record.segment_uid);
                folds.insert(record.segment_uid.clone(), record);
                fold_owners.push(owner.clone());
            }
            ObjectKind::SegmentNote => {
                if document.payload["entry_id"] != entry_id {
                    return Err("片段笔记归属不一致".into());
                }
                let note: neuink_domain::SegmentBlockNote =
                    serde_json::from_value(document.payload["note"].clone()).map_err(error)?;
                expected_key = format!("segment_note:{entry_id}:{}", note.segment_uid);
                segment_notes.push(note);
                segment_note_owners.push(owner.clone());
            }
            ObjectKind::Annotation => {
                if document.payload["entry_id"] != entry_id {
                    return Err("批注归属不一致".into());
                }
                let annotation: Annotation =
                    serde_json::from_value(document.payload["annotation"].clone())
                        .map_err(error)?;
                expected_key = format!("annotation:{}", annotation.annotation_id);
                annotations.push(annotation);
                annotation_owners.push(owner.clone());
            }
            _ => return Err("该实体类型尚未接入本次落盘流程".into()),
        }
        if &expected_key != owner {
            return Err("入站实体类型与标识不匹配".into());
        }
        for resource in &document.resources {
            if matches!(
                resource.name.as_str(),
                "translation.json" | "sentence-translations.json" | "paragraph-translations.json"
            ) && document.kind == ObjectKind::Translation
            {
                continue;
            }
            if resource.name == "note.json" && document.kind == ObjectKind::Note {
                continue;
            }
            if resource.name == "segments.json" && document.kind == ObjectKind::ParseSnapshot {
                continue;
            }
            let target = if resource.name == "paper.pdf" && document.kind == ObjectKind::Entry {
                format!("{base}/paper.pdf")
            } else if (resource.name.starts_with(&format!("{base}/mineru-output/"))
                || (document.kind == ObjectKind::Note
                    && document
                        .references
                        .iter()
                        .filter_map(|r| r.strip_prefix("entry:"))
                        .any(|id| {
                            resource
                                .name
                                .starts_with(&format!("entries/{id}/mineru-output/"))
                        })))
                && image(&resource.name)
            {
                resource.name.clone()
            } else if document.kind == ObjectKind::Note
                && resource.name.starts_with(&format!(
                    "{base}/notes/{}.assets/",
                    document.payload["note_id"].as_str().ok_or("笔记标识缺失")?
                ))
                && image(&resource.name)
            {
                resource.name.clone()
            } else {
                return Err("入站资源不属于当前实体或类型不受支持".into());
            };
            result.add(workspace, target, resource, owner)?;
        }
    }
    if !folds.is_empty() {
        let bytes = serde_json::to_vec_pretty(&serde_json::json!({"version":1,"records":folds}))
            .map_err(error)?;
        for owner in fold_owners {
            result.document(
                workspace,
                format!("{base}/paper.folds.json"),
                &bytes,
                &owner,
            )?;
        }
    }
    if !segment_notes.is_empty() {
        let bytes = serde_json::to_vec_pretty(&segment_notes).map_err(error)?;
        for owner in segment_note_owners {
            result.document(
                workspace,
                format!("{base}/segment-notes.json"),
                &bytes,
                &owner,
            )?;
        }
    }
    if !annotations.is_empty() {
        let bytes = serde_json::to_vec_pretty(&annotations).map_err(error)?;
        for owner in annotation_owners {
            result.document(
                workspace,
                format!("{base}/paper.annotations.json"),
                &bytes,
                &owner,
            )?;
        }
    }
    Ok(result)
}

pub(super) fn render_all(
    workspace: &Workspace,
    groups: &BTreeMap<String, Vec<EntityDocument>>,
) -> Result<Rendered> {
    let mut combined = Rendered {
        root: tempfile::tempdir().map_err(error)?,
        files: BTreeMap::new(),
    };
    for (entry, documents) in groups {
        let rendered = render(workspace, entry, documents)?;
        for (relative, (hash, size, owners)) in rendered.files {
            let resource = Resource {
                name: relative.clone(),
                hash,
                size,
            };
            for owner in owners {
                combined.add(workspace, relative.clone(), &resource, &owner)?;
            }
        }
    }
    Ok(combined)
}
