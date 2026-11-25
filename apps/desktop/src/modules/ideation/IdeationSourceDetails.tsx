import { Button } from '@/components/ui/button';
import type { CardSource } from '@/shared/ipc/ideationApi';
import type { SourceLinkOpenTarget } from '@/modules/notes/editor/SourceLinkNode';
import { SourceEvidence } from './SourceEvidence';
import { presetEntryId, userEntryId } from './ideationUtils';

/** Provenance is retained even when the original paper is no longer available. */
export function IdeationSourceDetails({ root, entryId, sources = [], title, trashedTitle, onOpenEntry, onOpenSource, onOpenTrash }: {
  root: string; entryId: string; sources?: CardSource[]; title?: string; trashedTitle?: string;
  onOpenEntry: (id: string) => void; onOpenSource?: (target: SourceLinkOpenTarget) => void; onOpenTrash?: () => void;
}) {
  if (entryId === userEntryId || entryId === presetEntryId) return null;
  return <section aria-label="卡片来源" className="mt-3 space-y-2 border-t pt-3 text-xs">
    {title ? <><p>来源：{title}</p><Button size="sm" variant="outline" onClick={() => onOpenEntry(entryId)}>查看来源论文</Button></> : <>
      <p role="status">{trashedTitle ? `来源已移入回收站：${trashedTitle}` : '来源当前不可用，可能已删除或尚未同步到本机。'}</p>
      <p className="text-muted-foreground">卡片正文、引用摘录和来源标识仍保留，可独立同步；恢复来源后可再次打开原文。</p>
      {onOpenTrash && <Button size="sm" variant="outline" onClick={onOpenTrash}>前往回收站恢复来源</Button>}
    </>}
    {sources.map((source, index) => <SourceEvidence key={`${source.segment_uid}:${index}`} root={root} entryId={entryId} source={source} onOpen={onOpenSource} available={!!title} />)}
  </section>;
}
