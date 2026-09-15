import { save } from '@tauri-apps/plugin-dialog';
import { Loader2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/shared/hooks/useToast';
import { exportPaper, inspectPaperExport, type PaperExportFormat, type PaperExportInspection, type PaperExportKind } from '@/shared/ipc/exportApi';
import { sanitizeExportFileName } from '../../notes/components/markdownNoteEditorSupport';
import { DEFAULT_EXPORT_OPTIONS, PaperExportOptionsFields } from './PaperExportOptionsFields';
import { PaperExportIssuePreviewDialog } from './PaperExportIssuePreviewDialog';
import { renderExportDiagrams } from './renderExportDiagrams';

const KIND_LABELS: Record<PaperExportKind, string> = { source: '解析全文', translation: '中文译稿', bilingual: '中英对照' };
const FORMATS: Record<PaperExportFormat, { label: string; extension: string }> = {
  docx: { label: 'Word 文档 (.docx)', extension: 'docx' },
  txt: { label: '纯文本 (.txt)', extension: 'txt' },
  markdown_zip: { label: 'Markdown 图片包 (.zip)', extension: 'zip' }
};

export function PaperExportDialog({
  entryId, entryTitle, workspaceRoot, open, onOpenChange, onCreateTranslationNote
}: {
  entryId: string;
  entryTitle: string;
  workspaceRoot: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateTranslationNote?: () => Promise<void>;
}) {
  const { notify } = useToast();
  const fieldId = useId();
  const [kind, setKind] = useState<PaperExportKind>('source');
  const [format, setFormat] = useState<PaperExportFormat>('docx');
  const [options, setOptions] = useState(DEFAULT_EXPORT_OPTIONS);
  const [progress, setProgress] = useState('');
  const [inspection, setInspection] = useState<{ key: string; context: string; report: PaperExportInspection } | null>(null);
  const [inspectionPending, setInspectionPending] = useState(true);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const busyRef = useRef(false);
  const key = JSON.stringify([workspaceRoot, entryId, kind, options, refresh]);
  const context = JSON.stringify([workspaceRoot, entryId, kind]);
  const report = !inspectionPending && !error && inspection?.key === key ? inspection.report : null;
  // Retain the same context's last result while rechecking to avoid collapsing
  // a scrolled list. Only the exact-key report above can authorize an export.
  const displayedReport = inspection?.context === context ? inspection.report : null;
  const checking = !report && !error;

  useEffect(() => { setIssuesOpen(false); }, [open, context]);
  useEffect(() => { setPreviewIndex(null); }, [open, key]);

  useEffect(() => {
    setInspectionPending(true);
    if (!open) return;
    let disposed = false;
    setError(null);
    if (!workspaceRoot) { setError('资料库不可用，请重新打开资料库。'); setInspectionPending(false); return; }
    void inspectPaperExport(workspaceRoot, entryId, kind, options).then((report) => {
      if (!disposed) { setInspection({ key, context, report }); setInspectionPending(false); }
    }).catch((caught: unknown) => {
      if (!disposed) { setError(String(caught)); setInspectionPending(false); }
    });
    return () => { disposed = true; };
  }, [open, workspaceRoot, entryId, kind, options, key, context]);

  const startExport = async () => {
    if (!workspaceRoot || !report || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setProgress('');
    setError(null);
    try {
      const selectedFormat = FORMATS[format];
      const filename = sanitizeExportFileName(`${entryTitle}-${KIND_LABELS[kind]}${report.requires_draft ? '-草稿' : ''}`);
      const targetPath = await save({ defaultPath: `${filename}.${selectedFormat.extension}`, filters: [{ name: selectedFormat.label, extensions: [selectedFormat.extension] }] });
      if (!targetPath) return;
      const rendered = options.diagrams === 'rendered' && format !== 'txt'
        ? await renderExportDiagrams(report.diagrams, setProgress) : [];
      setProgress('正在生成文件…');
      // Clicking the explicit continue action acknowledges this inspected snapshot only.
      await exportPaper({ root: workspaceRoot, entry_id: entryId, kind, format, target_path: targetPath,
        expected_fingerprint: report.fingerprint, allow_draft: report.requires_draft, options, rendered_diagrams: rendered });
      notify({ tone: 'success', title: '文件已导出', description: targetPath });
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const createNote = async () => {
    if (!onCreateTranslationNote || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try { await onCreateTranslationNote(); }
    catch (caught) { setError(String(caught)); }
    finally { busyRef.current = false; setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!busyRef.current) onOpenChange(nextOpen); }}>
      <DialogContent layout="bounded" className="gap-3" showCloseButton={!busy}>
        <DialogHeader className="pr-6">
          <DialogTitle>导出论文内容</DialogTitle>
          <DialogDescription className="space-y-1" asChild><div>
            <p className="line-clamp-2 break-words" title={entryTitle}>{entryTitle}</p>
            <p>导出完整解析范围，不受阅读视图的隐藏、折叠或缩放设置影响。</p>
          </div></DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3 text-sm" role="region" aria-label="导出选项和检查结果" tabIndex={0}>
        <div className="grid gap-3 @min-[28rem]/dialog:grid-cols-2">
          <div className="grid min-w-0 gap-1.5">
            <span className="text-xs font-medium" id={`${fieldId}-kind`}>导出内容</span>
            <Select value={kind} disabled={busy} onValueChange={(value) => setKind(value as PaperExportKind)}>
              <SelectTrigger aria-labelledby={`${fieldId}-kind`} className="w-full min-w-0 [&>span]:truncate"><SelectValue /></SelectTrigger>
              <SelectContent viewportAligned align="start">{Object.entries(KIND_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid min-w-0 gap-1.5">
            <span className="text-xs font-medium" id={`${fieldId}-format`}>文件格式</span>
            <Select value={format} disabled={busy} onValueChange={(value) => {
              setFormat(value as PaperExportFormat);
              if (value === 'txt' && options.diagrams === 'rendered') setOptions({ ...options, diagrams: 'mermaid' });
            }}>
              <SelectTrigger aria-labelledby={`${fieldId}-format`} className="w-full min-w-0 [&>span]:truncate"><SelectValue /></SelectTrigger>
              <SelectContent viewportAligned align="start">{Object.entries(FORMATS).map(([value, info]) => <SelectItem key={value} value={value}>{info.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <PaperExportOptionsFields id={fieldId} options={options} format={format} busy={busy} onChange={setOptions} />
          <div role="status" className="flex min-h-10 items-center gap-2">
            {checking ? <><Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin" /><span className="text-muted-foreground">{displayedReport ? '正在重新检查，结果更新前不可导出…' : '正在检查全部片段、译文与图片…'}</span></>
              : report ? <span>共 {report.total} 项 · 已翻译 {report.translated} · 原样保留 {report.preserved} · 缺译 {report.missing} · 旧译文 {report.stale}</span> : null}
          </div>
          {displayedReport ? <>
            {displayedReport.requires_draft ? <p id={`${fieldId}-draft-notice`} className="border-l-2 border-warning pl-3 text-xs leading-relaxed">
              当前有{[
                displayedReport.missing > 0 ? ` ${displayedReport.missing} 项缺译` : null,
                displayedReport.stale > 0 ? ` ${displayedReport.stale} 项旧译文` : null,
                displayedReport.missing_assets > 0 ? ` ${displayedReport.missing_assets} 项缺失图片` : null
              ].filter(Boolean).join('、')}。可继续导出，保留可用内容、未译原文和检查清单，并将文件标记为草稿。
            </p> : null}
            {displayedReport.unverified_images > 0 ? <p className="text-xs text-muted-foreground">
              {displayedReport.unverified_images} 项图中文字未做翻译核验，仅作提醒，不影响导出。
            </p> : null}
            <p className="text-xs text-muted-foreground">检测到 {displayedReport.diagrams.length} 个 Mermaid 流程图。</p>
            <p className="text-xs text-muted-foreground">检查范围仅为当前解析结果，未对原 PDF 逐页核验。公式保留源表示；图片内文字未做 OCR 翻译核验。</p>
            {format === 'txt' ? <p className="text-xs text-muted-foreground">TXT 仅包含文字与来源说明，不包含图片；需要图片请选择 Word 或资料包。</p> : null}
            {format === 'markdown_zip' ? <p className="text-xs text-muted-foreground">资料包包含 paper.md、引用图片和检查清单，不含原 PDF、私人笔记或账号设置。</p> : null}
            {displayedReport.issues.length > 0 ? <details open={issuesOpen} onToggle={(event) => setIssuesOpen(event.currentTarget.open)} className="rounded-md border px-3 py-2">
              <summary className="cursor-pointer">查看 {displayedReport.issues.length} 项内容检查结果</summary>
              <ul className="mt-2 divide-y text-xs">{displayedReport.issues.map((issue, index) => <li key={`${issue.segment_uid}-${index}`} className="flex items-start gap-2 py-2">
                <span className="min-w-0 flex-1 break-words">第 {issue.page} 页 · {issue.message}</span>
                <Button size="xs" variant="ghost" className="shrink-0" disabled={busy || !report}
                  aria-label={`预览第 ${issue.page} 页的第 ${index + 1} 项检查内容`} aria-haspopup="dialog"
                  onClick={(event) => { previewTriggerRef.current = event.currentTarget; setPreviewIndex(index); }}>预览</Button>
              </li>)}</ul>
            </details> : null}
          </> : null}
          {error ? <div role="alert" className="space-y-2 text-destructive"><p className="break-words">{error}</p><Button disabled={busy} size="sm" variant="outline" onClick={() => setRefresh((value) => value + 1)}>重新检查</Button></div> : null}
          {busy && progress ? <p role="status" className="text-xs text-muted-foreground">{progress}</p> : null}
        </DialogBody>
        <DialogFooter className="shrink-0 gap-2 border-t pt-3">
          {onCreateTranslationNote ? <Button disabled={busy} size="sm" variant="ghost" onClick={() => void createNote()}>已译片段生成笔记</Button> : null}
          <Button disabled={busy} size="sm" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button disabled={busy || !report || Boolean(error)} aria-describedby={displayedReport?.requires_draft ? `${fieldId}-draft-notice` : undefined} size="sm" onClick={() => void startExport()}>
            {busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}{busy ? '正在导出…' : displayedReport?.requires_draft ? '继续导出（含待核对内容）' : '选择位置并导出'}
          </Button>
        </DialogFooter>
      </DialogContent>
      {open && workspaceRoot && report && previewIndex !== null && report.issues[previewIndex] ? <PaperExportIssuePreviewDialog
        workspaceRoot={workspaceRoot} entryId={entryId} kind={kind} options={options} report={report} index={previewIndex}
        onSelect={setPreviewIndex} onClose={() => setPreviewIndex(null)}
        onRecheck={() => { setPreviewIndex(null); setRefresh((value) => value + 1); }}
        onReturnFocus={() => previewTriggerRef.current?.focus({ preventScroll: true })} /> : null}
    </Dialog>
  );
}
