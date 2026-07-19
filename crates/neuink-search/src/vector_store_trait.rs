use neuink_domain::EntryId;

use crate::{
    EmbeddingVector, SearchDocumentSource, SearchInclude, SearchResult, SearchScope, SearchTarget,
};

#[derive(Clone, Debug)]
pub struct VectorRecord {
    pub id: String,
    pub entry_id: EntryId,
    pub entry_title: String,
    pub source: SearchDocumentSource,
    pub target: SearchTarget,
    pub title: String,
    pub text: String,
    pub embedding: EmbeddingVector,
}

#[derive(Clone, Debug)]
pub struct VectorSearchHit {
    pub id: String,
    pub score: f32,
    pub record: VectorRecord,
}

pub trait VectorStore: Send + Sync {
    fn upsert(&self, records: &[VectorRecord]) -> SearchResult<()>;

    fn delete_entry(&self, entry_id: &EntryId) -> SearchResult<()>;

    fn search(
        &self,
        query_embedding: &EmbeddingVector,
        limit: usize,
        scope: &SearchScope,
        include: &SearchInclude,
    ) -> SearchResult<Vec<VectorSearchHit>>;
}
