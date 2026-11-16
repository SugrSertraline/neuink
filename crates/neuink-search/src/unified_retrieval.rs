//! One pipeline that composes the three retrieval stages that measured well
//! separately, in the order the measurements justify.
//!
//! 1. Document routing. The whole question is ranked once, the head of that
//!    ranking is read (`document_head`, head 20 / cap 20 on DAPR: document recall
//!    95.20 % -> 97.05 %), and the named papers are kept on top because dropping
//!    one answers a different question.
//! 2. Visual sidecar vote. A ready visual channel ranks pages; its parents are
//!    collapsed to one vote each and fused with the text entry order. An
//!    unavailable channel degrades to text and says so.
//! 3. Evidence inside the routed documents. Sub-questions only reach this stage.
//!    On HotpotQA-style questions decomposition at the *document* layer measured
//!    -0.83 pp, while inside a fixed document it measured +5.24 pp with a strong
//!    ranker, so `run_unified` never lets a sub-question change which documents
//!    are routed. That invariant is structural here, not a convention.
//!
//! A named carrier ("Table 3", "§4.2") narrows evidence inside the routed
//! documents. When that narrowing finds nothing, the task is retried without it
//! and the fallback is recorded: an empty narrowed pool is not evidence that the
//! carrier is irrelevant.

use neuink_domain::EntryId;

use crate::carrier_binding::{apply_to_query, parse_binding, CarrierBinding, UnboundReason};
use crate::document_head::{document_head, DocumentHeadConfig, HeadSkip};
use crate::retrieval_pipeline::ordered_hits;
use crate::visual_sidecar::{
    aggregate_parents, fuse_entry_orders, parent_entry_order, VisualChannelStatus, VisualRecall,
};
use crate::{SearchError, SearchQuery, SearchResult, SearchResults};

/// Evidence-channel adapter. The IPC layer closes over the prepared keyword and
/// semantic indexes, so this module needs no model or workspace handle.
pub trait TextRecall {
    fn recall(&mut self, query: &SearchQuery, window: usize) -> SearchResult<SearchResults>;
}

impl<F> TextRecall for F
where
    F: FnMut(&SearchQuery, usize) -> SearchResult<SearchResults>,
{
    fn recall(&mut self, query: &SearchQuery, window: usize) -> SearchResult<SearchResults> {
        self(query, window)
    }
}

/// Visual channel used when the product has no visual index. It reports why it
/// did not run instead of pretending to search.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoVisualChannel(pub VisualChannelStatus);

impl VisualRecall for NoVisualChannel {
    fn status(&self) -> VisualChannelStatus {
        self.0
    }

