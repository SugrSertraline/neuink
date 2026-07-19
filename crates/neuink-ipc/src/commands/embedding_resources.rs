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
