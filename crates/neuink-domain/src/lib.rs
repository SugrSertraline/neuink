pub mod annotation;
pub mod entry;
pub mod error;
pub mod ids;
pub mod note;
pub mod parser;
pub mod pdf;
pub mod reading;
pub mod segment;
pub mod segment_note;
pub mod source_link;
pub mod tag;
pub mod tag_reading;

pub use annotation::{
    pdf_page_annotation_segment_uid, Annotation, AnnotationAnchorKind, AnnotationImportance,
    AnnotationSegmentSnapshot, AnnotationTextSelection, PDF_PAGE_ANNOTATION_SEGMENT_PREFIX,
};
pub use entry::{ContentItem, EntryMeta};
pub use error::DomainError;
pub use ids::{AnnotationId, ConversationId, EntryId, NoteId, SegmentUid, SourceLinkId, TagId};
pub use note::{NoteOwner, NoteTarget, ReadingAuxiliaryView};
pub use parser::NeuinkDocument;
pub use pdf::{PdfAsset, PdfParseState, PdfParseStatus};
pub use reading::{EntryReadingState, ReadingMode, ReadingState, ReadingStateUpdate};
pub use segment::{SegmentType, SourceSegment};
pub use segment_note::SegmentBlockNote;
pub use source_link::{LinkOwner, SegmentRef, SourceLink};
pub use tag::TagMeta;
pub use tag_reading::{TagMemberReadingState, TagMemberStatus, TagReadingWorkspace};
