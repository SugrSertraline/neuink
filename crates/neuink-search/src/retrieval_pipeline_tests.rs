use neuink_domain::{CanonicalSectionRole, EntryId, SegmentType, SegmentUid};

use crate::{
    finalize_candidates, fuse_query_candidates, ordered_hits, results_from_hits, ChapterCentroids,
    SearchDocument, SearchDocumentSource, SearchDocumentSourceKind, SearchHit, SearchMode,
    SearchQuery, SearchResults, SearchScope, SearchTarget, SearchTextSection,
    SemanticVectorDocument,
};

fn document(entry: &str, uid: &str, section: Option<(&str, &str)>) -> SearchDocument {
    let entry_id = EntryId::from_string(entry);
    let segment_uid = SegmentUid::from_string(uid);
    SearchDocument {
        entry_id: entry_id.clone(),
        entry_title: entry.to_string(),
        source: SearchDocumentSource {
            kind: SearchDocumentSourceKind::Segment,
            segment_uid: Some(segment_uid.clone()),
            page_idx: Some(0),
            section_id: section.map(|(id, _)| id.to_string()),
            section_path: section.map(|(_, path)| path.to_string()),
            section_role: Some(CanonicalSectionRole::Methods),
            segment_type: Some(SegmentType::Paragraph),
            ..SearchDocumentSource::default()
        },
        target: SearchTarget::Segment {
            entry_id,
            segment_uid,
            page_idx: 0,
        },
        title: uid.to_string(),
        sections: vec![SearchTextSection::body(format!("Content of {uid}"))],
        boost: 1.0,
    }
}

fn hit(document: &SearchDocument, score: f32) -> SearchHit {
    SearchHit {
        entry_id: document.entry_id.clone(),
        entry_title: document.entry_title.clone(),
        source: document.source.clone(),
        target: document.target.clone(),
        title: document.title.clone(),
        snippet: document.text_for_snippet(),
        score,
        matched_terms: vec!["content".to_string()],
    }
}

fn query(limit: usize) -> SearchQuery {
    let mut query = SearchQuery::new("content");
    query.scope = SearchScope {
        entry_ids: vec![EntryId::from_string("entry-a")],
    };
    query.limit = limit;
    query
}

fn results(hits: Vec<SearchHit>) -> SearchResults {
    results_from_hits(
        "content".into(),
        "semantic".into(),
        7,
        hits,
        vec!["trace".into()],
    )
}

fn chapters(documents: &[SearchDocument], vectors: &[Vec<f32>]) -> ChapterCentroids {
    ChapterCentroids::from_vectors(
        documents
            .iter()
            .zip(vectors)
            .map(|(document, vector)| SemanticVectorDocument { document, vector }),
    )
}

fn exact_results(left: &SearchResults, right: &SearchResults) {
    assert_eq!(
        serde_json::to_value(left).unwrap(),
        serde_json::to_value(right).unwrap()
    );
}

#[test]
fn references_receive_exactly_one_penalty_before_the_final_cut() {
    let mut reference = document("entry-a", "ref", Some(("section-ref", "References")));
    reference.source.section_role = Some(CanonicalSectionRole::References);
    let body = document("entry-a", "body", Some(("section-body", "Methods")));
    let input = results(vec![hit(&reference, 2.0), hit(&body, 0.8)]);
    let output = finalize_candidates(input, &query(10), None, None, 0.0, true);
    let hits = ordered_hits(&output);
    assert_eq!(hits[0].title, "body");
    assert_eq!(hits[1].score.to_bits(), (2.0_f32 * 0.35).to_bits());
    assert_eq!(hits[0].score.to_bits(), 0.8_f32.to_bits());
}

