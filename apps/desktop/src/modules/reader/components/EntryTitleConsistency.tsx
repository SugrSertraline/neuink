import { AlertCircle, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { applyTitleConsistency, inspectTitleConsistency, type TitleConsistency } from '@/shared/ipc/workspaceApi';
import { reviewTitleConsistency, type TitleReview } from './titleConsistencyModel';

export function EntryTitleConsistency({ entryId, entryTitle, pdfFileName, parsed, root, reloadKey, onRefreshEntries }: {
  entryId: string;
  entryTitle: string;
  pdfFileName: string | null;
  parsed: boolean;
  root: string | null;
  reloadKey: number;
  onRefreshEntries: () => Promise<void>;
}) {
  const [inspection, setInspection] = useState<TitleConsistency | null>(null);
  const [review, setReview] = useState<TitleReview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ stage: 'check' | 'save' | 'refresh'; message: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [changeEntry, setChangeEntry] = useState(false);
  const [changePdf, setChangePdf] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setInspection(null);
    setReview(null);
    setError(null);
    if (!root || !parsed || !pdfFileName) return;
    setLoading(true);
    void inspectTitleConsistency(root, entryId).then(async result => {
      if (cancelled) return;
      setInspection(result);
      if (!result) return;
      const nextReview = await reviewTitleConsistency(result, retry > 0);
      if (cancelled) return;
      setReview(nextReview);
      setChangeEntry(Boolean(nextReview?.entryMismatch));
      setChangePdf(Boolean(nextReview?.pdfMismatch));
    }).catch(caught => { if (!cancelled) setError({ stage: 'check', message: caught instanceof Error ? caught.message : String(caught) }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [root, entryId, entryTitle, pdfFileName, parsed, reloadKey, retry]);

  const hasMismatch = Boolean(review?.entryMismatch || review?.pdfMismatch);
  if (loading) return <Loader2 role="status" aria-label="正在核对论文标题" className="ml-1 size-4 shrink-0 animate-spin text-muted-foreground" />;
  if (!hasMismatch && !error) return null;

  const apply = async () => {
    if (!root || !inspection || !review || busy || !(changeEntry || changePdf)) return;
    setBusy(true);
    setError(null);
    let saved = false;
    try {
      await applyTitleConsistency(root, entryId, inspection, review.suggestedTitle, changeEntry, changePdf);
      saved = true;
      await onRefreshEntries();
      setOpen(false);
      setRetry(value => value + 1);
    } catch (caught) {
      if (saved) {
        setInspection(null);
        setReview(null);
      }
      setError({ stage: saved ? 'refresh' : 'save', message: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      setBusy(false);
    }
  };

  return <>
    <Button aria-label="查看标题核对结果" title={error && !hasMismatch ? '标题核对失败，点击重试' : '标题可能与论文不一致'} type="button" size="icon-xs" variant="ghost"
      className="ml-1 shrink-0 align-middle text-warning" onClick={() => setOpen(true)}>
      <AlertCircle size={16} aria-hidden="true" />
    </Button>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <DialogContent layout="bounded">
        <DialogHeader>
          <DialogTitle>核对论文标题</DialogTitle>
          <DialogDescription>助手模型根据 PDF 首页解析文字提出建议。请核对原文，再决定是否修改。</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid content-start gap-3 pr-1 text-sm">
        {inspection && review ? <div className="grid gap-3">
          <div className="rounded-md border bg-muted/30 p-3"><div className="text-xs text-muted-foreground">建议的论文标题</div><div className="mt-1 break-words font-medium">{review.suggestedTitle}</div><p className="mt-2 text-xs text-muted-foreground">{review.reason}</p></div>
          <label className="flex items-start gap-3">
            <Checkbox aria-label="修改条目标题" checked={changeEntry} disabled={!review.entryMismatch || busy} onCheckedChange={value => setChangeEntry(value === true)} />
            <span className="min-w-0"><span className="font-medium">修改条目标题</span><span className="block break-words text-muted-foreground">当前：{inspection.entry_title}</span>{!review.entryMismatch ? <span className="text-muted-foreground">已匹配</span> : null}</span>
          </label>
          <label className="flex items-start gap-3">
            <Checkbox aria-label="修改 PDF 显示名称" checked={changePdf} disabled={!review.pdfMismatch || busy} onCheckedChange={value => setChangePdf(value === true)} />
            <span className="min-w-0"><span className="font-medium">修改 PDF 显示名称</span><span className="block break-words text-muted-foreground">当前：{inspection.pdf_file_name}</span>{review.pdfMismatch ? <span className="block break-words text-muted-foreground">建议：{review.suggestedPdfFileName}</span> : <span className="text-muted-foreground">已匹配</span>}</span>
          </label>
          <p className="text-xs text-muted-foreground">模型可能判断错误；修改显示名称不会改动原始 PDF 文件内容。</p>
        </div> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error.stage === 'check' ? '标题核对失败' : error.stage === 'save' ? '保存失败' : '标题已保存，但列表刷新失败'}：{error.message}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => { setOpen(false); setRetry(value => value + 1); }}>稍后处理</Button>
          {error ? <Button type="button" variant="outline" disabled={busy} onClick={() => setRetry(value => value + 1)}>重新检查</Button> : null}
          {inspection && review ? <Button type="button" disabled={busy || !(changeEntry || changePdf)} onClick={apply}>{busy ? '正在保存…' : '确认修改所选名称'}</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
