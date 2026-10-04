import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { approveResearchImport, previewResearchImport, rememberResearchConsent, type ResearchPaper } from '@/shared/ipc/researchApi';
import { decideToolApproval, getToolApprovals, type PendingToolApproval } from '../runtime/toolApproval';
import { formatAssistantError, useAssistantDebug } from '@/shared/lib/assistantDebug';

/** Approval store owns the operation; this panel owns only its preview. Parent owns scrolling. */
export function ResearchImportApproval({ item }: { item: PendingToolApproval }) {
  const debug = useAssistantDebug();
  const [papers, setPapers] = useState<ResearchPaper[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const ids = (item.input as { paper_ids?: unknown })?.paper_ids;
    if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) setError('论文选择无效，请拒绝并重新检索。');
    else void previewResearchImport(item.root, ids).then(rows => {
      if (alive.current) setPapers(rows);
    }).catch(caught => { if (alive.current) setError(String(caught)); });
    return () => { alive.current = false; };
  }, [item]);
  const confirm = async () => {
    if (!papers || inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError('');
    try {
      await approveResearchImport(item.root, papers.map(p => p.id), papers, item.id);
      // The user may have stopped the run while the native preview was being approved.
      if (!getToolApprovals().some(pending => pending.id === item.id)) return;
      rememberResearchConsent(item.root, item.toolCallId, item.id);
      decideToolApproval(item.id, true);
    } catch (caught) { if (alive.current) setError(String(caught)); }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  };
  return <div className="grid min-w-0 gap-2 text-sm">
    <p className="font-medium">确认下载并添加到条目库</p>
    <p className="text-muted-foreground">仅下载以下论文的公开 PDF，每篇最多 64 MB。不会自动解析、加标签或写笔记；重复论文将跳过。</p>
    {!papers && !error && <p role="status">正在读取论文预览…</p>}
    {papers && <ul className="grid gap-2">
      {papers.map(p => <li key={p.id} className="min-w-0 border-l-2 border-border pl-2 [overflow-wrap:anywhere]">
        <p className="font-medium">{p.title}</p>
        <p className="text-muted-foreground">{p.year} · {p.authors.slice(0, 3).join('、') || '作者信息缺失'} · {p.provider}</p>
        <p className="break-all text-xs">{p.pdf_url ?? '无公开 PDF：此项不会下载，可稍后从原文页面获取。'}</p>
        <details><summary className="cursor-pointer">查看摘要与来源</summary>
          <p className="whitespace-pre-wrap">{p.abstract_text || '没有摘要'}</p>
          <p className="break-all text-muted-foreground">{p.url}</p>
        </details>
      </li>)}
    </ul>}
    {error && <p role="alert" className="text-destructive [overflow-wrap:anywhere]">{formatAssistantError(error, { debug, fallback: '论文确认未完成，请拒绝本次操作后重新检索。' })}</p>}
    <div className="flex flex-wrap justify-end gap-2">
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => decideToolApproval(item.id, false)}>拒绝并停止</Button>
      <Button size="sm" disabled={busy || !papers?.some(p => p.pdf_url)} onClick={() => void confirm()}>{busy ? '正在确认…' : `确认下载 ${papers?.filter(p => p.pdf_url).length ?? 0} 篇`}</Button>
    </div>
  </div>;
}
