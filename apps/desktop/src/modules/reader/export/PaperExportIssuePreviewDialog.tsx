import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SourceSnapshotPreview } from '@/shared/components/SourceSnapshotPreview';
import { previewPaperExport, type PaperExportInspection, type PaperExportKind, type PaperExportOptions, type PaperExportPreview } from '@/shared/ipc/exportApi';
import { renderExportDiagrams } from './renderExportDiagrams';

export function PaperExportIssuePreviewDialog({
  workspaceRoot, entryId, kind, options, report, index, onSelect, onClose, onRecheck, onReturnFocus
}: {
  workspaceRoot: string;
  entryId: string;
  kind: PaperExportKind;
  options: PaperExportOptions;
  report: PaperExportInspection;
  index: number;
  onSelect: (index: number) => void;
  onClose: () => void;
  onRecheck: () => void;
  onReturnFocus: () => void;
}) {
  const issue = report.issues[index];
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; preview?: PaperExportPreview; error?: string; progress?: string } | null>(null);
  const key = JSON.stringify([workspaceRoot, entryId, kind, options, report.fingerprint, issue.segment_uid, attempt]);
  const current = state?.key === key ? state : null;

  useEffect(() => {
    let disposed = false;
    setState({ key, progress: '正在读取对应内容…' });
    void previewPaperExport({ root: workspaceRoot, entry_id: entryId, kind, options,
      expected_fingerprint: report.fingerprint, segment_uid: issue.segment_uid }).then(async (preview) => {
      if (disposed) return;
      if (preview.fingerprint !== report.fingerprint || preview.segment_uid !== issue.segment_uid) {
        throw new Error('预览与当前检查结果不一致，请重新检查内容。');
      }
      const rendered = preview.diagrams.length > 0 ? await renderExportDiagrams(preview.diagrams, (progress) => {
        if (!disposed) setState({ key, progress });
      }) : [];
      if (disposed) return;
      const assets = { ...preview.assets };
      for (const image of rendered) assets[`diagrams/${image.id}.png`] = `data:image/png;base64,${image.png_base64}`;
      setState({ key, preview: { ...preview, assets } });
    }).catch((error: unknown) => {
      if (!disposed) setState({ key, error: error instanceof Error ? error.message : String(error) });
    });
    return () => { disposed = true; };
  }, [key, workspaceRoot, entryId, kind, options, report.fingerprint, issue.segment_uid]);

  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent layout="bounded" className="gap-3 max-w-[54rem] sm:max-w-[54rem]" showCloseButton={false}
      onCloseAutoFocus={(event) => { event.preventDefault(); onReturnFocus(); }}>
      <DialogHeader>
        <DialogTitle>检查内容预览</DialogTitle>
        <DialogDescription>第 {issue.page} 页 · 第 {index + 1} / {report.issues.length} 项</DialogDescription>
        <p className="break-words text-sm">{issue.message}</p>
      </DialogHeader>
      <DialogBody key={key} role="region" aria-label="检查内容预览正文" tabIndex={0} className="space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">显示此片段按当前选项导出的内容；Word 分页和样式以文件为准。预览不会修改原文或标记为已核验。</p>
        {current?.error ? <div role="alert" className="space-y-2">
          <p className="break-words text-destructive">{current.error}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setAttempt((value) => value + 1)}>重试预览</Button>
            <Button size="sm" variant="outline" onClick={onRecheck}>重新检查内容</Button>
          </div>
        </div> : current?.preview ? current.preview.markdown.trim() ? <SourceSnapshotPreview
          markdown={current.preview.markdown} assetUrls={current.preview.assets}
          imageDetailEnabled imageFillWidth tableDetailEnabled compact
          mermaidAsCode={options.diagrams !== 'rendered'} />
          : <p role="status" className="text-muted-foreground">此片段没有可预览的正文或图片，请参考上方检查说明。</p>
          : <p role="status" className="flex items-center gap-2 text-muted-foreground"><Loader2 aria-hidden="true" className="size-4 animate-spin" />{current?.progress ?? '正在读取对应内容…'}</p>}
      </DialogBody>
      <DialogFooter>
        <Button size="sm" variant="outline" disabled={index === 0} onClick={() => onSelect(index - 1)}>上一项</Button>
        <Button size="sm" variant="outline" disabled={index === report.issues.length - 1} onClick={() => onSelect(index + 1)}>下一项</Button>
        <Button size="sm" onClick={onClose}>返回检查清单</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
