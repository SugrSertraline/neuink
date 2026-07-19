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
    let mut scores = HashMap::<T, f32>::new();

    for ranked_list in ranked_lists {
        let mut seen = HashSet::<T>::new();
        for (rank, item) in ranked_list.iter().enumerate() {
            if !seen.insert(item.clone()) {
                continue;
            }
            let rank = rank as f32 + 1.0;
            *scores.entry(item.clone()).or_insert(0.0) += 1.0 / (k + rank);
        }
    }

    let mut fused = scores.into_iter().collect::<Vec<_>>();
    fused.sort_by(|left, right| right.1.partial_cmp(&left.1).unwrap_or(Ordering::Equal));
    fused
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
}