#[test]
fn explicit_reference_section_filters_exempt_both_ids_and_paths() {
    let mut reference = document("entry-a", "ref", Some(("section-7", "References")));
    reference.source.section_role = Some(CanonicalSectionRole::References);
    let input = results(vec![hit(&reference, 2.0)]);
    for filter in ["section-7", "References"] {
        let mut query = query(10);
        query.section_filter = Some(filter.into());
        let output = finalize_candidates(input.clone(), &query, None, None, 0.0, true);
        exact_results(&input, &output);
    }
}

#[test]
fn reference_word_in_query_does_not_implicitly_override_the_reference_policy() {
    let mut reference = document("entry-a", "ref", Some(("section-7", "References")));
    reference.source.section_role = Some(CanonicalSectionRole::References);
    let input = results(vec![hit(&reference, 2.0)]);
    let mut query = query(10);
    query.text = "Which papers are listed in the references?".into();
    let output = finalize_candidates(input, &query, None, None, 0.0, true);
    assert_eq!(
        ordered_hits(&output)[0].score.to_bits(),
        (2.0_f32 * 0.35).to_bits()
    );
}

#[test]
fn alpha_zero_preserves_scores_order_metadata_and_warnings_exactly() {
    let documents = vec![
        document("entry-a", "first", Some(("section-1", "First"))),
        document("entry-a", "second", Some(("section-2", "Second"))),
    ];
    let chapters = chapters(&documents, &[vec![0.0, 1.0], vec![1.0, 0.0]]);
    let input = results(vec![
        hit(&documents[0], 0.91347),
        hit(&documents[1], 0.73284),
    ]);
    let output = finalize_candidates(
        input.clone(),
        &query(10),
        Some(&[1.0, 0.0]),
        Some(&chapters),
        0.0,
        false,
    );
    exact_results(&input, &output);
}

#[test]
fn chapter_evidence_can_promote_the_candidate_at_k_plus_one_before_truncation() {
    let documents = vec![
        document("entry-a", "distractor", Some(("section-1", "Unrelated"))),
        document("entry-a", "gold", Some(("section-2", "Answer"))),
    ];
    let chapters = chapters(&documents, &[vec![0.0, 1.0], vec![1.0, 0.0]]);
    let input = results(vec![hit(&documents[0], 0.9), hit(&documents[1], 0.8)]);
    let baseline = finalize_candidates(
        input.clone(),
        &query(1),
        Some(&[1.0, 0.0]),
        Some(&chapters),
        0.0,
        false,
    );
    assert_eq!(ordered_hits(&baseline)[0].title, "distractor");
    let output = finalize_candidates(
        input,
        &query(1),
        Some(&[1.0, 0.0]),
        Some(&chapters),
        0.1,
        false,
    );
    assert_eq!(output.total_hit_count, 1);
    assert_eq!(ordered_hits(&output)[0].title, "gold");
}

#[test]
fn missing_tree_or_invalid_content_vector_bypasses_the_entire_query() {
    for invalid in [vec![], vec![0.0, 0.0], vec![f32::NAN, 0.0]] {
        let documents = vec![
            document("entry-a", "valid", Some(("section-1", "Valid"))),
            document("entry-a", "invalid", Some(("section-2", "Invalid"))),
        ];
        let chapters = chapters(&documents, &[vec![1.0, 0.0], invalid]);
        let input = results(vec![hit(&documents[0], 0.9), hit(&documents[1], 0.8)]);
        let output = finalize_candidates(
            input.clone(),
            &query(10),
            Some(&[1.0, 0.0]),
            Some(&chapters),
            0.1,
            false,
        );
        exact_results(&input, &output);
    }
    let documents = vec![document("entry-a", "unstructured", None)];
    let chapters = chapters(&documents, &[vec![1.0, 0.0]]);
    let input = results(vec![hit(&documents[0], 0.6)]);
    let output = finalize_candidates(
        input.clone(),
        &query(10),
        Some(&[1.0, 0.0]),
        Some(&chapters),
        0.1,
        false,
    );
    exact_results(&input, &output);
}

