//! Publish complete Zotero entries from same-volume staging; never edit Zotero.
use crate::{atomic_write, atomic_write_json, Workspace, WorkspaceError};
use neuink_domain::{EntryId, EntryMeta, TagMeta};
use neuink_zotero::{Library, Paper};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs, io::Read, sync::Mutex};

static IMPORT_LOCK: Mutex<()> = Mutex::new(());
const SOURCE_FILE: &str = "zotero-source.json";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ZoteroSource {
    pub source_id: String,
    pub item_id: String,
    pub attachment_key: Option<String>,
    pub collections: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct ZoteroImportResult {
    pub entry_id: EntryId,
    pub title: String,
    pub status: &'static str,
    pub has_pdf: bool,
}

impl Workspace {
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

    fn zotero_sources(&self, id: &EntryId) -> Result<Vec<ZoteroSource>, WorkspaceError> {
        match fs::read(self.layout().entry_dir(id).join(SOURCE_FILE)) {
            Ok(bytes) => Ok(serde_json::from_slice(&bytes)?),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
            Err(error) => Err(error.into()),
        }
    }

    pub fn import_zotero_paper(
        &self,
        library: &Library,
        paper: &Paper,
        attachment_key: Option<&str>,
    ) -> Result<ZoteroImportResult, WorkspaceError> {
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
        let pdf = attachment
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
        let source = ZoteroSource {
            source_id: library.source_id.clone(),
            item_id: paper.id.clone(),
            attachment_key: attachment_key.map(str::to_owned),
            collections: library
                .collections
                .iter()
                .filter(|c| paper.collection_ids.contains(&c.id))
                .map(|c| c.path.clone())
                .collect(),
        };
        let hash = pdf
            .as_ref()
            .map(|bytes| blake3::hash(bytes).to_hex().to_string());
        if let Some(hash) = &hash {
            // Exact file identity is safe; equal titles or DOIs alone are not.
            let _guard = self.begin_tag_safe_mutation()?;
            if let Some(entry) = self
                .list_entries()?
                .into_iter()
                .find(|entry| entry.pdf.as_ref().is_some_and(|p| &p.content_hash == hash))
            {
                let mut sources = self.zotero_sources(&entry.id)?;
                sources.push(source);
                atomic_write_json(
                    self.layout().entry_dir(&entry.id).join(SOURCE_FILE),
                    &sources,
                )?;
                return Ok(result(entry, "skipped"));
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
        atomic_write_json(
            staged.layout().entry_dir(&entry.id).join(SOURCE_FILE),
            &vec![source],
        )?;
        let _guard = self.begin_tag_safe_mutation()?;
        let mut workspace = self.read_workspace_file()?;
        // Zotero tags are literal labels, not slash-separated NeuInk paths.
        // Publish tag definitions before entry membership; an interrupted publish
        // may leave unused tags, which a retry reuses, but never a partial entry.
        for name in paper
            .tags
            .iter()
            .map(|v| v.trim())
            .filter(|v| !v.is_empty())
        {
            let tag = if let Some(tag) = workspace
                .tags
                .iter()
                .find(|t| t.parent_id.is_none() && t.name.eq_ignore_ascii_case(name))
            {
                tag.clone()
            } else {
                let tag = TagMeta::new(name, None)?;
                workspace.tags.push(tag.clone());
                tag
            };
            if !entry.tags.contains(&tag.id) {
                entry.tags.push(tag.id);
            }
        }
        entry.validate()?;
        atomic_write_json(staged.layout().entry_meta_file(&entry.id), &entry)?;
        self.write_workspace_file(&workspace)?;
        fs::rename(
            staged.layout().entry_dir(&entry.id),
            self.layout().entry_dir(&entry.id),
        )?;
        Ok(result(entry, "imported"))
    }
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
    }
}

#[cfg(test)]
#[path = "zotero_tests.rs"]
mod tests;
