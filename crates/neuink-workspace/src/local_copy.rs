//! Explicit independent copies of managed sources, published only when the whole snapshot is complete.
use crate::{
    atomic_write_json, entry_sources::is_source_managed_dir, tag_reading::validate_id, Workspace,
    WorkspaceError,
};
use chrono::{DateTime, Utc};
use neuink_domain::{
    Annotation, AnnotationId, ContentItem, EntryId, NoteId, PdfParseStatus, SourceLink,
    SourceLinkId,
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};

const ORIGIN_FILE: &str = "local-copy-origin.json";

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct LocalCopyOrigin {
    pub source_entry_id: EntryId,
    pub source_title: String,
    pub source_kinds: Vec<String>,
    pub copied_at: DateTime<Utc>,
    pub source_revision: String,
}

#[derive(Debug, Serialize)]
pub struct LocalCopyResult {
    pub entry_id: EntryId,
    pub created: bool,
}

impl Workspace {
    pub fn local_copy_origin(
        &self,
        entry: &EntryId,
        trashed: bool,
    ) -> Result<Option<LocalCopyOrigin>, WorkspaceError> {
        let dir = if trashed {
            self.layout().trashed_entry_dir(entry)
        } else {
            self.layout().entry_dir(entry)
        };
        match fs::read(dir.join(ORIGIN_FILE)) {
            Ok(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error.into()),
        }
    }

    pub fn copy_source_to_local(
        &self,
        source_id: &EntryId,
        force_new: bool,
    ) -> Result<LocalCopyResult, WorkspaceError> {
        validate_id(source_id.as_str())?;
        let _guard = self.begin_tag_safe_mutation()?;
        let source = self.read_entry(source_id)?;
        let source_dir = self.layout().entry_dir(source_id);
        if !is_source_managed_dir(&source_dir)? {
            return Err(failure("只有来源条目可以导入为本地独立副本。"));
        }
        if !force_new {
            let source_hash = source.pdf.as_ref().map(|pdf| pdf.content_hash.clone()).or(self.zotero_sources(source_id)?.iter().find_map(|source| source.pdf_content_hash.clone()));
            for entry in self.list_entries()? {
                if !is_source_managed_dir(&self.layout().entry_dir(&entry.id))?
                    && (source_hash.as_ref().is_some_and(|hash| entry.pdf.as_ref().is_some_and(|pdf| &pdf.content_hash == hash)) || self
                        .local_copy_origin(&entry.id, false)?
                        .is_some_and(|origin| origin.source_entry_id == *source_id))
                {
                    return Ok(LocalCopyResult {
                        entry_id: entry.id,
                        created: false,
                    });
                }
            }
        }
        if source.pdf.as_ref().is_some_and(|pdf| {
            matches!(
                pdf.parse.status,
                PdfParseStatus::Queued
                    | PdfParseStatus::Uploading
                    | PdfParseStatus::Uploaded
                    | PdfParseStatus::Parsing
            )
        }) {
            return Err(failure(
                "来源论文正在解析，请等待解析完成后再导入本地副本。",
            ));
        }
        let mut kinds = Vec::new();
        for kind in ["zotero", "mineru"] {
            let path = source_dir.join(format!("{kind}-source.json"));
            if path.exists()
                && !serde_json::from_slice::<Vec<serde_json::Value>>(&fs::read(path)?)?.is_empty()
            {
                kinds.push(kind.to_owned());
            }
        }
        let new_id = EntryId::new();
        let mut entry = source.clone();
        entry.id = new_id.clone();
        entry.created_at = Utc::now();
        entry.updated_at = entry.created_at;
        if let Some(pdf) = &mut entry.pdf {
            pdf.parse.task_id = None;
            pdf.parse.updated_at = entry.created_at;
        }
        let mut replacements = vec![(source_id.to_string(), new_id.to_string())];
        for content in &mut entry.contents {
            let ContentItem::Note { note_id, .. } = content;
            validate_id(note_id.as_str())?;
            let links_file = self.layout().entry_note_links_file(source_id, note_id);
            if links_file.exists() {
                for link in serde_json::from_slice::<Vec<SourceLink>>(&fs::read(links_file)?)? {
                    replacements.push((link.link_id.to_string(), SourceLinkId::new().to_string()));
                }
            }
            let next = NoteId::new();
            replacements.push((note_id.to_string(), next.to_string()));
            *note_id = next;
        }
        let annotations = self.layout().entry_annotations_file(source_id);
        if annotations.exists() {
            for annotation in serde_json::from_slice::<Vec<Annotation>>(&fs::read(annotations)?)? {
                replacements.push((
                    annotation.annotation_id.to_string(),
                    AnnotationId::new().to_string(),
                ));
            }
        }
        let files = snapshot_files(&source_dir, &source)?;
        if let Some(pdf) = &source.pdf {
            if hash_file(&source_dir.join("paper.pdf"))? != pdf.content_hash {
                return Err(failure(
                    "来源 PDF 与已保存的内容哈希不一致，请重新检查来源后重试。",
                ));
            }
        }
        fs::create_dir_all(self.layout().cache_dir())?;
        let staged = tempfile::Builder::new()
            .prefix("local-source-copy-")
            .tempdir_in(self.layout().cache_dir())?;
        let mut manifest = Vec::new();
        for relative in &files {
            let input = source_dir.join(relative);
            let hash = hash_file(&input)?;
            let target_name = rewrite(&relative.to_string_lossy(), &replacements);
            let output = staged.path().join(target_name);
            if let Some(parent) = output.parent() {
                fs::create_dir_all(parent)?;
            }
            // Only persisted application documents contain identities. Parser bundles and PDFs stay byte-identical.
            if relative
                .extension()
                .is_some_and(|extension| extension == "md" || extension == "json")
                && !relative.starts_with("mineru-output")
            {
                fs::write(
                    &output,
                    rewrite(&fs::read_to_string(&input)?, &replacements),
                )?;
            } else {
                fs::copy(&input, &output)?;
                if hash_file(&output)? != hash {
                    return Err(failure("复制时来源文件发生变化，请重试。"));
                }
            }
            manifest.push((relative.clone(), hash));
        }
        // A concurrent writer outside the metadata lock must never publish a mixed snapshot.
        if snapshot_files(&source_dir, &source)? != files || self.read_entry(source_id)? != source {
            return Err(failure("来源副本在复制期间发生变化，请重试。"));
        }
        for (relative, hash) in &manifest {
            if hash_file(&source_dir.join(relative))? != *hash {
                return Err(failure("来源笔记或解析结果在复制期间发生变化，请重试。"));
            }
        }
        entry.validate()?;
        atomic_write_json(staged.path().join("entry.meta.json"), &entry)?;
        let source_revision = blake3::hash(&serde_json::to_vec(&(&source, &manifest))?)
            .to_hex()
            .to_string();
        let origin = LocalCopyOrigin {
            source_entry_id: source_id.clone(),
            source_title: source.title,
            source_kinds: kinds,
            copied_at: entry.created_at,
            source_revision,
        };
        atomic_write_json(staged.path().join(ORIGIN_FILE), &origin)?;
        self.record_copied_zotero_notes(source_id, staged.path(), &replacements)?;
        let destination = self.layout().entry_dir(&new_id);
        if destination.exists() {
            return Err(WorkspaceError::EntryAlreadyExists(new_id.to_string()));
        }
        fs::rename(staged.path(), &destination)?;
        Ok(LocalCopyResult {
            entry_id: new_id,
            created: true,
        })
    }
}

