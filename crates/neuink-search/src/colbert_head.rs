//! BGE-M3 ColBERT and sparse projection heads, loaded from a sidecar binary.
//!
//! The file is a header plus little-endian `f32` weights. Inspection reads only the
//! header, so a settings screen can say the head is missing without mapping the weights.

use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

pub const COLBERT_MAGIC: &[u8; 8] = b"NMCB0001";
pub const SPARSE_MAGIC: &[u8; 8] = b"NMSP0001";
pub const COLBERT_FILE: &str = "colbert_linear.bin";
pub const SPARSE_FILE: &str = "sparse_linear.bin";
/// XLM-R specials used by the frozen BGE-M3 lexical weights: CLS, PAD, EOS, UNK.
pub const SPECIAL_TOKEN_IDS: [u32; 4] = [0, 1, 2, 3];
pub const HYBRID_WEIGHTS: [f32; 3] = [0.4, 0.2, 0.4];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MultivectorSupport {
    Unsupported,
    Local(MultivectorHeadStatus),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MultivectorHeadStatus {
    pub colbert_present: bool,
    pub sparse_present: bool,
}

impl MultivectorHeadStatus {
    pub fn missing_reason(&self, hybrid: bool) -> Option<&'static str> {
        if !self.colbert_present {
            return Some("colbert_head_missing");
        }
        if hybrid && !self.sparse_present {
            return Some("sparse_head_missing");
        }
        None
    }
}

#[derive(Clone, Debug)]
pub struct LinearHead {
    pub in_dim: usize,
    pub out_dim: usize,
    pub weight: Vec<f32>,
    pub bias: Vec<f32>,
}

pub fn inspect_multivector_heads(dir: &Path) -> MultivectorHeadStatus {
    MultivectorHeadStatus {
        colbert_present: header_matches(&dir.join(COLBERT_FILE), COLBERT_MAGIC),
        sparse_present: header_matches(&dir.join(SPARSE_FILE), SPARSE_MAGIC),
    }
}

pub fn load_colbert(dir: &Path) -> Result<LinearHead, String> {
    load_head(&dir.join(COLBERT_FILE), COLBERT_MAGIC)
}

pub fn load_sparse(dir: &Path) -> Result<LinearHead, String> {
    load_head(&dir.join(SPARSE_FILE), SPARSE_MAGIC)
}