    fn recall(
        &mut self,
        _question: &str,
        _entries: &[String],
        _limit: usize,
    ) -> SearchResult<Vec<crate::visual_sidecar::VisualScore>> {
        Ok(Vec::new())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct UnifiedLimits {
    /// Ranked units read before documents are deduplicated.
    pub head_units: usize,
    /// Documents the evidence stage may pair.
    pub max_documents: usize,
    /// Candidate window for the routing query.
    pub route_window: usize,
    /// Candidate window for each evidence task.
    pub evidence_window: usize,
    /// Final evidence hits per task.
    pub evidence_limit: usize,
}

impl Default for UnifiedLimits {
    fn default() -> Self {
        Self {
            head_units: 20,
            max_documents: 20,
            route_window: 60,
            evidence_window: 60,
            evidence_limit: 20,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct UnifiedPlan {
    pub limits: UnifiedLimits,
    /// Read named carriers out of the question.
    pub bind_carriers: bool,
    pub text_weight: f32,
    pub visual_weight: f32,
    pub rrf_k: f32,
    /// How the visual channel enters the document order.
    pub visual_fusion: VisualFusionPolicy,
    /// Sub-questions kept per request. Only the evidence stage sees them.
    pub max_sub_questions: usize,
}

/// How visual votes reach the document order.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum VisualFusionPolicy {
    /// Weighted rank fusion. Reorders the head, so a wrong visual signal can displace a
    /// correct text hit.
    Weighted { visual_weight: f32 },
    /// Text order is preserved; visual entries are appended only when the gate reports a
    /// thin text head. Matches the shape the dual-channel experiment measured.
    AppendGated { gate: AppendGate },
}

/// Gold-free append gate. Both bounds are observable from the text result alone.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AppendGate {
    /// Fewer distinct entries than this counts as a thin head.
    pub min_head_entries: usize,
    /// Token overlap at or below this between the question and the best hit counts as a
    /// weak text signal.
    pub max_snippet_overlap: usize,
}

impl Default for UnifiedPlan {
    fn default() -> Self {
        Self {
            limits: UnifiedLimits::default(),
            bind_carriers: true,
            text_weight: 1.0,
            // The measured two-way fusion used equal weights; a sidecar vote is
            // weaker evidence than a text hit, so the default stays below it.
            visual_weight: 0.5,
            rrf_k: crate::DEFAULT_RRF_K,
            // The default is the shape the dual-channel experiment measured: text order
            // first, visual entries appended only when the gold-free gate opens.
            visual_fusion: VisualFusionPolicy::AppendGated {
                gate: AppendGate {
                    min_head_entries: 3,
                    max_snippet_overlap: 2,
                },
            },
            max_sub_questions: 4,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct UnifiedRequest {
    pub question: String,
    /// Evidence-layer sub-questions. Never affect routing.
    pub sub_questions: Vec<String>,
    /// Papers the user named. Kept ahead of the document cap.
    pub mandated_entries: Vec<String>,
    /// Entries the question may report. Empty means the caller froze nothing,
    /// which disables the visual channel rather than opening the whole library.
    pub allowed_entries: Vec<String>,
    /// Parsed documents inside the frozen scope, for the head's skip reasons.
    pub in_scope_documents: usize,
    /// Scope, include, mode and host filters. `text` and `limit` are ignored.
    pub template: SearchQuery,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Degradation {
    VisualDisabled,
    VisualUnavailable(&'static str),
    VisualNoAllowedEntries,
    CarrierUnnumbered,
    CarrierMultiple,
    CarrierEmptyFallback,
    NoDocuments,
}

impl Degradation {
    pub fn code(self) -> &'static str {
        match self {
            Self::VisualDisabled => "visual_disabled",
            Self::VisualUnavailable(_) => "visual_unavailable",
            Self::VisualNoAllowedEntries => "visual_no_allowed_entries",
            Self::CarrierUnnumbered => "carrier_unnumbered",
            Self::CarrierMultiple => "carrier_multiple",
            Self::CarrierEmptyFallback => "carrier_empty_fallback",
            Self::NoDocuments => "no_documents",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct RoutingStage {
    pub documents: Vec<String>,
    pub skipped: Option<HeadSkip>,
    pub truncated: bool,
    pub text_entries: usize,
    pub visual_entries: usize,
    /// `Some(open)` only under gated append: whether the gate let visual entries in.
    pub visual_gate_open: Option<bool>,
}

/// `SearchResults` has no `PartialEq`, so these outputs compare by fields in tests.
#[derive(Clone, Debug)]
pub struct UnifiedTaskOutput {
    pub question: String,
    /// True when the carrier constraint survived and produced hits.
    pub carrier_applied: bool,
    pub results: SearchResults,
}

#[derive(Clone, Debug)]
pub struct UnifiedOutput {
    pub routing: RoutingStage,
    pub binding: CarrierBinding,
    pub tasks: Vec<UnifiedTaskOutput>,
    pub degradations: Vec<Degradation>,
}

/// Runs routing, the visual vote, and evidence in that order. Every stage stays
/// inside the caller's frozen scope; nothing here widens it.
pub fn run_unified(
    text: &mut dyn TextRecall,
    visual: &mut dyn VisualRecall,
    plan: &UnifiedPlan,
    request: &UnifiedRequest,
) -> SearchResult<UnifiedOutput> {
    let question = request.question.trim().to_string();
    if question.is_empty() {
        return Err(SearchError::EmptyQuery);
    }
    let mut degradations = Vec::new();

    // Routing reads the whole question with no evidence-layer restriction: a
    // carrier narrows evidence, and a section filter must not decide which
    // documents can be routed.
    let mut route_query = request.template.clone();
    route_query.text = question.clone();
    route_query.limit = plan.limits.route_window.max(1);
    route_query.section_filter = None;
    route_query.segment_types.clear();
    let route_results = text.recall(&route_query, plan.limits.route_window.max(1))?;
    let text_hits = ordered_hits(&route_results);
    let text_order = entry_order_from(&text_hits);

    let visual_order = visual_vote(visual, &question, request, plan, &mut degradations)?;
    let (mut routed, visual_gate_open) = match plan.visual_fusion {
        VisualFusionPolicy::Weighted { visual_weight } => (
            fuse_entry_orders(
                &text_order,
                &visual_order,
                plan.text_weight,
                visual_weight,
                plan.rrf_k,
            ),
            None,
        ),
        VisualFusionPolicy::AppendGated { gate } => {
            let gate_open = text_order.is_empty()
                || text_order.len() < gate.min_head_entries
                || head_overlap(&text_hits, &question) <= gate.max_snippet_overlap;
            let combined = if gate_open {
                append_missing(&text_order, &visual_order)
            } else {
                text_order.clone()
            };
            (combined, Some(gate_open))
        }
    };
    // A channel that ignores the frozen scope must not smuggle documents in.
    retain_in_scope(&mut routed, &request.template);

    // Named papers are handed to the head separately. `document_head` counts an
    // entry that is both named and ranked as ranked, so passing it in both lists
    // would let the cap drop a paper the question explicitly named.
    let ranked_refs = routed
        .iter()
        .filter(|entry| !request.mandated_entries.iter().any(|named| named == *entry))
        .map(String::as_str)
        .collect::<Vec<_>>();
    let head = document_head(
        &ranked_refs,
        &request.mandated_entries,
        request.in_scope_documents,
        DocumentHeadConfig {
            head_units: plan.limits.head_units.max(1),
            max_documents: plan.limits.max_documents.max(1),
            max_mandated: usize::MAX,
        },
    );
    let routing = RoutingStage {
        documents: head.documents.clone(),
        skipped: head.skipped,
        truncated: head.truncated,
        text_entries: text_order.len(),
        visual_entries: visual_order.len(),
        visual_gate_open,
    };
    if head.documents.is_empty() {
        push_unique(&mut degradations, Degradation::NoDocuments);
        return Ok(UnifiedOutput {
            routing,
            binding: CarrierBinding::default(),
            tasks: Vec::new(),
            degradations,
        });
    }

    let binding = if plan.bind_carriers {
        parse_binding(&question)
    } else {
        CarrierBinding::default()
    };
    match binding.unbound_reason() {
        Some(UnboundReason::Unnumbered) => {
            push_unique(&mut degradations, Degradation::CarrierUnnumbered)
        }
        Some(UnboundReason::MultipleCarriers) => {
            push_unique(&mut degradations, Degradation::CarrierMultiple)
        }
        None => {}
    }
    let constraint = binding.narrow();

    let scope = head
        .documents
        .iter()
        .map(|entry| EntryId::from_string(entry.clone()))
        .collect::<Vec<_>>();
    let mut tasks = Vec::new();
    for task_question in evidence_questions(request, plan) {
        let mut query = request.template.clone();
        query.text = task_question.clone();
        query.limit = plan.limits.evidence_limit.max(1);
        query.scope.entry_ids = scope.clone();
        let narrowed = constraint
            .as_ref()
            .is_some_and(|constraint| apply_to_query(constraint, &mut query));
        let mut results = text.recall(&query, plan.limits.evidence_window.max(1))?;
        let mut carrier_applied = narrowed;
        if narrowed && results.total_hit_count == 0 {
            // An empty narrowed pool says nothing about relevance, so retry the
            // documents themselves and record that the carrier was dropped.
            push_unique(&mut degradations, Degradation::CarrierEmptyFallback);
            let mut plain = request.template.clone();
            plain.text = task_question.clone();
            plain.limit = plan.limits.evidence_limit.max(1);
            plain.scope.entry_ids = scope.clone();
            results = text.recall(&plain, plan.limits.evidence_window.max(1))?;
            carrier_applied = false;
        }
        tasks.push(UnifiedTaskOutput {
            question: task_question,
            carrier_applied,
            results,
        });
    }

    Ok(UnifiedOutput {
        routing,
        binding,
        tasks,
        degradations,
    })
}

fn visual_vote(
    visual: &mut dyn VisualRecall,
    question: &str,
    request: &UnifiedRequest,
    plan: &UnifiedPlan,
    degradations: &mut Vec<Degradation>,
) -> SearchResult<Vec<String>> {
    let status = visual.status();
    if let Some(code) = status.degradation_code() {
        let degradation = match status {
            VisualChannelStatus::Disabled => Degradation::VisualDisabled,
            VisualChannelStatus::Unavailable(reason) => Degradation::VisualUnavailable(reason),
            VisualChannelStatus::Ready => unreachable!("ready has no degradation code"),
        };
        let _ = code;
        push_unique(degradations, degradation);
        return Ok(Vec::new());
    }
    if request.allowed_entries.is_empty() {
        // Without a frozen allowed set the visual channel has no boundary, and an
        // unbounded page vote would be an unfrozen search.
        push_unique(degradations, Degradation::VisualNoAllowedEntries);
        return Ok(Vec::new());
    }
    if plan.visual_weight <= 0.0 {
        return Ok(Vec::new());
    }
    let scores = visual.recall(
        question,
        &request.allowed_entries,
        plan.limits.route_window.max(1),
    )?;
    let parents = aggregate_parents(&scores);
    Ok(parent_entry_order(&parents, plan.limits.head_units.max(1)))
}

fn entry_order_from(hits: &[crate::SearchHit]) -> Vec<String> {
    let mut entries = Vec::new();
    for hit in hits {
        let entry = hit.entry_id.to_string();
        if entries.iter().any(|seen| seen == &entry) {
            continue;
        }
        entries.push(entry);
    }
    entries
}

/// Token overlap between the question and the best text hit, used by the append gate.
///
/// This is the observable stand-in for the experiment's "low text signal" test: it never
/// reads a label, only the text the pipeline already retrieved.
fn head_overlap(hits: &[crate::SearchHit], question: &str) -> usize {
    let Some(best) = hits.first() else {
        return 0;
    };
    let question_tokens = crate::token::tokenize(question)
        .into_iter()
        .collect::<std::collections::BTreeSet<_>>();
    if question_tokens.is_empty() {
        return 0;
    }
    crate::token::tokenize(&best.snippet)
        .into_iter()
        .filter(|token| question_tokens.contains(token))
        .collect::<std::collections::BTreeSet<_>>()
        .len()
}

/// Keeps the text order intact and appends visual entries it did not already reach.
fn append_missing(text_order: &[String], visual_order: &[String]) -> Vec<String> {
    let mut combined = text_order.to_vec();
    for entry in visual_order {
        if combined.iter().any(|seen| seen == entry) {
            continue;
        }
        combined.push(entry.clone());
    }
    combined
}

fn retain_in_scope(entries: &mut Vec<String>, template: &SearchQuery) {
    if template.scope.entry_ids.is_empty() {
        return;
    }
    entries.retain(|entry| {
        template
            .scope
            .entry_ids
            .iter()
            .any(|allowed| allowed.as_str() == entry)
    });
}

fn evidence_questions(request: &UnifiedRequest, plan: &UnifiedPlan) -> Vec<String> {
    let mut questions = Vec::new();
    for candidate in &request.sub_questions {
        let candidate = candidate.trim();
        if candidate.is_empty()
            || questions.iter().any(|kept: &String| kept == candidate)
            || candidate == request.question.trim()
        {
            continue;
        }
        questions.push(candidate.to_string());
        if questions.len() >= plan.max_sub_questions.max(1) {
            break;
        }
    }
    if questions.is_empty() {
        questions.push(request.question.trim().to_string());
    }
    questions
}

fn push_unique(degradations: &mut Vec<Degradation>, value: Degradation) {
    if !degradations.contains(&value) {
        degradations.push(value);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::result::{SearchDocumentSource, SearchHit, SearchTarget};
    use crate::retrieval_pipeline::results_from_hits;
    use crate::visual_sidecar::VisualScore;
    use neuink_domain::{SegmentType, SegmentUid};

    fn hit(entry: &str, uid: &str, score: f32) -> SearchHit {
        SearchHit {
            entry_id: EntryId::from_string(entry),
            entry_title: entry.to_string(),
            source: SearchDocumentSource::default(),
            target: SearchTarget::Segment {
                entry_id: EntryId::from_string(entry),
                segment_uid: SegmentUid::from_string(uid),
                page_idx: 0,
            },
            title: entry.to_string(),
            snippet: format!("{entry} {uid}"),
            score,
            matched_terms: Vec::new(),
        }
    }

    /// Text channel that answers from a per-entry score table, with optional snippets so
    /// the append gate can be exercised through real token overlap.
    struct ScriptedText {
        ranking: Vec<(String, f32)>,
        snippets: std::collections::BTreeMap<String, String>,
        calls: Vec<String>,
    }

    impl ScriptedText {
        fn new(ranking: &[(&str, f32)]) -> Self {
            Self {
                ranking: ranking
                    .iter()
                    .map(|(entry, score)| ((*entry).to_string(), *score))
                    .collect(),
                snippets: std::collections::BTreeMap::new(),
                calls: Vec::new(),
            }
        }

        fn with_snippets(ranking: &[(&str, f32)], snippets: &[(&str, &str)]) -> Self {
            let mut scripted = Self::new(ranking);
            for (entry, snippet) in snippets {
                scripted
                    .snippets
                    .insert((*entry).to_string(), (*snippet).to_string());
            }
            scripted
        }
    }

    impl TextRecall for ScriptedText {
        fn recall(
            &mut self,
            query: &SearchQuery,
            _window: usize,
        ) -> SearchResult<SearchResults> {
            self.calls.push(query.text.clone());
            let filter = query.section_filter.as_deref();
            let hits = self
                .ranking
                .iter()
                .filter(|(entry, _)| {
                    query.scope.entry_ids.is_empty()
                        || query.scope.entry_ids.iter().any(|id| id.as_str() == entry)
                })
                .filter(|_| filter.is_none())
                .filter(|_| query.segment_types.is_empty())
                .map(|(entry, score)| {
                    let mut hit = hit(entry, "s1", *score);
                    if let Some(snippet) = self.snippets.get(entry) {
                        hit.snippet = snippet.clone();
                    }
                    hit
                })
                .collect::<Vec<_>>();
            Ok(results_from_hits(
                query.text.clone(),
                "scripted".to_string(),
                1,
                hits,
                Vec::new(),
            ))
        }
    }

    struct ScriptedVisual {
        status: VisualChannelStatus,
        scores: Vec<VisualScore>,
    }

    impl VisualRecall for ScriptedVisual {
        fn status(&self) -> VisualChannelStatus {
            self.status
        }

        fn recall(
            &mut self,
            _question: &str,
            _entries: &[String],
            _limit: usize,
        ) -> SearchResult<Vec<VisualScore>> {
            Ok(self.scores.clone())
        }
    }

    fn request(question: &str) -> UnifiedRequest {
        UnifiedRequest {
            question: question.to_string(),
            sub_questions: Vec::new(),
            mandated_entries: Vec::new(),
            allowed_entries: ["a", "b", "c", "d", "e", "f"]
                .iter()
                .map(|entry| (*entry).to_string())
                .collect(),
            in_scope_documents: 6,
            template: SearchQuery::new(question),
        }
    }

    #[test]
    fn routing_reads_the_head_and_ignores_evidence_filters() {
        let mut text = ScriptedText::new(&[("a", 3.0), ("b", 2.0), ("c", 1.0)]);
        let mut visual = NoVisualChannel(VisualChannelStatus::Disabled);
        let mut req = request("which method works?");
        req.template.section_filter = Some("results".to_string());
        req.template.segment_types = vec![SegmentType::Table];
        let output = run_unified(&mut text, &mut visual, &UnifiedPlan::default(), &req).unwrap();
        assert_eq!(output.routing.documents, ["a", "b", "c"]);
        assert_eq!(output.routing.skipped, None);
        assert_eq!(output.tasks.len(), 1);
        // The routing call carried no section or type restriction.
        assert_eq!(text.calls[0], "which method works?");
        assert!(output
            .degradations
            .contains(&Degradation::VisualDisabled));
    }

    #[test]
    fn sub_questions_never_change_the_routed_documents() {
        let mut plain_text = ScriptedText::new(&[("a", 3.0), ("b", 2.0), ("c", 1.0)]);
        let mut visual = NoVisualChannel(VisualChannelStatus::Disabled);
        let plain = run_unified(
            &mut plain_text,
            &mut visual,
            &UnifiedPlan::default(),
            &request("compare methods and datasets"),
        )
        .unwrap();

        let mut split_text = ScriptedText::new(&[("a", 3.0), ("b", 2.0), ("c", 1.0)]);
        let mut split_request = request("compare methods and datasets");
        split_request.sub_questions = vec![
            "which method is used?".to_string(),
            "which datasets are used?".to_string(),
        ];
        let split = run_unified(
            &mut split_text,
            &mut visual,
            &UnifiedPlan::default(),
            &split_request,
        )
        .unwrap();

        assert_eq!(plain.routing.documents, split.routing.documents);
        assert_eq!(split.tasks.len(), 2);
        assert_eq!(split.tasks[0].question, "which method is used?");
    }

    #[test]
    fn a_visual_vote_can_promote_a_document_into_the_head() {
        let mut text = ScriptedText::new(&[("a", 3.0), ("b", 2.0), ("c", 1.0)]);
        let mut visual = ScriptedVisual {
            status: VisualChannelStatus::Ready,
            scores: vec![VisualScore {
                entry_id: "c".to_string(),
                parent_id: "p1".to_string(),
                region: Some(0),
                score: 0.9,
            }],
        };
        let plan = UnifiedPlan {
            visual_fusion: VisualFusionPolicy::Weighted { visual_weight: 1.0 },
            ..UnifiedPlan::default()
        };
        let output = run_unified(&mut text, &mut visual, &plan, &request("chart value")).unwrap();
        // `c` gains a text vote plus the only visual vote, so it leads.
        assert_eq!(output.routing.documents[0], "c");
        assert_eq!(output.routing.documents.len(), 3);
        assert_eq!(output.routing.visual_entries, 1);
        assert!(!output
            .degradations
            .iter()
            .any(|code| code.code().starts_with("visual_")));
    }

    #[test]
    fn an_unavailable_visual_channel_degrades_and_keeps_text_order() {
        let mut text = ScriptedText::new(&[("a", 3.0), ("b", 2.0)]);
        let mut visual = NoVisualChannel(VisualChannelStatus::Unavailable("no index"));
        let output = run_unified(&mut text, &mut visual, &UnifiedPlan::default(), &request("q"))
            .unwrap();
        assert_eq!(output.routing.documents, ["a", "b"]);
        assert!(output
            .degradations
            .contains(&Degradation::VisualUnavailable("no index")));
        assert_eq!(
            Degradation::VisualUnavailable("no index").code(),
            "visual_unavailable"
        );
    }

    #[test]
    fn an_empty_allowed_set_disables_the_visual_channel() {
        let mut text = ScriptedText::new(&[("a", 1.0)]);
        let mut visual = ScriptedVisual {
            status: VisualChannelStatus::Ready,
            scores: vec![VisualScore {
                entry_id: "a".to_string(),
                parent_id: "p".to_string(),
                region: None,
                score: 1.0,
            }],
        };
        let mut req = request("q");
        req.allowed_entries.clear();
        let output = run_unified(&mut text, &mut visual, &UnifiedPlan::default(), &req).unwrap();
        assert_eq!(output.routing.visual_entries, 0);
        assert!(output
            .degradations
            .contains(&Degradation::VisualNoAllowedEntries));
    }

    #[test]
    fn a_named_carrier_narrows_evidence_and_its_empty_result_falls_back() {
        // The scripted channel returns nothing whenever a filter is set, which is
        // exactly the "narrowed pool is empty" case.
        let mut text = ScriptedText::new(&[("a", 2.0), ("b", 1.0)]);
        let mut visual = NoVisualChannel(VisualChannelStatus::Disabled);
        let output = run_unified(
            &mut text,
            &mut visual,
            &UnifiedPlan::default(),
            &request("what does Table 3 report?"),
        )
        .unwrap();
        assert_eq!(output.binding.carriers.len(), 1);
        assert!(output
            .degradations
            .contains(&Degradation::CarrierEmptyFallback));
        assert!(!output.tasks[0].carrier_applied);
        assert!(output.tasks[0].results.total_hit_count > 0);
    }

    #[test]
    fn named_papers_survive_the_document_cap() {
        let mut text = ScriptedText::new(&[("a", 5.0), ("b", 4.0), ("c", 3.0)]);
        let mut visual = NoVisualChannel(VisualChannelStatus::Disabled);
        let mut req = request("q");
        req.mandated_entries = vec!["c".to_string()];
        req.in_scope_documents = 6;
        let plan = UnifiedPlan {
            limits: UnifiedLimits {
                max_documents: 2,
                ..UnifiedLimits::default()
            },
            ..UnifiedPlan::default()
        };
        let output = run_unified(&mut text, &mut visual, &plan, &req).unwrap();
        assert!(output.routing.truncated);
        assert!(output.routing.documents.contains(&"c".to_string()));
        assert_eq!(output.routing.documents.len(), 2);
    }

    #[test]
    fn no_routed_documents_returns_nothing_instead_of_widening() {
        let mut text = ScriptedText::new(&[]);
        let mut visual = NoVisualChannel(VisualChannelStatus::Disabled);
        let output = run_unified(&mut text, &mut visual, &UnifiedPlan::default(), &request("q"))
            .unwrap();
        assert!(output.routing.documents.is_empty());
        assert!(output.tasks.is_empty());
        assert!(output.degradations.contains(&Degradation::NoDocuments));
        // Only the routing call ran; no evidence task opened the whole library.
        assert_eq!(text.calls.len(), 1);
    }

    #[test]
    fn out_of_scope_entries_from_a_channel_are_dropped() {
        let mut text = ScriptedText::new(&[("a", 2.0), ("z", 2.0)]);
        let mut visual = NoVisualChannel(VisualChannelStatus::Disabled);
        let mut req = request("q");
        req.template.scope.entry_ids = vec![EntryId::from_string("a")];
        let output = run_unified(&mut text, &mut visual, &UnifiedPlan::default(), &req).unwrap();
        assert_eq!(output.routing.documents, ["a"]);
    }

    #[test]
    fn an_empty_question_is_rejected() {
        let mut text = ScriptedText::new(&[("a", 1.0)]);
        let mut visual = NoVisualChannel(VisualChannelStatus::Disabled);
        let error = run_unified(&mut text, &mut visual, &UnifiedPlan::default(), &request("  "))
            .unwrap_err();
        assert!(matches!(error, SearchError::EmptyQuery));
    }

    #[test]
    fn unnumbered_carrier_words_are_reported_but_do_not_narrow() {
        let mut text = ScriptedText::new(&[("a", 1.0)]);
        let mut visual = NoVisualChannel(VisualChannelStatus::Disabled);
        let output = run_unified(
            &mut text,
            &mut visual,
            &UnifiedPlan::default(),
            &request("what does the table say about accuracy?"),
        )
        .unwrap();
        assert!(output
            .degradations
            .contains(&Degradation::CarrierUnnumbered));
        assert!(output.tasks[0].results.total_hit_count > 0);
    }

    #[test]
    fn binding_can_be_turned_off() {
        let mut text = ScriptedText::new(&[("a", 1.0)]);
        let mut visual = NoVisualChannel(VisualChannelStatus::Disabled);
        let plan = UnifiedPlan {
            bind_carriers: false,
            ..UnifiedPlan::default()
        };
        let output = run_unified(&mut text, &mut visual, &plan, &request("Table 3")).unwrap();
        assert!(output.binding.carriers.is_empty());
        assert!(output
            .degradations
            .iter()
            .all(|code| !code.code().starts_with("carrier_")));
    }

    #[test]
    fn the_append_gate_keeps_the_text_order_when_the_text_head_is_strong() {
        // Three distinct entries and the best snippet repeats every question token:
        // the gate stays shut and the visual channel cannot move anything.
        let mut text = ScriptedText::with_snippets(
            &[("a", 3.0), ("b", 2.0), ("c", 1.0)],
            &[("a", "chart value axis")],
        );
        let mut visual = ScriptedVisual {
            status: VisualChannelStatus::Ready,
            scores: vec![VisualScore {
                entry_id: "c".to_string(),
                parent_id: "images/c.jpg".to_string(),
                region: None,
                score: 0.9,
            }],
        };
        let plan = UnifiedPlan {
            visual_fusion: VisualFusionPolicy::AppendGated {
                gate: AppendGate {
                    min_head_entries: 3,
                    max_snippet_overlap: 2,
                },
            },
            ..UnifiedPlan::default()
        };
        let output = run_unified(&mut text, &mut visual, &plan, &request("chart value axis"))
            .expect("run");
        assert_eq!(output.routing.visual_gate_open, Some(false));
        assert_eq!(output.routing.documents, ["a", "b", "c"]);
        // The channel still ran; it simply was not allowed to append.
        assert_eq!(output.routing.visual_entries, 1);
    }

    #[test]
    fn the_append_gate_opens_on_a_thin_head_and_appends_after_the_text_order() {
        let mut text = ScriptedText::new(&[("a", 2.0)]);
        let mut visual = ScriptedVisual {
            status: VisualChannelStatus::Ready,
            scores: vec![
                VisualScore {
                    entry_id: "c".to_string(),
                    parent_id: "images/c.jpg".to_string(),
                    region: None,
                    score: 0.9,
                },
                VisualScore {
                    entry_id: "a".to_string(),
                    parent_id: "images/a.jpg".to_string(),
                    region: None,
                    score: 0.8,
                },
            ],
        };
        let plan = UnifiedPlan {
            visual_fusion: VisualFusionPolicy::AppendGated {
                gate: AppendGate {
                    min_head_entries: 3,
                    max_snippet_overlap: 2,
                },
            },
            ..UnifiedPlan::default()
        };
        let output = run_unified(&mut text, &mut visual, &plan, &request("chart")).expect("run");
        assert_eq!(output.routing.visual_gate_open, Some(true));
        // Text stays first; only unseen visual entries are appended, once.
        assert_eq!(output.routing.documents, ["a", "c"]);
    }

    #[test]
    fn the_append_gate_opens_when_the_best_hit_barely_overlaps_the_question() {
        let mut text = ScriptedText::with_snippets(
            &[("a", 3.0), ("b", 2.0), ("c", 1.0)],
            &[("a", "unrelated words")],
        );
        let mut visual = ScriptedVisual {
            status: VisualChannelStatus::Ready,
            scores: vec![VisualScore {
                entry_id: "d".to_string(),
                parent_id: "images/d.jpg".to_string(),
                region: None,
                score: 0.7,
            }],
        };
        let plan = UnifiedPlan {
            visual_fusion: VisualFusionPolicy::AppendGated {
                gate: AppendGate {
                    min_head_entries: 3,
                    max_snippet_overlap: 2,
                },
            },
            ..UnifiedPlan::default()
        };
        let output = run_unified(&mut text, &mut visual, &plan, &request("chart value axis"))
            .expect("run");
        assert_eq!(output.routing.visual_gate_open, Some(true));
        assert_eq!(output.routing.documents, ["a", "b", "c", "d"]);
    }

    #[test]
    fn weighted_fusion_reports_no_gate_and_still_reorders() {
        let mut text = ScriptedText::new(&[("a", 3.0), ("b", 2.0)]);
        let mut visual = ScriptedVisual {
            status: VisualChannelStatus::Ready,
            scores: vec![VisualScore {
                entry_id: "b".to_string(),
                parent_id: "images/b.jpg".to_string(),
                region: None,
                score: 0.95,
            }],
        };
        let plan = UnifiedPlan {
            visual_fusion: VisualFusionPolicy::Weighted { visual_weight: 5.0 },
            ..UnifiedPlan::default()
        };
        let output = run_unified(&mut text, &mut visual, &plan, &request("chart"))
            .expect("run");
        assert_eq!(output.routing.visual_gate_open, None);
        assert_eq!(output.routing.documents[0], "b");
    }
}
