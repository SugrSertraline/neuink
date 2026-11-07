import { recommendedRelations, relationWarning } from './relationRules';
import { SourceSnapshotPreview } from '@/shared/components/SourceSnapshotPreview';
import { branchRules } from './ideationBranches';
import { compactCardLabels } from './cardPresentation';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { CardKind, IdeationLink, IdeationLinkKind, PaperCard } from '@/shared/ipc/ideationApi';
import type { SourceLinkOpenTarget } from '@/modules/notes/editor/SourceLinkNode';
import { SourceEvidence } from './SourceEvidence';
import { linkLabels, relationLabel } from './ideationBoards';
import { cardLabels, presetEntryId, userEntryId } from './ideationUtils';
import { useIdeationContext } from './IdeationContext';
import type { CanvasNode } from './IdeationCanvas';
import { researchPatterns } from './patterns/researchPatterns';

export function IdeationInspector({ root, node, card, link, nodes, onClose, onRemoveNode, onRemoveLink, onBranch, onOpenEntry, onOpenSource }: {
  root: string; node?: CanvasNode; card?: PaperCard; link?: IdeationLink; nodes: CanvasNode[];
  onClose: () => void; onRemoveNode: (id: string) => void; onRemoveLink: (id: string) => void; onBranch: (id: string) => void;
  onOpenEntry: (id: string) => void; onOpenSource?: (target: SourceLinkOpenTarget) => void;
}) {
  const context = useIdeationContext()!;
  const original = context.state?.cards.find(c => c.id === node?.card_id) ?? card;
  const preceding = original ? (Object.entries(branchRules) as [CardKind, typeof branchRules[CardKind]][]).filter(([, rules]) => rules.some(rule => rule.kinds.includes(original.kind))).map(([kind]) => compactCardLabels[kind]) : [];
  const patchNode = (change: Partial<CanvasNode>) => context.update(state => ({ ...state, placements: state.placements.map(p => p.id === node?.id ? { ...p, ...change } : p) }));
  const patchLink = (change: Partial<IdeationLink>) => context.update(state => ({ ...state, links: state.links?.map(item => item.id === link?.id ? { ...item, ...change, origin: 'user' } : item) }));
  const from = nodes.find(item => item.id === link?.from), to = nodes.find(item => item.id === link?.to);
  return <aside aria-label={link ? '关系详情' : '卡片详情'} className="ideation-inspector absolute inset-y-0 right-0 z-20 flex w-[min(320px,100%)] min-h-0 shrink-0 flex-col border-l bg-background shadow-lg @[1000px]:relative @[1000px]:shadow-none">
    <div className="flex shrink-0 items-center justify-between border-b px-3 py-2"><h2 className="text-sm font-medium">{link ? '编辑关系' : '卡片详情'}</h2><Button size="icon-sm" variant="ghost" aria-label="关闭详情" onClick={onClose}><X /></Button></div>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 text-xs">
      {link ? <>
        <div className="space-y-2 rounded border bg-muted/30 p-2"><p className="font-medium">{from?.card.title}</p><p className="text-muted-foreground">{link.direction === 'both' ? '↔' : link.direction === 'none' ? '—' : '↓'} {relationLabel(link)}</p><p className="font-medium">{to?.card.title}</p></div>
        <label className="block space-y-1"><span>箭头</span><Select value={link.direction ?? 'forward'} onValueChange={direction => patchLink({ direction: direction as 'forward' | 'both' | 'none' })}><SelectTrigger aria-label="箭头样式"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="forward">单向 →</SelectItem><SelectItem value="both">双向 ↔</SelectItem><SelectItem value="none">无箭头 —</SelectItem></SelectContent></Select></label>
        <label className="block space-y-1"><span>关系类型</span><Select value={link.kind ?? 'related'} onValueChange={value => patchLink({ kind: value as IdeationLinkKind })}><SelectTrigger aria-label="关系类型" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(linkLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}{from && to && recommendedRelations(from.card.kind, to.card.kind).includes(value as IdeationLinkKind) ? ' · 推荐' : ''}</SelectItem>)}</SelectContent></Select></label>

        <label className="block space-y-1"><span>关系名称（可自定义）</span><Input maxLength={60} placeholder={linkLabels[link.kind ?? 'related']} value={link.label ?? ''} onChange={e => patchLink({ label: e.target.value })} /></label>
        <label className="block space-y-1"><span>逻辑描述／输入输出约定</span><Textarea maxLength={4000} rows={5} placeholder="例如：A 完成后执行 B；A 的表征输出作为 B 的输入；满足某条件时反馈到 A。" value={link.description ?? ''} onChange={e => patchLink({ description: e.target.value })} /></label>
        <p className="leading-relaxed text-muted-foreground">单向表示从上方到下方；双向表示双方交互；无箭头表示不指定顺序。可自定义前后步骤、条件分支或反馈逻辑，类型推荐不限制你的选择。</p>
        <Button size="sm" variant="outline" onClick={() => patchLink({ from: link.to, to: link.from })}>反转箭头方向</Button>
        <p className="text-muted-foreground">{link.origin === 'ai_inferred' ? 'AI 从论文归纳的关系，尚需核对。修改后将记为用户关系。' : '用户关系 · 不视为论文已经证明的结论'}</p>
        {link.sources?.length ? <section className="space-y-2"><h3 className="font-medium">参考依据</h3>{link.sources.map((source, i) => <SourceEvidence key={`${source.segment_uid}-${i}`} root={root} entryId={link.entry_id ?? ''} source={source} onOpen={onOpenSource} />)}</section> : null}
        <Button variant="outline" size="sm" onClick={() => onRemoveLink(link.id)}>移除关系</Button>
      </> : original && <>
        <p className="text-muted-foreground">{cardLabels[original.kind]} · {original.origin === 'ai_draft' ? 'AI 草稿，待核对' : original.entry_id === userEntryId ? '用户卡片' : original.entry_id === presetEntryId ? '通用研究模式' : '论文材料'}</p>
        <h3 className="text-sm font-semibold">{node?.card.title ?? original.title}</h3>
        <SourceSnapshotPreview markdown={node?.card.body ?? original.body} normalization="none" />
        {node && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => patchNode({ locked: !node.locked })}>{node.locked ? '解除固定' : '固定此卡片'}</Button><Button size="sm" variant="outline" onClick={() => onBranch(node.id)}>复制为分支</Button></div>}
        <section className="space-y-2 border-t pt-3"><h3 className="font-medium">类型连接建议</h3><p>可从这些类型展开到此卡片：{preceding.join('、') || '无固定前置类型'}</p><h4 className="font-medium">下一步可接</h4>{branchRules[original.kind].map(rule => <p key={rule.id}><span className="font-medium">{rule.title}：</span>{rule.kinds.map(kind => compactCardLabels[kind]).join('、')}</p>)}<p className="text-muted-foreground">这是类型建议；箭头方向由关系含义决定，手动连线不代表已验证关系。</p></section>
        <section className="space-y-2 border-t pt-3"><h3 className="font-medium">来源与依据</h3>
          {original.entry_id !== userEntryId && original.entry_id !== presetEntryId ? <Button size="sm" variant="outline" onClick={() => onOpenEntry(original.entry_id)}>打开来源论文</Button> : <p className="text-muted-foreground">{original.entry_id === userEntryId ? '用户自行添加' : '通用启发模式，不是论文结论'}</p>}
          {(node?.title != null || node?.body != null) && <details><summary className="cursor-pointer text-muted-foreground">查看来源卡片原始内容</summary><p className="mt-2 font-medium">{original.title}</p><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{original.body}</p></details>}
          {(original.pattern_ids?.length ?? 0) > 0 && <p className="text-muted-foreground">参考模式：{original.pattern_ids?.map(id => researchPatterns.find(p => p.id === id)?.title ?? id).join('、')}（适用性需核对）</p>}
          {original.sources?.map((source, index) => <SourceEvidence key={`${source.segment_uid}-${index}`} root={root} entryId={original.entry_id} source={source} onOpen={onOpenSource} />)}
          {original.origin === 'ai_draft' && <Button size="sm" variant="outline" onClick={() => context.update(state => ({ ...state, cards: state.cards.map(c => c.id === original.id ? { ...c, origin: 'ai_reviewed' } : c) }))}>已核对来源卡片</Button>}
        </section>
        {node && <Button variant="outline" size="sm" onClick={() => onRemoveNode(node.id)}>从此构思移除</Button>}
      </>}
    </div>
  </aside>;
}
