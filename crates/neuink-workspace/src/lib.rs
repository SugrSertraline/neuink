pub mod agent_execution;
pub mod annotation_index;
pub mod atomic_write;
mod content_transaction;
pub mod daily;
pub mod daily_note;
pub mod deep_research;
mod downloaded_pdf;
pub mod edit_recovery;
pub mod entertainment;
pub mod entry_lifecycle;
pub mod entry_meta;
pub mod entry_sources;
pub mod error;
pub mod export;
pub mod folding;
pub mod ideation;
pub mod layout;
pub mod legacy_import;
pub mod local_copy;
pub mod mineru_source;
pub mod note;
pub mod note_catalog;
#[cfg(test)]
mod note_catalog_tests;
pub mod note_image;
pub mod onboarding;
pub mod paragraph_translation;
pub mod pdf_duplicate;
pub mod pdf_parse_queue;
#[cfg(test)]
mod pdf_parse_queue_tests;
pub mod pdf_text;
mod read_only;
pub mod reading_pdf;
#[cfg(test)]
mod reading_pdf_tests;
pub mod reading_state;
pub mod recommendations;
pub mod recovery_control;
pub mod search;
pub mod source_availability;
pub mod source_notes;
pub mod sync_apply;
pub mod sync_control;
pub mod sync_export;
pub mod sync_inventory;
pub mod sync_journal;
pub mod tag_archive;
pub mod tag_details;
pub mod tag_note;
pub mod tag_reading;
mod tag_transaction;
pub mod title_consistency;
pub mod translation_chunk_cache;
pub mod trash;
pub mod workspace;
pub mod zotero;
mod zotero_local_copy;
mod zotero_note_sync;

pub use annotation_index::{
    AnnotationIndexRecord, AnnotationSegmentContext, AnnotationSegmentStatus,
};
pub use atomic_write::{atomic_write, atomic_write_json};
pub use error::WorkspaceError;
pub use layout::WorkspaceLayout;
pub use read_only::validate_workspace_read_only;
pub use search::{WorkspaceSearchOptions, WorkspaceSearchRecord, WorkspaceSearchRecordKind};
pub use trash::{TrashItem, TrashItemKind};
pub use workspace::{
    EntryTranslation, TranslatedSegment, TranslatedSegmentStatus, TranslationPaperContext,
    TranslationProgress, TranslationStatus, TranslationTaskSnapshot, TranslationTerm, Workspace,
};

pub mod sentence_translation;
