import type { ReaderPreferences } from '@/shared/lib/readerPreferences';
import type { SettingsPanelLayoutProps } from './SettingsPanelLayout';
import { SettingsPage, SettingsGroup, SettingSelect, SettingSwitch, SettingCheckbox } from './SettingsPrimitives';

const PREVIEW_CONTENT = [
  ['hoverPreviewShowOriginal', '解析后原文'], ['hoverPreviewShowTranslation', '译文'],
  ['hoverPreviewShowNote', '片段记录'], ['hoverPreviewShowAnnotation', '悬停批注']
] as const;

export function ReaderSettingsSection({ props }: { props: SettingsPanelLayoutProps }) {
  const p = props.readerPreferences;
  const update = (patch: Partial<ReaderPreferences>) => props.onReaderPreferencesChange({ ...p, ...patch });
  const previewDisabled = !p.hoverPreviewEnabled && !p.reflowHoverSourceEnabled;
  return <SettingsPage tab="reader" title="阅读与批注" description="设置打开论文、悬停预览和片段操作的方式。">
    <SettingsGroup title="打开条目">
      <SettingSwitch id="reader-open-pdf" label="有 PDF 时直接打开 PDF" description="打开条目时优先阅读 PDF；关闭后或没有 PDF 时显示条目概览。" checked={p.openEntryPdfByDefault ?? true} onCheckedChange={openEntryPdfByDefault => update({ openEntryPdfByDefault })} />
    </SettingsGroup>
    <SettingsGroup title="PDF 片段预览">
      <SettingSwitch id="reader-preview" label="PDF 片段悬停" description="悬停在 PDF 片段上时显示整段内容、笔记和批注。" checked={p.hoverPreviewEnabled} onCheckedChange={hoverPreviewEnabled => update({ hoverPreviewEnabled })} />
    </SettingsGroup>
    <SettingsGroup title="PDF 逐句悬停" description="与片段预览独立；点击句子仍可联动重排视图。有已保存的译文时可预览当前句翻译。">
      <SettingSwitch id="reader-sentence-hover" label="整句悬停" checked={p.pdfSentenceHoverEnabled} onCheckedChange={pdfSentenceHoverEnabled => update({ pdfSentenceHoverEnabled })} />
      <div className="settings-dependent">
        <p className="settings-subheading">悬停卡片显示</p>
        <div className="settings-checkbox-grid">
          <SettingCheckbox label="句子原文" checked={p.pdfSentenceHoverShowOriginal} disabled={!p.pdfSentenceHoverEnabled}
            onCheckedChange={pdfSentenceHoverShowOriginal => update({ pdfSentenceHoverShowOriginal })} />
          <SettingCheckbox label="逐句译文" checked={p.pdfSentenceHoverShowTranslation} disabled={!p.pdfSentenceHoverEnabled}
            onCheckedChange={pdfSentenceHoverShowTranslation => update({ pdfSentenceHoverShowTranslation })} />
        </div>
      </div>
    </SettingsGroup>
    <SettingsGroup title="其他悬停">
      <SettingSwitch id="reader-reflow-preview" label="重排悬停预览" description="鼠标悬停在重排内容上时显示对应片段。" checked={p.reflowHoverSourceEnabled} onCheckedChange={reflowHoverSourceEnabled => update({ reflowHoverSourceEnabled })} />
      <SettingSwitch id="reader-inline-annotation-hover" label="行内批注" description="悬停在 PDF 的选区批注高亮上时，只预览该处原文和批注；可独立于片段悬停预览使用。" checked={p.inlineAnnotationHoverEnabled} onCheckedChange={inlineAnnotationHoverEnabled => update({ inlineAnnotationHoverEnabled })} />
      <SettingSwitch id="reader-paper-reference-hover" label="文内引用悬停" description="悬停参考文献、图表引用时预览目标；关闭后仍可点击定位。" checked={p.paperReferenceHoverEnabled} onCheckedChange={paperReferenceHoverEnabled => update({ paperReferenceHoverEnabled })} />
    </SettingsGroup>
    <SettingsGroup id="reader-preview-content" title="片段预览内容" description={previewDisabled ? '开启 PDF 片段或重排悬停预览后生效；当前选择会保留。' : 'PDF 片段与重排预览共用以下内容选择。'}>
      <div className="settings-checkbox-grid">{PREVIEW_CONTENT.map(([key, label]) => <SettingCheckbox key={key} label={label} checked={p[key]} disabled={previewDisabled} onCheckedChange={checked => update({ [key]: checked })} />)}</div>
      <SettingCheckbox label="PDF 预览时高亮对应区域" checked={p.hoverPreviewShowRegion} disabled={!p.hoverPreviewEnabled} onCheckedChange={hoverPreviewShowRegion => update({ hoverPreviewShowRegion })} />
    </SettingsGroup>
    <SettingsGroup title="分段与片段记录">
      <SettingSwitch id="reader-regions" label="默认显示 PDF 分段框" description="显示 PDF 上解析得到的分段区域框。" checked={p.showRegions} onCheckedChange={showRegions => update({ showRegions })} />
      <SettingSelect id="reader-open-note" label="打开片段记录的方式" description="PDF／重排分屏时，单击始终只定位对侧。" value={p.segmentNoteOpenGesture}
        options={[{ value: 'button', label: '选中后操作' }, { value: 'single', label: '单击' }, { value: 'modifier', label: 'Alt + 单击' }]}
        onValueChange={value => update({ segmentNoteOpenGesture: value as ReaderPreferences['segmentNoteOpenGesture'], leftClickOpensNotePane: value === 'single' })} />
      <section className="settings-subsection" data-setting-id="reader-close-overlay" tabIndex={-1}>
        <h4 className="settings-subheading">片段浮层关闭方式</h4>
        <p className="text-xs leading-5 text-muted-foreground">可同时启用；有未保存内容时仍保留保存保护。</p>
        <SettingCheckbox label="点击空白处关闭" checked={p.closeSegmentOverlayOnBlankClick} onCheckedChange={closeSegmentOverlayOnBlankClick => update({ closeSegmentOverlayOnBlankClick })} />
        <SettingCheckbox label="再次点击当前片段关闭" checked={p.closeSegmentOverlayOnSameSegmentClick} onCheckedChange={closeSegmentOverlayOnSameSegmentClick => update({ closeSegmentOverlayOnSameSegmentClick })} />
      </section>
    </SettingsGroup>
  </SettingsPage>;
}
