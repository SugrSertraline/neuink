import { Button } from '@/components/ui/button';
import { SettingSelect } from './SettingsPrimitives';
import type { SettingsPanelLayoutProps } from './SettingsPanelLayout';

export function TaskModelSetting({ props, task }: { props: SettingsPanelLayoutProps; task: 'assistant' | 'translation' }) {
  const translation = task === 'translation';
  const selected = translation ? props.draftTranslationProfileId : props.draftAssistantProfileId;
  const title = translation ? '阅读翻译模型' : '助手对话模型';
  return <div className="settings-form" data-setting-id={translation ? 'translation-model' : 'models-assistant'} tabIndex={-1}>
    <SettingSelect label={title} description={translation ? '用于整篇、片段和选中文字翻译。模型连接为应用配置。' : '用于助手对话、资料问答和内容草拟。模型连接为应用配置。'}
      value={selected ?? ''} disabled={props.busy || props.settings.profiles.length === 0 || props.modelsUnavailable}
      placeholder={props.modelsUnavailable ? '配置尚未就绪' : '尚未配置模型'}
      options={props.settings.profiles.map(profile => ({ value: profile.id, label: `${profile.name} · ${profile.model}` }))}
      onValueChange={value => props.onSetTaskProfile(task, value)} />
    {props.modelsUnavailable ? <p className="text-xs text-muted-foreground">模型配置尚未就绪，请查看下方加载状态。</p>
      : !selected && <p className="text-xs text-warning">尚未指定模型，此功能暂不可用。</p>}
    {translation && <Button size="xs" variant="ghost" onClick={() => props.onSetActiveSettingsTab('models')}>管理模型连接</Button>}
  </div>;
}
