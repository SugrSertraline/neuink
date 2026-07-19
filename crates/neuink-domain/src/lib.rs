pub mod annotation;
pub mod entry;
pub mod error;
pub mod ids;
pub mod parser;
pub mod pdf;
pub mod segment;
pub mod segment_note;
pub mod source_link;
pub mod tag;

pub use annotation::{
    Annotation, AnnotationImportance, AnnotationSegmentSnapshot, AnnotationTextSelection,
};
pub use entry::{ContentItem, EntryMeta};
pub use error::DomainError;
pub use ids::{AnnotationId, ConversationId, EntryId, NoteId, SegmentUid, SourceLinkId, TagId};
pub use parser::NeuinkDocument;
pub use pdf::{PdfAsset, PdfParseState, PdfParseStatus};
pub use segment::{SegmentType, SourceSegment};
pub use segment_note::SegmentBlockNote;
pub use source_link::{LinkOwner, SegmentRef, SourceLink};
pub use tag::TagMeta;
