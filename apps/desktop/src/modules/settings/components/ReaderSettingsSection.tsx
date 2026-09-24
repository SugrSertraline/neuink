import type { ReaderPreferences } from '@/shared/lib/readerPreferences';
import type { SettingsPanelLayoutProps } from './SettingsPanelLayout';
import { SettingsPage, SettingsGroup, SettingSelect, SettingSwitch, SettingCheckbox } from './SettingsPrimitives';

const PREVIEW_CONTENT = [
  ['hoverPreviewShowOriginal', '解析后原文'], ['hoverPreviewShowTranslation', '译文'],
  ['hoverPreviewShowNote', '片段记录'], ['hoverPreviewShowAnnotation', '批注']
] as const;

export function ReaderSettingsSection({ props }: { props: SettingsPanelLayoutProps }) {
  const p = props.readerPreferences;
  const update = (patch: Partial<ReaderPreferences>) => props.onReaderPreferencesChange({ ...p, ...patch });
  const previewDisabled = !p.hoverPreviewEnabled && !p.reflowHoverSourceEnabled;
  return <SettingsPage tab="reader" title="阅读与批注" description="本机偏好 · 控制 PDF 和重排阅读的交互。翻译相关选项集中在“翻译”。">
    <SettingsGroup title="打开条目">
      <SettingSwitch id="reader-open-pdf" label="有 PDF 时直接打开 PDF" description="打开条目时优先阅读 PDF；关闭后或没有 PDF 时显示条目概览。" checked={p.openEntryPdfByDefault ?? true} onCheckedChange={openEntryPdfByDefault => update({ openEntryPdfByDefault })} />
    </SettingsGroup>
    <SettingsGroup title="悬停预览">
      <SettingSwitch id="reader-preview" label="PDF 悬停预览" description="鼠标悬停在 PDF 片段上时显示内容预览。" checked={p.hoverPreviewEnabled} onCheckedChange={hoverPreviewEnabled => update({ hoverPreviewEnabled })} />
      <SettingSwitch id="reader-reflow-preview" label="重排悬停预览" description="鼠标悬停在重排内容上时显示对应片段。" checked={p.reflowHoverSourceEnabled} onCheckedChange={reflowHoverSourceEnabled => update({ reflowHoverSourceEnabled })} />
      <SettingsGroup id="reader-preview-content" title="预览显示内容" description={previewDisabled ? '请先开启 PDF 或重排悬停预览；当前选择会保留。' : 'PDF 与重排预览共用以下内容选择。'}>
        <div className="settings-checkbox-grid">{PREVIEW_CONTENT.map(([key, label]) => <SettingCheckbox key={key} label={label} checked={p[key]} disabled={previewDisabled} onCheckedChange={checked => update({ [key]: checked })} />)}</div>
        <SettingCheckbox label="PDF 预览时高亮对应区域" checked={p.hoverPreviewShowRegion} disabled={!p.hoverPreviewEnabled} onCheckedChange={hoverPreviewShowRegion => update({ hoverPreviewShowRegion })} />
      </SettingsGroup>
      <details className="settings-advanced" data-setting-id="reader-preview-size" tabIndex={-1}>
        <summary>PDF 预览大小</summary>
        <SettingSelect label="预览文字大小" disabled={!p.hoverPreviewEnabled} value={p.pdfHoverPreviewFontSize}
          options={[{ value: 'small', label: '较小' }, { value: 'standard', label: '标准' }, { value: 'large', label: '较大' }]}
          onValueChange={value => update({ pdfHoverPreviewFontSize: value as ReaderPreferences['pdfHoverPreviewFontSize'] })} />
        <SettingSelect label="预览卡片大小" disabled={!p.hoverPreviewEnabled} value={p.pdfHoverPreviewSize}
          options={[{ value: 'compact', label: '紧凑' }, { value: 'standard', label: '标准' }, { value: 'large', label: '宽大' }]}
          onValueChange={value => update({ pdfHoverPreviewSize: value as ReaderPreferences['pdfHoverPreviewSize'] })} />
      </details>
    </SettingsGroup>
    <SettingsGroup title="分段与片段记录">
      <SettingSwitch id="reader-regions" label="默认显示 PDF 分段框" description="显示 PDF 上解析得到的分段区域框。" checked={p.showRegions} onCheckedChange={showRegions => update({ showRegions })} />
      <SettingSelect id="reader-open-note" label="打开片段记录的方式" description="PDF／重排分屏时，单击始终只定位对侧。" value={p.segmentNoteOpenGesture}
        options={[{ value: 'button', label: '选中后操作' }, { value: 'single', label: '单击' }, { value: 'modifier', label: 'Alt + 单击' }]}
        onValueChange={value => update({ segmentNoteOpenGesture: value as ReaderPreferences['segmentNoteOpenGesture'], leftClickOpensNotePane: value === 'single' })} />
      <SettingsGroup id="reader-close-overlay" title="片段浮层关闭方式" description="可同时启用；有未保存内容时仍保留保存保护。">
        <SettingCheckbox label="点击空白处关闭" checked={p.closeSegmentOverlayOnBlankClick} onCheckedChange={closeSegmentOverlayOnBlankClick => update({ closeSegmentOverlayOnBlankClick })} />
        <SettingCheckbox label="再次点击当前片段关闭" checked={p.closeSegmentOverlayOnSameSegmentClick} onCheckedChange={closeSegmentOverlayOnSameSegmentClick => update({ closeSegmentOverlayOnSameSegmentClick })} />
      </SettingsGroup>
    </SettingsGroup>
  </SettingsPage>;
}
