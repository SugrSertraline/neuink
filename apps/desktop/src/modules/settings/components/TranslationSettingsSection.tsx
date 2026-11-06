import type { SettingsPanelLayoutProps } from './SettingsPanelLayout';
import { SettingsPage, SettingsGroup, SettingsDisclosure, SettingSwitch, SettingCheckbox } from './SettingsPrimitives';
import { SelectionTranslationSettings } from './SelectionTranslationSettings';
import { TranslationSourcesSettings } from './TranslationSourcesSettings';
import { Button } from '@/components/ui/button';

const TRANSLATION_TYPES = [
  ['paragraph', '段落'], ['heading', '标题'], ['table', '表格'], ['math', '公式'], ['figure', '图片'], ['code', '代码'],
  ['list', '列表'], ['page_header', '页眉'], ['page_footer', '页脚'], ['page_number', '页码'], ['aside_text', '侧栏文字'], ['page_footnote', '脚注']
] as const;

export function TranslationSettingsSection({ props }: { props: SettingsPanelLayoutProps }) {
  const p = props.readerPreferences;
  const automation = props.translationAutomation;
  return <SettingsPage tab="translation" title="翻译" description="先配置翻译模型与服务，再指定每种翻译行为使用哪个来源。">
    <SelectionTranslationSettings active={props.activeSettingsTab === 'translation'} modelConnections={
      <SettingsDisclosure id="translation-model-connections" title="大模型连接" description="使用“模型与助手”中已保存的连接"
        status={props.modelsUnavailable ? '尚未就绪' : props.settings.profiles.length ? `已配置 ${props.settings.profiles.length} 个` : '未配置'}>
        {props.modelsUnavailable ? <p className="text-xs text-muted-foreground">模型配置尚未就绪，请在“模型与助手”中查看加载状态或重试。</p>
          : props.settings.profiles.length ? <ul aria-label="可用于翻译的大模型连接" className="divide-y divide-border">
            {props.settings.profiles.map(profile => <li key={profile.id} className="min-w-0 py-2 first:pt-0">
              <p className="truncate text-[13px] font-medium" title={profile.name}>{profile.name}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground" title={profile.model}>{profile.model}</p>
            </li>)}
          </ul> : <p className="text-xs text-muted-foreground">还没有大模型连接，可前往“模型与助手”添加。</p>}
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          <Button size="xs" variant="outline" onClick={() => props.onSetActiveSettingsTab('models')}>配置大模型连接</Button>
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">连接和 API Key 与系统模型配置共用。配置后，请在下方“翻译行为”中选择具体模型。</p>
      </SettingsDisclosure>
    } />
    <TranslationSourcesSettings active={props.activeSettingsTab === 'translation'} profiles={props.settings.profiles}
      defaultProfileId={props.draftTranslationProfileId} unavailable={props.modelsUnavailable} />
    <SettingsGroup title="自动翻译" description="按上方相应场景的翻译来源执行。">
      <SettingSwitch id="translation-selection" label="选中文字后自动翻译" description="本机阅读偏好 · 关闭后仍可手动点击“翻译”。" checked={p.autoTranslateTextSelection}
        onCheckedChange={autoTranslateTextSelection => props.onReaderPreferencesChange({ ...p, autoTranslateTextSelection })} />
      <SettingSwitch id="translation-auto" label="解析后自动翻译 PDF" description="应用偏好 · PDF 解析成功后自动启动英译中。" checked={automation.auto_translate_pdf} disabled={props.workspaceSettingsUnavailable}
        onCheckedChange={auto_translate_pdf => props.onTranslationAutomationChange({ ...automation, auto_translate_pdf })} />
    </SettingsGroup>
    <SettingsGroup id="translation-content" title="自动翻译范围" description={automation.auto_translate_pdf ? '选择解析完成后自动翻译的内容类型；不影响手动翻译。' : '开启“解析后自动翻译 PDF”后可设置；已选范围会保留。'}>
      {automation.auto_translate_pdf && <>
        <div className="settings-checkbox-grid">{TRANSLATION_TYPES.map(([value, label]) => <SettingCheckbox key={value} label={label}
          disabled={props.workspaceSettingsUnavailable} checked={automation.segment_types.includes(value)}
          onCheckedChange={checked => props.onTranslationAutomationChange({ ...automation, segment_types: checked ? [...automation.segment_types, value] : automation.segment_types.filter(type => type !== value) })} />)}</div>
        {!automation.segment_types.length && <p role="status" className="mt-2 text-xs text-warning">至少选择一种内容类型，否则不会启动自动翻译。</p>}
      </>}
    </SettingsGroup>
  </SettingsPage>;
}
