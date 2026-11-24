//! ONNX loading straight from a file path, for models whose weights live in a sidecar.
//!
//! `fastembed` only accepts one byte buffer per model, which is fine for single-file exports
//! (`Xenova/*`, our int8 builds) but cannot resolve ONNX **external data** — the official
//! `BAAI/bge-m3` export is a 725 KB graph plus a 2.2 GB `model.onnx_data`. ONNX Runtime
//! resolves that sidecar only when the session is created from a path, so those models take
//! this backend instead.
//!
//! Pooling comes from the manifest (`mean` / `cls`), matching what `fastembed` does for the
//! single-file path, so both backends produce comparable vectors.

use std::path::Path;

use ort::session::builder::GraphOptimizationLevel;
use ort::session::Session;
use ort::value::Tensor;
use serde::Deserialize;
use tokenizers::{PaddingParams, Tokenizer, TruncationParams};

/// Chooses an intra-op thread count that targets physical P-cores rather than
/// saturating hyperthreads or slow E-cores on hybrid CPUs (where barrier sync
/// slows CPU GEMM down). Explicit overrides still win.
pub fn default_cpu_intra_threads() -> usize {
    let logical = std::thread::available_parallelism()
        .map(usize::from)
        .unwrap_or(4);
    if logical <= 4 {
        logical.max(1)
    } else if logical <= 8 {
        (logical / 2).max(4)
    } else {
        (logical / 2).clamp(4, 6)
    }
}

/// Pooling over the token axis, matching the manifest vocabulary.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PoolKind {
    Mean,
    Cls,
}

impl PoolKind {
    pub fn from_manifest(value: Option<&str>) -> Self {
        match value.map(str::to_ascii_lowercase).as_deref() {
            Some("cls") => Self::Cls,
            _ => Self::Mean,
        }
    }
}

#[derive(Debug, Deserialize)]
struct ModelConfigPadding {
    #[serde(default)]
    pad_token_id: Option<u32>,
    #[serde(default)]
    model_type: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TokenizerConfigPadding {
    #[serde(default)]
    pad_token: Option<serde_json::Value>,
}

fn extract_token_text(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(text) if !text.is_empty() => Some(text.clone()),
        serde_json::Value::Object(map) => map
            .get("content")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(ToString::to_string),
        _ => None,
    }
}

