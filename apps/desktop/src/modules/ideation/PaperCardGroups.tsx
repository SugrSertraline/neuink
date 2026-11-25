import { CardTypeLabel } from './CardTypeLabel';
import { useState } from 'react';
import { Eye, Pencil, Trash2 } from 'lucide-react';
import { PaperCardBody } from './PaperCardBody';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { CardKind, PaperCard } from '@/shared/ipc/ideationApi';
import { compactCardLabels } from './cardPresentation';

const order = Object.keys(compactCardLabels) as CardKind[];
type Props = {
  cards: PaperCard[]; acceptedIds: Set<string>; disabled: boolean;
  onConfirm: (card: PaperCard) => void; onView: (card: PaperCard) => void; onEdit: (card: PaperCard) => void; onDelete: (card: PaperCard) => void;
};
export function PaperCardGroups(props: Props) {
  return <div className="space-y-8">{order.map(kind => {
    const cards = props.cards.filter(card => card.kind === kind);
    return cards.length ? <CardGroup key={kind} {...props} cards={cards} kind={kind} /> : null;
  })}</div>;
}
function CardGroup({ kind, ...props }: Props & { kind: CardKind }) {
  const [limit, setLimit] = useState(12);
  return <section aria-label={`${compactCardLabels[kind]}卡片`} className="space-y-4">
    <div className="flex items-center gap-3"><h4 className="text-sm font-semibold">{compactCardLabels[kind]}卡片</h4><span className="text-xs text-muted-foreground">{props.cards.length}</span><div className="h-px flex-1 bg-border" /></div>
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))] items-stretch gap-3">{props.cards.slice(0, limit).map(card => <PaperCardTile key={card.id} {...props} card={card} />)}</div>
    {props.cards.length > limit && <Button size="sm" variant="outline" onClick={() => setLimit(value => value + 12)}>显示更多{compactCardLabels[kind]}卡片（剩余 {props.cards.length - limit}）</Button>}
  </section>;
}
function PaperCardTile({ card, acceptedIds, disabled, onConfirm, onView, onEdit, onDelete }: Props & { card: PaperCard }) {
  return <Card size="sm" className="flex min-w-0 flex-col gap-0 overflow-hidden bg-card py-0 shadow-none">
    <div className="flex h-12 items-center justify-between gap-2 border-b px-4 py-2"><span className="text-xs font-medium"><CardTypeLabel kind={card.kind} /></span><span className="text-[11px] text-muted-foreground">{acceptedIds.has(card.id) ? '已确认' : '待核对'}</span>{!acceptedIds.has(card.id) && <Button size="sm" variant="outline" disabled={disabled} aria-label={`确认卡片 ${card.title}`} onClick={() => onConfirm(card)}>确认</Button>}</div>
    <button className="block w-full px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" onClick={() => onView(card)}>
      <span className="mb-1.5 line-clamp-2 min-h-5 break-words text-sm font-semibold leading-5">{card.title}</span>
      <PaperCardBody card={card} />
      <span className="mt-2 block text-[11px] text-muted-foreground">点击查看详情</span>
    </button>
    <div className="mt-auto flex items-center gap-1 border-t px-3 py-2"><span className="mr-auto text-[11px] text-muted-foreground">{card.sources?.length ? `${card.sources.length} 个来源` : '自行整理／待补来源'}</span>
      {[{ label: '查看', icon: Eye, run: onView }, { label: '编辑', icon: Pencil, run: onEdit }, { label: '删除', icon: Trash2, run: onDelete }].map(action => <Tooltip key={action.label}><TooltipTrigger asChild><Button size="icon-sm" variant="ghost" aria-label={`${action.label}卡片 ${card.title}`} disabled={action.label !== '查看' && disabled} onClick={() => action.run(card)}><action.icon className="size-3.5" /></Button></TooltipTrigger><TooltipContent>{action.label}卡片</TooltipContent></Tooltip>)}
    </div>
  </Card>;
}
