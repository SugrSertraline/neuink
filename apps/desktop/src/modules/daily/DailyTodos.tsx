import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { DailyWidget } from '@/shared/types/daily';
import { useDaily } from './DailyContext';
import { TodoWidget } from './TodoWidget';

/** A fixed todo view. Legacy widget references and their documents remain untouched. */
export function DailyTodos() {
  const model = useDaily()!;
  const [showCompleted, setShowCompleted] = useState(false);
  const saved = model.state?.widgets.find(widget => widget.kind === 'todos');
  const widget: DailyWidget = {
    id: saved?.id ?? 'daily-sidebar-todos', kind: 'todos', title: '待办',
    collapsed: false, expanded: true, note: null,
    list_id: saved?.list_id ?? model.state?.lists[0]?.id ?? 'inbox',
    selected_date_only: false, show_completed: showCompleted,
  };
  return <aside className="app-sidebar daily-sidebar flex min-h-0 flex-col" aria-label="看板待办">
    <div className="side-head flex h-9 shrink-0 items-center gap-2">
      <span className="mr-auto font-semibold">待办</span>
      <Button size="xs" variant="plain" className="text-[11px]" aria-pressed={showCompleted}
        disabled={!model.state} onClick={() => setShowCompleted(value => !value)}>显示已完成</Button>
    </div>
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3">
      <div className="flex h-6 shrink-0 items-center text-[11px] text-muted-foreground" role="status">
        {model.loading ? '正在读取…' : model.busy && !model.error ? '保存中…' : ''}
      </div>
      {!model.root ? <p className="text-xs text-muted-foreground">请先打开资料库。</p> : null}
      {model.error ? <div role="alert" className="space-y-1 pb-2 text-xs text-destructive">
        <p>{model.error}</p>
        <Button size="xs" variant="outline" onClick={model.retry}>重试保存或读取</Button>
        <Button size="xs" variant="plain" onClick={model.reload}>放弃本次修改并重新载入</Button>
      </div> : null}
      {model.state ? <section data-widget-id={widget.id} aria-label="待办清单"><TodoWidget widget={widget} allLists /></section> : null}
    </div>
  </aside>;
}
