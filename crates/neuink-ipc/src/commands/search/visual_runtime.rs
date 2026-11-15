//! One-click setup for the optional local visual service.
//!
//! The visual encoder is a 4 GB PyTorch checkpoint, so it cannot ship inside the app. What
//! the app *can* do is prepare everything the service needs in one action: an isolated
//! Python environment with pinned inference dependencies, plus the model weights, both under
//! a per-model directory. Nothing is installed globally, and an existing local model
//! directory can be reused instead of downloading 4 GB again.
//!
//! Everything here is best-effort and inspectable: the state file records what was done, and
//! a missing tool reports a fixed reason instead of failing silently.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::commands::search::recommended_visual_models::{RecommendedVisualModel, RECOMMENDED_VISUAL};

/// CPU-only torch: the CUDA wheel is multiple gigabytes larger and these laptops have no GPU.
const TORCH_INDEX: &str = "https://download.pytorch.org/whl/cpu";
const DEPENDENCIES: [&str; 4] = ["torch", "transformers", "qwen-vl-utils", "pillow"];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VisualRuntimeState {
    pub model_id: String,
    /// Directory holding the isolated Python environment.
    pub env_dir: String,
    /// Directory holding the model weights.
    pub model_dir: String,
    /// Interpreter inside the environment.
    pub python: String,
    pub dependencies_installed: bool,
    pub model_present: bool,
}

/// Fixed reasons the screen can translate without parsing messages.
pub const REASON_UV_MISSING: &str = "uv_missing";
pub const REASON_MODEL_MISSING: &str = "model_missing";
pub const REASON_INSTALL_FAILED: &str = "install_failed";

fn find_uv() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("NEUINK_UV") {
        let candidate = PathBuf::from(path);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    let from_path = Command::new("uv").arg("--version").output();
    if from_path.map(|output| output.status.success()).unwrap_or(false) {
        return Some(PathBuf::from("uv"));
    }
    let home = std::env::var("USERPROFILE").ok().map(PathBuf::from)?;
    let candidate = home.join(".local").join("bin").join("uv.exe");
    candidate.is_file().then_some(candidate)
}

/// Per-model working directory.
pub fn runtime_dir(resource_dir: &Path, model_id: &str) -> PathBuf {
    resource_dir.join("visual-service").join(model_id)
}

pub fn load_state(resource_dir: &Path, model_id: &str) -> Option<VisualRuntimeState> {
    let path = runtime_dir(resource_dir, model_id).join("state.json");
    let bytes = std::fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn write_state(state: &VisualRuntimeState, resource_dir: &Path) -> Result<(), String> {
    let dir = runtime_dir(resource_dir, &state.model_id);
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let bytes = serde_json::to_vec_pretty(state).map_err(|error| error.to_string())?;
    std::fs::write(dir.join("state.json"), bytes).map_err(|error| error.to_string())
}

fn model_of(model_id: &str) -> Option<RecommendedVisualModel> {
    RECOMMENDED_VISUAL.iter().copied().find(|model| model.id == model_id)
}

/// Reads a model directory's manifest facts without touching the network.
fn model_weights_present(dir: &Path) -> bool {
    ["model.safetensors", "pytorch_model.bin"]
        .iter()
        .any(|name| dir.join(name).is_file())
}

/// Prepares environment and weights. `reuse_model_dir` skips the download entirely.
pub fn install(
    resource_dir: &Path,
    model_id: &str,
    reuse_model_dir: Option<&Path>,
) -> Result<VisualRuntimeState, String> {
    let model = model_of(model_id).ok_or_else(|| format!("未知的视觉模型：{model_id}"))?;
    let uv = find_uv().ok_or_else(|| REASON_UV_MISSING.to_string())?;
    let dir = runtime_dir(resource_dir, model_id);
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let env_dir = dir.join("env");
    let model_dir = reuse_model_dir
        .map(|path| path.to_path_buf())
        .unwrap_or_else(|| dir.join("model"));

    // 1) Isolated environment.
    let venv = Command::new(&uv)
        .args(["venv", "--python", "3.11"])
        .arg(&env_dir)
        .output()
        .map_err(|error| format!("无法运行 uv：{error}"))?;
    if !venv.status.success() {
        return Err(format!(
            "创建 Python 环境失败：{}",
            String::from_utf8_lossy(&venv.stderr).trim()
        ));
    }
    #[cfg(windows)]
    let python = env_dir.join("Scripts").join("python.exe");
    #[cfg(not(windows))]
    let python = env_dir.join("bin").join("python");

    // 2) Inference dependencies, CPU torch to stay within a sane download size.
    let install = Command::new(&uv)
        .args(["pip", "install", "--python"])
        .arg(&python)
        .arg("--extra-index-url")
        .arg(TORCH_INDEX)
        .args(DEPENDENCIES)
        .output()
        .map_err(|error| format!("无法安装依赖：{error}"))?;
    let dependencies_installed = install.status.success();

    // 3) Weights, unless a local directory was supplied.
    let mut model_present = model_weights_present(&model_dir);
    if !model_present && reuse_model_dir.is_none() {
        let download = Command::new(&uv)
            .args(["run", "--python"])
            .arg(&python)
            .args(["python", "-c"])
            .arg(format!(
                "from huggingface_hub import snapshot_download; snapshot_download('{}', local_dir=r'{}')",
                model.repository,
                model_dir.display()
            ))
            .output()
            .map_err(|error| format!("无法下载模型：{error}"))?;
        model_present = download.status.success() && model_weights_present(&model_dir);
    }

    let state = VisualRuntimeState {
        model_id: model_id.to_string(),
        env_dir: env_dir.to_string_lossy().to_string(),
        model_dir: model_dir.to_string_lossy().to_string(),
        python: python.to_string_lossy().to_string(),
        dependencies_installed,
        model_present,
    };
    write_state(&state, resource_dir)?;
    if !dependencies_installed {
        return Err(format!(
            "{REASON_INSTALL_FAILED}: {}",
            String::from_utf8_lossy(&install.stderr).trim()
        ));
    }
    Ok(state)
}

/// Starts the service with the prepared environment, returning the child process id.
pub fn start(resource_dir: &Path, service_script: &Path, model_id: &str) -> Result<u32, String> {
    let state = load_state(resource_dir, model_id).ok_or_else(|| REASON_MODEL_MISSING.to_string())?;
    if !state.dependencies_installed || !state.model_present {
        return Err(REASON_MODEL_MISSING.to_string());
    }
    let child = Command::new(&state.python)
        .arg(service_script)
        .args(["--port", "8765"])
        .env("NEUINK_QWEN_VL_MODEL", &state.model_dir)
        .env("NEUINK_TORCH_THREADS", "8")
        .spawn()
        .map_err(|error| format!("无法启动视觉服务：{error}"))?;
    Ok(child.id())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_round_trips_per_model_directory() {
        let root = std::env::temp_dir().join(format!("neuink-visual-runtime-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let state = VisualRuntimeState {
            model_id: "qwen3-vl-embedding-2b".to_string(),
            env_dir: "env".to_string(),
            model_dir: "model".to_string(),
            python: "python".to_string(),
            dependencies_installed: true,
            model_present: false,
        };
        write_state(&state, &root).expect("write");
        let loaded = load_state(&root, "qwen3-vl-embedding-2b").expect("load");
        assert_eq!(loaded.model_dir, "model");
        assert!(load_state(&root, "unknown").is_none());
        std::fs::remove_dir_all(&root).ok();
    }
}