#[test]
fn mixed_entry_candidates_and_unscoped_queries_bypass_chapter_boost() {
    let documents = vec![
        document("entry-a", "first", Some(("section-1", "Methods"))),
        document("entry-b", "second", Some(("section-1", "Methods"))),
    ];
    let chapters = chapters(&documents, &[vec![0.0, 1.0], vec![1.0, 0.0]]);
    let input = results(vec![hit(&documents[0], 0.9), hit(&documents[1], 0.8)]);
    for scope in [
        vec![],
        vec![EntryId::from_string("entry-a")],
        vec![
            EntryId::from_string("entry-a"),
            EntryId::from_string("entry-b"),
        ],
    ] {
        let mut query = query(10);
        query.scope.entry_ids = scope;
        let output = finalize_candidates(
            input.clone(),
            &query,
            Some(&[1.0, 0.0]),
            Some(&chapters),
            0.1,
            false,
        );
        exact_results(&input, &output);
    }
}

#[test]
fn parent_centroid_counts_unique_content_segments_and_excludes_heading_vectors() {
    let mut heading = document("entry-a", "heading", Some(("parent", "Methods")));
    heading.source.segment_type = Some(SegmentType::Heading);
    let mut documents = vec![heading];
    let mut vectors = vec![vec![-1.0, 0.0]];
    for index in 0..3 {
        documents.push(document(
            "entry-a",
            &format!("left-{index}"),
            Some(("left", "Methods > Left")),
        ));
        vectors.push(vec![1.0, 0.0]);
    }
    let target = document("entry-a", "right", Some(("right", "Methods > Right")));
    documents.push(target.clone());
    vectors.push(vec![0.0, 1.0]);
    let reference_chapters = chapters(&documents, &vectors);
    let input = results(vec![hit(&target, 0.8)]);
    let reference = finalize_candidates(
        input.clone(),
        &query(10),
        Some(&[1.0, 0.0]),
        Some(&reference_chapters),
        0.1,
        false,
    );
    let expected_parent_cosine = 3.0_f32 / 10.0_f32.sqrt();
    let expected_score = (1.0 / 61.0) * (1.0 + 0.1 * (0.15 * expected_parent_cosine));
    assert!((ordered_hits(&reference)[0].score - expected_score).abs() < 1e-7);

    // Duplicate parser/search records must not outweigh another child section.
    for _ in 0..7 {
        documents.push(documents[1].clone());
        vectors.push(vectors[1].clone());
    }
    let duplicated = chapters(&documents, &vectors);
    let output = finalize_candidates(
        input,
        &query(10),
        Some(&[1.0, 0.0]),
        Some(&duplicated),
        0.1,
        false,
    );
    exact_results(&reference, &output);
}

#[test]
fn same_section_ids_in_another_entry_cannot_change_scoped_chapter_scores() {
    let documents = vec![document("entry-a", "own", Some(("section-1", "Methods")))];
    let input = results(vec![hit(&documents[0], 0.8)]);
    let own = chapters(&documents, &[vec![1.0, 0.0]]);
    let baseline = finalize_candidates(
        input.clone(),
        &query(10),
        Some(&[1.0, 0.0]),
        Some(&own),
        0.1,
        false,
    );
    let mut expanded = documents;
    expanded.push(document(
        "entry-b",
        "foreign",
        Some(("section-1", "Methods")),
    ));
    let isolated = chapters(&expanded, &[vec![1.0, 0.0], vec![-1.0, 0.0]]);
    let output = finalize_candidates(
        input,
        &query(10),
        Some(&[1.0, 0.0]),
        Some(&isolated),
        0.1,
        false,
    );
    exact_results(&baseline, &output);
}

