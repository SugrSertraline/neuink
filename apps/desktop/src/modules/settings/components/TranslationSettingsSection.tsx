import type { ReaderPreferences } from '@/shared/lib/readerPreferences';
import type { SettingsPanelLayoutProps } from './SettingsPanelLayout';
import { SettingsPage, SettingsGroup, SettingSelect, SettingSwitch, SettingCheckbox } from './SettingsPrimitives';
import { TaskModelSetting } from './TaskModelSetting';

const TRANSLATION_TYPES = [
  ['paragraph', '段落'], ['heading', '标题'], ['table', '表格'], ['math', '公式'], ['figure', '图片'], ['code', '代码'],
  ['list', '列表'], ['page_header', '页眉'], ['page_footer', '页脚'], ['page_number', '页码'], ['aside_text', '侧栏文字'], ['page_footnote', '脚注']
] as const;

export function TranslationSettingsSection({ props }: { props: SettingsPanelLayoutProps }) {
  const p = props.readerPreferences;
  const automation = props.translationAutomation;
  return <SettingsPage tab="translation" title="翻译" description="集中管理翻译模型、自动翻译和译文显示。自动翻译会调用所选模型。">
    <SettingsGroup title="翻译模型"><TaskModelSetting props={props} task="translation" /></SettingsGroup>
    <SettingsGroup title="自动翻译">
      <SettingSwitch id="translation-selection" label="选中文字后自动翻译" description="本机阅读偏好 · 关闭后仍可手动点击“翻译”。" checked={p.autoTranslateTextSelection}
        onCheckedChange={autoTranslateTextSelection => props.onReaderPreferencesChange({ ...p, autoTranslateTextSelection })} />
      <SettingSwitch id="translation-auto" label="解析后自动翻译 PDF" description="应用偏好 · PDF 解析成功后自动启动英译中。" checked={automation.auto_translate_pdf} disabled={props.workspaceSettingsUnavailable}
        onCheckedChange={auto_translate_pdf => props.onTranslationAutomationChange({ ...automation, auto_translate_pdf })} />
      <SettingsGroup id="translation-content" title="自动翻译内容范围" description={automation.auto_translate_pdf ? '选择参与自动翻译的内容类型。' : '开启“解析后自动翻译 PDF”后生效；当前选择会保留。'}>
        <div className="settings-checkbox-grid">{TRANSLATION_TYPES.map(([value, label]) => <SettingCheckbox key={value} label={label}
          disabled={!automation.auto_translate_pdf || props.workspaceSettingsUnavailable} checked={automation.segment_types.includes(value)}
          onCheckedChange={checked => props.onTranslationAutomationChange({ ...automation, segment_types: checked ? [...automation.segment_types, value] : automation.segment_types.filter(type => type !== value) })} />)}</div>
        {automation.auto_translate_pdf && !automation.segment_types.length && <p role="status" className="mt-2 text-xs text-warning">至少选择一种内容类型，否则不会启动自动翻译。</p>}
      </SettingsGroup>
    </SettingsGroup>
    <SettingsGroup title="译文显示">
      <SettingSelect id="translation-display" label="重排翻译显示" description="本机阅读偏好 · 设置重排视图默认显示的内容。" value={p.reflowTranslationMode}
        options={[{ value: 'source', label: '原文' }, { value: 'translation', label: '译文' }, { value: 'bilingual', label: '双语对照' }]}
        onValueChange={value => props.onReaderPreferencesChange({ ...p, reflowTranslationMode: value as ReaderPreferences['reflowTranslationMode'] })} />
    </SettingsGroup>
  </SettingsPage>;
}
