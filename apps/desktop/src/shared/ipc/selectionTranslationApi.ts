import { invoke } from '@tauri-apps/api/core';

export type SelectionTranslationProvider = 'reading_model' | 'azure' | 'deepl' | 'qwen_mt';
export type SelectionTranslationSettings = {
  provider: SelectionTranslationProvider; endpoint: string; model: string; region: string; has_key: boolean;
};
export type SelectionTranslationSave = Omit<SelectionTranslationSettings, 'has_key'> & { api_key?: string };
export const getSelectionTranslationSettings = () => invoke<SelectionTranslationSettings>('get_selection_translation_settings');
export const saveSelectionTranslationSettings = (request: SelectionTranslationSave) =>
  invoke<SelectionTranslationSettings>('save_selection_translation_settings', { request });
export const testSelectionTranslationService = (request: SelectionTranslationSave) =>
  invoke<string>('test_selection_translation_service', { request });
export class SelectionTranslationServiceError extends Error {}
export async function translateSelectionService(text: string) {
  try { return await invoke<string | null>('translate_selection_service', { text }); }
  catch (error) {
    const detail = String(error);
    const message = /HTTP (401|403)/.test(detail) ? '选区翻译服务认证失败，请检查 API Key、区域和账号额度。'
      : /HTTP (429|456)/.test(detail) ? '选区翻译服务额度不足或请求过于频繁，请检查额度或稍后重试。'
      : /HTTP 404/.test(detail) ? '选区翻译请求地址不存在，请在设置中检查完整请求地址。'
      : /超时/.test(detail) ? '选区翻译服务响应超时，请重试或在设置中更换服务。'
      : /API Key|凭据/.test(detail) ? '请在设置 → 翻译 → 选中文字翻译中配置 API Key。'
      : /12000/.test(detail) ? '选区过长，请每次选择不超过 12000 个字符。'
      : '选区翻译未完成，请检查服务类型、请求地址、模型名称和网络后重试。';
    throw new SelectionTranslationServiceError(message);
  }
}
