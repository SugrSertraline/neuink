//! Visual encoders the local service can host.
//!
//! None of these are installed by the app: the visual channel is a Python service that needs
//! torch plus PDF rasterization, so the honest offering is a model page, its size, and what
//! switching costs. Dimensions matter because they enter the snapshot namespace: a different
//! encoder means a new index, never a reused one.

use serde::Serialize;

#[derive(Clone, Copy, Debug, Serialize)]
pub struct RecommendedVisualModel {
    pub id: &'static str,
    pub display_name: &'static str,
    pub repository: &'static str,
    pub homepage: &'static str,
    /// safetensors size on the Hub, in MB.
    pub weights_megabytes: u32,
    pub dimensions: usize,
    pub note: &'static str,
    /// Where the weights are expected to live on disk.
    pub install_path: &'static str,
    /// Copyable steps: download to that path, then start the service on it.
    pub install_commands: &'static [&'static str],
    /// Marks the entry the repository currently ships as the default.
    pub current_default: bool,
}

pub const RECOMMENDED_VISUAL: [RecommendedVisualModel; 2] = [
    RecommendedVisualModel {
        id: "qwen3-vl-embedding-2b",
        display_name: "Qwen3-VL-Embedding-2B（当前默认）",
        repository: "Qwen/Qwen3-VL-Embedding-2B",
        homepage: "https://huggingface.co/Qwen/Qwen3-VL-Embedding-2B",
        weights_megabytes: 4255,
        dimensions: 2048,
        note: "实测 page R@10 0.268 / 四裁切 region 0.344（DocVQA 500 页池）；128 源首次编码 98 s @8 线程。",
        install_path: "%USERPROFILE%\\neuink-visual-models\\qwen3-vl-embedding-2b",
        install_commands: &[
            "huggingface-cli download Qwen/Qwen3-VL-Embedding-2B --local-dir \"%USERPROFILE%\\neuink-visual-models\\qwen3-vl-embedding-2b\"",
            "set NEUINK_QWEN_VL_MODEL=%USERPROFILE%\\neuink-visual-models\\qwen3-vl-embedding-2b",
            "python apps/desktop/scripts/qwen-visual-service/service.py --port 8765",
        ],
        current_default: true,
    },
    RecommendedVisualModel {
        id: "siglip2-base-patch16-224",
        display_name: "SigLIP2 base（更小）",
        repository: "google/siglip2-base-patch16-224",
        homepage: "https://huggingface.co/google/siglip2-base-patch16-224",
        weights_megabytes: 1501,
        dimensions: 768,
        note: "权重约 1.5 GB（约为当前 35%），中英尚可；接入只需改服务脚本的图文编码，Rust 侧不改。质量未在本项目数据上测过。",
        install_path: "%USERPROFILE%\\neuink-visual-models\\siglip2-base-patch16-224",
        install_commands: &[
            "huggingface-cli download google/siglip2-base-patch16-224 --local-dir \"%USERPROFILE%\\neuink-visual-models\\siglip2-base-patch16-224\"",
            "set NEUINK_QWEN_VL_MODEL=%USERPROFILE%\\neuink-visual-models\\siglip2-base-patch16-224",
            "python apps/desktop/scripts/qwen-visual-service/service.py --port 8765",
        ],
        current_default: false,
    },
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_visual_entry_links_its_page_and_reports_a_dimension() {
        for model in RECOMMENDED_VISUAL.iter() {
            assert!(model.homepage.starts_with("https://huggingface.co/"), "{}", model.id);
            assert!(model.dimensions > 0, "{}", model.id);
            assert!(model.weights_megabytes > 0, "{}", model.id);
            assert!(!model.install_path.is_empty(), "{} needs an install path", model.id);
            assert!(
                model.install_commands.len() >= 2,
                "{} must show download and start steps",
                model.id
            );
        }
    }

    #[test]
    fn exactly_one_entry_is_the_current_default() {
        assert_eq!(
            RECOMMENDED_VISUAL
                .iter()
                .filter(|model| model.current_default)
                .count(),
            1
        );
    }
}


