use crate::{
    EmbeddingInput, EmbeddingProvider, EmbeddingVector, SearchDocument, SearchDocumentSourceKind,
    SearchError, SearchInclude, SearchQuery, SearchResult, SearchTarget,
};

/// The current title / section path / caption / body representation. Changing
/// this value invalidates cached vectors even when document text is unchanged.
pub const EMBEDDING_REPRESENTATION_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug)]
pub struct SemanticVectorDocument<'a> {
    pub document: &'a SearchDocument,
    pub vector: &'a [f32],
}

pub fn embedding_text(document: &SearchDocument) -> String {
    let mut parts = Vec::with_capacity(document.sections.len() + 1);
    if !document.title.trim().is_empty() {
        parts.push(document.title.trim().to_string());
    }
    for section in &document.sections {
        if matches!(section.label.as_str(), "title" | "translation") {
            continue;
        }
        let text = section.text.trim();
        if !text.is_empty() && text != document.title.trim() {
            parts.push(if section.label == "section_path" {
                format!("[{text}]")
            } else {
                text.to_string()
            });
        }
    }
    format!("passage: {}", parts.join("\n"))
}

pub fn stable_document_key(document: &SearchDocument) -> String {
    let target = match &document.target {
        SearchTarget::Entry { entry_id } => format!("entry:{}", entry_id.as_str()),
        SearchTarget::Note { entry_id, note_id } => {
            format!("note:{}:{}", entry_id.as_str(), note_id.as_str())
        }
        SearchTarget::Page { entry_id, page_idx } => {
            format!("page:{}:{page_idx}", entry_id.as_str())
        }
        SearchTarget::Segment {
            entry_id,
            segment_uid,
            page_idx,
        } => format!(
            "segment:{}:{}:{page_idx}",
            entry_id.as_str(),
            segment_uid.as_str()
        ),
    };
    let mut hasher = blake3::Hasher::new();
    for field in [
        format!("{:?}", document.source.kind),
        document.source.field_name.clone().unwrap_or_default(),
        document
            .source
            .tag_id
            .as_ref()
            .map(|id| id.as_str())
            .unwrap_or_default()
            .to_string(),
        document
            .source
            .note_id
            .as_ref()
            .map(|id| id.as_str())
            .unwrap_or_default()
            .to_string(),
        document
            .source
            .segment_uid
            .as_ref()
            .map(|id| id.as_str())
            .unwrap_or_default()
            .to_string(),
        document
            .source
            .page_idx
            .map(|value| value.to_string())
            .unwrap_or_default(),
        embedding_text(document),
    ] {
        hasher.update(&(field.len() as u64).to_le_bytes());
        hasher.update(field.as_bytes());
    }
    format!("{target}:{}", hasher.finalize().to_hex())
}

/// Returns no identity for providers that cannot establish their model contents.
/// Such providers can search, but must not silently reuse persisted vectors.
pub fn semantic_embedding_identity(provider: &dyn EmbeddingProvider) -> Option<String> {
    let provider_identity = provider.cache_identity()?;
    let status = provider.status();
    let mut hasher = blake3::Hasher::new();
    hasher.update(&EMBEDDING_REPRESENTATION_VERSION.to_le_bytes());
    hasher.update(&(status.dimensions.unwrap_or_default() as u64).to_le_bytes());
    hasher.update(&(provider_identity.len() as u64).to_le_bytes());
    hasher.update(provider_identity.as_bytes());
    Some(hasher.finalize().to_hex().to_string())
}

pub fn embed_query_vector(
    provider: &dyn EmbeddingProvider,
    normalized_query: &str,
) -> SearchResult<Vec<f32>> {
    let mut vectors = provider.embed(&[EmbeddingInput {
        id: "query".to_string(),
        text: format!("query: {normalized_query}"),
    }])?;
    validate_embedding_vectors(&vectors, 1, provider.status().dimensions)?;
    Ok(normalize_embedding_vector(vectors.remove(0).values))
}

pub(crate) fn validate_embedding_vectors(
    vectors: &[EmbeddingVector],
    expected_count: usize,
    expected_dimensions: Option<usize>,
) -> SearchResult<()> {
    if vectors.len() != expected_count {
        return Err(SearchError::EmbeddingUnavailable(format!(
            "Embedding provider returned {} vectors for {expected_count} inputs.",
            vectors.len()
        )));
    }
    let dimensions =
        expected_dimensions.or_else(|| vectors.first().map(EmbeddingVector::dimensions));
    for vector in vectors {
        validate_embedding_vector(&vector.values, dimensions)?;
    }
    Ok(())
}

pub(crate) fn validate_embedding_vector(
    vector: &[f32],
    expected_dimensions: Option<usize>,
) -> SearchResult<()> {
    if let Some(expected) = expected_dimensions {
        if vector.len() != expected {
            return Err(SearchError::VectorDimensionMismatch {
                expected,
                actual: vector.len(),
            });
        }
    }
    if vector.is_empty() || vector.iter().any(|value| !value.is_finite()) {
        return Err(SearchError::EmbeddingUnavailable(
            "Embedding vector is empty or non-finite.".to_string(),
        ));
    }
    Ok(())
}

pub(crate) fn normalize_embedding_vector(mut values: Vec<f32>) -> Vec<f32> {
    let norm = values
        .iter()
        .map(|value| f64::from(*value).powi(2))
        .sum::<f64>()
        .sqrt();
    if norm > 0.0 {
        for value in &mut values {
            *value = (f64::from(*value) / norm) as f32;
        }
    }
    values
}

pub(crate) fn included_by_query(include: &SearchInclude, kind: SearchDocumentSourceKind) -> bool {
    match kind {
        SearchDocumentSourceKind::EntryTitle
        | SearchDocumentSourceKind::EntryField
        | SearchDocumentSourceKind::EntryTag => include.entry_meta,
        SearchDocumentSourceKind::NoteTitle
        | SearchDocumentSourceKind::NoteBody
        | SearchDocumentSourceKind::SegmentNote
        | SearchDocumentSourceKind::Annotation => include.notes,
        SearchDocumentSourceKind::PdfPage | SearchDocumentSourceKind::Segment => include.segments,
    }
}

pub fn matches_semantic_document(query: &SearchQuery, document: &SearchDocument) -> bool {
    if !query.scope.contains_entry(&document.entry_id)
        || !included_by_query(&query.include, document.source.kind)
        || (query.segments_only && !matches!(&document.target, SearchTarget::Segment { .. }))
    {
        return false;
    }
    if let Some(filter) = query
        .section_filter
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let filter_lower = filter.to_ascii_lowercase();
        if !document
            .source
            .section_id
            .as_deref()
            .is_some_and(|id| id == filter)
            && !document
                .source
                .section_path
                .as_deref()
                .is_some_and(|path| path.to_ascii_lowercase().contains(&filter_lower))
        {
            return false;
        }
    }
    query.segment_types.is_empty()
        || document
            .source
            .segment_type
            .is_some_and(|kind| query.segment_types.contains(&kind))
}
