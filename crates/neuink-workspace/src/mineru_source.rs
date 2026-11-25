use crate::{atomic_write_json, Workspace, WorkspaceError};
use neuink_domain::EntryId;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs};

const SOURCE_FILE: &str = "mineru-source.json";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MineruSource {
    pub item_id: String,
    pub content_hash: String,
}

impl Workspace {
    pub fn mineru_source_records(
        &self,
    ) -> Result<HashMap<String, (EntryId, String)>, WorkspaceError> {
        let mut result = HashMap::new();
        for entry in self.list_entries()? {
            let path = self.layout().entry_dir(&entry.id).join(SOURCE_FILE);
            match fs::read(path) {
                Ok(bytes) => {
                    let sources: Vec<MineruSource> = serde_json::from_slice(&bytes)?;
                    for source in sources {
                        result.insert(source.item_id, (entry.id.clone(), source.content_hash));
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }
        }
        Ok(result)
    }

    pub fn mineru_matches(&self) -> Result<HashMap<String, EntryId>, WorkspaceError> {
        Ok(self
            .mineru_source_records()?
            .into_iter()
            .map(|(source, (entry, _))| (source, entry))
            .collect())
    }

    pub fn record_mineru_source(
        &self,
        entry_id: &EntryId,
        item_id: String,
        content_hash: String,
    ) -> Result<(), WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        self.read_entry(entry_id)?;
        let path = self.layout().entry_dir(entry_id).join(SOURCE_FILE);
        let mut sources: Vec<MineruSource> = match fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(error) => return Err(error.into()),
        };
        if let Some(source) = sources.iter_mut().find(|source| source.item_id == item_id) {
            source.content_hash = content_hash;
        } else {
            sources.push(MineruSource {
                item_id,
                content_hash,
            });
        }
        atomic_write_json(&path, &sources)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_and_discovers_mineru_source() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace::create(dir.path()).unwrap();
        let entry = workspace.create_entry("Paper").unwrap();
        workspace
            .record_mineru_source(&entry.id, "source-id".into(), "hash".into())
            .unwrap();
        workspace
            .record_mineru_source(&entry.id, "another-id".into(), "hash-2".into())
            .unwrap();
        assert_eq!(workspace.mineru_matches().unwrap()["source-id"], entry.id);
        assert_eq!(workspace.mineru_matches().unwrap()["another-id"], entry.id);
        assert_eq!(
            workspace.entry_source_kinds().unwrap()[entry.id.as_str()].kinds,
            ["mineru"]
        );
    }
}
