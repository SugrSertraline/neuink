import { useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, GripVertical, Pencil, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PointerPreview } from '@/components/ui/pointer-preview';
import { usePointerItemDrag } from '@/shared/lib/usePointerItemDrag';
import { PaperCardBody } from './PaperCardBody';
import { CardTypeLabel } from './CardTypeLabel';
import { worksheetSections, type worksheetNodes, type WorksheetSection } from './researchWorksheet';
type Node = ReturnType<typeof worksheetNodes>[number];
type Props = {
  boardId: string; section: WorksheetSection; nodes: Node[]; active: boolean;
  onChoose: () => void; onDescribe: () => void; onView: (node: Node) => void; onEdit: (node: Node) => void; onRemove: (id: string) => void;
  onReorder: (source: string, target: string, after: boolean) => void;
};
export function WorksheetCardSection(props: Props) {
  const { section,nodes } = props, field = worksheetSections.find(f => f.key === section)!;
  const area = useRef<HTMLElement>(null), latest = useRef(props); latest.current = props;
  const [drop,setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const session = useMemo(() => {
    let source: string | null = null;
    const hit = (x: number,y: number) => {
      const element = document.elementFromPoint?.(x,y)?.closest<HTMLElement>('[data-worksheet-card]');
      if (!element || !area.current?.contains(element)) return null;
      const id = element.dataset.worksheetCard!;
      if (id === source) return null;
      const bounds = element.getBoundingClientRect();
      return { id, after: x > bounds.left + bounds.width/2 };
    };
    return {
      begin: (node: Node,x: number,y: number) => { source=node.id;setDrop(hit(x,y)); },
      update: (x: number,y: number) => setDrop(hit(x,y)),
      finish: (x: number,y: number) => { const target=hit(x,y);if (source && target) latest.current.onReorder(source,target.id,target.after);source=null;setDrop(null); },
      cancel: () => { source=null;setDrop(null); },
    };
  },[]);
  const drag = usePointerItemDrag(`${props.boardId}:${section}:${nodes.map(n=>n.id).join(',')}`,session);
  const move = (index: number,delta: number) => { const target=nodes[index+delta];if (target) props.onReorder(nodes[index].id,target.id,delta>0); };
  return <section ref={area} aria-label={field.label} className="space-y-3 border-b pb-6">
    <div className="flex items-center gap-3"><h2 className="mr-auto text-base font-semibold">{field.label}<span className="ml-2 font-normal text-muted-foreground">{nodes.length}</span></h2><Button size="sm" variant="outline" aria-label={`自己描述${field.label}`} onClick={props.onDescribe}><Pencil />自己描述</Button></div>
    <p className="text-xs leading-5 text-muted-foreground">{field.hint}</p>
    <div className="flex flex-wrap items-stretch gap-3">
      {nodes.map((node,index) => <article key={node.id} data-worksheet-card={node.id} className={`relative flex w-[min(320px,100%)] shrink-0 flex-col rounded-lg border bg-card text-card-foreground shadow-sm ${drag.preview?.item.id === node.id ? 'opacity-50' : ''} ${drop?.id === node.id ? 'border-primary ring-2 ring-primary/20' : 'border-border'}`}>
        {drop?.id === node.id && <span className={`pointer-events-none absolute inset-y-0 w-1 rounded bg-primary ${drop.after ? '-right-2' : '-left-2'}`} />}
        <div className="flex items-center gap-1 border-b px-2 py-2">
          <Button {...drag.handlers(node)} className="touch-none cursor-grab active:cursor-grabbing" variant="ghost" size="icon-sm" title="拖动排序；也可用上下方向键" aria-label={`拖动排序${node.card.title}`} onClick={e=>{if(drag.consumeDragClick())e.preventDefault();}} onKeyDown={e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();move(index,e.key==='ArrowUp'?-1:1);}}}><GripVertical /></Button>
          <span className="mr-auto flex min-w-0 items-center gap-2 text-xs text-muted-foreground">{section==='method' && <span className="shrink-0 rounded bg-primary/10 px-2 py-0.5 font-semibold text-primary">第 {index+1} 步</span>}<CardTypeLabel kind={node.card.kind} /></span>
          <Button size="icon-sm" variant="ghost" title="查看详情" aria-label={`查看${node.card.title}`} onClick={()=>props.onView(node)}><Eye /></Button>
          {node.card_id.startsWith('local-idea-') && <Button size="icon-sm" variant="ghost" title="编辑描述" aria-label={`编辑${node.card.title}`} onClick={()=>props.onEdit(node)}><Pencil /></Button>}
          <Button size="icon-sm" variant="ghost" title="从构思移除" aria-label={`移除${node.card.title}`} onClick={()=>props.onRemove(node.id)}><X /></Button>
        </div>
        <div className="flex-1 space-y-2 px-4 py-3"><button className="line-clamp-2 min-h-10 w-full text-left text-sm font-medium leading-5 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring" onClick={()=>props.onView(node)}>{node.card.title}</button><div className="[&>div]:border-0 [&>div]:pt-0 [&>div]:text-[13px]"><PaperCardBody card={node.card} /></div></div>
        <div className="flex items-center gap-1 border-t px-3 py-2"><span className="mr-auto text-[11px] text-muted-foreground">{node.card_id.startsWith('local-idea-')?'仅本构思':section==='method'?'候选步骤 · 待验证':'已选素材'}</span><Button variant="ghost" size="icon-sm" title="前移" aria-label={`前移${node.card.title}`} disabled={index===0} onClick={()=>move(index,-1)}><ArrowUp /></Button><Button variant="ghost" size="icon-sm" title="后移" aria-label={`后移${node.card.title}`} disabled={index===nodes.length-1} onClick={()=>move(index,1)}><ArrowDown /></Button></div>
      </article>)}
      <button onClick={props.onChoose} aria-label={`添加${field.label}`} aria-pressed={props.active} className={`flex min-h-44 w-[min(320px,100%)] shrink-0 flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed bg-card p-5 text-card-foreground transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${props.active?'border-primary':'border-border'}`}><Plus className="size-5 text-primary" /><span className="text-sm font-medium">添加{field.label}</span><span className="text-center text-xs leading-5 text-muted-foreground">点击在左侧查看推荐与全部卡片<br />也可用右上角“自己描述”添加</span></button>
    </div>
    {drag.preview && <PointerPreview anchor={{x:drag.preview.x,top:drag.preview.y,bottom:drag.preview.y}} width={240}><div className="p-3 text-xs">{drag.preview.item.card.title}<p className="mt-1 text-muted-foreground">在本区内拖动排序 · Esc 取消</p></div></PointerPreview>}
  </section>;
}