fn resolve_padding_params(model_dir: &Path, tokenizer: &Tokenizer) -> (u32, String) {
    let model_cfg = std::fs::read(model_dir.join("config.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<ModelConfigPadding>(&bytes).ok());
    let tok_cfg = std::fs::read(model_dir.join("tokenizer_config.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<TokenizerConfigPadding>(&bytes).ok());
    let special_cfg = std::fs::read(model_dir.join("special_tokens_map.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<TokenizerConfigPadding>(&bytes).ok());

    let pad_token = tok_cfg
        .and_then(|cfg| cfg.pad_token.as_ref().and_then(extract_token_text))
        .or_else(|| {
            special_cfg.and_then(|cfg| cfg.pad_token.as_ref().and_then(extract_token_text))
        })
        .unwrap_or_else(|| {
            let is_roberta = model_cfg
                .as_ref()
                .and_then(|cfg| cfg.model_type.as_deref())
                .is_some_and(|kind| kind.to_ascii_lowercase().contains("roberta"));
            if is_roberta {
                "<pad>".to_string()
            } else {
                "[PAD]".to_string()
            }
        });

    let pad_id = model_cfg
        .as_ref()
        .and_then(|cfg| cfg.pad_token_id)
        .or_else(|| tokenizer.token_to_id(&pad_token))
        .unwrap_or(0);

    (pad_id, pad_token)
}

/// A file-path ONNX session plus the tokenizer facts the provider needs.
pub struct PathEmbeddingEngine {
    /// `run` needs `&mut`, and the provider guards this engine with a mutex.
    session: std::sync::Mutex<Session>,
    tokenizer: Tokenizer,
    pooling: PoolKind,
    dimensions: Option<usize>,
    pad_id: i64,
    batch: usize,
}

impl PathEmbeddingEngine {
    /// Opens the session directly from `model_file` so ONNX Runtime avoids copying
    /// the whole model buffer in Rust RAM and can also resolve `*_data` sidecars.
    pub fn load(
        model_dir: &Path,
        model_file: &Path,
        pooling: PoolKind,
        dimensions: Option<usize>,
        intra_threads: Option<usize>,
    ) -> Result<Self, String> {
        let effective_threads = intra_threads
            .map(|threads| threads.max(1))
            .unwrap_or_else(default_cpu_intra_threads);
        let mut builder = Session::builder()
            .map_err(|error| error.to_string())?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .map_err(|error| error.to_string())?
            .with_intra_threads(effective_threads)
            .map_err(|error| error.to_string())?
            .with_inter_threads(1)
            .map_err(|error| error.to_string())?
            .with_parallel_execution(false)
            .map_err(|error| error.to_string())?;
        let session = builder
            .commit_from_file(model_file)
            .map_err(|error| format!("无法加载 ONNX 会话：{error}"))?;
        let mut tokenizer = Tokenizer::from_file(model_dir.join("tokenizer.json"))
            .map_err(|error| format!("无法加载 tokenizer.json：{error}"))?;
        let (pad_id, pad_token) = resolve_padding_params(model_dir, &tokenizer);
        tokenizer
            .with_truncation(Some(TruncationParams {
                max_length: 512,
                ..Default::default()
            }))
            .map_err(|error| error.to_string())?;
        tokenizer.with_padding(Some(PaddingParams {
            pad_id,
            pad_token,
            ..Default::default()
        }));
        Ok(Self {
            session: std::sync::Mutex::new(session),
            tokenizer,
            pooling,
            dimensions,
            pad_id: pad_id as i64,
            batch: 8,
        })
    }

    /// Embeds texts in fixed-size batches; each input becomes one L2-normalised vector.
    pub fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        let mut out = Vec::with_capacity(texts.len());
        for chunk in texts.chunks(self.batch) {
            let encodings = self
                .tokenizer
                .encode_batch(chunk.to_vec(), true)
                .map_err(|error| format!("分词失败：{error}"))?;
            let batch = encodings.len();
            let sequence = encodings
                .iter()
                .map(|encoding| encoding.get_ids().len())
                .max()
                .unwrap_or(0);
            if sequence == 0 {
                return Err("ONNX 输入序列长度为 0".to_string());
            }
            let mut ids = Vec::with_capacity(batch * sequence);
            let mut mask = Vec::with_capacity(batch * sequence);
            for encoding in &encodings {
                let row = encoding.get_ids();
                let pad = sequence.saturating_sub(row.len());
                ids.extend(row.iter().map(|value| *value as i64));
                ids.extend(std::iter::repeat_n(self.pad_id, pad));
                mask.extend(
                    encoding
                        .get_attention_mask()
                        .iter()
                        .map(|value| *value as i64),
                );
                mask.extend(std::iter::repeat_n(0_i64, pad));
            }
            let ids = Tensor::from_array(([batch as i64, sequence as i64], ids))
                .map_err(|error| error.to_string())?;
            let mask_tensor = Tensor::from_array(([batch as i64, sequence as i64], mask.clone()))
                .map_err(|error| error.to_string())?;
            let position = Tensor::from_array((
                [batch as i64, sequence as i64],
                vec![0_i64; batch * sequence],
            ))
            .map_err(|error| error.to_string())?;

            let mut session = self
                .session
                .lock()
                .map_err(|_| "ONNX 会话锁被污染".to_string())?;
            let mut feeds = ort::inputs![
                "input_ids" => ids,
                "attention_mask" => mask_tensor,
            ];
            if session
                .inputs()
                .iter()
                .any(|input| input.name() == "token_type_ids")
            {
                feeds.push((
                    std::borrow::Cow::Borrowed("token_type_ids"),
                    position.into(),
                ));
            }
            let outputs = session
                .run(feeds)
                .map_err(|error| format!("ONNX 推理失败：{error}"))?;
            let (shape, data) = outputs[0]
                .try_extract_tensor::<f32>()
                .map_err(|error| format!("输出张量无法读取：{error}"))?;
            let hidden = *shape.last().ok_or("输出维度为空")? as usize;
            if let Some(expected) = self.dimensions {
                if hidden != expected {
                    return Err(format!(
                        "模型输出维度 {hidden} 与清单声明的 {expected} 不一致"
                    ));
                }
            }
            if shape.len() == 2 {
                // Pre-pooled (batch, hidden) export.
                for row in 0..batch {
                    let start = row * hidden;
                    let mut vector = data[start..start + hidden].to_vec();
                    let norm = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
                    if norm > 0.0 {
                        for value in vector.iter_mut() {
                            *value /= norm;
                        }
                    }
                    out.push(vector);
                }
                continue;
            }
            // Standard (batch, sequence, hidden) export.
            for row in 0..batch {
                let start = row * sequence * hidden;
                let mut vector = vec![0.0_f32; hidden];
                match self.pooling {
                    PoolKind::Cls => {
                        vector.copy_from_slice(&data[start..start + hidden]);
                    }
                    PoolKind::Mean => {
                        let mut counted = 0.0_f32;
                        for token in 0..sequence {
                            if mask[row * sequence + token] == 0 {
                                continue;
                            }
                            let offset = start + token * hidden;
                            for index in 0..hidden {
                                vector[index] += data[offset + index];
                            }
                            counted += 1.0;
                        }
                        if counted > 0.0 {
                            for value in vector.iter_mut() {
                                *value /= counted;
                            }
                        }
                    }
                }
                let norm = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
                if norm > 0.0 {
                    for value in vector.iter_mut() {
                        *value /= norm;
                    }
                }
                out.push(vector);
            }
        }
        Ok(out)
    }

    /// Token states for the multi-vector heads. Dense matches [`Self::embed`].
    pub fn encode_token_states(&self, texts: &[String]) -> Result<Vec<TokenHiddenStates>, String> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        let mut out = Vec::with_capacity(texts.len());
        for chunk in texts.chunks(self.batch) {
            let encodings = self
                .tokenizer
                .encode_batch(chunk.to_vec(), true)
                .map_err(|error| format!("分词失败：{error}"))?;
            let batch = encodings.len();
            let sequence = encodings
                .iter()
                .map(|encoding| encoding.get_ids().len())
                .max()
                .unwrap_or(0);
            if sequence == 0 {
                return Err("ONNX 输入序列长度为 0".to_string());
            }
            let mut ids = Vec::with_capacity(batch * sequence);
            let mut mask = Vec::with_capacity(batch * sequence);
            let mut token_ids = Vec::with_capacity(batch);
            for encoding in &encodings {
                let row = encoding.get_ids();
                token_ids.push(row.to_vec());
                let pad = sequence.saturating_sub(row.len());
                ids.extend(row.iter().map(|value| *value as i64));
                ids.extend(std::iter::repeat_n(self.pad_id, pad));
                mask.extend(
                    encoding
                        .get_attention_mask()
                        .iter()
                        .map(|value| *value as i64),
                );
                mask.extend(std::iter::repeat_n(0_i64, pad));
            }
            let id_tensor = Tensor::from_array(([batch as i64, sequence as i64], ids))
                .map_err(|error| error.to_string())?;
            let mask_tensor = Tensor::from_array(([batch as i64, sequence as i64], mask.clone()))
                .map_err(|error| error.to_string())?;
            let position = Tensor::from_array((
                [batch as i64, sequence as i64],
                vec![0_i64; batch * sequence],
            ))
            .map_err(|error| error.to_string())?;
            let mut session = self
                .session
                .lock()
                .map_err(|_| "ONNX 会话锁被污染".to_string())?;
            let mut feeds = ort::inputs![
                "input_ids" => id_tensor,
                "attention_mask" => mask_tensor,
            ];
            if session
                .inputs()
                .iter()
                .any(|input| input.name() == "token_type_ids")
            {
                feeds.push((
                    std::borrow::Cow::Borrowed("token_type_ids"),
                    position.into(),
                ));
            }
            let outputs = session
                .run(feeds)
                .map_err(|error| format!("ONNX 推理失败：{error}"))?;
            let (shape, data) = outputs[0]
                .try_extract_tensor::<f32>()
                .map_err(|error| format!("输出张量无法读取：{error}"))?;
            let hidden = *shape.last().ok_or("输出维度为空")? as usize;
            if let Some(expected) = self.dimensions {
                if hidden != expected {
                    return Err(format!(
                        "模型输出维度 {hidden} 与清单声明的 {expected} 不一致"
                    ));
                }
            }
            for row in 0..batch {
                let valid_len = mask[row * sequence..(row + 1) * sequence]
                    .iter()
                    .filter(|value| **value != 0)
                    .count()
                    .min(token_ids[row].len());
                let start = row * sequence * hidden;
                let mut dense = vec![0.0_f32; hidden];
                match self.pooling {
                    PoolKind::Cls => {
                        if valid_len > 0 {
                            dense.copy_from_slice(&data[start..start + hidden]);
                        }
                    }
                    PoolKind::Mean => {
                        let mut counted = 0.0_f32;
                        for token in 0..valid_len {
                            let offset = start + token * hidden;
                            for index in 0..hidden {
                                dense[index] += data[offset + index];
                            }
                            counted += 1.0;
                        }
                        if counted > 0.0 {
                            for value in dense.iter_mut() {
                                *value /= counted;
                            }
                        }
                    }
                }
                let norm = dense.iter().map(|value| value * value).sum::<f32>().sqrt();
                if norm > 0.0 {
                    for value in dense.iter_mut() {
                        *value /= norm;
                    }
                }
                let mut hidden_tokens = Vec::with_capacity(valid_len);
                for token in 0..valid_len {
                    let offset = start + token * hidden;
                    hidden_tokens.push(data[offset..offset + hidden].to_vec());
                }
                out.push(TokenHiddenStates {
                    dense,
                    hidden_tokens,
                    token_ids: token_ids[row][..valid_len].to_vec(),
                    valid_len,
                });
            }
        }
        Ok(out)
    }
}

/// One text's pooled vector and the token rows the projection heads consume.
pub struct TokenHiddenStates {
    pub dense: Vec<f32>,
    pub hidden_tokens: Vec<Vec<f32>>,
    pub token_ids: Vec<u32>,
    pub valid_len: usize,
}

#[cfg(test)]
mod tests {
    use super::{default_cpu_intra_threads, resolve_padding_params, PoolKind};
    use tokenizers::models::wordlevel::WordLevel;
    use tokenizers::Tokenizer;

    #[test]
    fn pooling_follows_the_manifest_with_mean_as_default() {
        assert_eq!(PoolKind::from_manifest(Some("cls")), PoolKind::Cls);
        assert_eq!(PoolKind::from_manifest(Some("CLS")), PoolKind::Cls);
        assert_eq!(PoolKind::from_manifest(Some("mean")), PoolKind::Mean);
        assert_eq!(PoolKind::from_manifest(None), PoolKind::Mean);
    }

    #[test]
    fn default_cpu_intra_threads_stays_bounded_for_hybrid_cpus() {
        let threads = default_cpu_intra_threads();
        assert!((1..=6).contains(&threads));
    }

    #[test]
    fn resolve_padding_params_reads_model_config_for_roberta_and_bert() {
        let tokenizer = Tokenizer::new(WordLevel::default());
        let base = std::env::temp_dir().join(format!(
            "neuink-pad-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));

        let roberta = base.join("roberta");
        std::fs::create_dir_all(&roberta).unwrap();
        std::fs::write(
            roberta.join("config.json"),
            br#"{"model_type":"xlm-roberta","pad_token_id":1}"#,
        )
        .unwrap();
        std::fs::write(
            roberta.join("tokenizer_config.json"),
            br#"{"pad_token":"<pad>"}"#,
        )
        .unwrap();
        assert_eq!(
            resolve_padding_params(&roberta, &tokenizer),
            (1, "<pad>".to_string())
        );

        let bert = base.join("bert");
        std::fs::create_dir_all(&bert).unwrap();
        std::fs::write(
            bert.join("config.json"),
            br#"{"model_type":"bert","pad_token_id":0}"#,
        )
        .unwrap();
        std::fs::write(
            bert.join("special_tokens_map.json"),
            br#"{"pad_token":{"content":"[PAD]"}}"#,
        )
        .unwrap();
        assert_eq!(
            resolve_padding_params(&bert, &tokenizer),
            (0, "[PAD]".to_string())
        );

        let _ = std::fs::remove_dir_all(&base);
    }
}