pub fn write_head(path: &Path, magic: &[u8; 8], head: &LinearHead) -> Result<(), String> {
    if head.weight.len() != head.out_dim * head.in_dim || head.bias.len() != head.out_dim {
        return Err("projection head shape does not match its dimensions".to_string());
    }
    let mut bytes = Vec::new();
    bytes.extend_from_slice(magic);
    bytes.extend_from_slice(&(head.in_dim as u32).to_le_bytes());
    bytes.extend_from_slice(&(head.out_dim as u32).to_le_bytes());
    for value in head.weight.iter().chain(head.bias.iter()) {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    let mut file = File::create(path).map_err(|error| error.to_string())?;
    file.write_all(&bytes).map_err(|error| error.to_string())
}

/// `y = W x + b` with `W` stored row-major `[out, in]`.
pub fn affine(head: &LinearHead, token: &[f32]) -> Result<Vec<f32>, String> {
    if token.len() != head.in_dim {
        return Err("token width does not match the projection head".to_string());
    }
    let mut output = vec![0.0_f32; head.out_dim];
    for row in 0..head.out_dim {
        let mut value = head.bias[row];
        let start = row * head.in_dim;
        for column in 0..head.in_dim {
            value += head.weight[start + column] * token[column];
        }
        output[row] = value;
    }
    Ok(output)
}

/// `y = normalize(W x + b)`.
pub fn project_token(head: &LinearHead, token: &[f32]) -> Result<Vec<f32>, String> {
    let mut output = affine(head, token)?;
    l2_normalize(&mut output);
    Ok(output)
}

/// Skip CLS and keep tokens through EOS. `hidden` is one row per token, including CLS.
pub fn project_colbert(head: &LinearHead, hidden: &[Vec<f32>], valid_len: usize) -> Result<Vec<Vec<f32>>, String> {
    if valid_len == 0 || valid_len > hidden.len() {
        return Err("colbert sequence length is outside the hidden states".to_string());
    }
    let mut rows = Vec::new();
    for token in hidden.iter().take(valid_len).skip(1) {
        rows.push(project_token(head, token)?);
    }
    Ok(rows)
}

/// ReLU sparse weights. Special token ids are dropped. Repeated ids keep the maximum.
pub fn lexical_weights(head: &LinearHead, hidden: &[Vec<f32>], token_ids: &[u32], valid_len: usize) -> Result<Vec<(u32, f32)>, String> {
    if head.out_dim != 1 {
        return Err("sparse head must project to one value".to_string());
    }
    if valid_len > hidden.len() || valid_len > token_ids.len() {
        return Err("sparse sequence length is outside the hidden states".to_string());
    }
    let mut weights: Vec<(u32, f32)> = Vec::new();
    for position in 0..valid_len {
        let token_id = token_ids[position];
        let projected = affine(head, &hidden[position])?;
        let weight = projected[0].max(0.0);
        if SPECIAL_TOKEN_IDS.contains(&token_id) || weight <= 0.0 {
            continue;
        }
        if let Some(existing) = weights.iter_mut().find(|(id, _)| *id == token_id) {
            if weight > existing.1 {
                existing.1 = weight;
            }
        } else {
            weights.push((token_id, weight));
        }
    }
    weights.sort_by_key(|(id, _)| *id);
    Ok(weights)
}

pub fn lexical_dot(left: &[(u32, f32)], right: &[(u32, f32)]) -> f32 {
    let mut score = 0.0;
    for (token, weight) in left {
        if let Some((_, other)) = right.iter().find(|(id, _)| id == token) {
            score += weight * other;
        }
    }
    score
}

/// Mean of each left token's maximum similarity against the right tokens.
pub fn mean_maxsim(left: &[Vec<f32>], right: &[Vec<f32>]) -> f32 {
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    let mut total = 0.0;
    for row in left {
        let mut best = f32::NEG_INFINITY;
        for column in right {
            best = best.max(dot(row, column));
        }
        if best.is_finite() {
            total += best;
        }
    }
    total / left.len() as f32
}

pub fn hybrid_score(dense: f32, lexical: f32, colbert: f32) -> f32 {
    HYBRID_WEIGHTS[0] * dense + HYBRID_WEIGHTS[1] * lexical + HYBRID_WEIGHTS[2] * colbert
}

pub fn head_sha256(dir: &Path) -> String {
    let mut hasher = blake3::Hasher::new();
    for name in [COLBERT_FILE, SPARSE_FILE] {
        let path = dir.join(name);
        if let Ok(bytes) = std::fs::read(path) {
            hasher.update(&(bytes.len() as u64).to_le_bytes());
            hasher.update(&bytes);
        }
    }
    hasher.finalize().to_hex().to_string()
}

fn header_matches(path: &Path, magic: &[u8; 8]) -> bool {
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(_) => return false,
    };
    let mut header = [0_u8; 8];
    file.read_exact(&mut header).is_ok() && &header == magic
}

fn load_head(path: &PathBuf, magic: &[u8; 8]) -> Result<LinearHead, String> {
    let bytes = std::fs::read(path).map_err(|error| error.to_string())?;
    if bytes.len() < 16 || &bytes[..8] != magic {
        return Err(format!("projection head header is not valid: {}", path.display()));
    }
    let in_dim = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
    let out_dim = u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize;
    let weight_count = out_dim
        .checked_mul(in_dim)
        .ok_or_else(|| "projection head dimensions overflow".to_string())?;
    let total_floats = weight_count
        .checked_add(out_dim)
        .ok_or_else(|| "projection head dimensions overflow".to_string())?;
    let needed = total_floats
        .checked_mul(4)
        .and_then(|n| n.checked_add(16))
        .ok_or_else(|| "projection head dimensions overflow".to_string())?;
    if in_dim == 0 || out_dim == 0 || bytes.len() != needed {
        return Err("projection head length does not match its dimensions".to_string());
    }
    let mut values = Vec::with_capacity(out_dim * in_dim + out_dim);
    for chunk in bytes[16..].chunks_exact(4) {
        values.push(f32::from_le_bytes(chunk.try_into().unwrap()));
    }
    let weight = values[..out_dim * in_dim].to_vec();
    let bias = values[out_dim * in_dim..].to_vec();
    Ok(LinearHead {
        in_dim,
        out_dim,
        weight,
        bias,
    })
}

