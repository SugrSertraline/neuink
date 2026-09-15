import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { DiagramExportMode, PaperExportFormat, PaperExportOptions } from '@/shared/ipc/exportApi';

export const DEFAULT_EXPORT_OPTIONS: PaperExportOptions = { diagrams: 'original', image_width: 'standard', include_source_refs: false };
const MODES: Record<DiagramExportMode, string> = {
  original: '原图（推荐）', rendered: 'Mermaid 渲染图', mermaid: 'Mermaid 源码', original_with_source: '原图 + 源码附录'
};

export function PaperExportOptionsFields({ id, options, format, busy, onChange }: {
  id: string; options: PaperExportOptions; format: PaperExportFormat; busy: boolean; onChange: (options: PaperExportOptions) => void;
}) {
  return <div className="space-y-3 border-t pt-3">
    <div className="grid gap-3 @min-[28rem]/dialog:grid-cols-2">
      <div className="grid min-w-0 gap-1.5">
        <span className="text-xs font-medium" id={`${id}-diagrams`}>流程图导出方式</span>
        <Select value={options.diagrams} disabled={busy} onValueChange={(value) => onChange({ ...options, diagrams: value as DiagramExportMode })}>
          <SelectTrigger className="w-full min-w-0 [&>span]:truncate" aria-labelledby={`${id}-diagrams`}><SelectValue /></SelectTrigger>
          <SelectContent viewportAligned align="start">{Object.entries(MODES).map(([value, label]) => <SelectItem key={value} value={value} disabled={format === 'txt' && value === 'rendered'}>{label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {format === 'docx' ? <div className="grid min-w-0 gap-1.5">
        <span className="text-xs font-medium" id={`${id}-width`}>Word 图片最大宽度</span>
        <Select value={options.image_width} disabled={busy} onValueChange={(value) => onChange({ ...options, image_width: value as PaperExportOptions['image_width'] })}>
          <SelectTrigger className="w-full min-w-0" aria-labelledby={`${id}-width`}><SelectValue /></SelectTrigger>
          <SelectContent viewportAligned align="start"><SelectItem value="compact">紧凑（正文宽度 60%）</SelectItem><SelectItem value="standard">标准（正文宽度 85%）</SelectItem><SelectItem value="full">通栏（正文宽度 100%）</SelectItem></SelectContent>
        </Select>
      </div> : null}
    </div>
    <p className="text-xs text-muted-foreground">仅影响识别出 Mermaid 的流程图，普通图片照常保留。原图更接近论文；Mermaid 是解析得到的重构结果，不保证与原图一致。</p>
    {options.diagrams === 'mermaid' ? <p className="text-xs text-muted-foreground">Word / TXT 中保留可复制的源码，不是图形；Markdown 包保留 mermaid 代码块和独立 .mmd 文件。</p> : null}
    {options.diagrams === 'original_with_source' ? <p className="text-xs text-muted-foreground">正文使用原图，源码移至文末附录；Markdown 包另附独立 .mmd 文件。</p> : null}
    {options.diagrams === 'rendered' ? <p className="text-xs text-muted-foreground">本地渲染为白底 PNG，等比例插入；不修改识别源码。失败会停止导出，可改选原图或源码。</p> : null}
    <label className="flex items-center gap-2 text-xs">
      <Switch aria-label="显示逐段来源编号" disabled={busy} checked={options.include_source_refs} onCheckedChange={(checked) => onChange({ ...options, include_source_refs: checked })} />
      显示逐段来源编号（核对用，默认关闭）
    </label>
    {format === 'docx' ? <p className="text-xs text-muted-foreground">自动设置标题层级、正文行距、图注、代码字体及图片边界，单栏排版，不复刻 PDF 双栏。</p> : null}
  </div>;
}
