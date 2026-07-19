use neuink_domain::EntryId;

use crate::{SearchDocument, SearchQuery, SearchResult, SearchResults};

pub trait SearchIndex: Send + Sync {
    fn replace_documents(&self, documents: Vec<SearchDocument>) -> SearchResult<()>;
    fn remove_entry(&self, entry_id: &EntryId) -> SearchResult<()>;
    fn search(&self, query: SearchQuery) -> SearchResult<SearchResults>;
    fn generation(&self) -> SearchResult<u64>;
}