#[test]
fn wrong_dimension_or_non_finite_query_vectors_bypass_chapter_boost() {
    let documents = vec![
        document("entry-a", "first", Some(("section-1", "Methods"))),
        document("entry-a", "second", Some(("section-2", "Results"))),
    ];
    let chapters = chapters(&documents, &[vec![0.0, 1.0], vec![1.0, 0.0]]);
    let input = results(vec![hit(&documents[0], 0.9), hit(&documents[1], 0.8)]);
    for query_vector in [
        vec![1.0, 0.0, 0.0],
        vec![f32::INFINITY, 0.0],
        vec![0.0, 0.0],
    ] {
        let output = finalize_candidates(
            input.clone(),
            &query(10),
            Some(&query_vector),
            Some(&chapters),
            0.15,
            false,
        );
        exact_results(&input, &output);
    }
}

#[test]
fn query_fusion_ranks_globally_before_the_final_cut() {
    let shared = document("entry-a", "shared", Some(("section-1", "Methods")));
    let top_only_first = document("entry-a", "first", Some(("section-2", "Results")));
    let middle = document("entry-a", "middle", Some(("section-3", "Results")));
    let other = document("entry-a", "other", Some(("section-4", "Results")));
    let first_list = results(vec![
        hit(&top_only_first, 0.9),
        hit(&middle, 0.8),
        hit(&shared, 0.7),
    ]);
    let second_list = results(vec![hit(&shared, 0.9), hit(&other, 0.8)]);

    // Truncating each list to one hit before fusion would keep `first` and lose `shared`.
    let fused = fuse_query_candidates("content", &[first_list, second_list], &[1.0, 0.9]);
    let output = finalize_candidates(fused, &query(1), None, None, 0.0, false);

    assert_eq!(output.total_hit_count, 1);
    assert_eq!(ordered_hits(&output)[0].title, "shared");
}

/// Structural contract only: numbered hierarchy, Table/Figure captions, Math
/// and References policy as the domain outline exposes them. Not a quality test.
#[test]
fn mineru_shaped_segments_yield_hierarchy_captions_math_and_reference_roles() {
    use neuink_domain::{build_document_outline, SourceSegment};

    let heading = |text: &str| SourceSegment::new(SegmentType::Heading, 0, None, text.into());
    let paragraph = |text: &str| SourceSegment::new(SegmentType::Paragraph, 0, None, text.into());
    let table = SourceSegment::new(SegmentType::Table, 0, None, "metric table".into())
        .with_relation_groups(None, Some("visual-1".into()));
    let table_caption =
        SourceSegment::new(SegmentType::Paragraph, 0, None, "Table 1: Scores".into())
            .with_relation_groups(None, Some("visual-1".into()));
    let math = SourceSegment::new(SegmentType::Math, 0, None, "E = mc^2".into());
    let reference_entry = paragraph("[1] Vaswani et al. Attention is all you need.");

    let segments = vec![
        heading("1 Introduction"),
        paragraph("We study retrieval."),
        heading("1.1 Background"),
        table,
        table_caption,
        math.clone(),
        heading("References"),
        reference_entry.clone(),
    ];
    let outline = build_document_outline(&segments);

    assert_eq!(outline.sections.len(), 2, "two top-level sections");
    let introduction = &outline.sections[0];
    assert_eq!(introduction.level, 1);
    assert_eq!(introduction.children.len(), 1, "1.1 nests under 1");
    let background = &introduction.children[0];
    assert_eq!(background.level, 2);
    assert!(background
        .section_path
        .starts_with(&introduction.section_path));
    assert!(background.section_path.contains(" > "));

    // Math stays inside the section that contains it and never opens a heading.
    assert_eq!(
        outline.segment_sections.get(&math.uid).map(String::as_str),
        Some(background.section_id.as_str())
    );

    // References is a canonical role; its entries stay with that section.
    let references = &outline.sections[1];
    assert_eq!(references.section_role, CanonicalSectionRole::References);
    assert_eq!(
        outline
            .segment_sections
            .get(&reference_entry.uid)
            .map(String::as_str),
        Some(references.section_id.as_str())
    );
}

