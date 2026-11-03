import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { WorkspaceWebLink } from '@/shared/components/WorkspaceWebLink';
import { useToast } from '@/shared/hooks/useToast';
import { approveResearchImport, previewResearchImport, rememberResearchConsent, runResearchTool, type ResearchPaper } from '@/shared/ipc/researchApi';
import { finishAssistantBackgroundRun, setAssistantBackgroundRun } from './assistantBackgroundRuns';
import type { SciverseLibraryImportResult } from '@/shared/ipc/assistantApi';
import { ASSISTANT_IMPORT_INCOMPLETE, formatAssistantError, readAssistantDebug, useAssistantDebug } from '@/shared/lib/assistantDebug';
import { indexLibraryPapers, type LocalPaperMatch, type PaperLibraryEntry } from '../research/libraryPaperMatch';

export type SciverseImportState = { status: 'idle' | 'confirm' | 'loading' }
  | { status: 'done'; result: SciverseLibraryImportResult } | { status: 'error'; message: string };
const SciverseContext = createContext<{ states: Record<string, SciverseImportState>; update: (id: string, state: SciverseImportState) => void } | null>(null);
export function useSciverseImportState(id: string): [SciverseImportState, (state: SciverseImportState) => void] {
  const shared = useContext(SciverseContext);
  const [local, setLocal] = useState<SciverseImportState>({ status: 'idle' });
  return shared ? [shared.states[id] ?? { status: 'idle' }, state => shared.update(id, state)] : [local, setLocal];
}

type State = { phase: 'preview' | 'confirm' | 'importing' | 'done' | 'error'; paper?: ResearchPaper; entryId?: string; message?: string; cancelled?: boolean };
type Actions = { states: Record<string, State>; prepare: (paper: ResearchPaper) => void; confirm: (id: string) => void; cancel: (id: string) => void;
  findLocal: (paper: ResearchPaper) => LocalPaperMatch | null; libraryStatus: 'loading' | 'ready' | 'error'; openEntry?: (id: string) => void };
const Context = createContext<Actions | null>(null);
const EMPTY_ENTRIES: PaperLibraryEntry[] = [];

