import type { Editor } from '@tiptap/core';
import { ListTree, PanelLeftClose } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { collectNoteOutline, type NoteOutlineItem } from '../editor/noteOutline';
import { revealNoteOutlinePosition } from '../editor/noteOutlineNavigation';

const ELEMENT_NAMES: Record<string, string> = {
  heading: '标题', paragraph: '段落', bulletList: '列表', orderedList: '有序列表', taskList: '待办',
  image: '图片', table: '表格', dataTable: '数据表', blockMath: '公式', inlineMath: '行内公式',
  codeBlock: '代码', mermaidDiagram: '流程图', blockquote: '引用', calloutBlock: '提示',
  sourceLink: '来源', horizontalRule: '分隔线',
};

function outlineType(item: NoteOutlineItem) {
  return item.headingLevel ? `${item.headingLevel} 级标题` : ELEMENT_NAMES[item.kind] ?? '元素';
}

/** Per-view navigation state only. Closing the sidebar never remounts the editor or scroll owner. */
export function NoteOutlineSidebar({ editor, scrollRef, disabled = false }: {
  editor: Editor | null;
  scrollRef: RefObject<HTMLDivElement | null>;
  disabled?: boolean;
}) {
  const panelId = useId();
  const titleId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [showElements, setShowElements] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState(() => editor && !editor.isDestroyed
    ? { document: editor.state.doc, items: collectNoteOutline(editor.state.doc) } : null);

  useEffect(() => {
    setOpen(false);
    setQuery('');
    setShowElements(false);
    setError('');
  }, [editor]);

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || !open || disabled) return;
    const refresh = () => setSnapshot({ document: editor.state.doc, items: collectNoteOutline(editor.state.doc) });
    const onTransaction = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (transaction.docChanged) { refresh(); setError(''); }
    };
    refresh();
    editor.on('transaction', onTransaction);
    return () => { editor.off('transaction', onTransaction); };
  }, [editor, open, disabled]);

  const items = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return (snapshot?.items ?? []).filter(item => (showElements || item.kind === 'heading')
      && (!search || `${outlineType(item)} ${item.label}`.toLocaleLowerCase().includes(search)));
  }, [snapshot, query, showElements]);

  const locate = (item: NoteOutlineItem) => {
    if (!editor || disabled || !snapshot) return;
    if (revealNoteOutlinePosition(editor, scrollRef.current, item.position, snapshot.document)) {
      setError('');
    } else {
      if (!editor.isDestroyed) setSnapshot({ document: editor.state.doc, items: collectNoteOutline(editor.state.doc) });
      setError('内容已更新或暂不可见，请重新选择目录项。');
    }
  };

  const navigateRows = (event: KeyboardEvent<HTMLElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-outline-position]')];
    const current = rows.indexOf(event.target as HTMLButtonElement);
    if (current < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1
      : Math.max(0, Math.min(rows.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)));
    rows[next]?.focus({ preventScroll: true });
    // Keyboard navigation scrolls only this bounded list, not the document behind it.
    const row = rows[next];
    const list = event.currentTarget;
    if (row && row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop;
    else if (row && row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
  };

  const expanded = open && !disabled && Boolean(editor) && !editor?.isDestroyed;
  const toggleLabel = expanded ? '收起笔记目录' : '展开笔记目录';

  return (
    <div className="markdown-note-outline-slot min-h-0" data-open={expanded}>
      <aside className="markdown-note-outline-sidebar flex h-full min-h-0 flex-col overflow-hidden border-r bg-card text-foreground"
        aria-label="笔记目录" onKeyDown={event => {
          if (expanded && event.key === 'Escape' && !event.defaultPrevented) {
            event.preventDefault(); event.stopPropagation();
            setOpen(false);
            toggleRef.current?.focus({ preventScroll: true });
          }
        }}>
        <div className="flex h-9 shrink-0 items-center gap-2 px-1">
          <Button ref={toggleRef} aria-label={toggleLabel} title={toggleLabel} aria-controls={panelId} aria-expanded={expanded}
            className="size-7 shrink-0 p-0" disabled={disabled || !editor || editor.isDestroyed} size="sm" type="button"
            variant="ghost" onClick={() => { setOpen(value => !value); setError(''); }}>
            {expanded ? <PanelLeftClose size={15} aria-hidden="true" /> : <ListTree size={15} aria-hidden="true" />}
          </Button>
          {expanded ? <h2 id={titleId} className="truncate text-[13px] font-medium">笔记目录</h2> : null}
        </div>
        <div id={panelId} aria-labelledby={expanded ? titleId : undefined} hidden={!expanded}
          className={expanded ? 'flex min-h-0 flex-1 flex-col gap-2 overflow-hidden border-t p-2' : 'hidden'}>
          <div className="flex gap-1" aria-label="目录范围">
            <Button type="button" size="xs" variant={showElements ? 'ghost' : 'secondary'} aria-pressed={!showElements}
              onClick={() => setShowElements(false)}>标题</Button>
            <Button type="button" size="xs" variant={showElements ? 'secondary' : 'ghost'} aria-pressed={showElements}
              onClick={() => setShowElements(true)}>全部元素</Button>
          </div>
          <Input aria-label="搜索笔记目录" className="shrink-0" placeholder="搜索标题或元素" value={query}
            onChange={event => setQuery(event.target.value)} />
          {error ? <p role="alert" className="shrink-0 text-xs text-destructive">{error}</p> : null}
          <nav aria-label="笔记文内定位" className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
            onKeyDown={navigateRows}>
            {items.length ? <ol className="m-0 list-none p-0">
              {items.map(item => <li key={`${item.position}:${item.kind}`}>
                <Button type="button" size="sm" variant="ghost" data-outline-position={item.position}
                  aria-label={`定位${outlineType(item)}：${item.label}`} title={`${outlineType(item)}：${item.label}`}
                  className="h-auto min-h-8 w-full justify-start gap-2 py-1 text-left font-normal"
                  style={{ paddingLeft: 8 + Math.min(item.depth, 8) * 12 }} onClick={() => locate(item)}>
                  <span aria-hidden="true" className="shrink-0 text-[11px] text-muted-foreground">
                    {item.headingLevel ? `H${item.headingLevel}` : ELEMENT_NAMES[item.kind] ?? '元素'}
                  </span>
                  <span className="min-w-0 truncate">{item.label}</span>
                </Button>
              </li>)}
            </ol> : <div className="px-1 py-3 text-xs text-muted-foreground">
              {query.trim() ? '没有匹配的目录项。' : showElements ? '此笔记暂无可定位内容。'
                : <>此笔记没有标题。<Button type="button" variant="link" size="xs" onClick={() => setShowElements(true)}>查看全部元素</Button></>}
            </div>}
          </nav>
        </div>
      </aside>
    </div>
  );
}
