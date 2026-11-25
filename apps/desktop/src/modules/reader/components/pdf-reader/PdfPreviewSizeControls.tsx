import { useId } from 'react';
import { Button } from '@/components/ui/button';
import {
  PDF_PREVIEW_FONT_MIN, PDF_PREVIEW_FONT_MAX, PDF_PREVIEW_SIZE_MIN, PDF_PREVIEW_SIZE_MAX,
  normalizePdfPreviewFontSize, normalizePdfPreviewSize, type ReaderPreferences,
} from '@/shared/lib/readerPreferences';

/** Reader preferences own persistence; native sliders own arrows/drag, the popover owns scrolling. */
export function PdfPreviewSizeControls({ preferences, onChange }: {
  preferences: ReaderPreferences; onChange: (preferences: ReaderPreferences) => void;
}) {
  const id = useId();
  const font = normalizePdfPreviewFontSize(preferences.pdfHoverPreviewFontSize);
  const size = normalizePdfPreviewSize(preferences.pdfHoverPreviewSize);
  const controls = [
    { key: 'pdfHoverPreviewFontSize', label: '预览文字大小', value: font, min: PDF_PREVIEW_FONT_MIN, max: PDF_PREVIEW_FONT_MAX },
    { key: 'pdfHoverPreviewSize', label: '预览卡片大小', value: size, min: PDF_PREVIEW_SIZE_MIN, max: PDF_PREVIEW_SIZE_MAX },
  ] as const;
  return <section aria-label="PDF 预览大小" className="grid gap-2 border-t px-2 pt-2">
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-medium text-muted-foreground">预览大小</span>
      <Button size="xs" variant="ghost" disabled={font === 100 && size === 100}
        onClick={() => onChange({ ...preferences, pdfHoverPreviewFontSize: 100, pdfHoverPreviewSize: 100 })}>恢复默认大小</Button>
    </div>
    {controls.map(control => <div key={control.key} className="grid gap-1">
      <div className="flex justify-between gap-2 text-xs">
        <label htmlFor={`${id}-${control.key}`}>{control.label}</label>
        <output htmlFor={`${id}-${control.key}`} className="tabular-nums text-muted-foreground">{control.value}%</output>
      </div>
      <input id={`${id}-${control.key}`} type="range" min={control.min} max={control.max} step={1} value={control.value}
        className="h-6 w-full cursor-pointer accent-primary"
        aria-valuetext={`${control.value}%`}
        onChange={event => onChange({ ...preferences, [control.key]: Number(event.target.value) })} />
    </div>)}
  </section>;
}
