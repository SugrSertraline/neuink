pub mod agent_execution;
pub mod annotation_index;
pub mod atomic_write;
pub mod entry_meta;
pub mod error;
pub mod export;
pub mod layout;
pub mod note;
pub mod note_catalog;
#[cfg(test)]
mod note_catalog_tests;
pub mod onboarding;
pub mod paragraph_translation;
pub mod pdf_parse_queue;
#[cfg(test)]
mod pdf_parse_queue_tests;
pub mod pdf_text;
pub mod reading_state;
pub mod search;
pub mod source_availability;
pub mod tag_archive;
pub mod tag_details;
pub mod tag_note;
pub mod tag_reading;
mod tag_transaction;
pub mod trash;
pub mod workspace;

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
