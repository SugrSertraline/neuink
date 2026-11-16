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
const DEPENDENCIES: [&str; 5] = ["torch", "transformers", "torchvision", "qwen-vl-utils", "pillow"];

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
    /// Why the weights are missing, when they are. Free text from the downloader, truncated,
    /// so the settings screen can show a real reason instead of a silent gap.
    #[serde(default)]
    pub model_error: Option<String>,
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

    // 3) Weights. A download failure is reported, not swallowed: the environment stays
    // usable and "download weights" can be retried without redoing the dependency install.
    let mut model_present = model_weights_present(&model_dir);
    let mut model_error = None;
    if !model_present {
        if let Some(reuse) = reuse_model_dir {
            model_error = Some(format!(
                "指定的本地权重目录里没有 model.safetensors / pytorch_model.bin：{}",
                reuse.display()
            ));
        } else {
            match download_weights(&uv, &python, model.repository, &model_dir) {
                Ok(()) => model_present = true,
                Err(reason) => model_error = Some(reason),
            }
        }
    }

    let state = VisualRuntimeState {
        model_id: model_id.to_string(),
        env_dir: env_dir.to_string_lossy().to_string(),
        model_dir: model_dir.to_string_lossy().to_string(),
        python: python.to_string_lossy().to_string(),
        dependencies_installed,
        model_present,
        model_error,
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

/// One download attempt against a specific Hugging Face endpoint.
fn run_download(
    uv: &Path,
    python: &Path,
    repository: &str,
    model_dir: &Path,
    endpoint: Option<&str>,
) -> Result<(), String> {
    let mut command = Command::new(uv);
    command
        .args(["run", "--python"])
        .arg(python)
        .args(["python", "-c"])
        .arg(format!(
            "from huggingface_hub import snapshot_download; snapshot_download(''{repository}'', local_dir=r''{}'')",
            model_dir.display()
        ));
    if let Some(endpoint) = endpoint {
        command.env("HF_ENDPOINT", endpoint);
    }
    let download = command
        .output()
        .map_err(|error| format!("无法运行下载器：{error}"))?;
    if !download.status.success() {
        let stderr = String::from_utf8_lossy(&download.stderr);
        let lines = stderr.lines().rev().take(6).collect::<Vec<_>>();
        let tail = lines.into_iter().rev().collect::<Vec<_>>().join(" | ");
        return Err(if tail.trim().is_empty() {
            format!("退出码 {:?}，没有错误输出", download.status.code())
        } else {
            tail
        });
    }
    if !model_weights_present(model_dir) {
        return Err(format!(
            "下载命令成功，但目录里没有 model.safetensors / pytorch_model.bin：{}",
            model_dir.display()
        ));
    }
    Ok(())
}

/// Downloads weights, preferring an explicitly configured endpoint (`NEUINK_HF_ENDPOINT`)
/// and falling back to a mirror when the official host cannot deliver. Measured on a
/// China-network machine: the official host stalls large files behind the local proxy while
/// `hf-mirror.com` completes them.
fn download_weights(
    uv: &Path,
    python: &Path,
    repository: &str,
    model_dir: &Path,
) -> Result<(), String> {
    // Weights that already exist are reused: a retry after a partial external download must
    // not re-fetch 4 GB just to discover the file is there.
    if model_weights_present(model_dir) {
        return Ok(());
    }
    let configured = std::env::var("NEUINK_HF_ENDPOINT")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if let Some(endpoint) = configured.as_deref() {
        return run_download(uv, python, repository, model_dir, Some(endpoint))
            .map_err(|reason| format!("权重下载失败（{endpoint}）：{reason}"));
    }
    match run_download(uv, python, repository, model_dir, None) {
        Ok(()) => Ok(()),
        Err(official) => {
            const MIRROR: &str = "https://hf-mirror.com";
            run_download(uv, python, repository, model_dir, Some(MIRROR))
                .map_err(|mirror| format!("官方端点：{official}；镜像端点：{mirror}"))
        }
    }
}
/// Retries only the weights step for an already prepared environment, so a failed 4 GB
/// download never forces the torch/pip install to run again.
pub fn download_missing_weights(
    resource_dir: &Path,
    model_id: &str,
    reuse_model_dir: Option<&Path>,
) -> Result<VisualRuntimeState, String> {
    let mut state = load_state(resource_dir, model_id)
        .ok_or_else(|| format!("还没有安装依赖，请先执行一键安装：{model_id}"))?;
    if !state.dependencies_installed {
        return Err(REASON_INSTALL_FAILED.to_string());
    }
    let model = model_of(model_id).ok_or_else(|| format!("未知的视觉模型：{model_id}"))?;
    let uv = find_uv().ok_or_else(|| REASON_UV_MISSING.to_string())?;
    let python = PathBuf::from(&state.python);
    let model_dir = reuse_model_dir
        .map(|path| path.to_path_buf())
        .unwrap_or_else(|| PathBuf::from(&state.model_dir));
    state.model_dir = model_dir.to_string_lossy().to_string();
    match download_weights(&uv, &python, model.repository, &model_dir) {
        Ok(()) => {
            state.model_present = true;
            state.model_error = None;
        }
        Err(reason) => {
            state.model_present = model_weights_present(&model_dir);
            state.model_error = Some(reason.clone());
            write_state(&state, resource_dir)?;
            return Err(reason);
        }
    }
    write_state(&state, resource_dir)?;
    Ok(state)
}

/// Starts the service with an already-loaded state, returning the child process id.
pub fn start_with_state(state: &VisualRuntimeState, service_script: &Path) -> Result<u32, String> {
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
            model_error: None,
        };
        write_state(&state, &root).expect("write");
        let loaded = load_state(&root, "qwen3-vl-embedding-2b").expect("load");
        assert_eq!(loaded.model_dir, "model");
        assert!(load_state(&root, "unknown").is_none());
        std::fs::remove_dir_all(&root).ok();
    }
}


