use crate::{atomic_write_json, mineru_source::MineruSource, zotero::ZoteroSource, Workspace, WorkspaceError};
use neuink_domain::EntryId;
use serde::Serialize;
use std::{collections::{HashMap, HashSet}, fs, path::Path};

const VISIBILITY_FILE: &str = "source-entry-visibility.json";

pub(crate) fn is_source_managed_dir(dir: &Path) -> Result<bool, WorkspaceError> {
    for name in ["zotero-source.json", "mineru-source.json"] {
        match fs::read(dir.join(name)) {
            Ok(bytes) => {
                let records: Vec<serde_json::Value> = serde_json::from_slice(&bytes)?;
                if !records.is_empty() { return Ok(true); }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
            Err(error) => return Err(error.into()),
        }
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn attach(workspace: &Workspace, entry: &EntryId, kind: &str) {
        let value = if kind == "zotero" { serde_json::json!([{"source_id":"library","item_id":"1:ABC12345","attachment_key":null,"collections":[]}]) }
            else { serde_json::json!([{"item_id":"mineru-result","content_hash":"hash"}]) };
        atomic_write_json(workspace.layout().entry_dir(entry).join(format!("{kind}-source.json")), &value).unwrap();
    }

    #[test]
    fn both_source_types_are_hide_only_and_remain_protected_in_legacy_trash() {
        for kind in ["zotero", "mineru"] {
            let dir = tempfile::tempdir().unwrap();
            let workspace = Workspace::create(dir.path()).unwrap();
            let entry = workspace.create_entry("Source paper").unwrap();
            attach(&workspace, &entry.id, kind);
            assert!(matches!(workspace.delete_entry(&entry.id), Err(WorkspaceError::SourceManagedEntry)));
            assert!(workspace.read_entry(&entry.id).is_ok());
            workspace.set_source_entry_hidden(&entry.id, true).unwrap();
            let reopened = Workspace::open_existing(dir.path()).unwrap();
            assert!(reopened.entry_source_kinds().unwrap()[entry.id.as_str()].hidden);
            reopened.set_source_entry_hidden(&entry.id, false).unwrap();
            assert!(!reopened.entry_source_kinds().unwrap()[entry.id.as_str()].hidden);
            // Simulate a source entry placed in the recycle bin by an older version.
            fs::create_dir_all(workspace.layout().trashed_entries_dir()).unwrap();
            fs::rename(workspace.layout().entry_dir(&entry.id), workspace.layout().trashed_entry_dir(&entry.id)).unwrap();
            assert!(workspace.list_trash_items().unwrap().iter().any(|item| item.entry_id == entry.id && item.source_managed));
            assert!(workspace.entry_source_kinds().unwrap()[entry.id.as_str()].kinds.contains(&kind));
            assert!(matches!(workspace.purge_entry(&entry.id), Err(WorkspaceError::SourceManagedEntry)));
            assert!(workspace.layout().trashed_entry_dir(&entry.id).exists());
            workspace.restore_entry(&entry.id).unwrap();
            assert!(workspace.read_entry(&entry.id).is_ok());
        }
    }

    #[test]
    fn legacy_zotero_hidden_records_can_be_restored_and_mixed_sources_are_protected() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace::create(dir.path()).unwrap();
        let entry = workspace.create_entry("Mixed source").unwrap();
        attach(&workspace, &entry.id, "zotero"); attach(&workspace, &entry.id, "mineru");
        workspace.set_zotero_paper_hidden("library", "1:ABC12345", true).unwrap();
        assert!(workspace.entry_source_kinds().unwrap()[entry.id.as_str()].hidden);
        workspace.set_source_entry_hidden(&entry.id, false).unwrap();
        assert!(workspace.hidden_zotero_papers("library").unwrap().is_empty());
        assert!(!workspace.entry_source_kinds().unwrap()[entry.id.as_str()].hidden);
        assert!(matches!(workspace.delete_entry(&entry.id), Err(WorkspaceError::SourceManagedEntry)));
    }

    #[test]
    fn damaged_source_records_do_not_allow_deletion_and_local_entries_keep_normal_deletion() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace::create(dir.path()).unwrap();
        let entry = workspace.create_entry("Damaged provenance").unwrap();
        fs::write(workspace.layout().entry_dir(&entry.id).join("mineru-source.json"), b"not json").unwrap();
        assert!(workspace.delete_entry(&entry.id).is_err());
        assert!(workspace.read_entry(&entry.id).is_ok());
        let local = workspace.create_entry("Local").unwrap();
        workspace.delete_entry(&local.id).unwrap(); workspace.purge_entry(&local.id).unwrap();
        assert!(!workspace.layout().trashed_entry_dir(&local.id).exists());
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct EntrySourceInfo {
    pub source_pdf_hash: Option<String>,
    pub local_copy_ids: Vec<String>,
    pub copied_from: Option<crate::local_copy::LocalCopyOrigin>,
    pub kinds: Vec<&'static str>,
    pub zotero_hidden: bool,
    pub hidden: bool,
    pub zotero_note_ids: Vec<String>,
    pub zotero_organization: Vec<ZoteroOrganization>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ZoteroOrganization {
    pub source_id: String,
    pub tags: Vec<String>,
    pub collections: Vec<String>,
}

impl Workspace {
    pub(crate) fn source_entry_visibility(&self) -> Result<HashMap<String, bool>, WorkspaceError> {
        match fs::read(self.layout().root().join(VISIBILITY_FILE)) {
            Ok(bytes) => Ok(serde_json::from_slice(&bytes)?),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
            Err(error) => Err(error.into()),
        }
    }

    pub fn set_source_entry_hidden(&self, entry_id: &EntryId, hidden: bool) -> Result<(), WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        self.read_entry(entry_id)?;
        if !is_source_managed_dir(&self.layout().entry_dir(entry_id))? { return Err(WorkspaceError::SourceVisibilityUnavailable); }
        let mut visibility = self.source_entry_visibility()?;
        visibility.insert(entry_id.to_string(), hidden);
        atomic_write_json(self.layout().root().join(VISIBILITY_FILE), &visibility)
    }

    pub fn entry_source_kinds(&self) -> Result<HashMap<String, EntrySourceInfo>, WorkspaceError> {
        let visibility = self.source_entry_visibility()?;
        let mut result = HashMap::new();
        let mut local_copies = Vec::new();
        let mut locals_by_hash: HashMap<String, Vec<String>> = HashMap::new();
        let mut hidden_by_source: HashMap<String, HashSet<String>> = HashMap::new();
        for (entry, trashed) in self.entries_including_trash()? {
            let dir = if trashed { self.layout().trashed_entry_dir(&entry.id) } else { self.layout().entry_dir(&entry.id) };
            let mut kinds = Vec::new();
            let mut zotero_hidden = false;
            let mut zotero_note_ids = Vec::new();
            let mut zotero_organization = Vec::new();
            let mut source_pdf_hash = entry.pdf.as_ref().map(|pdf| pdf.content_hash.clone());
            match fs::read(dir.join("zotero-source.json")) {
                Ok(bytes) => {
                    let sources: Vec<ZoteroSource> = serde_json::from_slice(&bytes)?;
                    if !sources.is_empty() {
                        kinds.push("zotero");
                        for source in sources {
                            if source_pdf_hash.is_none() { source_pdf_hash = source.pdf_content_hash.clone(); }
                            zotero_organization.push(ZoteroOrganization { source_id: source.source_id.clone(), tags: source.tags.clone(), collections: source.collections.clone() });
                            zotero_note_ids.extend(source.note_ids.values().map(ToString::to_string));
                            if !hidden_by_source.contains_key(&source.source_id) {
                                hidden_by_source.insert(source.source_id.clone(), self.hidden_zotero_papers(&source.source_id)?.into_iter().collect());
                            }
                            if hidden_by_source.get(&source.source_id).is_some_and(|ids| ids.contains(&source.item_id)) {
                                zotero_hidden = true;
                            }
                        }
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }
            match fs::read(dir.join("mineru-source.json")) {
                Ok(bytes) => {
                    let sources: Vec<MineruSource> = serde_json::from_slice(&bytes)?;
                    if !sources.is_empty() {
                        kinds.push("mineru");
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }
            let hidden = visibility.get(entry.id.as_str()).copied().unwrap_or(zotero_hidden);
            zotero_hidden = kinds.contains(&"zotero") && hidden;
            let copied_from = self.local_copy_origin(&entry.id, trashed)?;
            if !trashed && kinds.is_empty() {
                if let Some(pdf) = &entry.pdf { locals_by_hash.entry(pdf.content_hash.clone()).or_default().push(entry.id.to_string()); }
                if let Some(origin) = &copied_from { local_copies.push((origin.source_entry_id.to_string(), entry.id.to_string())); }
            }
            result.insert(entry.id.to_string(), EntrySourceInfo { kinds, hidden, zotero_hidden, zotero_note_ids, zotero_organization, copied_from, source_pdf_hash, local_copy_ids: Vec::new() });
        }
        for (source, local) in local_copies { if let Some(info) = result.get_mut(&source) { info.local_copy_ids.push(local); } }
        for info in result.values_mut().filter(|info| !info.kinds.is_empty()) {
            if let Some(ids) = info.source_pdf_hash.as_ref().and_then(|hash| locals_by_hash.get(hash)) { info.local_copy_ids.extend(ids.iter().cloned()); }
            info.local_copy_ids.sort(); info.local_copy_ids.dedup();
        }
        Ok(result)
    }
}