/** Workspace-scoped state is shared by chat and read-only tabs, including in-flight/finished imports. */
export function ResearchPaperActionsProvider({ root, children, entries = EMPTY_ENTRIES, libraryStatus = 'ready', onOpenEntry }: {
  root: string | null; children: ReactNode; entries?: readonly PaperLibraryEntry[]; libraryStatus?: 'loading' | 'ready' | 'error'; onOpenEntry?: (id: string) => void;
}) {
  const [states, setStates] = useState<Record<string, State>>({});
  const [sciverseStates, setSciverseStates] = useState<Record<string, SciverseImportState>>({});
  const current = useRef(states);
  const alive = useRef(true);
  const locks = useRef(new Set<string>());
  const { notify } = useToast();
  const findLocal = useMemo(() => indexLibraryPapers(entries), [entries]);
  const catalog = useRef({ findLocal, libraryStatus }); catalog.current = { findLocal, libraryStatus };
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const update = (id: string, state?: State) => {
    if (!alive.current) return;
    const next = { ...current.current };
    if (state) next[id] = state; else delete next[id];
    // No permanent search cache. An evicted unsubmitted preview grants no permission.
    for (const key of Object.keys(next)) {
      if (Object.keys(next).length <= 128) break;
      if (key !== id && !['preview', 'importing'].includes(next[key].phase)) delete next[key];
    }
    current.current = next; setStates(next);
  };
  useEffect(() => {
    if (libraryStatus !== 'ready') return;
    // Once the catalog confirms an import, it owns presence (including later trash/restore).
    const ids = new Set(entries.map(entry => entry.id));
    for (const [id, state] of Object.entries(states)) if (state.phase === 'done' && state.entryId && ids.has(state.entryId)) update(id);
  }, [entries, libraryStatus, states]);
  const prepare = async (candidate: ResearchPaper) => {
    const id = candidate.id;
    if (!root || catalog.current.libraryStatus !== 'ready' || catalog.current.findLocal(candidate) || locks.current.has(id) || current.current[id]?.phase === 'done') return;
    if (locks.current.size >= 8) {
      notify({ title: '正在处理其他论文', description: '请等待当前预览或添加完成后重试。' });
      return;
    }
    locks.current.add(id); update(id, { phase: 'preview' });
    try {
      const papers = await previewResearchImport(root, [id]);
      const paper = papers.find(item => item.id === id);
      if (!paper) throw new Error('检索结果已过期，请重新检索后添加。');
      if (catalog.current.findLocal(paper)) { update(id); return; }
      if (!paper.pdf_url) throw new Error('该论文没有可下载的公开 PDF，请打开原文查看。');
      update(id, { phase: 'confirm', paper });
    } catch (error) { update(id, { phase: 'error', message: String(error) }); }
    finally { locks.current.delete(id); }
  };
  const confirm = async (id: string) => {
    const state = current.current[id];
    if (!root || catalog.current.libraryStatus !== 'ready' || locks.current.has(id) || state?.phase !== 'confirm' || !state.paper) return;
    const paper = state.paper;
    if (catalog.current.findLocal(paper)) { update(id); return; }
    locks.current.add(id); update(id, { phase: 'importing', paper });
    const controller = new AbortController();
    const callId = crypto.randomUUID();
    setAssistantBackgroundRun({ abortController: controller, root, conversation: null, conversationId: null,
      taskKind: 'paper-import', startedAt: Date.now(),
      question: `添加论文：${paper.title}`, error: null, streamingMessageId: null,
      noteProposalsByMessageId: {}, toolEventsByMessageId: {} });
    try {
      controller.signal.throwIfAborted();
      await approveResearchImport(root, [id], [paper], callId);
      controller.signal.throwIfAborted();
      rememberResearchConsent(root, callId, callId);
      const output = await runResearchTool('import_papers', { root, paper_ids: [id] }, controller.signal, callId) as {
        results?: Array<{ id: string; status: string; entry_id?: string; error?: string }>;
      };
      const result = output?.results?.find(item => item.id === id);
      if (!result || !['imported', 'already_in_library'].includes(result.status)) {
        throw new Error(result?.error || '未收到添加成功的结果，请检查条目库后重试。');
      }
      const message = result.status === 'already_in_library' ? '已在本地文库，无需重复添加。' : '已添加到本地，PDF 已下载；尚未解析。';
      update(id, { phase: 'done', paper, entryId: result.entry_id, message });
      notify({ tone: 'success', title: '论文已在本地文库', description: `${paper.title}：${message}` });
    } catch (error) {
      const message = controller.signal.aborted ? '添加已停止，可能有文件已写入，请检查条目库后重试。' : String(error);
      update(id, { phase: 'error', message, cancelled: controller.signal.aborted });
      notify({ tone: 'danger', title: '论文添加未完成', description: formatAssistantError(message, { debug: readAssistantDebug(), fallback: controller.signal.aborted ? '论文添加已停止，请先核对条目库。' : ASSISTANT_IMPORT_INCOMPLETE }) });
    } finally { locks.current.delete(id); finishAssistantBackgroundRun(controller); }
  };
  return <SciverseContext.Provider value={{ states: sciverseStates, update: (id, state) => {
    if (!alive.current) return;
    setSciverseStates(previous => {
      const next = { ...previous, [id]: state };
      for (const key of Object.keys(next)) {
        if (Object.keys(next).length <= 128) break;
        if (key !== id && next[key].status !== 'loading') delete next[key];
      }
      return next;
    });
  } }}><Context.Provider value={root ? { states, findLocal, libraryStatus, openEntry: onOpenEntry, prepare: paper => { void prepare(paper); }, confirm: id => { void confirm(id); },
    cancel: id => { if (!locks.current.has(id)) update(id); } } : null}>{children}</Context.Provider></SciverseContext.Provider>;
}

