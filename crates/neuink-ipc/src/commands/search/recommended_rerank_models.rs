//! Reranker models that can be installed in one click.
//!
//! The reranker loader (`LocalReranker`) reads a flat directory: an ONNX file plus the four
//! tokenizer files. Two upstream shapes qualify, and one does not:
//! - `BAAI/bge-reranker-base` publishes a single-file fp32 `onnx/model.onnx` (1.1 GB).
//! - `Xenova/bge-reranker-base` publishes `onnx/model_quantized.onnx` (279 MB) but no
//!   `special_tokens_map.json`, which the installer synthesises.
//! - `Xenova/bge-reranker-v2-m3` answers 401 without a token, so it is not offered here;
//!   the v2-m3 weights are used as a local export instead.

use std::path::Path;

use serde::Serialize;

const SYNTHETIC_SPECIAL_TOKENS: &str = r#"{
  "bos_token": "<s>",
  "eos_token": "</s>",
  "unk_token": "<unk>",
  "sep_token": "</s>",
  "pad_token": "<pad>",
  "cls_token": "<s>",
  "mask_token": "<mask>"
}
"#;

#[derive(Clone, Copy, Debug, Serialize)]
pub struct RecommendedRerankModel {
    pub id: &'static str,
    pub display_name: &'static str,
    pub repository: &'static str,
    pub onnx_megabytes: u32,
    pub note: &'static str,
    pub homepage: &'static str,
    /// `(remote path, local path)` pairs the installer fetches.
    pub files: &'static [(&'static str, &'static str)],
}

pub const RECOMMENDED_RERANK: [RecommendedRerankModel; 2] = [
    RecommendedRerankModel {
        id: "rerank-base-int8-xenova",
        display_name: "bge-reranker-base int8（Xenova）",
        repository: "Xenova/bge-reranker-base",
        onnx_megabytes: 279,
        note: "推荐档：279 MB，CPU 上 20 候选约 1.2 秒；仓库缺 special_tokens_map.json，安装时补齐。",
        homepage: "https://huggingface.co/Xenova/bge-reranker-base",
        files: &[
            ("onnx/model_quantized.onnx", "onnx/model_quantized.onnx"),
            ("tokenizer.json", "tokenizer.json"),
            ("config.json", "config.json"),
            ("tokenizer_config.json", "tokenizer_config.json"),
        ],
    },
    RecommendedRerankModel {
        id: "rerank-base-fp32-official",
        display_name: "bge-reranker-base fp32（BAAI 官方）",
        repository: "BAAI/bge-reranker-base",
        onnx_megabytes: 1112,
        note: "官方 fp32 单文件 ONNX（1.1 GB），tokenizer 文件完整；推理比 int8 慢约 2–3 倍。",
        homepage: "https://huggingface.co/BAAI/bge-reranker-base",
        files: &[
            ("onnx/model.onnx", "onnx/model.onnx"),
            ("tokenizer.json", "tokenizer.json"),
            ("config.json", "config.json"),
            ("tokenizer_config.json", "tokenizer_config.json"),
            ("special_tokens_map.json", "special_tokens_map.json"),
            ("sentencepiece.bpe.model", "sentencepiece.bpe.model"),
        ],
    },
];

#[derive(Debug, Serialize)]
pub struct RecommendedRerankState {
    pub model: RecommendedRerankModel,
    pub installed_dir: Option<String>,
    pub installed: bool,
}

pub fn list_states(root: &Path) -> Vec<RecommendedRerankState> {
    RECOMMENDED_RERANK
        .iter()
        .map(|model| {
            let dir = root.join(model.id);
            let installed = model.files.iter().all(|(_, local)| dir.join(local).is_file());
            RecommendedRerankState {
                model: *model,
                installed_dir: installed.then(|| dir.to_string_lossy().to_string()),
                installed,
            }
        })
        .collect()
}

pub fn install_dir(root: &Path, id: &str) -> Option<std::path::PathBuf> {
    RECOMMENDED_RERANK
        .iter()
        .find(|model| model.id == id)
        .map(|model| root.join(model.id))
}

/// Fills the tokenizer file some exports omit, so `LocalReranker::load` accepts the directory.
pub fn complete_tokenizer_files(dir: &Path) -> Result<(), String> {
    let special = dir.join("special_tokens_map.json");
    if !special.is_file() {
        std::fs::write(&special, SYNTHETIC_SPECIAL_TOKENS).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_entry_links_its_page_and_declares_an_onnx_file() {
        for model in RECOMMENDED_RERANK.iter() {
            assert!(model.homepage.starts_with("https://huggingface.co/"));
            assert!(model
                .files
                .iter()
                .any(|(remote, _)| remote.ends_with(".onnx")));
        }
    }

    #[test]
    fn tokenizer_completion_writes_the_missing_map_only_once() {
        let dir = std::env::temp_dir().join(format!("neuink-rerank-tok-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("dir");
        complete_tokenizer_files(&dir).expect("first");
        let first = std::fs::read_to_string(dir.join("special_tokens_map.json")).expect("map");
        complete_tokenizer_files(&dir).expect("second");
        let second = std::fs::read_to_string(dir.join("special_tokens_map.json")).expect("map");
        assert_eq!(first, second);
        std::fs::remove_dir_all(&dir).ok();
    }
}
