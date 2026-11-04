use crate::{
    atomic_write_json,
    entry_sources::is_source_managed_dir,
    local_copy::{LocalCopyOrigin, LocalCopyResult},
    pdf_duplicate::hash_pdf_file,
    Workspace, WorkspaceError,
};
use neuink_domain::EntryId;
use neuink_zotero::{Library, Paper};
use std::fs;

impl Workspace {
    /// Explicit imports may read the latest source PDF; background scans never overwrite a local entry.
    pub fn import_current_zotero_copy(
        &self,
        source_id: &EntryId,
        library: &Library,
        paper: &Paper,
        force_new: bool,
    ) -> Result<LocalCopyResult, WorkspaceError> {
        let source = self.read_entry(source_id)?;
        if !self
            .zotero_sources(source_id)?
            .iter()
            .any(|origin| origin.source_id == library.source_id && origin.item_id == paper.id)
        {
            return Err(WorkspaceError::Zotero(
                "来源论文与当前 Zotero 资料库不匹配。".into(),
            ));
        }
        if !force_new {
            if let Some(id) = self
                .entry_source_kinds()?
                .get(source_id.as_str())
                .and_then(|info| info.local_copy_ids.first())
            {
                return Ok(LocalCopyResult {
                    entry_id: EntryId::from_string(id),
                    created: false,
                });
            }
        }
        let attachment = paper
            .attachments
            .iter()
            .find(|attachment| attachment.available);
        if source.pdf.is_none() && attachment.is_none() && !paper.attachments.is_empty() {
            return Err(WorkspaceError::Zotero(
                "来源 PDF 当前不在本机，请先在 Zotero 下载或重新定位附件。已有本地笔记保留。"
                    .into(),
            ));
        }
        let hash = attachment
            .and_then(|attachment| attachment.path.as_ref())
            .map(hash_pdf_file)
            .transpose()?;
        if !force_new {
            if let Some(id) = self.find_independent_source_copy(source_id, hash.as_deref())? {
                return Ok(LocalCopyResult {
                    entry_id: id,
                    created: false,
                });
            }
        }
        // Reuse the saved parse and local enhancements when the source PDF bytes are unchanged.
        if hash.as_ref().is_some_and(|hash| {
            source
                .pdf
                .as_ref()
                .is_some_and(|pdf| &pdf.content_hash == hash)
        }) || attachment.is_none()
        {
            return self.copy_source_to_local(source_id, force_new);
        }
        fs::create_dir_all(self.layout().cache_dir())?;
        let staging = tempfile::Builder::new()
            .prefix("current-zotero-copy-")
            .tempdir_in(self.layout().cache_dir())?;
        let temporary = Workspace::create(staging.path())?;
        let indexed = temporary.import_zotero_paper(
            library,
            paper,
            attachment.map(|attachment| attachment.key.as_str()),
        )?;
        let copied = temporary.copy_source_to_local(&indexed.entry_id, true)?;
        let mut entry = temporary.read_entry(&copied.entry_id)?;
        entry.tags = source.tags;
        let mut origin: LocalCopyOrigin = temporary
            .local_copy_origin(&entry.id, false)?
            .ok_or_else(|| WorkspaceError::Zotero("缺少独立副本来源记录。".into()))?;
        origin.source_entry_id = source_id.clone();
        origin.source_title = paper.title.clone();
        atomic_write_json(temporary.layout().entry_meta_file(&entry.id), &entry)?;
        atomic_write_json(
            temporary
                .layout()
                .entry_dir(&entry.id)
                .join("local-copy-origin.json"),
            &origin,
        )?;
        let _guard = self.begin_tag_safe_mutation()?;
        self.read_entry(source_id)?;
        if !force_new {
            if let Some(id) = self.find_independent_source_copy(
                source_id,
                entry.pdf.as_ref().map(|pdf| pdf.content_hash.as_str()),
            )? {
                return Ok(LocalCopyResult {
                    entry_id: id,
                    created: false,
                });
            }
        }
        let destination = self.layout().entry_dir(&entry.id);
        if destination.exists() {
            return Err(WorkspaceError::EntryAlreadyExists(entry.id.to_string()));
        }
        fs::rename(temporary.layout().entry_dir(&entry.id), destination)?;
        Ok(LocalCopyResult {
            entry_id: entry.id,
            created: true,
        })
    }

    pub(crate) fn find_independent_source_copy(
        &self,
        source: &EntryId,
        hash: Option<&str>,
    ) -> Result<Option<EntryId>, WorkspaceError> {
        for entry in self.list_entries()? {
            if is_source_managed_dir(&self.layout().entry_dir(&entry.id))? {
                continue;
            }
            let same_file = hash.is_some_and(|hash| {
                entry
                    .pdf
                    .as_ref()
                    .is_some_and(|pdf| pdf.content_hash == hash)
            });
            let same_origin = self
                .local_copy_origin(&entry.id, false)?
                .is_some_and(|origin| origin.source_entry_id == *source);
            if same_file || same_origin {
                return Ok(Some(entry.id));
            }
        }
        Ok(None)
    }
}
