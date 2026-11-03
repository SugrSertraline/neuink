import type { SettingsPanelLayoutProps } from './SettingsPanelLayout';
import { SettingsPage, SettingsGroup, SettingSwitch, SettingCheckbox } from './SettingsPrimitives';
import { TaskModelSetting } from './TaskModelSetting';
import { SelectionTranslationSettings } from './SelectionTranslationSettings';

const TRANSLATION_TYPES = [
  ['paragraph', '段落'], ['heading', '标题'], ['table', '表格'], ['math', '公式'], ['figure', '图片'], ['code', '代码'],
  ['list', '列表'], ['page_header', '页眉'], ['page_footer', '页脚'], ['page_number', '页码'], ['aside_text', '侧栏文字'], ['page_footnote', '脚注']
] as const;

export function TranslationSettingsSection({ props }: { props: SettingsPanelLayoutProps }) {
  const p = props.readerPreferences;
  const automation = props.translationAutomation;
  return <SettingsPage tab="translation" title="翻译" description="配置选中文字、整篇与片段翻译。">
    <SelectionTranslationSettings active={props.activeSettingsTab === 'translation'}>
      <SettingSwitch id="translation-selection" label="选中文字后自动翻译" description="本机阅读偏好 · 关闭后仍可手动点击“翻译”。" checked={p.autoTranslateTextSelection}
        onCheckedChange={autoTranslateTextSelection => props.onReaderPreferencesChange({ ...p, autoTranslateTextSelection })} />
    </SelectionTranslationSettings>
    <SettingsGroup title="整篇与片段翻译" description="使用下方模型翻译整篇 PDF 和阅读器中的段落／片段；选中文字的专用服务独立配置。">
      <TaskModelSetting props={props} task="translation" />
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
