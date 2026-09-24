import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Filter, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/search-input';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { NoteCatalog } from '@/shared/ipc/noteCatalogApi';
import type { TagMeta } from '@/shared/types/domain';
import { RelationCanvas } from './RelationCanvas';
import { RelationDetails } from './RelationDetails';
import { buildRelationGraph, filterRelationGraph, RELATION_KINDS, RELATION_LABELS, type RelationEvidence, type RelationKind, type RelationNode } from './relationGraph';
import './relations.css';

export type RelationsPageProps = {
  entries: LibraryEntry[]; tags: TagMeta[]; trashedEntries: LibraryEntry[]; catalog: NoteCatalog;
  loading: boolean; error: string | null; onRefresh: () => void; onBack: () => void;
  active?: boolean;
  onOpen: (node: RelationNode) => void; onSource: (evidence: RelationEvidence) => void;
};

/** View-only state belongs here; workspace navigation and catalog loading remain outside. */
export function RelationsPage({ entries, tags, trashedEntries, catalog, loading, error, onRefresh, onBack, onOpen, onSource, active = true }: RelationsPageProps) {
  const graph = useMemo(() => buildRelationGraph(tags, entries, catalog.notes, trashedEntries), [tags, entries, catalog.notes, trashedEntries]);
  const [query, setQuery] = useState('');
  const [kinds, setKinds] = useState<RelationKind[]>(RELATION_KINDS);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [navigation, setNavigation] = useState<{ ids: (string | null)[]; index: number }>({ ids: [null], index: 0 });
  const selectedId = navigation.ids[navigation.index];
  const selected = graph.nodes.find(node => node.id === selectedId) ?? null;
  const focus = graph.nodes.find(node => node.id === focusId);
  const visible = useMemo(() => filterRelationGraph(graph, kinds, query, focus?.id ?? null), [graph, kinds, query, focus?.id]);
  const select = (id: string | null) => setNavigation(current => current.ids[current.index] === id ? current
    : { ids: [...current.ids.slice(0, current.index + 1), id], index: current.index + 1 });
  const back = () => setNavigation(current => ({ ...current, index: Math.max(0, current.index - 1) }));
  const reset = () => { setFocusId(null); setQuery(''); setKinds(RELATION_KINDS); };
  return <section className="relations-page flex h-full min-h-0 min-w-0 flex-col bg-card" aria-label="关系图页面"
    onKeyDown={event => {
      if (event.key !== 'Escape' || (event.target as HTMLElement).closest('input,textarea,[role="menu"],[contenteditable="true"]')) return;
      if (selected) { event.preventDefault(); back(); }
    }}>
    <header className="flex shrink-0 flex-wrap items-center gap-3 border-b px-3 py-3">
      <Button size="sm" variant="ghost" onClick={onBack}><ArrowLeft size={14} />条目库</Button>
      <div className="mr-auto"><h1 className="text-sm font-semibold">关系图</h1><p className="mt-0.5 text-xs text-muted-foreground">{tags.length} 个标签 · {entries.length} 篇论文 · {graph.nodes.filter(node => node.kind === 'note').length} 篇笔记</p></div>
      <Button size="sm" variant="outline" disabled={loading} onClick={onRefresh}><RefreshCw size={13} className={loading ? 'animate-spin' : undefined} />{loading ? '更新中' : '刷新关系'}</Button>
    </header>
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
      <div className="flex items-center gap-0.5" aria-label="关系查看历史">
        <Button size="icon-sm" variant="ghost" aria-label="返回上一个对象" disabled={navigation.index === 0} onClick={back}><ArrowLeft size={14} /></Button>
        <Button size="icon-sm" variant="ghost" aria-label="前进到下一个对象" disabled={navigation.index >= navigation.ids.length - 1} onClick={() => setNavigation(current => ({ ...current, index: current.index + 1 }))}><ArrowRight size={14} /></Button>
      </div>
      <SearchInput label="搜索关系图" placeholder="搜索标签、论文或笔记，显示其直接关系" value={query} onValueChange={setQuery} className="basis-48" />
      <DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="outline"><Filter size={13} />关系类型{kinds.length === RELATION_KINDS.length ? '' : ` ${kinds.length}/4`}</Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">{RELATION_KINDS.map(kind => <DropdownMenuCheckboxItem key={kind} checked={kinds.includes(kind)} onSelect={event => event.preventDefault()}
          onCheckedChange={checked => setKinds(current => checked ? [...current, kind] : current.filter(item => item !== kind))}>{RELATION_LABELS[kind]}</DropdownMenuCheckboxItem>)}</DropdownMenuContent>
      </DropdownMenu>
      <Button size="sm" variant="ghost" disabled={!focus && !query && kinds.length === RELATION_KINDS.length} onClick={reset}>全部关系</Button>
    </div>
    {focus ? <div className="flex shrink-0 items-center gap-2 border-b bg-muted/40 px-3 py-1 text-xs"><span className="min-w-0 flex-1 truncate">聚焦：{focus.title} 及其直接关系</span><Button size="xs" variant="ghost" onClick={() => setFocusId(null)}>退出聚焦</Button></div> : null}
    {loading ? <p role="status" className="border-b px-3 py-1.5 text-xs text-muted-foreground">正在更新笔记和引用关系…</p> : null}
    {error || catalog.errors.length ? <div role="alert" className="shrink-0 border-b px-3 py-2 text-xs text-destructive">
      <p>部分关系未能加载，已读取的内容仍可查看。{error}</p>
      {catalog.errors.length ? <details className="mt-1"><summary className="cursor-pointer">查看 {catalog.errors.length} 条加载提示</summary><ul className="max-h-24 overflow-y-auto">{catalog.errors.map((message, index) => <li key={index} className="break-words">{message}</li>)}</ul></details> : null}
    </div> : null}
    <div className="relations-body flex min-h-0 flex-1 overflow-hidden">
      {visible.nodes.length ? <RelationCanvas graph={visible} selectedId={selected?.id ?? null} active={active} onSelect={select}
        renderDetails={selected ? onClose => <RelationDetails node={selected} graph={graph} onSelect={select} onClose={onClose} onOpen={onOpen} onSource={onSource}
          onFocus={() => { setFocusId(selected.id); setQuery(''); }} /> : undefined} /> : <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
        <p>{loading ? '正在整理关系…' : graph.nodes.length ? '没有符合当前范围的对象' : error ? '关系暂不可用，请稍后刷新' : '还没有标签、论文或笔记'}</p>
        {graph.nodes.length ? <Button size="sm" variant="outline" onClick={reset}>清除筛选</Button> : !loading ? <Button size="sm" variant="outline" onClick={onBack}>返回条目库</Button> : null}
      </div>}
    </div>
    <footer className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t px-3 py-1.5 text-[11px] text-muted-foreground">
      <span>{visible.nodes.length} 个对象 · {visible.edges.length} 条关系</span><span>悬停预览 · 点击查看详情</span><span className="ml-auto">仅展示已记录的关系</span>
    </footer>
  </section>;
}