export function ResearchPaperAction({ paper, children, variant = 'row', secondaryActions, titleLink = true, className }: { paper: ResearchPaper; children?: ReactNode; variant?: 'row' | 'card'; secondaryActions?: ReactNode; titleLink?: boolean; className?: string }) {
  const debug = useAssistantDebug();
  const actions = useContext(Context);
  const state = actions?.states[paper.id];
  const local = actions?.libraryStatus === 'ready' ? actions.findLocal(paper) : null;
  const card = variant === 'card';
  return <article aria-label={card ? paper.title : undefined} className={cn(card ? 'flex min-w-0 flex-col rounded-lg border bg-card p-3 text-sm [overflow-wrap:anywhere]' : 'min-w-0 border-b py-3 text-sm [overflow-wrap:anywhere]', className)}>
    <div className={card ? 'flex flex-1 flex-col gap-3' : 'flex flex-wrap items-start justify-between gap-2'}>
    <div className={card ? 'min-w-0 flex-1' : 'min-w-0 flex-1 basis-40'}>
      <div className={card ? 'line-clamp-3 font-medium leading-5' : undefined} title={card ? paper.title : undefined}>{titleLink ? <WorkspaceWebLink href={paper.url}>{paper.title}</WorkspaceWebLink> : paper.title}</div>
      <p className={card ? 'mt-1 border-b pb-3 text-xs text-muted-foreground' : 'text-xs text-muted-foreground'}><span className={card ? 'line-clamp-1' : undefined}>{[paper.year, paper.provider, (paper.authors ?? []).slice(0, 3).join(', ')].filter(Boolean).join(' · ')}</span></p>
      {children && <div className="mt-1">{children}</div>}
    </div>
    <div className={`flex shrink-0 flex-wrap items-center gap-2 ${card ? 'border-t pt-3' : ''}`}>
      {secondaryActions}
      {!card ? <WorkspaceWebLink href={paper.url}>查看</WorkspaceWebLink> : null}
      {local ? <>
        <span className="text-xs text-muted-foreground">{local.hasPdf ? '已在本地' : '已在本地 · 暂无 PDF'}</span>
        {actions?.openEntry ? <Button size="sm" variant="outline" onClick={() => actions.openEntry?.(local.entryId)}>{local.hasPdf ? '打开论文' : '打开条目'}</Button> : null}
      </> : <Button size="sm" variant="outline" disabled={!actions || actions.libraryStatus !== 'ready' || ['preview', 'importing', 'done', 'confirm'].includes(state?.phase ?? '')}
        onClick={() => actions?.prepare(paper)}>
        {actions?.libraryStatus === 'loading' ? '正在检查本地…' : actions?.libraryStatus === 'error' ? '本地状态暂不可用' : state?.phase === 'done' ? '已在本地' : state?.phase === 'preview' ? '读取预览…' : state?.phase === 'importing' ? '正在添加…' : state?.phase === 'error' ? '重试添加' : '添加到本地'}
      </Button>}
      {!actions && <span className="text-xs text-muted-foreground">打开资料库后可添加</span>}
    </div>
    </div>
    {!local && state?.phase === 'confirm' && <div className="mt-2 grid gap-2 rounded border bg-muted p-2">
      <p>确认下载并添加《{state.paper?.title}》？不会自动解析、添加标签或修改笔记。</p>
      <p className="text-xs text-muted-foreground">{state.paper?.pdf_url}</p>
      <div className="flex flex-wrap gap-2"><Button size="sm" variant="ghost" onClick={() => actions?.cancel(paper.id)}>取消</Button>
        <Button size="sm" disabled={actions?.libraryStatus !== 'ready'} onClick={() => actions?.confirm(paper.id)}>确认添加</Button></div>
    </div>}
    {!local && state?.message && <p role={state.phase === 'error' ? 'alert' : 'status'} className={state.phase === 'error' ? 'mt-1 text-destructive' : 'mt-1 text-muted-foreground'}>{state.phase === 'error' ? formatAssistantError(state.message, { debug, fallback: state.cancelled ? '论文添加已停止，请先核对条目库。' : ASSISTANT_IMPORT_INCOMPLETE }) : state.message}</p>}
  </article>;
}
