use neuink_search::EmbeddingProviderStatus;

use super::search::text_provider_for_app;

#[tauri::command]
pub fn get_embedding_status<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<EmbeddingProviderStatus, String> {
    Ok(text_provider_for_app(&app)?.status())
}
