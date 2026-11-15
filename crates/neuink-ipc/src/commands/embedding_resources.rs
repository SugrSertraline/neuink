use std::path::PathBuf;

use neuink_search::{EmbeddingProvider, FastEmbedProvider, DEFAULT_EMBEDDING_MODEL_RESOURCE_DIR};
use tauri::Manager;

pub fn embedding_model_dir<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<PathBuf, String> {
    // A configured directory wins, but only when it actually holds a usable model: a stale
    // path must not silently disable semantic search for everyone.
    if let Some(override_dir) = configured_model_dir(app) {
        if FastEmbedProvider::from_model_dir(&override_dir).status().available {
            return Ok(override_dir);
        }
    }
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


/// The user-selected text model directory, if one is configured and exists.
fn configured_model_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<PathBuf> {
    let configured = crate::storage::read_settings(app).ok()?.text_model.model_dir?;
    let path = PathBuf::from(configured);
    path.is_dir().then_some(path)
}

/// One selectable text model directory found next to the bundled one.
#[derive(Debug, serde::Serialize)]
pub struct TextModelChoice {
    pub id: String,
    pub model_name: Option<String>,
    pub dimensions: Option<usize>,
    pub pooling: Option<String>,
    pub path: String,
    pub bundled: bool,
}

/// Lists model directories under `resources/embedding-models/*` that carry a manifest and an
/// ONNX file, so the settings screen can offer real choices instead of a free-text field.
pub fn list_text_models<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<Vec<TextModelChoice>, String> {
    let resource_dir = app.path().resource_dir().map_err(|error| error.to_string())?;
    let mut roots = vec![resource_dir.join("embedding-models")];
    if let Some(exe_dir) = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
    {
        roots.push(exe_dir.join("embedding-models"));
    }
    roots.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../apps/desktop/src-tauri/resources/embedding-models"),
    );

    let mut choices: Vec<TextModelChoice> = Vec::new();
    for root in roots {
        let Ok(entries) = std::fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let Some(manifest) = read_model_manifest(&path) else {
                continue;
            };
            let id = path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default()
                .to_string();
            if choices.iter().any(|choice| choice.id == id) {
                continue;
            }
            choices.push(TextModelChoice {
                bundled: id == "default",
                id,
                model_name: manifest.0,
                dimensions: manifest.1,
                pooling: manifest.2,
                path: path.to_string_lossy().to_string(),
            });
        }
    }
    choices.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(choices)
}

/// Reads the parts of `neuink-embedding.json` the UI shows.
fn read_model_manifest(dir: &std::path::Path) -> Option<(Option<String>, Option<usize>, Option<String>)> {
    const MODEL_FILES: [&str; 3] = ["onnx/model.onnx", "onnx/model_int8.onnx", "model.onnx"];
    if !MODEL_FILES.iter().any(|name| dir.join(name).is_file()) {
        return None;
    }
    let bytes = std::fs::read(dir.join("neuink-embedding.json")).ok()?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    Some((
        value.get("model_name").and_then(|item| item.as_str()).map(str::to_string),
        value.get("dimensions").and_then(|item| item.as_u64()).map(|value| value as usize),
        value.get("pooling").and_then(|item| item.as_str()).map(str::to_string),
    ))
}