#[test]
fn candidate_window_is_five_times_the_final_limit_with_a_floor_and_k200_cap() {
    use crate::candidate_window;
    assert_eq!(candidate_window(1), 60);
    assert_eq!(candidate_window(12), 60);
    assert_eq!(candidate_window(40), 200);
    assert_eq!(candidate_window(200), 1000);
    assert_eq!(candidate_window(500), 1000);
}

#[test]
fn same_text_under_other_uids_in_sibling_subtrees_counts_once_in_the_parent_centroid() {
    let mut heading = document("entry-a", "heading", Some(("parent", "Methods")));
    heading.source.segment_type = Some(SegmentType::Heading);
    let mut left = document("entry-a", "dup-a", Some(("left", "Methods > Left")));
    left.sections = vec![SearchTextSection::body("Same passage")];
    let mut left_copy = document("entry-a", "dup-b", Some(("left-2", "Methods > Left Two")));
    // Whitespace-only difference: the normalized body text is identical.
    left_copy.sections = vec![SearchTextSection::body("Same  passage")];
    let mut right = document("entry-a", "other", Some(("right", "Methods > Right")));
    right.sections = vec![SearchTextSection::body("Different passage")];
    let documents = vec![heading, left.clone(), left_copy.clone(), right.clone()];
    let vectors = vec![
        vec![-1.0, 0.0],
        vec![1.0, 0.0],
        vec![1.0, 0.0],
        vec![0.0, 1.0],
    ];
    let deduped = chapters(&documents, &vectors);
    let output = finalize_candidates(
        results(vec![hit(&right, 0.8)]),
        &query(10),
        Some(&[1.0, 0.0]),
        Some(&deduped),
        0.1,
        false,
    );
    // Unique content: (1,0) once and (0,1) once, so the parent centroid is (1,1)/sqrt(2).
    let deduped_cosine = 1.0_f32 / 2.0_f32.sqrt();
    let expected = (1.0 / 61.0) * (1.0 + 0.1 * (0.15 * deduped_cosine));
    assert!((ordered_hits(&output)[0].score - expected).abs() < 1e-6);

    // Different text must not merge, even when only case differs.
    left_copy.sections = vec![SearchTextSection::body("same passage")];
    let distinct = chapters(
        &[documents[0].clone(), left, left_copy, right.clone()],
        &vectors,
    );
    let output = finalize_candidates(
        results(vec![hit(&right, 0.8)]),
        &query(10),
        Some(&[1.0, 0.0]),
        Some(&distinct),
        0.1,
        false,
    );
    let counted_twice_cosine = 2.0_f32 / 5.0_f32.sqrt();
    let distinct_expected = (1.0 / 61.0) * (1.0 + 0.1 * (0.15 * counted_twice_cosine));
    assert!((ordered_hits(&output)[0].score - distinct_expected).abs() < 1e-6);
    assert!((expected - distinct_expected).abs() > 1e-5);
}

