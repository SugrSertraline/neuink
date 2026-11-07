pub mod agent_execution;
pub mod annotation_index;
pub mod atomic_write;
pub mod daily;
pub mod deep_research;
pub mod ideation;
pub mod daily_note;
pub mod entertainment;
pub mod recommendations;
pub mod entry_meta;
pub mod edit_recovery;
pub mod entry_sources;
pub mod local_copy;
mod downloaded_pdf;
pub mod error;
pub mod export;
pub mod folding;
pub mod layout;
pub mod legacy_import;
pub mod mineru_source;
pub mod note;
pub mod note_image;
pub mod note_catalog;
#[cfg(test)]
mod note_catalog_tests;
pub mod onboarding;
pub mod paragraph_translation;
pub mod translation_chunk_cache;
pub mod pdf_parse_queue;
pub mod pdf_duplicate;
#[cfg(test)]
mod pdf_parse_queue_tests;
pub mod pdf_text;
pub mod reading_pdf;
#[cfg(test)]
mod reading_pdf_tests;
pub mod reading_state;
pub mod search;
pub mod source_availability;
pub mod source_notes;
pub mod tag_archive;
pub mod tag_details;
pub mod tag_note;
pub mod tag_reading;
pub mod title_consistency;
mod tag_transaction;
pub mod trash;
pub mod workspace;
pub mod zotero;
mod zotero_note_sync;
mod zotero_local_copy;

pub use annotation_index::{
    AnnotationIndexRecord, AnnotationSegmentContext, AnnotationSegmentStatus,
};
pub use atomic_write::{atomic_write, atomic_write_json};
pub use error::WorkspaceError;
pub use layout::WorkspaceLayout;
pub use search::{WorkspaceSearchOptions, WorkspaceSearchRecord, WorkspaceSearchRecordKind};
pub use trash::{TrashItem, TrashItemKind};
pub use workspace::{
    EntryTranslation, TranslatedSegment, TranslatedSegmentStatus, TranslationPaperContext,
    TranslationProgress, TranslationStatus, TranslationTaskSnapshot, TranslationTerm, Workspace,
};

pub mod sentence_translation;
