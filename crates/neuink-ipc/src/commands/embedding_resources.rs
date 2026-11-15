use std::path::PathBuf;

use neuink_search::{EmbeddingProvider, FastEmbedProvider, DEFAULT_EMBEDDING_MODEL_RESOURCE_DIR};
use tauri::Manager;

pub fn embedding_model_dir<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.to_path_buf()));

    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/desktop/src-tauri/resources")
        .join(DEFAULT_EMBEDDING_MODEL_RESOURCE_DIR);

    let mut candidates = vec![
        resource_dir.join(DEFAULT_EMBEDDING_MODEL_RESOURCE_DIR),
        resource_dir
            .join("resources")
            .join(DEFAULT_EMBEDDING_MODEL_RESOURCE_DIR),
    ];
    if let Some(exe_dir) = exe_dir {
        candidates.push(exe_dir.join(DEFAULT_EMBEDDING_MODEL_RESOURCE_DIR));
        candidates.push(
            exe_dir
                .join("resources")
                .join(DEFAULT_EMBEDDING_MODEL_RESOURCE_DIR),
        );
    }
    candidates.push(dev);

    for candidate in candidates.iter() {
        if FastEmbedProvider::from_model_dir(candidate)
            .status()
            .available
        {
            return Ok(candidate.clone());
        }
    }

    Ok(candidates
        .into_iter()
        .next()
        .unwrap_or_else(|| PathBuf::from(DEFAULT_EMBEDDING_MODEL_RESOURCE_DIR)))
}

/// Bundled cross-encoder directory (`embedding-models/reranker`).
///
/// Feature-free resolution, like `visual_model_dir`: it checks for the ONNX file instead
/// of asking the reranker type, so a build without `local-embedding` reports the same path
/// and the rerank stage simply falls back.
pub fn rerank_model_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    const RERANK_DIR: &str = "embedding-models/reranker";

    let resource_dir = app.path().resource_dir().map_err(|error| error.to_string())?;
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.to_path_buf()));
    let mut candidates = vec![
        resource_dir.join(RERANK_DIR),
        resource_dir.join("resources").join(RERANK_DIR),
    ];
    if let Some(exe_dir) = exe_dir {
        candidates.push(exe_dir.join(RERANK_DIR));
        candidates.push(exe_dir.join("resources").join(RERANK_DIR));
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../apps/desktop/src-tauri/resources")
            .join(RERANK_DIR),
    );
    for candidate in &candidates {
        if ["onnx/model_int8.onnx", "onnx/model.onnx", "model.onnx"]
            .iter()
            .any(|relative| candidate.join(relative).is_file())
        {
            return Ok(candidate.clone());
        }
    }
    Ok(candidates.into_iter().next().unwrap_or_else(|| PathBuf::from(RERANK_DIR)))
}
/// Optional dedicated encoder for the assistant router.
///
/// Routing thresholds and `query:` prefixes were calibrated on e5-small, so it must not
/// silently borrow whatever encoder the search path currently uses: switching search to
/// bge-m3 would otherwise disable routing without a trace. A separate directory keeps the
/// two independent: routing uses it when present, and otherwise falls back to the search
/// directory only if that directory still holds the calibrated model.
pub fn router_model_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    const ROUTER_DIR: &str = "embedding-models/router";

    let resource_dir = app.path().resource_dir().map_err(|error| error.to_string())?;
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.to_path_buf()));
    let mut candidates = vec![
        resource_dir.join(ROUTER_DIR),
        resource_dir.join("resources").join(ROUTER_DIR),
    ];
    if let Some(exe_dir) = exe_dir {
        candidates.push(exe_dir.join(ROUTER_DIR));
        candidates.push(exe_dir.join("resources").join(ROUTER_DIR));
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../apps/desktop/src-tauri/resources")
            .join(ROUTER_DIR),
    );
    for candidate in &candidates {
        if ["onnx/model.onnx", "onnx/model_int8.onnx", "model.onnx"]
            .iter()
            .any(|relative| candidate.join(relative).is_file())
        {
            return Ok(candidate.clone());
        }
    }
    embedding_model_dir(app)
}