#[test]
fn hybrid_with_semantic_policy_returns_the_semantic_order_without_keyword_recall() {
    use crate::{
        recall_candidates, EmbeddingInput, EmbeddingProvider, EmbeddingProviderStatus,
        EmbeddingVector, HybridPolicy, MemorySearchIndex, PersistentSemanticSearchIndex,
        SearchInclude, SearchIndex, SearchMode, SearchResult,
    };

    struct AxisProvider;
    impl EmbeddingProvider for AxisProvider {
        fn status(&self) -> EmbeddingProviderStatus {
            EmbeddingProviderStatus {
                available: true,
                provider: "test-axis".into(),
                ..Default::default()
            }
        }
        fn embed(&self, inputs: &[EmbeddingInput]) -> SearchResult<Vec<EmbeddingVector>> {
            Ok(inputs
                .iter()
                .map(|input| {
                    EmbeddingVector::new(if input.text.contains("alpha") {
                        vec![1.0, 0.0]
                    } else {
                        vec![0.0, 1.0]
                    })
                })
                .collect())
        }
    }

    let mut first = document("entry-a", "one", Some(("section-1", "Methods")));
    first.sections = vec![SearchTextSection::body("alpha one")];
    let mut second = document("entry-a", "two", Some(("section-2", "Methods")));
    second.sections = vec![SearchTextSection::body("beta two")];
    let mut third = document("entry-a", "three", Some(("section-3", "Methods")));
    third.sections = vec![SearchTextSection::body("alpha three")];
    let documents = vec![first, second, third];
    let keyword = MemorySearchIndex::default();
    keyword.replace_documents(documents.clone()).unwrap();
    let semantic =
        PersistentSemanticSearchIndex::build(&documents, &AxisProvider, &SearchInclude::default())
            .unwrap();
    let vector = [1.0_f32, 0.0];

    let mut semantic_query = query(10);
    semantic_query.text = "alpha".into();
    semantic_query.mode = SearchMode::Semantic;
    let semantic_only = recall_candidates(
        &keyword,
        Some(&semantic),
        &semantic_query,
        Some(&vector),
        HybridPolicy::Legacy,
        10,
    )
    .unwrap();

    let mut hybrid_query = semantic_query.clone();
    hybrid_query.mode = SearchMode::Hybrid;
    let hybrid = recall_candidates(
        &keyword,
        Some(&semantic),
        &hybrid_query,
        Some(&vector),
        HybridPolicy::Semantic,
        10,
    )
    .unwrap();

    assert_eq!(hybrid.mode, "hybrid_semantic_only");
    let semantic_order = ordered_hits(&semantic_only)
        .iter()
        .map(|hit| (hit.title.clone(), hit.score.to_bits()))
        .collect::<Vec<_>>();
    let hybrid_order = ordered_hits(&hybrid)
        .iter()
        .map(|hit| (hit.title.clone(), hit.score.to_bits()))
        .collect::<Vec<_>>();
    assert!(!hybrid_order.is_empty());
    assert_eq!(hybrid_order, semantic_order);
}

#[test]
fn entry_completeness_and_section_coverage_are_read_only_and_never_relax_bypass() {
    let mut heading = document("entry-a", "heading", Some(("parent", "Methods")));
    heading.source.segment_type = Some(SegmentType::Heading);
    let body = document("entry-a", "body", Some(("left", "Methods > Left")));
    let broken = document("entry-b", "broken", Some(("section-b", "Results")));
    let documents = vec![heading, body, broken];
    let chapters = chapters(
        &documents,
        &[vec![-1.0, 0.0], vec![1.0, 0.0], vec![0.0, 0.0]],
    );

    assert!(chapters.is_entry_complete("entry-a"));
    assert!(
        !chapters.is_entry_complete("entry-b"),
        "invalid vector stays incomplete"
    );
    assert!(
        !chapters.is_entry_complete("missing"),
        "unknown entry is not eligible"
    );
    assert_eq!(
        chapters.section_coverage("entry-a"),
        crate::SectionCoverage {
            sections: 2,
            with_content: 1,
            without_content: 1,
        }
    );
    assert_eq!(
        chapters.section_coverage("missing"),
        crate::SectionCoverage::default()
    );
}

/// Same body, same title, distinct uids: every score ties, so only identity decides the cut.
fn tied_document(uid: usize) -> SearchDocument {
    let mut document = document(
        "entry-a",
        &format!("seg-{uid:03}"),
        Some(("section-1", "Methods")),
    );
    document.sections = vec![SearchTextSection::body("shared candidate text")];
    document.title = "Page 1".to_string();
    document
}

fn tied_documents(count: usize, reversed: bool) -> Vec<SearchDocument> {
    let mut documents = (0..count).map(tied_document).collect::<Vec<_>>();
    if reversed {
        documents.reverse();
    }
    documents
}

fn identities(results: &SearchResults) -> Vec<String> {
    ordered_hits(results)
        .iter()
        .map(crate::hit_identity)
        .collect()
}

struct ConstantProvider;

