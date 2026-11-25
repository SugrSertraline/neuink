import { useEffect, useRef, useState } from 'react';
import { readSegmentContent } from '@/shared/ipc/assistantApi';
import type { CardSource } from '@/shared/ipc/ideationApi';
import type { SourceLinkOpenTarget } from '@/modules/notes/editor/SourceLinkNode';

/** Keep a snapshot visible even when the source has been reparsed or removed. */
export function SourceEvidence({ root, entryId, source, onOpen, available = true }: {
  root: string; entryId: string; source: CardSource; onOpen?: (target: SourceLinkOpenTarget) => void; available?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  useEffect(() => { request.current++; setBusy(false); setError(null); return () => { request.current++; }; }, [root, entryId, source.segment_uid, source.quote]);
  const open = async () => {
    if (!onOpen || busy) return;
    const token = ++request.current;
    setBusy(true); setError(null);
    try {
      const current = await readSegmentContent({ root, entryId, segmentUid: source.segment_uid });
      if (request.current !== token) return;
      const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
      if (!source.quote.trim() || !normalize(current.text).startsWith(normalize(source.quote))) throw new Error('来源内容已变化，请重新整理并核对原文。');
      onOpen({ sourceEntryId: entryId, page: current.page_idx + 1, segmentUid: current.segment_uid });
    } catch (caught) {
      if (request.current === token) setError(caught instanceof Error ? caught.message : '来源片段不可用，请打开论文核对。');
    } finally { if (request.current === token) setBusy(false); }
  };
  return <div className="mt-2 text-xs"><p className="line-clamp-3 text-muted-foreground">{source.quote || '无原文摘录'}</p>
    <button className="underline" disabled={!onOpen || !available || busy} onClick={() => void open()}>{busy ? '正在核对来源…' : `核对原文 · 第 ${source.page_idx + 1} 页`}</button>
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </div>;
}
