import { useIdeationTask } from './ideationTask';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody } from '@/components/ui/dialog';
import { SourceSnapshotPreview } from '@/shared/components/SourceSnapshotPreview';
import type { PaperCard } from '@/shared/ipc/ideationApi';
import { useIdeationContext } from './IdeationContext';
import { addWorksheetCard, sectionForNode, worksheetNodes, worksheetSections, type WorksheetSection } from './researchWorksheet';
import { loadMethodCandidates, recommendMethods, type MethodAdvice } from './methodRecommendations';
import { ResearchPlanError } from './researchPlan';
import { cardErrorMessages, classifyCardError } from './generateCards';
export function WorksheetRecommendations({section}:{section:WorksheetSection}) {
  const runTask=useIdeationTask();
  const context=useIdeationContext()!, state=context.state!, board=context.activeBoard!;
  const [result,setResult]=useState<MethodAdvice|null>(null),[cards,setCards]=useState<PaperCard[]>([]),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[detail,setDetail]=useState<PaperCard|null>(null);
  const controller=useRef<AbortController|null>(null);
  const nodes=worksheetNodes(state).filter(n=>n.card.body.trim());
  const fingerprint=JSON.stringify([board.id,board.description,nodes.map(n=>[n.id,n.card.title,n.card.body,n.card.origin,n.slot]),(context.background.summaries ?? []).map(s=>[s.entry_id,s.revision])]);
  const latest=useRef(fingerprint);latest.current=fingerprint;
  const label=worksheetSections.find(f=>f.key===section)!.label;
  const run=async()=>{
    const abort=new AbortController();controller.current?.abort();controller.current=abort;
    const snapshot=fingerprint;setBusy(true);setError('');setNotice('');setResult(null);
    try {
      await runTask({root:context.workspaceRoot,kind:'recommend',controller:abort},async stage=>{
      stage('读取已确认卡片');
      const library=await loadMethodCandidates(context.workspaceRoot,state.cards,context.background.summaries ?? [],abort.signal,section);
      const available=library.cards.filter(c=>!nodes.some(n=>n.card_id===c.id));
      if(!available.length){if(!abort.signal.aborted&&latest.current===snapshot)setNotice(library.failures?'部分卡片读取失败，可重试或在下方浏览全部卡片。':'没有新的已确认候选卡片。可自己描述，或先到论文详情生成并确认卡片。');return;}
      const text=(target:WorksheetSection)=>nodes.filter(n=>sectionForNode(n)===target).map(n=>n.card.body).join('\n');
      stage('模型分析相关性与适用条件');
      const advice=await recommendMethods({goal:text('problem')||board.description||board.title,background:text('background'),constraints:'',selected:nodes.map(n=>n.card),candidates:available,mode:'recommend',section,methodOrder:nodes.filter(n=>sectionForNode(n)==='method').map(n=>n.card_id)},abort.signal);
      if(abort.signal.aborted||latest.current!==snapshot)return;
      stage('校验推荐结果');
      setCards(available);setResult(advice);setNotice([library.failures?`${library.failures} 篇卡片读取失败。`:'',available.length>120?'本次仅分析前 120 张候选。':'','AI 推荐尚需判断，不会自动加入。'].join(' '));
      });
    }catch(cause){if(!abort.signal.aborted&&latest.current===snapshot)setError(cause instanceof ResearchPlanError?cause.message:cardErrorMessages[classifyCardError(cause)]);}
    finally{if(controller.current===abort)setBusy(false);}
  };
  // A new empty-slot click remounts this component. Input changes invalidate, not automatically regenerate.
  useEffect(()=>{void run();return()=>controller.current?.abort();},[]);
  useEffect(()=>{return()=>{controller.current?.abort();};},[fingerprint]);
  const previous=useRef(fingerprint);
  useEffect(()=>{if(previous.current!==fingerprint){previous.current=fingerprint;setResult(null);setError('');setBusy(false);setNotice('研究内容已改变，点击重新推荐获取匹配结果。');}},[fingerprint]);
  return <section aria-label="推荐卡片" className="space-y-3 border-b pb-4">
    <div className="flex items-center gap-2"><h3 className="mr-auto text-sm font-semibold">推荐 · {label}</h3><Button size="sm" variant="outline" onClick={()=>{if(busy){controller.current?.abort();setBusy(false);setNotice('已停止，可重新推荐。');}else void run();}}>{busy?'停止':'重新推荐'}</Button></div>
    {busy&&<p role="status" className="text-xs text-muted-foreground">正在结合构思分析卡片…</p>}{error&&<p role="alert" className="text-xs text-destructive">{error}</p>}{notice&&<p role="status" className="text-xs text-muted-foreground">{notice}</p>}
    {result?.recommendations.map(item=>{const card=cards.find(c=>c.id===item.cardId);if(!card)return null;return <article key={item.cardId} className="space-y-2 rounded-md border bg-card p-3"><button className="text-left text-sm font-medium hover:text-primary" onClick={()=>setDetail(card)}>{card.title}</button><p className="text-xs leading-5">{item.reason}</p><p className="text-xs text-muted-foreground">{item.combination}</p><p className="text-xs text-muted-foreground">注意：{item.caution}</p><div className="flex items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{section==='method'?(item.relation==='alternative'?'替代选择':'互补方法'):'相关素材'}</span><Button size="sm" variant="outline" onClick={()=>context.update(current=>addWorksheetCard(current,card,section))}>加入{label}</Button></div></article>;})}
    {result?.gap&&<p className="text-xs leading-5">待补充：{result.gap}</p>}{result&&!result.recommendations.length&&!result.gap&&<p className="text-xs">没有合适推荐，可以从下方全部卡片中选择。</p>}
    {detail&&<Dialog open onOpenChange={open=>{if(!open)setDetail(null);}}><DialogContent><DialogHeader><DialogTitle>{detail.title}</DialogTitle></DialogHeader><DialogBody><SourceSnapshotPreview markdown={detail.body} normalization="none" /></DialogBody></DialogContent></Dialog>}
  </section>;
}