impl crate::EmbeddingProvider for ConstantProvider {
    fn status(&self) -> crate::EmbeddingProviderStatus {
        crate::EmbeddingProviderStatus {
            available: true,
            provider: "test-constant".into(),
            ..Default::default()
        }
    }

    fn embed(
        &self,
        inputs: &[crate::EmbeddingInput],
    ) -> crate::SearchResult<Vec<crate::EmbeddingVector>> {
        Ok(inputs
            .iter()
            .map(|_| crate::EmbeddingVector::new(vec![1.0, 0.0]))
            .collect())
    }
}

#[test]
fn keyword_ties_beyond_the_window_keep_the_same_members_across_order_and_rebuilds() {
    use crate::{MemorySearchIndex, SearchIndex};
    let build = |reversed: bool| {
        let index = MemorySearchIndex::default();
        index
            .replace_documents(tied_documents(100, reversed))
            .unwrap();
        let mut query = query(60);
        query.text = "candidate".into();
        identities(&index.search(query).unwrap())
    };
    let forward = build(false);
    assert_eq!(forward.len(), 60);
    assert_eq!(forward, build(true));
    assert_eq!(forward, build(false), "a new index has a new HashMap seed");
}

#[test]
fn semantic_ties_beyond_the_window_keep_the_same_members_across_order_and_rebuilds() {
    use crate::{InMemorySemanticSearchIndex, PersistentSemanticSearchIndex, SearchInclude};
    let mut query = query(60);
    query.mode = SearchMode::Semantic;
    let vector = [1.0_f32, 0.0];
    let provider = ConstantProvider;
    let include = SearchInclude::default();
    let in_memory = |reversed: bool| {
        let index =
            InMemorySemanticSearchIndex::build(&tied_documents(100, reversed), &provider, &include)
                .unwrap();
        identities(
            &index
                .search_with_vector(&query, "candidate", &vector, "semantic", Vec::new(), 1)
                .unwrap(),
        )
    };
    let persistent = |reversed: bool| {
        let index = PersistentSemanticSearchIndex::build(
            &tied_documents(100, reversed),
            &provider,
            &include,
        )
        .unwrap();
        identities(
            &index
                .search_with_vector(&query, "candidate", &vector, "semantic", Vec::new(), 1)
                .unwrap(),
        )
    };
    let memory_forward = in_memory(false);
    assert_eq!(memory_forward.len(), 60);
    assert_eq!(memory_forward, in_memory(true));
    assert_eq!(memory_forward, in_memory(false));
    let persistent_forward = persistent(false);
    assert_eq!(persistent_forward.len(), 60);
    assert_eq!(persistent_forward, persistent(true));
    assert_eq!(persistent_forward, persistent(false));
}

#[test]
fn fused_ties_beyond_the_window_keep_the_same_members_across_order_and_rebuilds() {
    use crate::{
        recall_candidates, HybridPolicy, InMemorySemanticSearchIndex, MemorySearchIndex,
        SearchInclude, SearchIndex,
    };
    let vector = [1.0_f32, 0.0];
    let provider = ConstantProvider;
    let include = SearchInclude::default();
    let run = |reversed: bool| {
        let documents = tied_documents(100, reversed);
        let keyword = MemorySearchIndex::default();
        keyword.replace_documents(documents.clone()).unwrap();
        let semantic =
            crate::PersistentSemanticSearchIndex::build(&documents, &provider, &include).unwrap();
        let mut hybrid = query(60);
        hybrid.text = "candidate".into();
        hybrid.mode = SearchMode::Hybrid;
        let fused = recall_candidates(
            &keyword,
            Some(&semantic),
            &hybrid,
            Some(&vector),
            HybridPolicy::Legacy,
            60,
        )
        .unwrap();
        identities(&fused)
    };
    let forward = run(false);
    assert_eq!(forward.len(), 60);
    assert_eq!(forward, run(true));
    assert_eq!(forward, run(false));
    let _ = InMemorySemanticSearchIndex::build;
}
