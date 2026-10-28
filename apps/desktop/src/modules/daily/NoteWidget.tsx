import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { MarkdownNoteEditor } from '@/modules/notes/components/MarkdownNoteEditor';
import { useOwnedNote } from '@/modules/notes/useOwnedNote';
import { useWorkspaceNotes } from '@/modules/notes/WorkspaceNotesContext';
import { noteOwnerKey, noteTargetKey } from '@/shared/lib/noteOwner';
import { readOwnedNote } from '@/shared/ipc/noteOwnerApi';
import { SourceSnapshotPreview } from '@/shared/components/SourceSnapshotPreview';
import type { DailyWidget } from '@/shared/types/daily';
import { useDaily } from './DailyContext';

export function NoteWidget({ widget, fill = false, onConfigure }: { widget: DailyWidget; fill?: boolean; onConfigure?: () => void }) {
  const model = useDaily()!;
  const target = widget.kind === 'journal' ? { owner: { kind: 'daily' as const, date: model.date }, note_id: 'journal' } : widget.note;
  const notes = useOwnedNote(model.root, target);
  const catalog = useWorkspaceNotes();
  const key = target ? noteTargetKey(target) : '';
  const previewLimit = fill ? 1200 : 240;
  const [preview, setPreview] = useState(''), [error, setError] = useState(''), [loading, setLoading] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let stale = false; setPreview(''); setError('');
    if (!target || !model.root || widget.expanded) return;
    setLoading(true);
    void readOwnedNote(model.root, target).then(note => { if (!stale) setPreview(note.markdown); }).catch(e => { if (!stale) setError(String(e)); }).finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [model.root, key, widget.expanded, catalog?.version, attempt]);
  if (!target) return <div className="space-y-3 py-2 text-xs text-muted-foreground"><p>固定一篇常用笔记，随时查看和编辑。</p>{onConfigure ? <Button size="sm" variant="outline" onClick={onConfigure}>选择笔记</Button> : null}</div>;
  return <div className={fill ? 'flex min-h-0 flex-1 flex-col gap-2' : 'space-y-2'}>
    <div className="flex min-w-0 items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>{target.owner.kind === 'daily' ? target.owner.date : '已固定笔记'}</span>
      <Button size="xs" variant="plain" className="h-auto px-0 py-0.5" onClick={() => model.openNote(target, widget.title || undefined)}>打开笔记</Button>
    </div>
    {widget.expanded ? <div className={fill ? 'min-h-0 flex-1 overflow-hidden' : 'h-80 min-h-0 overflow-hidden rounded border'}><MarkdownNoteEditor key={`${model.root}:${key}`} compact
      entryId={noteOwnerKey(target.owner)} noteOwner={target.owner} noteId={target.note_id} workspaceRoot={model.root}
      fallbackTitle={widget.title || (widget.kind === 'journal' ? `${model.date} 每日记录` : '固定便签')}
      editorScopeKey={`daily-widgets/${widget.id}`} onLoadNote={notes.load} onSaveNote={notes.save} onWritableChange={notes.setWritable} onCreateSourceLinkFromPaste={notes.buildSource} onOpenSourceLink={model.openSource} /></div>
      : loading ? <p role="status" className="text-xs">正在读取…</p> : error ? <div role="alert" className="text-xs text-destructive"><p>{error}</p><Button size="xs" variant="outline" onClick={() => setAttempt(n => n + 1)}>重试</Button></div>
      : preview ? <div className={'daily-note-preview min-w-0 text-xs leading-5 ' + (fill ? 'min-h-0 flex-1 overflow-y-auto overscroll-contain' : '')}><SourceSnapshotPreview markdown={`${preview.slice(0, previewLimit)}${preview.length > previewLimit ? '…' : ''}`} normalization="none" compact flush allowScroll={false} assetUrls={{}} showMermaidDiagrams={false} /></div>
      : <p className="py-1 text-xs text-muted-foreground">还没有内容，打开笔记开始记录。</p>}
  </div>;
}
