//! First-stage multi-vector pool. A missing head or a failed encode keeps the
//! single-vector order and records a fixed reason. Search itself does not fail.

use std::collections::HashMap;
use std::path::Path;

use neuink_config::{MultivectorPoolMode, MultivectorPoolSettings};
use neuink_search::{
    cache_path, format_structured_hit, hit_identity, read_cache, reorder_multivector_hits,
    write_cache, EmbeddingProvider, EntryMultivectorCache, MultivectorDocument,
    MultivectorSupport, SearchHit, SearchResults,
};

pub(super) const POOL_SINGLE: &str = "single_vector";
pub(super) const REASON_COLBERT_MISSING: &str = "colbert_head_missing";
pub(super) const REASON_SPARSE_MISSING: &str = "sparse_head_missing";
pub(super) const REASON_PROVIDER_UNSUPPORTED: &str = "provider_unsupported";
pub(super) const REASON_PROVIDER_ERROR: &str = "provider_error";

const MULTIVECTOR_CACHE_NAMESPACE: &str = "mv-v1-structured";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct PoolMark {
    pub used: &'static str,
    pub reason: Option<&'static str>,
}

pub(super) fn pool_mark(settings: &MultivectorPoolSettings, support: MultivectorSupport) -> Option<PoolMark> {
    if !settings.enabled {
        return None;
    }
    let hybrid = settings.mode == MultivectorPoolMode::BgeM3Hybrid;
    let status = match support {
        MultivectorSupport::Unsupported => {
            return Some(PoolMark {
                used: POOL_SINGLE,
                reason: Some(REASON_PROVIDER_UNSUPPORTED),
            });
        }
        MultivectorSupport::Local(status) => status,
    };
    if let Some(reason) = status.missing_reason(hybrid) {
        let reason = if reason == "sparse_head_missing" {
            REASON_SPARSE_MISSING
        } else {
            REASON_COLBERT_MISSING
        };
        return Some(PoolMark {
            used: POOL_SINGLE,
            reason: Some(reason),
        });
    }
    Some(PoolMark {
        used: settings.mode.as_str(),
        reason: None,
    })
}

pub(super) fn rescore_results_with_cache(
    results: SearchResults,
    settings: &MultivectorPoolSettings,
    provider: &dyn EmbeddingProvider,
    cache_root: Option<&Path>,
) -> (SearchResults, Option<PoolMark>) {
    let Some(mark) = pool_mark(settings, provider.multivector_support()) else {
        return (results, None);
    };
    if mark.reason.is_some() {
        return (results, Some(mark));
    }
    let query = results.query.clone();
    let mode = results.mode.clone();
    let generation = results.index_generation;
    let warnings = results.warnings.clone();
    let hits = neuink_search::ordered_hits(&results);
    let (ordered, mark) = rescore_hits(&hits, &query, settings, provider, cache_root, generation)
        .unwrap_or((
            hits,
            PoolMark {
                used: POOL_SINGLE,
                reason: Some(REASON_PROVIDER_ERROR),
            },
        ));
    (
        neuink_search::results_from_hits(query, mode, generation, ordered, warnings),
        Some(mark),
    )
}

fn entry_generation_fingerprint(generation: u64) -> String {
    format!("gen:{generation}")
}

fn segment_cache_key(hit: &SearchHit, structured_text: &str) -> String {
    let hash = blake3::hash(structured_text.as_bytes()).to_hex();
    format!("{}#{}", hit_identity(hit), &hash[..16])
}

fn provider_cache_head_tag(provider: &dyn EmbeddingProvider) -> String {
    provider
        .multivector_head_identity()
        .unwrap_or_else(|| "local-default".to_string())
}

