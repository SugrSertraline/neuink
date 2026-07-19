use std::path::{Path, PathBuf};

use neuink_domain::{EntryId, NoteId};

#[derive(Clone, Debug)]
pub struct WorkspaceLayout {
    root: PathBuf,
}

impl WorkspaceLayout {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn workspace_file(&self) -> PathBuf {
        self.root.join("neuink.workspace.json")
    }

    pub fn entries_dir(&self) -> PathBuf {
        self.root.join("entries")
    }

    pub fn trash_dir(&self) -> PathBuf {
        self.root.join("trash")
    }

    pub fn trashed_entries_dir(&self) -> PathBuf {
        self.trash_dir().join("entries")
    }

    pub fn conversations_dir(&self) -> PathBuf {
        self.root.join("conversations")
    }

    pub fn cache_dir(&self) -> PathBuf {
        self.root.join(".neuink-cache")
    }

    pub fn entry_dir(&self, entry_id: &EntryId) -> PathBuf {
        self.entries_dir().join(entry_id.as_str())
    }

    pub fn trashed_entry_dir(&self, entry_id: &EntryId) -> PathBuf {
        self.trashed_entries_dir().join(entry_id.as_str())
    }

    pub fn entry_meta_file(&self, entry_id: &EntryId) -> PathBuf {
        self.entry_dir(entry_id).join("entry.meta.json")
    }

    pub fn entry_pdf_file(&self, entry_id: &EntryId) -> PathBuf {
        self.entry_dir(entry_id).join("paper.pdf")
    }

    pub fn entry_segments_file(&self, entry_id: &EntryId) -> PathBuf {
        self.entry_dir(entry_id).join("paper.segments.json")
    }

    pub fn entry_annotations_file(&self, entry_id: &EntryId) -> PathBuf {
        self.entry_dir(entry_id).join("paper.annotations.json")
    }

    pub fn entry_translation_file(&self, entry_id: &EntryId) -> PathBuf {
        self.entry_dir(entry_id).join("paper.translation.json")
    }

    pub fn entry_segment_notes_file(&self, entry_id: &EntryId) -> PathBuf {
        self.entry_dir(entry_id).join("segment-notes.json")
    }

    pub fn entry_notes_dir(&self, entry_id: &EntryId) -> PathBuf {
        self.entry_dir(entry_id).join("notes")
    }

    pub fn entry_trash_dir(&self, entry_id: &EntryId) -> PathBuf {
        self.entry_dir(entry_id).join(".trash")
    }

    pub fn entry_trash_index_file(&self, entry_id: &EntryId) -> PathBuf {
        self.entry_trash_dir(entry_id).join("items.json")
    }

    pub fn entry_trash_notes_dir(&self, entry_id: &EntryId) -> PathBuf {
        self.entry_trash_dir(entry_id).join("notes")
    }

    pub fn entry_note_file(&self, entry_id: &EntryId, note_id: &NoteId) -> PathBuf {
        self.entry_notes_dir(entry_id)
            .join(format!("{}.md", note_id.as_str()))
    }

    pub fn entry_note_assets_dir(&self, entry_id: &EntryId, note_id: &NoteId) -> PathBuf {
        self.entry_notes_dir(entry_id)
            .join(format!("{}.assets", note_id.as_str()))
    }

    pub fn entry_note_links_file(&self, entry_id: &EntryId, note_id: &NoteId) -> PathBuf {
        self.entry_notes_dir(entry_id)
            .join(format!("{}.links.json", note_id.as_str()))
    }

    pub fn entry_mineru_output_dir(&self, entry_id: &EntryId) -> PathBuf {
        self.entry_dir(entry_id).join("mineru-output")
    }

    pub fn entry_mineru_output_zip(&self, entry_id: &EntryId) -> PathBuf {
        self.entry_mineru_output_dir(entry_id).join("full.zip")
    }
}