fn rewrite(text: &str, replacements: &[(String, String)]) -> String {
    replacements
        .iter()
        .fold(text.to_owned(), |text, (old, new)| text.replace(old, new))
}

fn hash_file(path: &Path) -> Result<String, WorkspaceError> {
    let mut file = fs::File::open(path)?;
    let mut hasher = blake3::Hasher::new();
    let mut buffer = [0u8; 65536];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(hasher.finalize().to_hex().to_string())
}

fn snapshot_files(
    root: &Path,
    entry: &neuink_domain::EntryMeta,
) -> Result<Vec<PathBuf>, WorkspaceError> {
    if fs::symlink_metadata(root)?.file_type().is_symlink() {
        return Err(failure("来源副本目录不能是符号链接。"));
    }
    let canonical = root.canonicalize()?;
    let mut files = Vec::new();
    for name in [
        "paper.pdf",
        "paper.segments.json",
        "segment-notes.json",
        "paper.annotations.json",
        "paper.translation.json",
        "mineru-output",
    ] {
        collect(root, &canonical, &root.join(name), &mut files, 0)?;
    }
    for content in &entry.contents {
        let ContentItem::Note { note_id, .. } = content;
        let note = root.join("notes").join(format!("{note_id}.md"));
        if !note.is_file() {
            return Err(failure("来源笔记文件缺失，未创建本地副本。"));
        }
        for suffix in ["md", "links.json", "assets"] {
            collect(
                root,
                &canonical,
                &root.join("notes").join(format!("{note_id}.{suffix}")),
                &mut files,
                0,
            )?;
        }
    }
    files.sort();
    Ok(files)
}

fn collect(
    root: &Path,
    canonical: &Path,
    path: &Path,
    files: &mut Vec<PathBuf>,
    depth: usize,
) -> Result<(), WorkspaceError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    if depth > 64
        || metadata.file_type().is_symlink()
        || !path.canonicalize()?.starts_with(canonical)
    {
        return Err(failure(
            "来源资源含不安全的链接或过深目录，未创建本地副本。",
        ));
    }
    if metadata.is_dir() {
        for item in fs::read_dir(path)? {
            let item = item?;
            if !item.file_name().to_string_lossy().starts_with('.') {
                collect(root, canonical, &item.path(), files, depth + 1)?;
            }
        }
    } else if metadata.is_file() {
        files.push(
            path.strip_prefix(root)
                .map_err(|_| failure("来源资源路径无效。"))?
                .to_path_buf(),
        );
    }
    Ok(())
}

fn failure(message: &str) -> WorkspaceError {
    WorkspaceError::LocalCopy(message.to_owned())
}

#[cfg(test)]
#[path = "local_copy_tests.rs"]
mod tests;