fn l2_normalize(values: &mut [f32]) {
    let norm = values.iter().map(|value| value * value).sum::<f32>().sqrt();
    if norm > 0.0 {
        for value in values {
            *value /= norm;
        }
    }
}

fn dot(left: &[f32], right: &[f32]) -> f32 {
    left.iter().zip(right).map(|(left, right)| left * right).sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity_head() -> LinearHead {
        LinearHead {
            in_dim: 2,
            out_dim: 2,
            weight: vec![1.0, 0.0, 0.0, 1.0],
            bias: vec![0.0, 0.0],
        }
    }

    #[test]
    fn projection_matches_the_normalized_linear_reference() {
        let projected = project_token(&identity_head(), &[3.0, 4.0]).expect("project");
        assert!((projected[0] - 0.6).abs() < 1e-6);
        assert!((projected[1] - 0.8).abs() < 1e-6);
    }

    #[test]
    fn colbert_keeps_tokens_through_eos_and_skips_cls() {
        let hidden = vec![vec![1.0, 0.0], vec![3.0, 4.0], vec![0.0, 5.0]];
        let rows = project_colbert(&identity_head(), &hidden, 3).expect("colbert");
        assert_eq!(rows.len(), 2);
        assert!((rows[0][0] - 0.6).abs() < 1e-6);
        assert!((rows[1][1] - 1.0).abs() < 1e-6);
    }

    #[test]
    fn sparse_weights_drop_specials_and_keep_the_max() {
        let head = LinearHead {
            in_dim: 1,
            out_dim: 1,
            weight: vec![1.0],
            bias: vec![0.0],
        };
        let hidden = vec![vec![0.2], vec![0.5], vec![-1.0], vec![0.9], vec![0.4]];
        let ids = [0, 7, 1, 7, 2];
        let weights = lexical_weights(&head, &hidden, &ids, 5).expect("sparse");
        assert_eq!(weights, vec![(7, 0.9)]);
    }

    #[test]
    fn maxsim_and_hybrid_match_the_frozen_mix() {
        let left = vec![vec![1.0, 0.0], vec![0.0, 1.0]];
        let right = vec![vec![0.0, 1.0], vec![1.0, 0.0]];
        let colbert = mean_maxsim(&left, &right);
        assert!((colbert - 1.0).abs() < 1e-6);
        let lexical = lexical_dot(&[(1, 0.5), (2, 0.2)], &[(2, 0.4), (3, 0.1)]);
        assert!((lexical - 0.08).abs() < 1e-6);
        let mixed = hybrid_score(1.0, lexical, colbert);
        assert!((mixed - 0.816).abs() < 1e-6);
    }

    #[test]
    fn a_header_check_does_not_require_the_weight_bytes() {
        let dir = std::env::temp_dir().join(format!("neuink-colbert-head-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("dir");
        std::fs::write(dir.join(COLBERT_FILE), COLBERT_MAGIC).expect("header");
        let status = inspect_multivector_heads(&dir);
        assert!(status.colbert_present);
        assert!(!status.sparse_present);
        assert_eq!(status.missing_reason(true), Some("sparse_head_missing"));
        assert!(status.missing_reason(false).is_none());
        write_head(&dir.join(SPARSE_FILE), SPARSE_MAGIC, &LinearHead {
            in_dim: 1,
            out_dim: 1,
            weight: vec![2.0],
            bias: vec![0.5],
        })
        .expect("write");
        write_head(&dir.join(COLBERT_FILE), COLBERT_MAGIC, &identity_head()).expect("colbert");
        assert_eq!(load_colbert(&dir).expect("load colbert").in_dim, 2);
        let loaded = load_sparse(&dir).expect("load");
        assert_eq!(loaded.weight, vec![2.0]);
        assert!(!head_sha256(&dir).is_empty());
        assert!((loaded.bias[0] - 0.5).abs() < 1e-6);
        std::fs::remove_dir_all(&dir).ok();
    }
}
