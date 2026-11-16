use std::{
    cmp::Ordering,
    collections::{HashMap, HashSet},
    hash::Hash,
};

pub const DEFAULT_RRF_K: f32 = 60.0;

pub fn reciprocal_rank_fusion<T>(ranked_lists: &[Vec<T>], k: f32) -> Vec<(T, f32)>
where
    T: Clone + Eq + Hash,
{
    let weights = vec![1.0; ranked_lists.len()];
    weighted_reciprocal_rank_fusion(ranked_lists, &weights, k)
}

pub fn weighted_reciprocal_rank_fusion<T>(
    ranked_lists: &[Vec<T>],
    weights: &[f32],
    k: f32,
) -> Vec<(T, f32)>
where
    T: Clone + Eq + Hash,
{
    let mut scores = HashMap::<T, f32>::new();

    for (list_index, ranked_list) in ranked_lists.iter().enumerate() {
        let weight = weights.get(list_index).copied().unwrap_or(1.0);
        if weight <= 0.0 {
            continue;
        }
        let mut seen = HashSet::<T>::new();
        for (rank, item) in ranked_list.iter().enumerate() {
            if !seen.insert(item.clone()) {
                continue;
            }
            let rank = rank as f32 + 1.0;
            *scores.entry(item.clone()).or_insert(0.0) += weight / (k + rank);
        }
    }

    let mut fused = scores.into_iter().collect::<Vec<_>>();
    fused.sort_by(|left, right| right.1.partial_cmp(&left.1).unwrap_or(Ordering::Equal));
    fused
}

pub fn adaptive_hybrid_weights(
    query: &str,
    keyword_top_matched_terms: Option<&[String]>,
) -> (f32, f32) {
    if is_pure_cjk_query(query) && keyword_top_matched_terms.is_none() {
        return (0.0, 1.0);
    }

    let latin_terms = crate::token::tokenize(query)
        .into_iter()
        .filter(|term| {
            term.chars()
                .any(|character| character.is_ascii_alphabetic())
        })
        .collect::<HashSet<_>>();
    if !latin_terms.is_empty() {
        let matched = keyword_top_matched_terms
            .unwrap_or_default()
            .iter()
            .map(|term| term.to_ascii_lowercase())
            .collect::<HashSet<_>>();
        let coverage = latin_terms
            .iter()
            .filter(|term| matched.contains(*term))
            .count() as f32
            / latin_terms.len() as f32;
        if coverage >= 0.8 {
            return (1.35, 0.65);
        }
    }

    (1.0, 1.0)
}

fn is_pure_cjk_query(query: &str) -> bool {
    let mut has_cjk = false;
    let mut has_content = false;
    for character in query.chars() {
        if character.is_whitespace() || character.is_ascii_punctuation() {
            continue;
        }
        has_content = true;
        if is_cjk(character) {
            has_cjk = true;
        } else {
            return false;
        }
    }
    has_content && has_cjk
}

fn is_cjk(character: char) -> bool {
    matches!(
        character as u32,
        0x3400..=0x4DBF
            | 0x4E00..=0x9FFF
            | 0xF900..=0xFAFF
            | 0x20000..=0x2A6DF
            | 0x2A700..=0x2B73F
            | 0x2B740..=0x2B81F
            | 0x2B820..=0x2CEAF
            | 0x3040..=0x309F
            | 0x30A0..=0x30FF
            | 0xAC00..=0xD7AF
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fuses_ranked_lists_by_reciprocal_rank() {
        let fused = reciprocal_rank_fusion(
            &[
                vec!["a".to_string(), "b".to_string(), "c".to_string()],
                vec!["b".to_string(), "d".to_string(), "a".to_string()],
            ],
            DEFAULT_RRF_K,
        );

        assert_eq!(fused[0].0, "b");
        assert!(fused.iter().any(|(item, _score)| item == "d"));
    }

    #[test]
    fn weighted_fusion_can_disable_a_candidate_list() {
        let fused = weighted_reciprocal_rank_fusion(
            &[vec!["keyword".to_string()], vec!["semantic".to_string()]],
            &[0.0, 1.0],
            DEFAULT_RRF_K,
        );
        assert_eq!(fused, vec![("semantic".to_string(), 1.0 / 61.0)]);
    }

    #[test]
    fn adaptive_weights_follow_deterministic_query_rules() {
        assert_eq!(adaptive_hybrid_weights("中文检索", None), (0.0, 1.0));
        assert_eq!(
            adaptive_hybrid_weights(
                "TREC COVID",
                Some(&["trec".to_string(), "covid".to_string()]),
            ),
            (1.35, 0.65)
        );
        assert_eq!(adaptive_hybrid_weights("TREC COVID", None), (1.0, 1.0));
    }
}
