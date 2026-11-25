import { AlertCircle, Loader2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { applyTitleConsistency, confirmTitleConsistency, inspectTitleConsistency, type TitleConsistency } from '@/shared/ipc/workspaceApi';
import { reviewTitleConsistency, type TitleReview } from './titleConsistencyModel';

const TITLE_REVIEW_UPDATED = 'neuink:title-review-updated';

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
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ stage: 'check' | 'save' | 'refresh'; message: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [changeEntry, setChangeEntry] = useState(false);
  const [changePdf, setChangePdf] = useState(false);
  const [retry, setRetry] = useState(0);
  const instanceId = useId();

  useEffect(() => {
    const refreshOtherView = (event: Event) => {
      const detail = (event as CustomEvent<{ root: string; entryId: string; origin: string }>).detail;
      if (detail?.root === root && detail.entryId === entryId && detail.origin !== instanceId) {
        setRetry(value => value + 1);
      }
    };
    window.addEventListener(TITLE_REVIEW_UPDATED, refreshOtherView);
    return () => window.removeEventListener(TITLE_REVIEW_UPDATED, refreshOtherView);
  }, [root, entryId, instanceId]);

  useEffect(() => {
    let cancelled = false;
    setInspection(null);
    setReview(null);
    setUnavailableReason(null);
    setError(null);
    if (!root || !parsed || !pdfFileName) { setLoading(false); return; }
    setLoading(true);
    void inspectTitleConsistency(root, entryId).then(async result => {
      if (cancelled) return;
      setInspection(result);
      if (!result) { setUnavailableReason('当前 PDF 的解析状态已变化，暂时无法核对标题。'); return; }
      if (result.confirmed) { setOpen(false); return; }
      if (result.evidence.length === 0) {
        setReview({ status: 'uncertain', reason: 'PDF 首页没有可用于核对标题的解析文字，请查看原文后确认。' });
        return;
      }
      const nextReview = await reviewTitleConsistency(result, retry > 0);
      if (cancelled) return;
      setReview(nextReview);
      if (!nextReview) setOpen(false);
      setChangeEntry(nextReview?.status === 'mismatch' && nextReview.entryMismatch);
      setChangePdf(nextReview?.status === 'mismatch' && nextReview.pdfMismatch);
    }).catch(caught => { if (!cancelled) setError({ stage: 'check', message: caught instanceof Error ? caught.message : String(caught) }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [root, entryId, entryTitle, pdfFileName, parsed, reloadKey, retry]);

  const hasMismatch = review?.status === 'mismatch';
  if (loading) return <span role="status" aria-label="正在核对论文标题" title="正在核对论文标题" className="ml-1 inline-flex shrink-0 self-center text-muted-foreground">
    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
  </span>;
  if (!hasMismatch && review?.status !== 'uncertain' && !unavailableReason && !error) return null;

  const apply = async () => {
    if (!root || !inspection || review?.status !== 'mismatch' || busy || !(changeEntry || changePdf)) return;
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

  const confirmCurrentNames = async () => {
    if (!root || !inspection || busy) return;
    setBusy(true);
    setError(null);
    try {
      await confirmTitleConsistency(root, entryId, inspection);
      setInspection({ ...inspection, confirmed: true });
      setReview(null);
      setOpen(false);
      window.dispatchEvent(new CustomEvent(TITLE_REVIEW_UPDATED, { detail: { root, entryId, origin: instanceId } }));
    } catch (caught) {
      setError({ stage: 'save', message: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      setBusy(false);
    }
  };

  return <>
    <Button aria-label="查看标题核对结果" title={error ? '标题核对需要处理，点击查看' : review?.status === 'uncertain' ? '标题暂时无法确认，点击查看' : '标题可能与论文不一致'} type="button" size="icon-xs" variant="ghost"
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
        {inspection && review?.status === 'mismatch' ? <div className="grid gap-3">
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
        {inspection && review?.status !== 'mismatch' ? <div className="rounded-md border bg-muted/30 p-3 text-xs">
          <p className="font-medium">请对照 PDF 原文确认当前名称</p>
          <p className="mt-2 break-words text-muted-foreground">条目标题：{inspection.entry_title}</p>
          <p className="mt-1 break-words text-muted-foreground">PDF 显示名称：{inspection.pdf_file_name}</p>
        </div> : null}
        {review?.status === 'uncertain' ? <p className="text-sm text-muted-foreground">{review.reason}</p> : null}
        {unavailableReason ? <p className="text-sm text-muted-foreground">{unavailableReason}</p> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error.stage === 'check' ? '标题核对失败' : error.stage === 'save' ? '保存失败' : '标题已保存，但列表刷新失败'}：{error.message}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>稍后处理</Button>
          {error || review?.status === 'uncertain' || unavailableReason ? <Button type="button" variant="outline" disabled={busy} onClick={() => { setOpen(false); setRetry(value => value + 1); }}>重新检查</Button> : null}
          {inspection ? <Button type="button" variant="outline" disabled={busy} onClick={confirmCurrentNames}>确认当前名称无误</Button> : null}
          {inspection && review?.status === 'mismatch' ? <Button type="button" disabled={busy || !(changeEntry || changePdf)} onClick={apply}>{busy ? '正在保存…' : '确认修改所选名称'}</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
