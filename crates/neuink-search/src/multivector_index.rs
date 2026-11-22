//! Rebuildable per-entry multi-vector cache and the pool's ranking rule.
//!
//! A scope that fits in `max_full_scope_segments` is scored in full. A wider scope
//! rescores only the single-vector head. Equal scores break by `hit_identity` ascending.

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::colbert_head::{hybrid_score, lexical_dot, mean_maxsim};
use crate::retrieval_pipeline::hit_identity;
use crate::SearchHit;

const CACHE_MAGIC: &[u8; 8] = b"NEMV0001";

#[derive(Clone, Debug)]
pub struct MultivectorDocument {
    pub identity: String,
    pub dense: Vec<f32>,
    pub lexical: Vec<(u32, f32)>,
    pub colbert: Vec<Vec<f32>>,
}

#[derive(Clone, Debug)]
pub struct EntryMultivectorCache {
    pub entry_id: String,
    pub entry_fingerprint: String,
    pub head_sha256: String,
    pub documents: Vec<MultivectorDocument>,
}

pub fn cache_path(cache_dir: &Path, namespace: &str, entry_id: &str) -> PathBuf {
    cache_dir.join("colbert").join(namespace).join(format!("{entry_id}.mv1"))
}

pub fn write_cache(path: &Path, cache: &EntryMultivectorCache) -> Result<(), String> {
    let bytes = encode_cache(cache)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let temporary = path.with_extension("mv1.tmp");
    {
        let mut file = File::create(&temporary).map_err(|error| error.to_string())?;
        file.write_all(&bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
    }
    fs::rename(&temporary, path).map_err(|error| error.to_string())
}

pub fn read_cache(path: &Path, entry_fingerprint: &str, head_sha256: &str) -> Result<EntryMultivectorCache, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    let cache = decode_cache(&bytes)?;
    if cache.entry_fingerprint != entry_fingerprint || cache.head_sha256 != head_sha256 {
        return Err("multi-vector cache does not match the entry or the projection head".to_string());
    }
    Ok(cache)
}

/// Indexes to score. A small scope is exact. A wide scope keeps the single-vector head.
pub fn rescore_selection(scope_len: usize, single_vector_order: &[usize], max_full_scope_segments: usize, rescore_window: usize) -> Vec<usize> {
    if scope_len <= max_full_scope_segments {
        return (0..scope_len).collect();
    }
    single_vector_order.iter().copied().take(rescore_window).collect()
}

pub fn rank_documents(query: &MultivectorDocument, documents: &[MultivectorDocument], hybrid: bool) -> Vec<usize> {
    let mut scored = documents
        .iter()
        .enumerate()
        .map(|(index, document)| {
            let dense = dot(&query.dense, &document.dense);
            let lexical = lexical_dot(&query.lexical, &document.lexical);
            let colbert = mean_maxsim(&query.colbert, &document.colbert);
            let score = if hybrid {
                hybrid_score(dense, lexical, colbert)
            } else {
                colbert
            };
            (index, score, document.identity.clone())
        })
        .collect::<Vec<_>>();
    scored.sort_by(|left, right| {
        right
            .1
            .partial_cmp(&left.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.2.cmp(&right.2))
    });
    scored.into_iter().map(|(index, _, _)| index).collect()
}

/// Reorders `hits` by the multi-vector score of the selected prefix. The tail stays put.
pub fn reorder_hits(hits: &[SearchHit], query: &MultivectorDocument, documents: &[MultivectorDocument], hybrid: bool) -> Vec<SearchHit> {
    if documents.len() != hits.len() || hits.is_empty() {
        return hits.to_vec();
    }
    let mut aligned = documents.to_vec();
    for (document, hit) in aligned.iter_mut().zip(hits) {
        document.identity = hit_identity(hit);
    }
    let order = rank_documents(query, &aligned, hybrid);
    let mut ordered = order.into_iter().map(|index| hits[index].clone()).collect::<Vec<_>>();
    crate::stamp_rank_scores(&mut ordered);
    ordered
}

fn encode_cache(cache: &EntryMultivectorCache) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(CACHE_MAGIC);
    write_string(&mut bytes, &cache.entry_id);
    write_string(&mut bytes, &cache.entry_fingerprint);
    write_string(&mut bytes, &cache.head_sha256);
    bytes.extend_from_slice(&(cache.documents.len() as u32).to_le_bytes());
    for document in &cache.documents {
        write_string(&mut bytes, &document.identity);
        write_f32s(&mut bytes, &document.dense);
        bytes.extend_from_slice(&(document.lexical.len() as u32).to_le_bytes());
        for (token, weight) in &document.lexical {
            bytes.extend_from_slice(&token.to_le_bytes());
            bytes.extend_from_slice(&weight.to_le_bytes());
        }
        bytes.extend_from_slice(&(document.colbert.len() as u32).to_le_bytes());
        for row in &document.colbert {
            write_f32s(&mut bytes, row);
        }
    }
    Ok(bytes)
}

