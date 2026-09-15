use crate::{EntryId, NoteId, TagId};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum NoteOwner {
    Entry { entry_id: EntryId },
    TagReading { tag_id: TagId },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct NoteTarget {
    pub owner: NoteOwner,
    pub note_id: NoteId,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReadingAuxiliaryView {
    #[default]
    Compare,
    Note,
}
