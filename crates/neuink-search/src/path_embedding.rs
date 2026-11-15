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

use ort::session::Session;
use ort::value::Tensor;
use tokenizers::{PaddingParams, Tokenizer, TruncationParams};

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

/// A file-path ONNX session plus the tokenizer facts the provider needs.
pub struct PathEmbeddingEngine {
    /// `run` needs `&mut`, and the provider guards this engine with a mutex.
    session: std::sync::Mutex<Session>,
    tokenizer: Tokenizer,
    pooling: PoolKind,
    dimensions: usize,
    batch: usize,
}

impl PathEmbeddingEngine {
    /// Opens the session from `model_file` so ONNX Runtime can resolve `*_data` sidecars.
    pub fn load(
        model_dir: &Path,
        model_file: &Path,
        pooling: PoolKind,
        dimensions: usize,
        intra_threads: Option<usize>,
    ) -> Result<Self, String> {
        let mut builder = Session::builder().map_err(|error| error.to_string())?;
        if let Some(threads) = intra_threads {
            builder = builder
                .with_intra_threads(threads.max(1))
                .map_err(|error| error.to_string())?;
        }
        let session = builder
            .commit_from_file(model_file)
            .map_err(|error| format!("无法加载 ONNX 会话：{error}"))?;
        let mut tokenizer = Tokenizer::from_file(model_dir.join("tokenizer.json"))
            .map_err(|error| format!("无法加载 tokenizer.json：{error}"))?;
        tokenizer
            .with_truncation(Some(TruncationParams {
                max_length: 512,
                ..Default::default()
            }))
            .map_err(|error| error.to_string())?;
        tokenizer.with_padding(Some(PaddingParams {
            pad_id: 1,
            pad_token: "<pad>".to_string(),
            ..Default::default()
        }));
        Ok(Self {
            session: std::sync::Mutex::new(session),
            tokenizer,
            pooling,
            dimensions,
            batch: 8,
        })
    }

    /// Embeds texts in fixed-size batches; each input becomes one L2-normalised vector.
    pub fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
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
            let mut ids = Vec::with_capacity(batch * sequence);
            let mut mask = Vec::with_capacity(batch * sequence);
            for encoding in &encodings {
                let row = encoding.get_ids();
                let pad = sequence.saturating_sub(row.len());
                ids.extend(row.iter().map(|value| *value as i64));
                ids.extend(std::iter::repeat_n(0_i64, pad));
                mask.extend(encoding.get_attention_mask().iter().map(|value| *value as i64));
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
            if session.inputs().iter().any(|input| input.name() == "token_type_ids") {
                feeds.push((std::borrow::Cow::Borrowed("token_type_ids"), position.into()));
            }
            let outputs = session
                .run(feeds)
                .map_err(|error| format!("ONNX 推理失败：{error}"))?;
            let (shape, data) = outputs[0]
                .try_extract_tensor::<f32>()
                .map_err(|error| format!("输出张量无法读取：{error}"))?;
            // Expected shape: (batch, sequence, hidden).
            let hidden = *shape.last().ok_or("输出维度为空")? as usize;
            if hidden != self.dimensions {
                return Err(format!(
                    "模型输出维度 {hidden} 与清单声明的 {} 不一致",
                    self.dimensions
                ));
            }
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
}

#[cfg(test)]
mod tests {
    use super::PoolKind;

    #[test]
    fn pooling_follows_the_manifest_with_mean_as_default() {
        assert_eq!(PoolKind::from_manifest(Some("cls")), PoolKind::Cls);
        assert_eq!(PoolKind::from_manifest(Some("CLS")), PoolKind::Cls);
        assert_eq!(PoolKind::from_manifest(Some("mean")), PoolKind::Mean);
        assert_eq!(PoolKind::from_manifest(None), PoolKind::Mean);
    }
}




