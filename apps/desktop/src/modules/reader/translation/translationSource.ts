import type { LlmSettingsState } from '@/shared/ipc/assistantApi';
import type { TranslationSource } from '@/shared/ipc/translationRoutingApi';

export function translationSourceProfile(settings: LlmSettingsState, source: TranslationSource) {
  if (source.kind === 'selection_service' || source.kind === 'service') throw new Error('请通过选区翻译服务执行此请求。');
  const profile = source.kind === 'profile'
    ? settings.profiles.find(profile => profile.id === source.profile_id)
    : settings.translation_profile;
  if (!profile) throw new Error(source.kind === 'profile'
    ? '此翻译类型指定的模型已删除，请在设置 → 翻译中重新选择。'
    : '请先在设置 → 翻译中配置统一默认模型。');
  return profile;
}
