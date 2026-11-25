import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useWorkspaceNotes } from '@/modules/notes/WorkspaceNotesContext';
import { noteTargetKey } from '@/shared/lib/noteOwner';
import type { DailyWidget } from '@/shared/types/daily';
import { useDaily } from './DailyContext';
import { saveSegmentEditorsBeforeClose } from '@/modules/reader/components/segmentEditorDirtyRegistry';

export function WidgetSettings({ widget, onChange }: { widget: DailyWidget; onChange: (next: DailyWidget) => void }) {
  const model = useDaily()!, notes = useWorkspaceNotes();
  const [title, setTitle] = useState(widget.title), [listTitle, setListTitle] = useState(''), [error, setError] = useState('');
  return <div className="space-y-2 border-b pb-3 text-xs">
    {error ? <p role="alert" className="text-destructive">{error}</p> : null}
    <Label htmlFor={`${widget.id}-name`}>组件名称</Label><div className="flex gap-1"><Input id={`${widget.id}-name`} value={title} maxLength={80} onChange={e => setTitle(e.target.value)} /><Button size="sm" disabled={model.busy} onClick={() => onChange({ ...widget, title })}>保存</Button></div>
    {widget.kind === 'note' ? <>
      <Label>固定笔记</Label><Select value={widget.note ? noteTargetKey(widget.note) : ''} disabled={model.busy || notes?.loading} onValueChange={value => { const note = notes?.catalog.notes.find(note => noteTargetKey(note.target) === value); if (note) onChange({ ...widget, note: note.target }); }}>
        <SelectTrigger size="sm" aria-label="选择固定笔记"><SelectValue placeholder="选择已有笔记" /></SelectTrigger><SelectContent>{notes?.catalog.notes.filter(note => !note.deleted_at && !note.error).map(note => <SelectItem key={noteTargetKey(note.target)} value={noteTargetKey(note.target)}>{note.title} · {note.owner_title}</SelectItem>)}</SelectContent>
      </Select>{notes?.error ? <p role="alert">{notes.error}<Button size="xs" onClick={notes.refresh}>重试</Button></p> : null}
      <Button size="xs" variant="ghost" onClick={() => model.openNote({ owner: { kind: 'daily', date: model.date }, note_id: 'journal' })}>新建当日笔记</Button>
    </> : null}
    {widget.kind === 'todos' ? <>
      <Label>待办清单</Label><Select value={widget.list_id} disabled={model.busy} onValueChange={list_id => onChange({ ...widget, list_id })}><SelectTrigger size="sm" aria-label="选择待办清单"><SelectValue /></SelectTrigger><SelectContent>{model.state?.lists.map(list => <SelectItem key={list.id} value={list.id}>{list.title}</SelectItem>)}</SelectContent></Select>
      <div className="flex gap-1"><Input aria-label="新清单名称" placeholder="新清单名称" value={listTitle} maxLength={80} onChange={e => setListTitle(e.target.value)} /><Button size="sm" disabled={model.busy || !listTitle.trim()} onClick={async () => { setError(''); if (!await saveSegmentEditorsBeforeClose('daily-widgets')) { setError('待办或笔记尚未保存，请先处理保存提示。'); return; } const id = crypto.randomUUID(); if (await model.mutate(state => ({ ...state, lists: [...state.lists, { id, title: listTitle.trim() }], widgets: state.widgets.map(item => item.id === widget.id ? { ...item, list_id: id } : item) }))) setListTitle(''); }}>新建</Button></div>
      <label className="flex items-center gap-2"><input type="checkbox" checked={widget.selected_date_only} disabled={model.busy} onChange={e => onChange({ ...widget, selected_date_only: e.target.checked })} />只看所选日期</label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={widget.show_completed} disabled={model.busy} onChange={e => onChange({ ...widget, show_completed: e.target.checked })} />显示已完成</label>
    </> : null}
  </div>;
}
