import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { FoldRecord } from '@/shared/ipc/foldingApi';
import { translateFoldLevel } from './translateFoldLevel';

/** Translate only the visible missing level; leaving the viewport releases its request. */
export function FoldTranslationButton({ root, entryId, title, record, level }: {
  root: string | null; entryId: string; title: string; record: FoldRecord; level: 'brief' | 'key' | 'takeaway' | 'topic';
}) {
  const [status, setStatus] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const node = useRef<HTMLSpanElement>(null);
  const latestRecord = useRef(record); latestRecord.current = record;
  const retry = useRef<() => void>(() => undefined);
  const source = level === 'brief' ? record.brief.join(' ') : record[level];

  useEffect(() => {
    const element = node.current;
    if (!element || !root) return;
    let disposed = false, visible = false, failed = false, done = false;
    let current: AbortController | null = null;
    setStatus('idle');
    const start = () => {
      if (disposed || current || failed || done) return;
      const controller = new AbortController(); current = controller; setStatus('busy');
      void translateFoldLevel(root, entryId, title, latestRecord.current, level, controller.signal).then(() => {
        if (!disposed && !controller.signal.aborted) { done = true; setStatus('done'); }
      }).catch(() => {
        if (!disposed && !controller.signal.aborted) {
          failed = true; setStatus('error');
        }
      }).finally(() => {
        if (current === controller) current = null;
        if (disposed) return;
        if (controller.signal.aborted && !failed && !done) setStatus('idle');
        if (visible && document.visibilityState !== 'hidden' && !failed && !done) start();
      });
    };
    retry.current = () => { failed = false; start(); };
    const update = () => {
      if (visible && document.visibilityState !== 'hidden') start();
      else current?.abort();
    };
    let observer: IntersectionObserver | undefined;
    let fallback: (() => void) | undefined;
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(entries => { visible = Boolean(entries[0]?.isIntersecting); update(); });
      observer.observe(element);
    } else {
      fallback = () => {
        const rect = element.getBoundingClientRect();
        visible = rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
        update();
      };
      window.addEventListener('scroll', fallback, true); window.addEventListener('resize', fallback); fallback();
    }
    document.addEventListener('visibilitychange', update);
    return () => {
      disposed = true; current?.abort(); observer?.disconnect(); retry.current = () => undefined;
      if (fallback) { window.removeEventListener('scroll', fallback, true); window.removeEventListener('resize', fallback); }
      document.removeEventListener('visibilitychange', update);
    };
  }, [root, entryId, title, record.segment_uid, level, source]);

  return <span ref={node} onClick={event => event.stopPropagation()}>
    {status === 'busy' ? <span role="status">正在生成当前详略的中文译文…</span> :
      status === 'done' ? <span role="status">译文已生成，正在显示…</span> :
        <Button type="button" size="xs" variant="ghost" disabled={!root} onClick={() => retry.current()}>{status === 'error' ? '重试当前详略译文' : '生成当前详略译文'}</Button>}
    {status === 'error' ? <span role="status"> 翻译失败，请检查模型配置后重试。</span> : null}
  </span>;
}