fn decode_cache(bytes: &[u8]) -> Result<EntryMultivectorCache, String> {
    if bytes.len() < 8 || &bytes[..8] != CACHE_MAGIC {
        return Err("multi-vector cache header is not valid".to_string());
    }
    let mut cursor = 8;
    let entry_id = read_string(bytes, &mut cursor)?;
    let entry_fingerprint = read_string(bytes, &mut cursor)?;
    let head_sha256 = read_string(bytes, &mut cursor)?;
    let count = read_u32(bytes, &mut cursor)? as usize;
    let mut documents = Vec::with_capacity(count);
    for _ in 0..count {
        let identity = read_string(bytes, &mut cursor)?;
        let dense = read_f32s(bytes, &mut cursor)?;
        let lexical_len = read_u32(bytes, &mut cursor)? as usize;
        let mut lexical = Vec::with_capacity(lexical_len);
        for _ in 0..lexical_len {
            let token = read_u32(bytes, &mut cursor)?;
            let weight = read_f32(bytes, &mut cursor)?;
            lexical.push((token, weight));
        }
        let rows = read_u32(bytes, &mut cursor)? as usize;
        let mut colbert = Vec::with_capacity(rows);
        for _ in 0..rows {
            colbert.push(read_f32s(bytes, &mut cursor)?);
        }
        documents.push(MultivectorDocument {
            identity,
            dense,
            lexical,
            colbert,
        });
    }
    if cursor != bytes.len() {
        return Err("multi-vector cache has trailing bytes".to_string());
    }
    Ok(EntryMultivectorCache {
        entry_id,
        entry_fingerprint,
        head_sha256,
        documents,
    })
}

fn write_string(bytes: &mut Vec<u8>, value: &str) {
    bytes.extend_from_slice(&(value.len() as u32).to_le_bytes());
    bytes.extend_from_slice(value.as_bytes());
}

fn write_f32s(bytes: &mut Vec<u8>, values: &[f32]) {
    bytes.extend_from_slice(&(values.len() as u32).to_le_bytes());
    for value in values {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
}

fn read_u32(bytes: &[u8], cursor: &mut usize) -> Result<u32, String> {
    let end = cursor.checked_add(4).ok_or("cache truncated")?;
    if end > bytes.len() {
        return Err("cache truncated".to_string());
    }
    let value = u32::from_le_bytes(bytes[*cursor..end].try_into().unwrap());
    *cursor = end;
    Ok(value)
}

fn read_f32(bytes: &[u8], cursor: &mut usize) -> Result<f32, String> {
    let end = cursor.checked_add(4).ok_or("cache truncated")?;
    if end > bytes.len() {
        return Err("cache truncated".to_string());
    }
    let value = f32::from_le_bytes(bytes[*cursor..end].try_into().unwrap());
    *cursor = end;
    Ok(value)
}

fn read_string(bytes: &[u8], cursor: &mut usize) -> Result<String, String> {
    let length = read_u32(bytes, cursor)? as usize;
    let end = cursor.checked_add(length).ok_or("cache truncated")?;
    if end > bytes.len() {
        return Err("cache truncated".to_string());
    }
    let value = std::str::from_utf8(&bytes[*cursor..end])
        .map_err(|_| "cache string is not utf-8".to_string())?
        .to_string();
    *cursor = end;
    Ok(value)
}

fn read_f32s(bytes: &[u8], cursor: &mut usize) -> Result<Vec<f32>, String> {
    let length = read_u32(bytes, cursor)? as usize;
    let mut values = Vec::with_capacity(length);
    for _ in 0..length {
        values.push(read_f32(bytes, cursor)?);
    }
    Ok(values)
}

fn dot(left: &[f32], right: &[f32]) -> f32 {
    if left.len() != right.len() {
        return 0.0;
    }
    left.iter().zip(right).map(|(left, right)| left * right).sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn document(identity: &str, dense: f32) -> MultivectorDocument {
        MultivectorDocument {
            identity: identity.into(),
            dense: vec![dense],
            lexical: vec![],
            colbert: vec![vec![dense, 0.0]],
        }
    }

    #[test]
    fn equal_scores_break_by_identity_and_a_wide_scope_keeps_the_head() {
        let query = document("q", 1.0);
        let documents = vec![document("b", 1.0), document("a", 1.0)];
        assert_eq!(rank_documents(&query, &documents, false), vec![1, 0]);
        assert_eq!(rescore_selection(50, &[2, 0, 1], 600, 100), (0..50).collect::<Vec<_>>());
        assert_eq!(rescore_selection(800, &[4, 1, 2, 3], 600, 2), vec![4, 1]);
    }

    #[test]
    fn a_damaged_cache_does_not_load_and_a_fresh_write_round_trips() {
        let dir = std::env::temp_dir().join(format!("neuink-mv-cache-{}", std::process::id()));
        let path = cache_path(&dir, "ns", "entry");
        let cache = EntryMultivectorCache {
            entry_id: "entry".into(),
            entry_fingerprint: "finger".into(),
            head_sha256: "head".into(),
            documents: vec![document("a", 0.5)],
        };
        write_cache(&path, &cache).expect("write");
        let loaded = read_cache(&path, "finger", "head").expect("read");
        assert_eq!(loaded.documents[0].identity, "a");
        assert!(read_cache(&path, "other", "head").is_err());
        std::fs::write(&path, b"NEMV0001broken").expect("damage");
        assert!(read_cache(&path, "finger", "head").is_err());
        write_cache(&path, &cache).expect("rebuild");
        assert!(read_cache(&path, "finger", "head").is_ok());
        std::fs::remove_dir_all(&dir).ok();
    }
}
