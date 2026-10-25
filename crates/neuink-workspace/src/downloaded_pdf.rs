use crate::{atomic_write, atomic_write_json, Workspace, WorkspaceError};
use chrono::Utc;
use neuink_domain::{EntryMeta, PdfAsset, PdfParseState};

impl Workspace {
    /// Attaches a verified download to an existing metadata entry under the same
    /// lock as notes and metadata edits. A stale snapshot never replaces user work.
    pub fn attach_downloaded_pdf(
        &self,
        expected: &EntryMeta,
        bytes: &[u8],
        source_url: Option<&str>,
    ) -> Result<EntryMeta, WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        let mut entry = self.read_entry(&expected.id)?;
        if entry.pdf.is_some() {
            return Err(WorkspaceError::PdfAlreadyExists(entry.id.to_string()));
        }
        if entry.updated_at != expected.updated_at {
            return Err(WorkspaceError::EntryRevisionConflict(entry.id.to_string()));
        }
        if !bytes.starts_with(b"%PDF-")
            || !bytes[bytes.len().saturating_sub(4096)..]
                .windows(5)
                .any(|v| v == b"%%EOF")
        {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "下载内容不是完整 PDF",
            )
            .into());
        }
        let path = self.layout().entry_pdf_file(&entry.id);
        // A crash between the file and metadata writes is recoverable: leave the
        // file for manual recovery instead of silently overwriting it on retry.
        if path.exists() {
            return Err(WorkspaceError::PdfAlreadyExists(entry.id.to_string()));
        }
        if let Some(url) = source_url {
            entry.fields.insert("PDF 来源".into(), url.into());
            entry.fields.insert(
                "PDF 获取方式".into(),
                "开放获取版本（可能与期刊排版不同）".into(),
            );
        } else {
            entry
                .fields
                .insert("PDF 获取方式".into(), "Sciverse 原文附件".into());
        }
        entry.pdf = Some(PdfAsset {
            file_name: "paper.pdf".into(),
            content_hash: blake3::hash(bytes).to_hex().to_string(),
            imported_at: Utc::now(),
            parse: PdfParseState::not_started(),
        });
        entry.updated_at = Utc::now();
        atomic_write(&path, bytes)?;
        if let Err(error) = atomic_write_json(self.layout().entry_meta_file(&entry.id), &entry) {
            // The destination was absent before this operation; only our new file is removed.
            std::fs::remove_file(&path)?;
            return Err(error);
        }
        Ok(entry)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_notes_and_rejects_stale_or_duplicate_downloads() {
        let dir = std::env::temp_dir().join(format!(
            "neuink-download-test-{}",
            neuink_domain::EntryId::new()
        ));
        let workspace = Workspace::create(&dir).unwrap();
        let entry = workspace.create_entry("Paper").unwrap();
        let current = workspace.create_note(&entry.id, "Existing note").unwrap();
        let bytes = b"%PDF-1.7\ncomplete\n%%EOF\n";
        assert!(matches!(
            workspace.attach_downloaded_pdf(&entry, bytes, None),
            Err(WorkspaceError::EntryRevisionConflict(_))
        ));
        assert!(!workspace.layout().entry_pdf_file(&entry.id).exists());
        let saved = workspace
            .attach_downloaded_pdf(&current, bytes, Some("https://example.org/paper.pdf"))
            .unwrap();
        assert_eq!(saved.contents, current.contents);
        assert_eq!(saved.fields["PDF 来源"], "https://example.org/paper.pdf");
        assert!(matches!(
            workspace.attach_downloaded_pdf(&saved, bytes, None),
            Err(WorkspaceError::PdfAlreadyExists(_))
        ));
        let reopened = Workspace::open(&dir)
            .unwrap()
            .read_entry(&saved.id)
            .unwrap();
        assert!(reopened.pdf.is_some());
        assert_eq!(reopened.contents, current.contents);
        std::fs::remove_dir_all(&dir).unwrap();
    }
    #[test]
    fn invalid_pdf_or_deleted_entry_never_creates_files() {
        let dir = std::env::temp_dir().join(format!(
            "neuink-download-test-{}",
            neuink_domain::EntryId::new()
        ));
        let workspace = Workspace::create(&dir).unwrap();
        let entry = workspace.create_entry("Paper").unwrap();
        assert!(workspace
            .attach_downloaded_pdf(&entry, b"<html>denied</html>", None)
            .is_err());
        assert!(!workspace.layout().entry_pdf_file(&entry.id).exists());
        workspace.delete_entry(&entry.id).unwrap();
        assert!(workspace
            .attach_downloaded_pdf(&entry, b"%PDF-1.7\n%%EOF", None)
            .is_err());
        assert!(!workspace.layout().entry_dir(&entry.id).exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
