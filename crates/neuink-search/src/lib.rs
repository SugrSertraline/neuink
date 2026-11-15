mod document_builder;
mod carrier_binding;
mod document_head;
mod heuristic_rerank;
mod embedding_provider_trait;
mod embedding_representation;
mod error;
mod fastembed_provider;
mod memory_index;
mod persistent_semantic_index;
mod query;
mod query_plan;
mod rerank_hits;
mod reranking;
#[cfg(test)]
mod reranking_tests;
#[cfg(all(test, feature = "local-embedding"))]
mod reranking_local_tests;
mod result;
mod retrieval_pipeline;
#[cfg(test)]
mod retrieval_pipeline_tests;
mod rrf;
mod search_index_trait;
mod section_tree_index;
mod semantic_index;
mod token;
mod unified_retrieval;
mod vector_store_trait;
mod visual_embedding;
mod visual_index;
mod visual_sidecar;

pub use document_builder::{compose_search_document, SearchDocumentInput};
pub use embedding_provider_trait::{
    EmbeddingInput, EmbeddingProvider, EmbeddingProviderStatus, EmbeddingVector,
};
pub use embedding_representation::{
    embed_query_vector, embedding_text, semantic_embedding_identity, stable_document_key,
    SemanticVectorDocument, EMBEDDING_REPRESENTATION_VERSION,
};
pub use error::{SearchError, SearchResult};
pub use fastembed_provider::{
    FastEmbedProvider, DEFAULT_EMBEDDING_MODEL_RESOURCE_DIR, LOCAL_EMBEDDING_BATCH_SIZE,
};
pub use memory_index::MemorySearchIndex;
pub use persistent_semantic_index::{
    merge_hybrid_results, semantic_index_path, semantic_result_mode, PersistentSemanticSearchIndex,
    INDEX_FORMAT_VERSION, SEMANTIC_INDEX_FORMAT_VERSION,
};
pub use query::{SearchInclude, SearchMode, SearchQuery, SearchScope};
pub use query_plan::{infer_query_plan, QueryModality, QueryPlan};
#[cfg(feature = "local-embedding")]
pub use reranking::LocalReranker;
pub use rerank_hits::rerank_hits_with_provider;
pub use reranking::{
    rerank_candidates, LocalRerankerOptions, RerankCandidate, RerankError, RerankProvider,
    RerankResult, RerankScore, RerankedCandidate, DEFAULT_RERANK_MAX_CANDIDATES,
    RERANK_MAX_CANDIDATES_LIMIT, RERANK_MAX_LENGTH,
};
pub use result::{
    SearchDocument, SearchDocumentSource, SearchDocumentSourceKind, SearchEntryGroup, SearchHit,
    SearchResults, SearchTarget, SearchTextSection,
};
pub use retrieval_pipeline::*;
pub use rrf::{
    adaptive_hybrid_weights, reciprocal_rank_fusion, weighted_reciprocal_rank_fusion, DEFAULT_RRF_K,
};
pub use search_index_trait::SearchIndex;
pub use section_tree_index::{
    build_section_tree_index, segment_type_matches_filter, SectionTreeEntry, SectionTreeIndex,
    NEUTRAL_STRUCTURE_SCORE,
};
pub use semantic_index::InMemorySemanticSearchIndex;
pub use vector_store_trait::{VectorRecord, VectorSearchHit, VectorStore};

pub use carrier_binding::{
    apply_to_query, parse_binding, Carrier, CarrierBinding, CarrierConstraint, CarrierKind,
    UnboundReason,
};
pub use heuristic_rerank::{
    extract_query_fields, field_coverage, rerank_hits_by_coverage, FieldCoverageWeights,
    QueryFields,
};
pub use document_head::{
    document_head, document_pairs, documents_for_pairs, DocumentHead, DocumentHeadConfig, HeadSkip,
};
pub use unified_retrieval::{
    run_unified, AppendGate, Degradation, NoVisualChannel, RoutingStage, TextRecall,
    UnifiedLimits, UnifiedOutput, UnifiedPlan, UnifiedRequest, UnifiedTaskOutput,
    VisualFusionPolicy,
};
pub use visual_embedding::{
    check_provider, NoVisualProvider, VisualAssetInput, VisualEmbeddingProvider, VisualPageEmbedding,
    VisualPageVector, VisualProviderCheck, VisualProviderStatus,
};
pub use visual_index::{
    build_visual_index, reopen_visual_index, visual_index_path, visual_namespace,
    VisualIndexDocument, VisualSearchIndex, VisualSourceKind, VISUAL_EMBED_BATCH_SIZE,
    VISUAL_INDEX_FILE_NAME, VISUAL_INDEX_FORMAT_VERSION,
};
pub use visual_sidecar::{
    aggregate_parents, fuse_entry_orders, parent_entry_order, ParentScore, VisualChannelStatus,
    VisualRecall, VisualScore,
};
