//! Curated text embedding models that can actually be installed here.
//!
//! The rule for this list is the loader's rule, not popularity: a model qualifies only when
//! its ONNX export is a **single self-contained file** that emits `last_hidden_state`, because
//! the current loader hands one byte buffer to `ort` and pools the token axis itself.
//!
//! That disqualifies two otherwise obvious choices, and the reasons are recorded per entry
//! instead of being hidden:
//! - `BAAI/bge-m3` ships `onnx/model.onnx` as a 0.7 MB graph plus a 2.2 GB `model.onnx_data`;
//!   external data cannot be resolved from an in-memory buffer.
//! - Xenova's `sentence_transformers_*` variants bake pooling into the graph, so pooling them
//!   again would produce meaningless vectors.

use std::path::{Path, PathBuf};

use serde::Serialize;

/// Files our loader requires beside the ONNX model.
pub const REQUIRED_TOKENIZER_FILES: [&str; 4] = [
    "tokenizer.json",
    "config.json",
    "special_tokens_map.json",
    "tokenizer_config.json",
];

/// Synthetic token map for exports that omit it. Token ids match the XLM-R/`bge-m3` family;
/// any tokenizer that follows the same special-token layout accepts it unchanged.
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
pub struct RecommendedTextModel {
    /// Stable identifier, also the resource directory name.
    pub id: &'static str,
    pub display_name: &'static str,
    pub repository: &'static str,
    pub dimensions: usize,
    /// `mean` or `cls`.
    pub pooling: &'static str,
    /// HF-relative ONNX path that is self-contained (no `*_data` sibling).
    pub onnx_path: &'static str,
    pub onnx_megabytes: u32,
    pub languages: &'static str,
    pub license: &'static str,
    /// Why this entry is or is not directly installable.
    pub note: &'static str,
    /// `true` when the files can be fetched and used as-is.
    pub directly_installable: bool,
}

pub const RECOMMENDED: [RecommendedTextModel; 4] = [
    RecommendedTextModel {
        id: "bge-m3-int8-xenova",
        display_name: "bge-m3 int8（Xenova 单文件）",
        repository: "Xenova/bge-m3",
        dimensions: 1024,
        pooling: "cls",
        onnx_path: "onnx/model_int8.onnx",
        onnx_megabytes: 569,
        languages: "中英 + 100 语种",
        license: "MIT",
        note: "与当前默认同源（BAAI/bge-m3）的官方社区 int8 导出，单文件可直接加载；仓库缺 special_tokens_map.json，安装时补齐。",
        directly_installable: true,
    },
    RecommendedTextModel {
        id: "multilingual-e5-large-qs",
        display_name: "multilingual-e5-large quantized（Xenova）",
        repository: "Xenova/multilingual-e5-large",
        dimensions: 1024,
        pooling: "mean",
        onnx_path: "onnx/model_quantized.onnx",
        onnx_megabytes: 562,
        languages: "中英 + 100 语种",
        license: "MIT",
        note: "e5 家族的 1024 维版本，Mean 池化，需 query:/passage: 前缀；单文件可直接加载。",
        directly_installable: true,
    },
    RecommendedTextModel {
        id: "bge-m3-fp32-original",
        display_name: "bge-m3 fp32（BAAI 官方 ONNX）",
        repository: "BAAI/bge-m3",
        dimensions: 1024,
        pooling: "cls",
        onnx_path: "onnx/model.onnx",
        onnx_megabytes: 2162,
        languages: "中英 + 100 语种",
        license: "MIT",
        note: "原版权重但采用 external data（model.onnx_data），内存加载器无法解析；需先内联成单文件。",
        directly_installable: false,
    },
    RecommendedTextModel {
        id: "bge-large-zh-v1.5",
        display_name: "bge-large-zh-v1.5",
        repository: "BAAI/bge-large-zh-v1.5",
        dimensions: 1024,
        pooling: "cls",
        onnx_path: "",
        onnx_megabytes: 1300,
        languages: "中文优先",
        license: "MIT",
        note: "纯中文场景质量高，但仓库未发布 ONNX，需要自行用 optimum 导出后再放入目录。",
        directly_installable: false,
    },
];

