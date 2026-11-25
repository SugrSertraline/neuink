import { useIdeationTask } from './ideationTask';
import { IdeationSourceDetails } from './IdeationSourceDetails';
import { WorksheetCardSection } from './WorksheetCardSection';
import { LocalIdeaEditor } from './LocalIdeaEditor';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { SourceSnapshotPreview } from '@/shared/components/SourceSnapshotPreview';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { SourceLinkOpenTarget } from '@/modules/notes/editor/SourceLinkNode';
import type { PaperCard } from '@/shared/ipc/ideationApi';
import { useIdeationContext } from './IdeationContext';
import { IdeationBoardDialog } from './IdeationBoardList';
import { ResearchPlanDialog } from './ResearchPlanDialog';
import { placeCard } from './ideationUtils';
import { cardErrorMessages, classifyCardError } from './generateCards';
import { ResearchPlanError } from './researchPlan';
import { recommendMethods, type MethodAdvice } from './methodRecommendations';
import { sectionForNode, reorderWorksheetCards, worksheetSections, type WorksheetSection, isWorksheetCard, setWorksheetValue, worksheetFields, worksheetNodes, worksheetReportState, worksheetValue, type WorksheetField } from './researchWorksheet';
type Props = { root: string; entries: LibraryEntry[]; trashedEntries?: LibraryEntry[]; onOpenTrash?: () => void; onOpenEntry: (id: string) => void; onOpenSource?: (target: SourceLinkOpenTarget) => void };
export function IdeationWorkspace(props: Props) {
  const context = useIdeationContext();
  const [creating,setCreating] = useState(false);
  if (!context) return <p className="p-4 text-sm text-muted-foreground">请先打开资料库。</p>;
  if (!context.state) return <div className="p-4" role={context.error ? 'alert' : 'status'}>{context.error ?? '正在读取研究构思…'}{context.error && <Button onClick={context.retryLoad}>重新读取</Button>}</div>;
  if (!context.activeBoard) return <div className="flex h-full flex-col items-center justify-center gap-4 p-6"><h1 className="text-lg font-semibold">从一个问题开始</h1><p className="text-sm text-muted-foreground">描述问题，挑选积累的方法，让 AI 帮你整理组合思路。</p><Button onClick={() => setCreating(true)}>新建构思</Button>{creating && <IdeationBoardDialog board="new" onClose={() => setCreating(false)} />}</div>;
  return <ResearchWorksheet key={context.activeBoard.id} {...props} />;
}
function ResearchWorksheet({ root, entries, trashedEntries = [], onOpenTrash, onOpenEntry, onOpenSource }: Props) {
  const runTask = useIdeationTask();
  const context = useIdeationContext()!, state = context.state!, board = context.activeBoard!;
  const [editing,setEditing] = useState(false), [planning,setPlanning] = useState(false);
  const [localCard,setLocalCard] = useState<{ field: WorksheetField; nodeId?: string; title?: string; body?: string } | null>(null);
  const [detail,setDetail] = useState<PaperCard | null>(null);
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [notice,setNotice] = useState('');
  const [advice,setAdvice] = useState<MethodAdvice | null>(null);
  const [undo,setUndo] = useState<(() => void) | null>(null);
  const controller = useRef<AbortController | null>(null);
  const nodes = worksheetNodes(state);
  const values = Object.fromEntries(worksheetFields.map(f => [f.key, worksheetValue(state,board.id,f.key)])) as Record<WorksheetField,string>;
  const sectionText = (field: WorksheetField) => nodes.filter(n => sectionForNode(n) === field).map(n => n.card.body).filter(Boolean).join('\n\n');
  const goal = sectionText('problem') || board.description;
  const methods = nodes.filter(n => sectionForNode(n) === 'method' && n.card.body.trim());
  const selected = nodes.filter(n => !isWorksheetCard(n.card_id) || n.card.body.trim()).map(n => n.card);
  const fingerprint = JSON.stringify([board.id, board.description, values, nodes.map(n => [n.id,n.card.title,n.card.body,n.card.origin,n.slot]), context.background.summaries?.map(s => [s.entry_id,s.revision])]);
  const latest = useRef(fingerprint); latest.current = fingerprint;
  useEffect(() => { controller.current?.abort(); setBusy(false); setAdvice(null); setError(''); }, [fingerprint]);
  useEffect(() => () => { controller.current?.abort(); }, []);
  useEffect(() => { const card = state.cards.find(c => c.id === context.selectedCardId); if (card) setDetail(card); }, [context.selectedCardId]);
  const run = async () => {
    if (!goal.trim()) { setError('请先填写想解决的问题，再推荐方法。'); return; }
    const abort = new AbortController(); controller.current?.abort(); controller.current = abort;
    const snapshot = fingerprint; setBusy(true); setError(''); setAdvice(null); setNotice('');
    try {
      const result = await runTask({root,kind:'compose',controller:abort},async stage=>{
        stage('基于已选方法和顺序整理思路');
        const result = await recommendMethods({goal,background:sectionText('background'),constraints:'',selected,candidates:[],mode:'compose',methodOrder:methods.map(n=>n.card_id)},abort.signal);
        stage('校验研究思路');return result;
      });
      if (abort.signal.aborted || latest.current !== snapshot) return;
      setAdvice(result);setNotice('研究思路尚未验证，请审阅后采用。');
    } catch (cause) { if (!abort.signal.aborted && latest.current === snapshot) setError(cause instanceof ResearchPlanError ? cause.message : cardErrorMessages[classifyCardError(cause)]); }
    finally { if (controller.current === abort) { setBusy(false); controller.current = null; } }
  };
  const methodIds = methods.map(n => n.card_id).join('|');
  const previousMethods = useRef(methodIds);
  useEffect(() => {
    const previous = new Set(previousMethods.current.split('|')); previousMethods.current = methodIds;
    const added = methodIds.split('|').find(id => id && !previous.has(id));
    if (added) context.requestWorksheetCards('method');
  }, [methodIds]);
  const remove = (id: string) => {
    const index = state.placements.findIndex(n => n.id === id); const node = state.placements[index]; if (!node) return; const links = (state.links ?? []).filter(l => l.from === id || l.to === id);
    context.update(current => ({ ...current, placements: current.placements.filter(n => n.id !== id), links: current.links?.filter(l => l.from !== id && l.to !== id) }));
    setUndo(() => () => context.update(current => ({ ...current, placements: [...current.placements.slice(0,index),node,...current.placements.slice(index)], links: [...(current.links ?? []),...links.filter(l => [l.from,l.to].every(n => n === id || current.placements.some(p => p.id === n)))] })));
  };
  const write = (key: WorksheetField, value: string) => context.update(current => setWorksheetValue(current,board.id,key,value));
  return <div className="flex h-full min-h-0 flex-col bg-background" aria-label="研究方案填写页">
    <header className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-3">
      <Button size="sm" variant="ghost" onClick={() => { context.setSidebarTab('boards'); context.showSidebar(); }}><ArrowLeft />构思列表</Button>
      <h1 className="min-w-0 flex-1 truncate text-sm font-semibold" title={board.title}>{board.title}</h1><Button size="icon-sm" variant="ghost" aria-label="编辑构思名称" onClick={() => setEditing(true)}><Pencil /></Button>
      <span role="status" className="w-24 text-right text-xs text-muted-foreground">{context.saving ? '保存中…' : context.dirty ? '未保存' : '已保存到本地'}</span>
      <Button size="sm" variant="outline" disabled={!context.dirty || context.saving} onClick={() => void context.save()}>保存</Button>
      <Button size="sm" disabled={!goal.trim() || !selected.length || busy} onClick={() => setPlanning(true)}>开始研究</Button>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto" aria-label="研究内容">
      <div className="mx-auto max-w-[1064px] space-y-8 px-5 py-6">
        <p className="text-sm text-muted-foreground">先描述问题，再选择方法。AI 帮你找可配合的方法、整理方案；无需连线。</p>
        {context.error && <p role="alert" className="text-sm text-destructive">保存失败：{context.error}。内容仍保留，请点击保存重试。</p>}
        {undo && <div className="flex items-center gap-2 text-sm" role="status">已更新本构思，可撤销此次操作<Button size="sm" variant="outline" onClick={() => { undo(); setUndo(null); }}>撤销</Button></div>}
        {worksheetSections.map(field => <WorksheetCardSection key={field.key} boardId={board.id} section={field.key}
          sourceStatus={id => ['ideation-user','ideation-preset'].includes(id) || entries.some(e => e.id === id) ? undefined : trashedEntries.some(e => e.id === id) ? '来源已移入回收站' : '来源当前不可用'}
          nodes={nodes.filter(n => n.card.body.trim() && sectionForNode(n) === field.key)} active={context.worksheetSection === field.key}
          onChoose={()=>context.requestWorksheetCards(field.key)} onDescribe={()=>setLocalCard({field:field.key})}
          onView={node=>setDetail(node.card)} onEdit={node=>setLocalCard({field:field.key,nodeId:node.id,title:node.card.title,body:node.card.body})}
          onRemove={remove} onReorder={(source,target,after)=>context.update(current=>reorderWorksheetCards(current,field.key,source,target,after))} />)}
        <section aria-label="研究思路草稿" className="space-y-4">
          <div className="flex flex-wrap items-center gap-3"><h2 className="mr-auto text-sm font-semibold">研究思路草稿</h2><Button size="sm" variant="outline" disabled={busy||!goal.trim()||!methods.length} onClick={()=>void run()}>整理研究思路</Button></div>
          <p className="text-xs leading-5 text-muted-foreground">AI 根据上面的背景、问题和方法顺序整理思路。这是生成结果，不需要再添加一类素材。</p>
          {busy&&<div role="status" className="flex items-center gap-2 text-sm">正在整理研究思路…<Button size="sm" variant="outline" onClick={()=>{controller.current?.abort();setBusy(false);setNotice('已停止，可以重新整理。');}}>停止</Button></div>}
          {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}{notice&&<p role="status" className="text-xs text-muted-foreground">{notice}</p>}
          {advice?.plan&&<div className="space-y-3 rounded-lg border bg-card p-4"><h3 className="text-sm font-medium">新建议 · 尚未采用</h3><SourceSnapshotPreview markdown={advice.plan} normalization="none" /><Button size="sm" onClick={()=>{const old=values.composition;write('composition',advice.plan);setUndo(()=>()=>write('composition',old));}}>采用研究思路</Button></div>}
          {nodes.filter(n=>sectionForNode(n)==='composition'&&n.card.body.trim()).map(node=><div key={node.id} className="space-y-3 rounded-lg border bg-card p-4"><div className="flex items-center gap-2"><h3 className="mr-auto text-sm font-medium">{node.card.title}</h3>{node.card_id.startsWith('local-idea-')&&<Button size="sm" variant="outline" onClick={()=>setLocalCard({field:'composition',nodeId:node.id,title:node.card.title,body:node.card.body})}>修改草稿</Button>}<Button size="sm" variant="ghost" onClick={()=>remove(node.id)}>移除</Button></div><SourceSnapshotPreview markdown={node.card.body} normalization="none" /></div>)}
        </section>
      </div>
    </div>
    {localCard && <LocalIdeaEditor maxLength={localCard.field === 'composition' ? 12000 : 6000} title={localCard.title} body={localCard.body} onClose={() => setLocalCard(null)} onSave={(title,body) => {
      if (localCard.nodeId) context.update(current => ({ ...current, placements: current.placements.map(n => n.id === localCard.nodeId ? {...n,title,body} : n) }));
      else placeCard(context.update,{id:`local-idea-${crypto.randomUUID()}`,entry_id:'ideation-user',kind:worksheetFields.find(f => f.key === localCard.field)!.kind,title,body},0,0);
      setLocalCard(null);
    }} />}
    {editing && <IdeationBoardDialog board={board} onClose={() => setEditing(false)} />}
    {planning && <ResearchPlanDialog root={root} onClose={() => setPlanning(false)} worksheet={{ goal, state: worksheetReportState(state), background: sectionText('background'), constraints: '' }} />}
    {detail && <Dialog open onOpenChange={open => { if (!open) { setDetail(null); context.setSelectedCardId(null); } }}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>{detail.title}</DialogTitle><DialogDescription>卡片详情 · {entries.find(e => e.id === detail.entry_id)?.title ?? trashedEntries.find(e => e.id === detail.entry_id)?.title ?? (['ideation-user','ideation-preset'].includes(detail.entry_id) ? '本构思或个人内容' : '来源当前不可用')}</DialogDescription></DialogHeader><DialogBody><SourceSnapshotPreview markdown={detail.body} normalization="none" /><IdeationSourceDetails root={root} entryId={detail.entry_id} sources={detail.sources} title={entries.find(e => e.id === detail.entry_id)?.title} trashedTitle={trashedEntries.find(e => e.id === detail.entry_id)?.title} onOpenEntry={onOpenEntry} onOpenSource={onOpenSource} onOpenTrash={onOpenTrash} /></DialogBody></DialogContent></Dialog>}

  </div>;
}
