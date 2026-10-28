import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, Plus } from 'lucide-react';
import { registerSegmentEditorCloseHandler, setSegmentEditorDirty } from '@/modules/reader/components/segmentEditorDirtyRegistry';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useDaily } from './DailyContext';
import type { DailyWidget, DailyTodo } from '@/shared/types/daily';

export function TodoWidget({ widget, allLists = false }: { widget: DailyWidget; allLists?: boolean }) {
  const model = useDaily()!;
  const [text, setText] = useState(''), [date, setDate] = useState('');
  const [editing, setEditing] = useState<DailyTodo | null>(null);
  const draftId = useRef(crypto.randomUUID());
  const todos = model.state?.todos.filter(todo => !todo.deleted && (allLists || todo.list_id === widget.list_id) && (widget.show_completed || !todo.completed) && (!widget.selected_date_only || todo.date === model.date)) ?? [];
  const visible = widget.expanded ? todos : todos.filter((todo, index) => index < 5 || todo.id === editing?.id);
  const deleted = model.state?.todos.filter(todo => todo.deleted && (allLists || todo.list_id === widget.list_id)) ?? [];
  const update = (todo: DailyTodo) => model.mutate(state => ({ ...state, todos: state.todos.map(item => item.id === todo.id ? todo : item) }));
  const submit = async () => {
    if (!text.trim()) return true;
    const todo = { id: draftId.current, list_id: widget.list_id, text: text.trim(), date: date || null, completed: false, deleted: false };
    const saved = await model.mutate(state => ({ ...state, todos: state.todos.some(t => t.id === todo.id) ? state.todos.map(t => t.id === todo.id ? todo : t) : [...state.todos, todo] }));
    if (saved) { pending.current.text = ''; draftId.current = crypto.randomUUID(); setText(''); setDate(''); }
    return saved;
  };
  const pending = useRef({ submit, update, editing, text }); pending.current = { submit, update, editing, text };
  useEffect(() => {
    const scope = `daily-widgets/${widget.id}`, owner = `todos-${widget.id}`;
    const stop = registerSegmentEditorCloseHandler(scope, owner, {
      isDirty: () => Boolean(pending.current.text.trim() || pending.current.editing),
      discard: () => { setText(''); setDate(''); setEditing(null); },
      save: async () => { const p = pending.current; if (p.editing && (!p.editing.text.trim() || !await p.update(p.editing))) return false; if (p.editing) { pending.current.editing = null; setEditing(null); } return p.submit(); }
    });
    return () => { stop(); setSegmentEditorDirty(scope, owner, false); };
  }, [widget.id]);
  useEffect(() => { setSegmentEditorDirty(`daily-widgets/${widget.id}`, `todos-${widget.id}`, Boolean(text.trim() || editing)); }, [widget.id, text, editing]);
  return <div className="space-y-2 text-xs">
    <form onSubmit={event => { event.preventDefault(); void submit(); }} className="space-y-2">
      <div className="flex min-w-0 items-center gap-1">
        <Input className="h-7 min-w-0 text-xs" aria-label="新待办" placeholder="添加待办…" value={text} maxLength={1000} disabled={model.busy} onChange={e => setText(e.target.value)} />
        <Button size="icon-sm" variant="plain" title="添加待办" aria-label="添加待办" type="submit" disabled={model.busy || !text.trim()}><Plus /></Button>
      </div>
      {text.trim() || date ? <div className="flex min-w-0 items-center gap-2 text-muted-foreground"><span className="shrink-0">计划日期</span><Input aria-label="待办计划日期（可选）" type="date" className="h-7 min-w-0 flex-1 text-xs" value={date} disabled={model.busy} onChange={e => setDate(e.target.value)} /></div> : null}
    </form>
    {todos.length ? <ul className="space-y-1">{visible.map(todo => <li key={todo.id} className="py-1">
      {editing?.id === todo.id ? <form className="space-y-1" onSubmit={e => { e.preventDefault(); void update(editing).then(ok => { if (ok) setEditing(null); }); }}>
        <Input aria-label="编辑待办" disabled={model.busy} value={editing.text} onChange={e => setEditing({ ...editing, text: e.target.value })} />
        <Input type="date" disabled={model.busy} aria-label="修改计划日期" value={editing.date ?? ''} onChange={e => setEditing({ ...editing, date: e.target.value || null })} />
        <div className="flex justify-end gap-1"><Button size="xs" variant="ghost" type="button" onClick={() => setEditing(null)}>取消</Button><Button size="xs" type="submit" disabled={model.busy || !editing.text.trim()}>保存</Button></div>
      </form> : <>
        <div className="flex items-start gap-1">
          <label className="flex min-w-0 flex-1 items-start gap-2 py-0.5 leading-5"><input type="checkbox" className="mt-1 shrink-0 accent-primary" checked={todo.completed} disabled={model.busy} onChange={e => void update({ ...todo, completed: e.target.checked })} /><span className={`min-w-0 break-words ${todo.completed ? 'text-muted-foreground line-through' : ''}`}>{todo.text}</span></label>
          <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon-xs" variant="plain" disabled={model.busy} title="待办操作" aria-label={`待办操作：${todo.text}`}><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => setEditing(todo)}>编辑</DropdownMenuItem><DropdownMenuItem onSelect={() => void update({ ...todo, deleted: true })}>删除</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
        </div>
        {todo.date ? <p className="pl-5 text-[11px] text-muted-foreground">{todo.date}</p> : null}
      </>}
    </li>)}</ul> : <p className="py-2 text-muted-foreground">{widget.selected_date_only ? `${model.date} 没有符合条件的待办。` : '没有未完成待办。'}</p>}
    {deleted.length ? <details><summary className="cursor-pointer text-muted-foreground">已删除 {deleted.length} 项</summary>{deleted.map(todo => <div key={todo.id} className="flex items-center gap-1 py-1"><span className="min-w-0 flex-1 truncate">{todo.text}</span><Button size="xs" variant="ghost" disabled={model.busy} onClick={() => void update({ ...todo, deleted: false })}>恢复</Button></div>)}</details> : null}
    {visible.length < todos.length ? <Button size="xs" variant="ghost" disabled={model.busy} onClick={() => void model.mutate(state => ({ ...state, widgets: state.widgets.map(item => item.id === widget.id ? { ...item, expanded: true } : item) }))}>显示全部 {todos.length} 项</Button> : null}
  </div>;
}