fn rescore_hits(
    hits: &[SearchHit],
    query: &str,
    settings: &MultivectorPoolSettings,
    provider: &dyn EmbeddingProvider,
    cache_root: Option<&Path>,
    generation: u64,
) -> Result<(Vec<SearchHit>, PoolMark), ()> {
    if hits.is_empty() {
        return Ok((
            hits.to_vec(),
            PoolMark {
                used: settings.mode.as_str(),
                reason: None,
            },
        ));
    }
    let selected = neuink_search::rescore_selection(
        hits.len(),
        &(0..hits.len()).collect::<Vec<_>>(),
        settings.max_full_scope_segments,
        settings.rescore_window,
    );

    let head_tag = provider_cache_head_tag(provider);
    let gen_fp = entry_generation_fingerprint(generation);
    let mut cached_by_entry: HashMap<String, HashMap<String, MultivectorDocument>> = HashMap::new();

    if let Some(root) = cache_root {
        let mut entry_ids = Vec::new();
        for index in &selected {
            let entry_id = hits[*index].entry_id.to_string();
            if !entry_ids.contains(&entry_id) {
                entry_ids.push(entry_id);
            }
        }
        for entry_id in entry_ids {
            let path = cache_path(root, MULTIVECTOR_CACHE_NAMESPACE, &entry_id);
            let mut map = HashMap::new();
            if let Ok(cache) = read_cache(&path, &gen_fp, &head_tag) {
                for document in cache.documents {
                    map.insert(document.identity.clone(), document);
                }
            }
            cached_by_entry.insert(entry_id, map);
        }
    }

    let structured_texts = selected
        .iter()
        .map(|index| format_structured_hit(&hits[*index]))
        .collect::<Vec<_>>();
    let cache_keys = selected
        .iter()
        .zip(structured_texts.iter())
        .map(|(index, text)| segment_cache_key(&hits[*index], text))
        .collect::<Vec<_>>();

    let mut texts = vec![query.to_string()];
    let mut miss_positions: Vec<(usize, String, String)> = Vec::new();
    for (offset, index) in selected.iter().enumerate() {
        let entry_id = hits[*index].entry_id.to_string();
        let key = &cache_keys[offset];
        let hit_cache = cached_by_entry
            .get(&entry_id)
            .is_some_and(|map| map.contains_key(key));
        if !hit_cache {
            texts.push(structured_texts[offset].clone());
            miss_positions.push((offset, entry_id, key.clone()));
        }
    }

    let encoded = match provider.encode_multivector_documents(&texts) {
        Ok(encoded) => encoded,
        Err(error) if error == "provider_unsupported" => {
            return Ok((
                hits.to_vec(),
                PoolMark {
                    used: POOL_SINGLE,
                    reason: Some(REASON_PROVIDER_UNSUPPORTED),
                },
            ));
        }
        Err(_) => return Err(()),
    };
    if encoded.len() != texts.len() {
        return Err(());
    }
    let query_vector = encoded[0].clone();
    let mut dirty_entries = Vec::new();
    for (encoded_offset, (_, entry_id, key)) in miss_positions.into_iter().enumerate() {
        let mut document = encoded[encoded_offset + 1].clone();
        document.identity = key.clone();
        cached_by_entry
            .entry(entry_id.clone())
            .or_default()
            .insert(key, document);
        if !dirty_entries.contains(&entry_id) {
            dirty_entries.push(entry_id);
        }
    }

    let mut documents = Vec::with_capacity(selected.len());
    let mut chosen = Vec::with_capacity(selected.len());
    for (offset, index) in selected.iter().enumerate() {
        let hit = &hits[*index];
        let entry_id = hit.entry_id.to_string();
        let key = &cache_keys[offset];
        let mut document = cached_by_entry
            .get(&entry_id)
            .and_then(|map| map.get(key))
            .cloned()
            .ok_or(())?;
        document.identity = hit_identity(hit);
        documents.push(document);
        chosen.push(hit.clone());
    }

    if let Some(root) = cache_root {
        for entry_id in dirty_entries {
            if let Some(map) = cached_by_entry.get(&entry_id) {
                let mut docs = map.values().cloned().collect::<Vec<_>>();
                docs.sort_by(|left, right| left.identity.cmp(&right.identity));
                let path = cache_path(root, MULTIVECTOR_CACHE_NAMESPACE, &entry_id);
                let cache = EntryMultivectorCache {
                    entry_id,
                    entry_fingerprint: gen_fp.clone(),
                    head_sha256: head_tag.clone(),
                    documents: docs,
                };
                // Fail-closed: disk cache write failures never fail search.
                let _ = write_cache(&path, &cache);
            }
        }
    }

    let mut ordered = reorder_multivector_hits(
        &chosen,
        &query_vector,
        &documents,
        settings.mode == MultivectorPoolMode::BgeM3Hybrid,
    );
    for index in 0..hits.len() {
        if !selected.contains(&index) {
            ordered.push(hits[index].clone());
        }
    }
    neuink_search::stamp_rank_scores(&mut ordered);
    Ok((
        ordered,
        PoolMark {
            used: settings.mode.as_str(),
            reason: None,
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use neuink_domain::{EntryId, SegmentType, SegmentUid};
    use neuink_search::{
        EmbeddingInput, EmbeddingProviderStatus, EmbeddingVector, MultivectorHeadStatus,
        SearchDocumentSource, SearchResult, SearchTarget,
    };

    struct CountingMultivectorProvider {
        calls: AtomicUsize,
        docs_encoded: AtomicUsize,
    }

    impl EmbeddingProvider for CountingMultivectorProvider {
        fn status(&self) -> EmbeddingProviderStatus {
            EmbeddingProviderStatus::default()
        }

        fn cache_identity(&self) -> Option<String> {
            Some("test-head-sha".to_string())
        }

        fn embed(&self, _inputs: &[EmbeddingInput]) -> SearchResult<Vec<EmbeddingVector>> {
            Ok(Vec::new())
        }

        fn multivector_support(&self) -> MultivectorSupport {
            MultivectorSupport::Local(MultivectorHeadStatus {
                colbert_present: true,
                sparse_present: true,
            })
        }

        fn encode_multivector_documents(&self, texts: &[String]) -> Result<Vec<MultivectorDocument>, String> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.docs_encoded
                .fetch_add(texts.len().saturating_sub(1), Ordering::SeqCst);
            Ok(texts
                .iter()
                .map(|text| {
                    let score = if text.contains("Section: Results") { 1.0 } else { 0.2 };
                    MultivectorDocument {
                        identity: String::new(),
                        dense: vec![score],
                        lexical: vec![],
                        colbert: vec![vec![score, 0.0]],
                    }
                })
                .collect())
        }
    }

    fn hit(uid: &str, section: &str, snippet: &str) -> SearchHit {
        SearchHit {
            entry_id: EntryId::from_string("entry-1"),
            entry_title: "Paper".into(),
            source: SearchDocumentSource {
                section_path: Some(section.into()),
                segment_type: Some(SegmentType::Paragraph),
                ..SearchDocumentSource::default()
            },
            target: SearchTarget::Segment {
                entry_id: EntryId::from_string("entry-1"),
                segment_uid: SegmentUid::from_string(uid),
                page_idx: 0,
            },
            title: "Paper".into(),
            snippet: snippet.into(),
            score: 1.0,
            matched_terms: Vec::new(),
            surrounding_context: None,
        }
    }

    #[test]
    fn a_missing_colbert_head_falls_closed_without_scoring() {
        let mut settings = MultivectorPoolSettings::default();
        settings.enabled = true;
        let mark = pool_mark(
            &settings,
            MultivectorSupport::Local(MultivectorHeadStatus {
                colbert_present: false,
                sparse_present: false,
            }),
        )
        .expect("enabled");
        assert_eq!(mark.used, POOL_SINGLE);
        assert_eq!(mark.reason, Some(REASON_COLBERT_MISSING));
    }

    #[test]
    fn an_unsupported_provider_is_named() {
        let mut settings = MultivectorPoolSettings::default();
        settings.enabled = true;
        settings.mode = MultivectorPoolMode::Colbert;
        let mark = pool_mark(&settings, MultivectorSupport::Unsupported).expect("enabled");
        assert_eq!(mark.reason, Some(REASON_PROVIDER_UNSUPPORTED));
        assert!(pool_mark(&MultivectorPoolSettings::default(), MultivectorSupport::Unsupported).is_none());
    }

    #[test]
    fn repeated_single_paper_rescore_reuses_disk_cache_and_encodes_structured_text() {
        let cache_dir = std::env::temp_dir().join(format!(
            "neuink-mv-stage-test-{}",
            std::process::id()
        ));
        std::fs::remove_dir_all(&cache_dir).ok();
        let provider = CountingMultivectorProvider {
            calls: AtomicUsize::new(0),
            docs_encoded: AtomicUsize::new(0),
        };
        let mut settings = MultivectorPoolSettings::default();
        settings.enabled = true;
        let results = neuink_search::results_from_hits(
            "what are the results".into(),
            "hybrid".into(),
            1,
            vec![
                hit("s1", "Abstract", "Overview"),
                hit("s2", "Results", "Accuracy is 91.2%"),
            ],
            Vec::new(),
        );
        let (first, mark1) =
            rescore_results_with_cache(results.clone(), &settings, &provider, Some(&cache_dir));
        assert_eq!(mark1.expect("mark").reason, None);
        assert_eq!(neuink_search::ordered_hits(&first)[0].snippet, "Accuracy is 91.2%");
        assert_eq!(provider.docs_encoded.load(Ordering::SeqCst), 2);

        let (second, mark2) =
            rescore_results_with_cache(results, &settings, &provider, Some(&cache_dir));
        assert_eq!(mark2.expect("mark").reason, None);
        assert_eq!(neuink_search::ordered_hits(&second)[0].snippet, "Accuracy is 91.2%");
        // Second call encodes only the query (0 document re-encodes).
        assert_eq!(provider.docs_encoded.load(Ordering::SeqCst), 2);

        // Third call with an overlapping subset [s2, s3] reuses cached s2 and encodes only s3!
        let partial = neuink_search::results_from_hits(
            "another query".into(),
            "hybrid".into(),
            1,
            vec![
                hit("s2", "Results", "Accuracy is 91.2%"),
                hit("s3", "Method", "We use a transformer."),
            ],
            Vec::new(),
        );
        let (_, mark3) = rescore_results_with_cache(partial, &settings, &provider, Some(&cache_dir));
        assert_eq!(mark3.expect("mark").reason, None);
        assert_eq!(provider.docs_encoded.load(Ordering::SeqCst), 3);

        // Fourth call returning to [s1, s3] hits cache for BOTH (s1 was preserved across merge!).
        let merged_check = neuink_search::results_from_hits(
            "third query".into(),
            "hybrid".into(),
            1,
            vec![
                hit("s1", "Abstract", "Overview"),
                hit("s3", "Method", "We use a transformer."),
            ],
            Vec::new(),
        );
        let (_, mark4) = rescore_results_with_cache(merged_check, &settings, &provider, Some(&cache_dir));
        assert_eq!(mark4.expect("mark").reason, None);
        assert_eq!(provider.docs_encoded.load(Ordering::SeqCst), 3);
        std::fs::remove_dir_all(&cache_dir).ok();
    }
}
