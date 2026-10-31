use std::{fs::File, io::Read, path::Path};

use serde::Serialize;

use crate::{Workspace, WorkspaceError};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfDuplicate {
    pub entry_id: String,
    pub title: String,
    pub file_name: String,
    pub content_hash: String,
    pub in_trash: bool,
}

pub fn hash_pdf_file(path: impl AsRef<Path>) -> Result<String, WorkspaceError> {
    let mut file = File::open(path)?;
    let mut hasher = blake3::Hasher::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(hasher.finalize().to_hex().to_string())
}

impl Workspace {
    pub fn find_pdf_duplicate(&self, hash: &str) -> Result<Option<PdfDuplicate>, WorkspaceError> {
        if let Some(entry) = self.list_entries()?.into_iter().find(|entry| {
            entry
                .pdf
                .as_ref()
                .is_some_and(|pdf| pdf.content_hash == hash)
        }) {
            if let Some(pdf) = entry.pdf {
                return Ok(Some(PdfDuplicate {
                    entry_id: entry.id.to_string(),
                    title: entry.title,
                    file_name: pdf.file_name,
                    content_hash: pdf.content_hash,
                    in_trash: false,
                }));
            }
        }
        if let Some(entry) = self.list_trashed_entries()?.into_iter().find(|entry| {
            entry
                .pdf
                .as_ref()
                .is_some_and(|pdf| pdf.content_hash == hash)
        }) {
            if let Some(pdf) = entry.pdf {
                return Ok(Some(PdfDuplicate {
                    entry_id: entry.id.to_string(),
                    title: entry.title,
                    file_name: pdf.file_name,
                    content_hash: pdf.content_hash,
                    in_trash: true,
                }));
            }
        }
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_identical_bytes_despite_different_names_and_in_trash() {
        let temp = tempfile::tempdir().unwrap();
        let workspace = Workspace::create(temp.path().join("workspace")).unwrap();
        let first = temp.path().join("first.pdf");
        let renamed = temp.path().join("renamed.pdf");
        std::fs::write(&first, b"%PDF-1.7\nsame content").unwrap();
        std::fs::write(&renamed, b"%PDF-1.7\nsame content").unwrap();
        let entry = workspace.create_entry("Original paper").unwrap();
        workspace.import_pdf(&entry.id, &first).unwrap();
        let hash = hash_pdf_file(&renamed).unwrap();
        assert_eq!(
            workspace.find_pdf_duplicate(&hash).unwrap().unwrap().title,
            "Original paper"
        );
        let another = workspace.create_entry("Another paper").unwrap();
        assert!(matches!(workspace.import_pdf(&another.id, &renamed),
            Err(WorkspaceError::PdfContentDuplicate(title)) if title == "Original paper"));
        assert!(workspace.read_entry(&another.id).unwrap().pdf.is_none());
        std::fs::write(&renamed, b"%PDF-1.7\ndifferent content").unwrap();
        workspace.import_pdf(&another.id, &renamed).unwrap();
        workspace.delete_entry(&entry.id).unwrap();
        assert!(
            workspace
                .find_pdf_duplicate(&hash)
                .unwrap()
                .unwrap()
                .in_trash
        );
    }

    #[test]
    fn explicit_confirmation_only_applies_to_the_same_pdf_bytes() {
        let temp = tempfile::tempdir().unwrap();
        let workspace = Workspace::create(temp.path().join("workspace")).unwrap();
        let first = temp.path().join("first.pdf");
        let second = temp.path().join("second.pdf");
        std::fs::write(&first, b"%PDF-1.7\nfirst").unwrap();
        std::fs::write(&second, b"%PDF-1.7\nfirst").unwrap();
        let original = workspace.create_entry("Original").unwrap();
        workspace.import_pdf(&original.id, &first).unwrap();
        let duplicate = workspace.create_entry("Another").unwrap();
        assert!(matches!(workspace.import_pdf_with_confirmation(&duplicate.id, &second, Some("wrong hash")),
            Err(WorkspaceError::PdfContentDuplicate(_))));
        let hash = hash_pdf_file(&second).unwrap();
        let saved = workspace.import_pdf_with_confirmation(&duplicate.id, &second, Some(&hash)).unwrap();
        assert_eq!(saved.pdf.unwrap().content_hash, hash);
        assert_eq!(workspace.list_entries().unwrap().len(), 2);
    }
}
