//! Publish complete Zotero entries from same-volume staging; never edit Zotero.
use crate::{atomic_write, atomic_write_json, Workspace, WorkspaceError};
use crate::pdf_duplicate::PdfDuplicate;
use neuink_domain::{EntryId, EntryMeta, NoteId};
use neuink_zotero::{Library, Paper};
use serde::{Deserialize, Serialize};
use std::{collections::{HashMap, HashSet}, fs, io::Read, path::PathBuf, sync::Mutex, time::UNIX_EPOCH};

static IMPORT_LOCK: Mutex<()> = Mutex::new(());
const SOURCE_FILE: &str = "zotero-source.json";
const HIDDEN_FILE: &str = "zotero-hidden.json";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ZoteroSource {
    #[serde(default)]
    pub pdf_content_hash: Option<String>,
    pub source_id: String,
    pub item_id: String,
    pub attachment_key: Option<String>,
    pub collections: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub note_ids: HashMap<String, NoteId>,
    #[serde(default)]
    pub source_fingerprint: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ZoteroImportResult {
    pub entry_id: EntryId,
    pub title: String,
    pub status: &'static str,
    pub has_pdf: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duplicate: Option<PdfDuplicate>,
}

impl Workspace {
    /// Refresh only the read-only source organization, preserving local tags and comparison baselines.
    pub fn refresh_zotero_organization(&self, library: &Library) -> Result<bool, WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        let papers: HashMap<_, _> = library.papers.iter().map(|paper| (paper.id.as_str(), paper)).collect();
        let mut updated = false;
        for entry in self.list_entries()? {
            let mut sources = self.zotero_sources(&entry.id)?;
            let mut dirty = false;
            for source in &mut sources {
                if source.source_id != library.source_id { continue; }
                let Some(paper) = papers.get(source.item_id.as_str()) else { continue; };
                let collections: Vec<String> = library.collections.iter().filter(|collection| paper.collection_ids.contains(&collection.id)).map(|collection| collection.path.clone()).collect();
                if source.tags != paper.tags || source.collections != collections {
                    source.tags = paper.tags.clone(); source.collections = collections; dirty = true;
                }
            }
            if dirty { atomic_write_json(self.layout().entry_dir(&entry.id).join(SOURCE_FILE), &sources)?; updated = true; }
        }
        Ok(updated)
    }

    pub fn zotero_changed_papers(&self, library: &Library) -> Result<Vec<String>, WorkspaceError> {
        let mut changed = Vec::new();
        let papers: HashMap<_, _> = library.papers.iter().map(|paper| (paper.id.as_str(), paper)).collect();
        for entry in self.list_entries()? {
            for source in self.zotero_sources(&entry.id)? {
                if source.source_id != library.source_id { continue; }
                if let (Some(previous), Some(paper)) = (source.source_fingerprint, papers.get(source.item_id.as_str())) {
                    if previous != self.zotero_comparison_fingerprint(&entry.id, paper)? { changed.push(source.item_id); }
                }
            }
        }
        changed.sort();
        Ok(changed)
    }

    pub fn zotero_paper_fingerprints(&self, library: &Library) -> Result<HashMap<String, String>, WorkspaceError> {
        let matches = self.zotero_matches(&library.source_id)?;
        library.papers.iter().map(|paper| {
            let fingerprint = if let Some(entry) = matches.get(&paper.id) { self.zotero_comparison_fingerprint(entry, paper)? } else { zotero_fingerprint(paper)? };
            Ok((paper.id.clone(), fingerprint))
        }).collect()
    }

    fn zotero_comparison_fingerprint(&self, entry: &EntryId, paper: &Paper) -> Result<String, WorkspaceError> {
        let mut comparable = paper.clone();
        for baseline in self.zotero_note_baselines(entry)?.values() {
            if let Some(note) = comparable.notes.iter_mut().find(|note| note.key == baseline.note_key && note.html == baseline.source_html) {
                note.html = baseline.imported_html.clone();
            }
        }
        zotero_fingerprint(&comparable)
    }

    pub fn hidden_zotero_papers(&self, source_id: &str) -> Result<Vec<String>, WorkspaceError> {
        let path = self.layout().root().join(HIDDEN_FILE);
        let hidden: HashMap<String, HashSet<String>> = match fs::read(path) {
            Ok(bytes) => serde_json::from_slice(&bytes)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => HashMap::new(),
            Err(error) => return Err(error.into()),
        };
        let mut effective = hidden.get(source_id).cloned().unwrap_or_default();
        let visibility = self.source_entry_visibility()?;
        for (paper, entry) in self.zotero_matches(source_id)? {
            if let Some(hidden) = visibility.get(entry.as_str()) {
                if *hidden { effective.insert(paper); } else { effective.remove(&paper); }
            }
        }
        let mut papers: Vec<_> = effective.into_iter().collect();
        papers.sort();
        Ok(papers)
    }

    pub fn set_zotero_paper_hidden(&self, source_id: &str, paper_id: &str, hidden: bool) -> Result<(), WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        let path = self.layout().root().join(HIDDEN_FILE);
        let mut all: HashMap<String, HashSet<String>> = match fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => HashMap::new(),
            Err(error) => return Err(error.into()),
        };
        if hidden { all.entry(source_id.to_owned()).or_default().insert(paper_id.to_owned()); }
        else if let Some(ids) = all.get_mut(source_id) {
            ids.remove(paper_id);
            if ids.is_empty() { all.remove(source_id); }
        }
        atomic_write_json(&path, &all)
    }

    pub fn zotero_matches(
        &self,
        source_id: &str,
    ) -> Result<HashMap<String, EntryId>, WorkspaceError> {
        let mut result = HashMap::new();
        for entry in self.list_entries()? {
            for source in self.zotero_sources(&entry.id)? {
                if source.source_id == source_id {
                    result.insert(source.item_id, entry.id.clone());
                }
            }
        }
        Ok(result)
    }

    pub fn zotero_sources(&self, id: &EntryId) -> Result<Vec<ZoteroSource>, WorkspaceError> {
        match fs::read(self.layout().entry_dir(id).join(SOURCE_FILE)) {
            Ok(bytes) => Ok(serde_json::from_slice(&bytes)?),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
            Err(error) => Err(error.into()),
        }
    }

    pub fn backup_zotero_note_original(&self, entry_id: &EntryId, note_id: &NoteId,
        server_id: &str, version: u64, html: &str) -> Result<PathBuf, WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        self.read_entry(entry_id)?;
        if !self.zotero_sources(entry_id)?.iter().any(|source| source.note_ids.values().any(|id| id == note_id)) {
            return Err(failure("这不是从 Zotero 导入的笔记。"));
        }
        let server = blake3::hash(server_id.as_bytes()).to_hex().to_string();
        let path = self.layout().entry_dir(entry_id).join("zotero-note-backups")
            .join(format!("{}-{}-v{}.html", note_id, &server[..12], version));
        atomic_write(&path, html.as_bytes())?;
        Ok(path)
    }

    pub fn set_imported_zotero_entry_hidden(&self, id: &EntryId, hidden: bool) -> Result<(), WorkspaceError> {
        self.read_entry(id)?;
        let sources = self.zotero_sources(id)?;
        if sources.is_empty() { return Err(failure("此条目没有 Zotero 来源记录。")); }
        for source in sources {
            self.set_zotero_paper_hidden(&source.source_id, &source.item_id, hidden)?;
        }
        self.set_source_entry_hidden(id, hidden)
    }

    pub fn import_zotero_paper(
        &self,
        library: &Library,
        paper: &Paper,
        attachment_key: Option<&str>,
    ) -> Result<ZoteroImportResult, WorkspaceError> {
        self.import_zotero_paper_with_confirmation(library, paper, attachment_key, None)
    }

    pub fn import_zotero_paper_with_confirmation(
        &self,
        library: &Library,
        paper: &Paper,
        attachment_key: Option<&str>,
        confirmed_duplicate_hash: Option<&str>,
    ) -> Result<ZoteroImportResult, WorkspaceError> {
        self.import_zotero_paper_impl(library, paper, attachment_key, confirmed_duplicate_hash, false)
    }

    pub fn index_zotero_paper(&self, library: &Library, paper: &Paper, attachment_key: Option<&str>) -> Result<ZoteroImportResult, WorkspaceError> {
        self.import_zotero_paper_impl(library, paper, attachment_key, None, true)
    }

    fn import_zotero_paper_impl(&self, library: &Library, paper: &Paper, attachment_key: Option<&str>, confirmed_duplicate_hash: Option<&str>, catalog: bool) -> Result<ZoteroImportResult, WorkspaceError> {
        let _lock = IMPORT_LOCK
            .lock()
            .map_err(|_| failure("导入暂不可用，请重启后重试。"))?;
        if let Some(id) = self.zotero_matches(&library.source_id)?.get(&paper.id) {
            return Ok(result(self.read_entry(id)?, "skipped"));
        }
        let attachment = attachment_key
            .map(|key| {
                paper
                    .attachments
                    .iter()
                    .find(|a| a.key == key)
                    .ok_or_else(|| failure("所选附件已失效，请刷新论文列表。"))
            })
            .transpose()?;
        let mut pdf = attachment
            .map(|attachment| {
                let path = attachment
                    .path
                    .as_ref()
                    .filter(|_| attachment.available)
                    .ok_or_else(|| {
                        failure("PDF 不在本地。请在 Zotero 下载或重新定位附件，再刷新列表。")
                    })?;
                let mut file = fs::File::open(path)
                    .map_err(|_| failure("无法读取 PDF，请检查附件是否已移动。"))?;
                let before = file.metadata()?;
                if before.len() != attachment.file_size
                    || before.modified().ok() != attachment.modified
                {
                    return Err(failure("附件在列表读取后发生变化，请刷新列表后重新导入。"));
                }
                if before.len() > 256 * 1024 * 1024 {
                    return Err(failure("PDF 超过 256 MB，暂不支持批量导入。"));
                }
                let mut bytes = Vec::new();
                (&mut file)
                    .take(256 * 1024 * 1024 + 1)
                    .read_to_end(&mut bytes)?;
                let after = file.metadata()?;
                if bytes.len() as u64 != before.len()
                    || after.len() != before.len()
                    || after.modified().ok() != before.modified().ok()
                    || !bytes[..bytes.len().min(1024)]
                        .windows(5)
                        .any(|w| w == b"%PDF-")
                {
                    return Err(failure("附件不是有效 PDF 或读取时发生变化，未导入。"));
                }
                Ok(bytes)
            })
            .transpose()?;
        let mut source = ZoteroSource {
            pdf_content_hash: None,
            source_id: library.source_id.clone(),
            item_id: paper.id.clone(),
            attachment_key: attachment_key.map(str::to_owned),
            collections: library
                .collections
                .iter()
                .filter(|c| paper.collection_ids.contains(&c.id))
                .map(|c| c.path.clone())
                .collect(),
            tags: paper.tags.clone(),
            note_ids: HashMap::new(),
            source_fingerprint: Some(zotero_fingerprint(paper)?),
        };
        let hash = pdf
            .as_ref()
            .map(|bytes| blake3::hash(bytes).to_hex().to_string());
        source.pdf_content_hash = hash.clone();
        if let Some(hash) = &hash {
            // Exact file identity is safe; equal titles or DOIs alone are not.
            let _guard = self.begin_tag_safe_mutation()?;
            if let Some(duplicate) = self.find_pdf_duplicate(hash)? {
                if catalog {
                    // Keep a source row even when the PDF is already local; do not copy its bytes again.
                    pdf = None;
                } else if confirmed_duplicate_hash != Some(hash.as_str()) {
                    return Ok(ZoteroImportResult {
                        entry_id: EntryId::from_string(&duplicate.entry_id),
                        title: duplicate.title.clone(),
                        status: "duplicate",
                        has_pdf: true,
                        duplicate: Some(duplicate),
                    });
                }
            }
        }
        fs::create_dir_all(self.layout().cache_dir())?;
        let staging = tempfile::Builder::new()
            .prefix("zotero-import-")
            .tempdir_in(self.layout().cache_dir())?;
        let staged = Workspace::create(staging.path())?;
        let mut entry =
            staged.create_entry_with_meta(&paper.title, paper.fields.clone(), vec![])?;
        if let Some(bytes) = pdf {
            let source_path = staging.path().join("paper.pdf");
            atomic_write(&source_path, &bytes)?;
            entry = staged.import_pdf(&entry.id, source_path)?;
            if let (Some(pdf), Some(attachment)) = (&mut entry.pdf, attachment) {
                pdf.file_name = attachment.file_name.clone();
            }
        }
        let mut note_baselines = HashMap::new();
        for (index, note) in paper.notes.iter().enumerate() {
            let title = format!("Zotero 笔记 {}", index + 1);
            let note_id = NoteId::new();
            staged.create_note_with_id(&entry.id, note_id.clone(), &title)?;
            let plain = crate::zotero_note_sync::imported_markdown(&note.html);
            staged.update_note(&entry.id, &note_id, &title, plain.clone())?;
            note_baselines.insert(note_id.to_string(), crate::zotero_note_sync::NoteBaseline {
                note_key: note.key.clone(), imported_html: note.html.clone(), source_html: note.html.clone(), local_markdown: plain, local_title: title,
            });
            source.note_ids.insert(note.key.clone(), note_id);
        }
        if !paper.notes.is_empty() {
            atomic_write_json(staged.layout().entry_dir(&entry.id).join("zotero-note-sync.json"), &note_baselines)?;
            atomic_write_json(staged.layout().entry_dir(&entry.id).join("zotero-notes.json"), &paper.notes)?;
            entry = staged.read_entry(&entry.id)?;
        }
        atomic_write_json(
            staged.layout().entry_dir(&entry.id).join(SOURCE_FILE),
            &vec![source],
        )?;
        let _guard = self.begin_tag_safe_mutation()?;
        entry.validate()?;
        atomic_write_json(staged.layout().entry_meta_file(&entry.id), &entry)?;
        fs::rename(
            staged.layout().entry_dir(&entry.id),
            self.layout().entry_dir(&entry.id),
        )?;
        Ok(result(entry, "imported"))
    }
}

fn zotero_fingerprint(paper: &Paper) -> Result<String, WorkspaceError> {
    let attachments = paper.attachments.iter().map(|file| (
        &file.key, &file.file_name, file.available, file.file_size,
        file.modified.and_then(|time| time.duration_since(UNIX_EPOCH).ok()).map(|duration| duration.as_nanos()),
    )).collect::<Vec<_>>();
    let notes = paper.notes.iter().map(|note| (&note.key, &note.html)).collect::<Vec<_>>();
    let bytes = serde_json::to_vec(&(&paper.title, &paper.fields, &paper.tags, &paper.collection_ids, attachments, notes))?;
    Ok(blake3::hash(&bytes).to_hex().to_string())
}

fn failure(message: &str) -> WorkspaceError {
    WorkspaceError::Zotero(message.into())
}
fn result(entry: EntryMeta, status: &'static str) -> ZoteroImportResult {
    ZoteroImportResult {
        entry_id: entry.id,
        title: entry.title,
        has_pdf: entry.pdf.is_some(),
        status,
        duplicate: None,
    }
}

#[cfg(test)]
#[path = "zotero_tests.rs"]
mod tests;
