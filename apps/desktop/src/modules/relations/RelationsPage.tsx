import { useEffect, useMemo, useReducer } from 'react';
import { ArrowLeft, ArrowRight, Filter, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/search-input';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { NoteCatalog } from '@/shared/ipc/noteCatalogApi';
import type { TagMeta } from '@/shared/types/domain';
import { RelationCanvas } from './RelationCanvas';
import { RelationDetails } from './RelationDetails';
import { buildRelationGraph, filterRelationGraph, RELATION_KINDS, RELATION_LABELS, type RelationEvidence, type RelationNode } from './relationGraph';
import './relations.css';
import { initialRelationNavigation, relationNavigation, relationOverview } from './relationNavigation';

export type RelationsPageProps = {
  entries: LibraryEntry[]; tags: TagMeta[]; trashedEntries: LibraryEntry[]; catalog: NoteCatalog;
  loading: boolean; error: string | null; onRefresh: () => void; onBack: () => void;
  active?: boolean;
  onOpen: (node: RelationNode) => void; onSource: (evidence: RelationEvidence) => void;
};

/** View-only state belongs here; workspace navigation and catalog loading remain outside. */
export function RelationsPage({ entries, tags, trashedEntries, catalog, loading, error, onRefresh, onBack, onOpen, onSource, active = true }: RelationsPageProps) {
  const graph = useMemo(() => buildRelationGraph(tags, entries, catalog.notes, trashedEntries), [tags, entries, catalog.notes, trashedEntries]);
  const [navigation, navigate] = useReducer(relationNavigation, undefined, initialRelationNavigation);
  const location = navigation.history[navigation.index];
  const { query, kinds, selectedId } = location;
  const selected = graph.nodes.find(node => node.id === selectedId) ?? null;
  const visible = useMemo(() => filterRelationGraph(graph, kinds, query, null), [graph, kinds, query]);
  const select = (id: string | null) => navigate({ type: 'visit', location: { ...location, selectedId: id, query: id ? '' : query } });
  const back = () => navigate({ type: 'back' });
  const reset = () => navigate({ type: 'visit', location: relationOverview() });
  useEffect(() => { if (!loading) navigate({ type: 'prune', ids: new Set(graph.nodes.map(node => node.id)) }); }, [graph, loading]);
  return <section className="relations-page flex h-full min-h-0 min-w-0 flex-col bg-card" aria-label="关系图页面"
    onKeyDown={event => {
      if (!event.defaultPrevented && event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !(event.target as HTMLElement).closest('input,textarea,[role="menu"],[contenteditable="true"]')) {
        event.preventDefault(); navigate({ type: event.key === 'ArrowLeft' ? 'back' : 'forward' }); return;
      }
      if (event.defaultPrevented || event.key !== 'Escape' || (event.target as HTMLElement).closest('input,textarea,[role="menu"],[role="dialog"],[contenteditable="true"]')) return;
      if (selected) { event.preventDefault(); select(null); }
    }}>
    <header className="flex shrink-0 flex-wrap items-center gap-3 border-b px-3 py-3">
      <Button size="sm" variant="ghost" onClick={onBack}><ArrowLeft size={14} />条目库</Button>
      <div className="mr-auto"><h1 className="text-sm font-semibold">关系图</h1><p className="mt-0.5 text-xs text-muted-foreground">{tags.length} 个标签 · {entries.length} 个条目 · {graph.nodes.filter(node => node.kind === 'note').length} 篇笔记</p></div>
      <Button size="sm" variant="outline" disabled={loading} onClick={onRefresh}><RefreshCw size={13} className={loading ? 'animate-spin' : undefined} />{loading ? '更新中' : '刷新关系'}</Button>
    </header>
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
      <div className="flex items-center gap-0.5" aria-label="关系查看历史">
        <Button size="icon-sm" variant="ghost" aria-label="返回上一个对象" disabled={navigation.index === 0} onClick={back}><ArrowLeft size={14} /></Button>
        <Button size="icon-sm" variant="ghost" aria-label="前进到下一个对象" disabled={navigation.index >= navigation.history.length - 1} onClick={() => navigate({ type: 'forward' })}><ArrowRight size={14} /></Button>
      </div>
      <SearchInput label="搜索关系图" placeholder="查找标签、条目或笔记" value={query} onValueChange={query => navigate({ type: 'search', query })} className="basis-48" />
      <DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="outline"><Filter size={13} />关系类型{kinds.length === RELATION_KINDS.length ? '' : ` ${kinds.length}/4`}</Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">{RELATION_KINDS.map(kind => <DropdownMenuCheckboxItem key={kind} checked={kinds.includes(kind)} onSelect={event => event.preventDefault()}
          onCheckedChange={checked => navigate({ type: 'visit', location: { ...location, kinds: RELATION_KINDS.filter(item => item === kind ? checked : kinds.includes(item)) } })}>{RELATION_LABELS[kind]}</DropdownMenuCheckboxItem>)}</DropdownMenuContent>
      </DropdownMenu>
      <Button size="sm" variant="ghost" disabled={!selectedId && !query && kinds.length === RELATION_KINDS.length} onClick={reset}>全部关系</Button>
    </div>
    <div className="relation-explanation flex shrink-0 flex-wrap gap-x-4 gap-y-1 border-b bg-muted px-3 py-1.5 text-[11px] text-muted-foreground" aria-label="关系含义">
      <span>标签 → 下级标签</span><span>标签 → 直接归属的条目</span><span>标签 / 条目 → 笔记</span><span>笔记 → 引用的原文</span>
    </div>
    {loading ? <p role="status" className="border-b px-3 py-1.5 text-xs text-muted-foreground">正在更新笔记和引用关系…</p> : null}
    {error || catalog.errors.length ? <div role="alert" className="shrink-0 border-b px-3 py-2 text-xs text-destructive">
      <p>部分关系未能加载，已读取的内容仍可查看。{error}</p>
      {catalog.errors.length ? <details className="mt-1"><summary className="cursor-pointer">查看 {catalog.errors.length} 条加载提示</summary><ul className="max-h-24 overflow-y-auto">{catalog.errors.map((message, index) => <li key={index} className="break-words">{message}</li>)}</ul></details> : null}
    </div> : null}
    <div className="relations-body flex min-h-0 flex-1 overflow-hidden">
      {visible.nodes.length ? <RelationCanvas graph={visible} selectedId={selected?.id ?? null} active={active} onSelect={select}
        renderDetails={selected ? onClose => <RelationDetails key={selected.id} node={selected} graph={visible} onSelect={select} onClose={onClose} onOpen={onOpen} onSource={onSource} filtered={kinds.length < RELATION_KINDS.length} /> : undefined} /> : <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
        <p>{loading ? '正在整理关系…' : graph.nodes.length ? '没有符合当前范围的对象' : error ? '关系暂不可用，请稍后刷新' : '还没有标签、条目或笔记'}</p>
        {graph.nodes.length ? <Button size="sm" variant="outline" onClick={reset}>清除筛选</Button> : !loading ? <Button size="sm" variant="outline" onClick={onBack}>返回条目库</Button> : null}
      </div>}
    </div>
    <footer className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t px-3 py-1.5 text-[11px] text-muted-foreground">
      <span>{selected ? `当前对象 · ${visible.edges.filter(edge => edge.from === selected.id || edge.to === selected.id).length} 条直接关系`
        : `${visible.nodes.length} 个对象 · ${visible.edges.length} 条关系`}</span><span>悬停预览 · 点击查看详情</span><span className="ml-auto">仅展示已记录的关系</span>
    </footer>
  </section>;
}
