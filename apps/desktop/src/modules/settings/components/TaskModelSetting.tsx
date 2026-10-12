import { Button } from '@/components/ui/button';
import { SettingSelect } from './SettingsPrimitives';
import type { SettingsPanelLayoutProps } from './SettingsPanelLayout';

export function TaskModelSetting({ props, task }: { props: SettingsPanelLayoutProps; task: 'assistant' | 'translation' }) {
  const translation = task === 'translation';
  const selected = translation ? props.draftTranslationProfileId : props.draftAssistantProfileId;
  const title = translation ? '整体翻译模型' : '助手对话模型';
  return <div className="settings-form" data-setting-id={translation ? 'translation-model' : 'models-assistant'} tabIndex={-1}>
    <SettingSelect label={title} description={translation ? '用于整篇和段落／片段翻译，选择后自动保存。选中文字仅在选择“沿用整体翻译模型”时使用此模型。' : '用于对话、资料问答和笔记整理。选择后自动保存。'}
      value={selected ?? ''} disabled={props.busy || props.settings.profiles.length === 0 || props.modelsUnavailable}
      placeholder={props.modelsUnavailable ? '配置尚未就绪' : '尚未配置模型'}
      options={props.settings.profiles.map(profile => ({ value: profile.id, label: `${profile.name} · ${profile.model}` }))}
      onValueChange={value => props.onSetTaskProfile(task, value)} />
    {props.modelsUnavailable ? <p className="text-xs text-muted-foreground">模型配置尚未就绪，请查看下方加载状态。</p>
      : !selected && <p className="text-xs text-warning">{translation ? '尚未指定整体翻译模型；已单独配置的选中文字翻译服务仍可使用。' : '尚未指定模型，此功能暂不可用。'}</p>}
    {translation && <Button size="xs" variant="ghost" onClick={() => props.onSetActiveSettingsTab('models')}>管理模型连接</Button>}
  </div>;
}