#[derive(Debug, Serialize)]
pub struct RecommendedState {
    pub model: RecommendedTextModel,
    /// Resource directory of an already installed copy, when present.
    pub installed_dir: Option<String>,
    pub installed: bool,
}

/// Reports which recommendations already exist under the given resource root.
pub fn list_states(root: &Path) -> Vec<RecommendedState> {
    RECOMMENDED
        .iter()
        .map(|model| {
            let dir = root.join(model.id);
            let installed = model.directly_installable
                && !model.onnx_path.is_empty()
                && dir.join(model.onnx_path).is_file()
                && REQUIRED_TOKENIZER_FILES
                    .iter()
                    .all(|name| dir.join(name).is_file());
            RecommendedState {
                model: *model,
                installed_dir: installed.then(|| dir.to_string_lossy().to_string()),
                installed,
            }
        })
        .collect()
}

/// Target directory for an install of `id` under `root`.
pub fn install_dir(root: &Path, id: &str) -> Option<PathBuf> {
    RECOMMENDED
        .iter()
        .find(|model| model.id == id && model.directly_installable)
        .map(|model| root.join(model.id))
}

/// Writes the manifest the loader reads, plus a synthetic token map when the export omits it.
pub fn write_model_metadata(dir: &Path, model: &RecommendedTextModel) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    let manifest = format!(
        "{{\n  \"provider\": \"fastembed-local\",\n  \"model_name\": \"{}\",\n  \"dimensions\": {},\n  \"pooling\": \"{}\"\n}}\n",
        model.repository, model.dimensions, model.pooling
    );
    std::fs::write(dir.join("neuink-embedding.json"), manifest).map_err(|error| error.to_string())?;
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
    fn only_single_file_exports_are_marked_installable() {
        for model in RECOMMENDED.iter() {
            if model.directly_installable {
                assert!(!model.onnx_path.is_empty(), "{} needs an onnx path", model.id);
                assert!(
                    !model.onnx_path.contains("sentence_transformers"),
                    "{} must not use a pooled export",
                    model.id
                );
            } else {
                assert!(
                    model.onnx_path.is_empty() || model.onnx_path.contains("model.onnx"),
                    "{} reason must be recorded",
                    model.id
                );
            }
        }
    }

    #[test]
    fn metadata_writes_a_manifest_the_loader_accepts() {
        let dir = std::env::temp_dir().join(format!("neuink-rec-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let model = RECOMMENDED[0];
        write_model_metadata(&dir, &model).expect("write metadata");
        let manifest = std::fs::read_to_string(dir.join("neuink-embedding.json")).expect("manifest");
        assert!(manifest.contains("\"dimensions\": 1024"));
        assert!(manifest.contains("\"pooling\": \"cls\""));
        assert!(dir.join("special_tokens_map.json").is_file());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn states_report_installed_only_when_every_required_file_exists() {
        let root = std::env::temp_dir().join(format!("neuink-rec-root-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let model = RECOMMENDED[0];
        let dir = install_dir(&root, model.id).expect("install dir");
        write_model_metadata(&dir, &model).expect("metadata");
        assert!(!list_states(&root).iter().any(|state| state.installed));

        std::fs::create_dir_all(dir.join("onnx")).expect("onnx dir");
        std::fs::write(dir.join(model.onnx_path), b"stub").expect("onnx");
        for name in ["tokenizer.json", "config.json", "tokenizer_config.json"] {
            std::fs::write(dir.join(name), b"{}").expect("tokenizer file");
        }
        let installed = list_states(&root)
            .into_iter()
            .find(|state| state.model.id == model.id)
            .expect("state");
        assert!(installed.installed);
        std::fs::remove_dir_all(&root).ok();
    }
}
