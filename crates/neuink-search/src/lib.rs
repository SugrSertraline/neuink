mod colbert_head;
mod document_builder;
mod carrier_binding;
mod document_head;
mod heuristic_rerank;
mod embedding_provider_trait;
mod embedding_representation;
mod error;
mod fastembed_provider;
mod listwise_rerank;
mod memory_index;
mod multivector_index;
mod persistent_semantic_index;
mod remote_embedding_provider;
mod query;
#[cfg(feature = "local-embedding")]
mod path_embedding;
mod query_plan;
mod rerank_hits;
mod remote_reranking;
mod scope_rerank;
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
mod structural_prior;
mod surrounding_context;
mod token;
mod unified_retrieval;
mod vector_store_trait;
mod visual_embedding;
mod visual_evidence;
mod visual_index;
mod visual_sidecar;

pub use colbert_head::{
    affine, head_sha256, inspect_multivector_heads, lexical_weights, load_colbert, load_sparse,
    project_colbert, write_head, LinearHead, MultivectorHeadStatus, MultivectorSupport,
};
pub use document_builder::{compose_search_document, SearchDocumentInput};
pub use listwise_rerank::{
    fuse_pool_rrf_with_profile, fuse_rankings_rrf, parse_ranked_ids,
    reorder_hits as reorder_listwise_hits, single_paper_listwise_user_prompt, HttpListwiseReranker,
    ListwiseOrder, ListwisePromptStyle, ListwiseRerankProvider, PoolRrfProfile,
};
pub use multivector_index::{
    cache_path, rank_documents, read_cache, reorder_hits as reorder_multivector_hits, rescore_selection,
    write_cache, EntryMultivectorCache, MultivectorDocument,
};
pub use embedding_provider_trait::{
    EmbeddingInput, EmbeddingPrefixes, EmbeddingProvider, EmbeddingProviderStatus, EmbeddingVector,
};
pub use embedding_representation::{
    embed_query_vector, embedding_text, embedding_text_with_prefix, semantic_embedding_identity,
    stable_document_key, stable_document_key_with_prefix, SemanticVectorDocument,
    EMBEDDING_REPRESENTATION_VERSION,
};
pub use error::{SearchError, SearchResult};
pub use fastembed_provider::{
    FastEmbedProvider, DEFAULT_EMBEDDING_MODEL_RESOURCE_DIR, EMBEDDING_MODEL_FILE_NAMES,
    LOCAL_EMBEDDING_BATCH_SIZE,
};
pub use remote_embedding_provider::RemoteEmbeddingProvider;
pub use memory_index::MemorySearchIndex;
pub use persistent_semantic_index::{
    merge_hybrid_results, semantic_index_path, semantic_result_mode, PersistentSemanticSearchIndex,
    INDEX_FORMAT_VERSION, SEMANTIC_INDEX_FORMAT_VERSION,
};
pub use query::{SearchInclude, SearchMode, SearchQuery, SearchScope};
pub use query_plan::{infer_query_plan, QueryModality, QueryPlan};
#[cfg(feature = "local-embedding")]
pub use reranking::LocalReranker;
pub use remote_reranking::{
    HttpReranker, COHERE_RERANK_ENDPOINT, COHERE_RERANK_MODEL, DASHSCOPE_RERANK_ENDPOINT,
    DASHSCOPE_RERANK_MODEL, JINA_RERANK_ENDPOINT, JINA_RERANK_MODEL,
};
pub use rerank_hits::{
    rerank_hits_with_provider, rerank_hits_with_provider_raw, rerank_hits_with_provider_structured,
    stamp_rank_scores,
};
pub use structural_prior::{
    apply_structural_soft_demotion, apply_structural_soft_demotion_head,
    apply_structural_soft_demotion_head_with_related, format_structured_hit, is_single_paper_hits,
    query_has_summary_intent, strip_passage_header,
};
pub use surrounding_context::{
    attach_surrounding_context, SegmentContextMap, DEFAULT_SURROUNDING_CONTEXT_TOP_N,
};
pub use scope_rerank::{
    refine_tail_with_scope_v6, HttpScopeJudge, PassageJudgment, ScopeDecision, ScopeItem,
    ScopeJudgeError, ScopeJudgeProvider, ScopeJudgeRequest, ScopeRefineReport, ScopeSwapSummary,
};
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
    visual_snapshot_keys, VisualIndexDocument, VisualSearchIndex, VisualSourceKind,
    VISUAL_EMBED_BATCH_SIZE, VISUAL_INDEX_FILE_NAME, VISUAL_INDEX_FORMAT_VERSION,
};
pub use visual_evidence::{
    apply_within_paper_visual_evidence, question_has_visual_intent,
    supplement_hits_from_visual_pages, CeConfidence, VisualPageSegments, WithinPaperVisualOptions,
};
pub use visual_sidecar::{
    aggregate_parents, fuse_entry_orders, parent_entry_order, ParentScore, VisualChannelStatus,
    VisualRecall, VisualScore,
};





