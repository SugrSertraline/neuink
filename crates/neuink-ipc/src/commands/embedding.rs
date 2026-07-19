use neuink_search::{EmbeddingProvider, EmbeddingProviderStatus, FastEmbedProvider};

use super::embedding_resources::embedding_model_dir;

#[tauri::command]
pub fn get_embedding_status<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<EmbeddingProviderStatus, String> {
    let model_dir = embedding_model_dir(&app)?;
    Ok(FastEmbedProvider::from_model_dir(model_dir).status())
}
