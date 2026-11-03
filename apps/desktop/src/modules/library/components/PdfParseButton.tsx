import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/shared/hooks/useToast';
import type { LibraryEntry } from './LibrarySidebar';

export type PdfParseAction = {
  configured: boolean;
  disabled?: boolean;
  onStart: (entryId: string) => Promise<void> | void;
  onConfigure: () => void;
};

/** Submission is local; persisted entry status and the existing queue own parsing progress. */
export function PdfParseButton({ entry, action }: { entry: LibraryEntry; action: PdfParseAction }) {
  const { notify } = useToast();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  if (!entry.pdfFileName || entry.status === 'Parsed') return null;
  const queued = entry.status === 'Queued';
  const running = entry.status === 'Uploading' || entry.status === 'Parsing';
  const label = busy ? '正在提交…' : queued ? '等待解析' : running ? '解析中…'
    : entry.status === 'Failed' ? '重试解析' : '开始解析';
  const start = async () => {
    if (pending.current || queued || running || action.disabled) return;
    if (!action.configured) {
      action.onConfigure();
      notify({ title: '请先选择解析方式', description: '可导入 MinerU 客户端解析结果，或配置解析服务后开始解析。' });
      return;
    }
    pending.current = true;
    setBusy(true);
    try {
      await action.onStart(entry.id);
      notify({ title: '已加入解析队列', description: `“${entry.title}”的进度可在条目库查看。` });
    } catch (error) {
      notify({ tone: 'danger', title: '开始解析失败', description: error instanceof Error ? error.message : String(error) });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return <Button type="button" size="xs" variant="outline" className="shrink-0 whitespace-nowrap"
    disabled={action.disabled || busy || queued || running}
    title={!action.configured && !queued && !running ? '先选择解析方式' : `${label}：${entry.title}`}
    onPointerDown={event => event.stopPropagation()}
    onClick={event => { event.stopPropagation(); void start(); }}>{label}</Button>;
}
