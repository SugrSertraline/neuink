import { registerSegmentEditorCloseHandler, setSegmentEditorDirty } from '@/modules/reader/components/segmentEditorDirtyRegistry';
import { useEffect, useState } from 'react';
import type { CardKind, PaperCard } from '@/shared/ipc/ideationApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { compactCardLabels } from './cardPresentation';
import { cardTemplateText } from './cardTemplates';

export function PaperCardEditor({ card, isNew, busy, error, onSave, onClose }: {
  card: PaperCard; isNew: boolean; busy: boolean; error: string;
  onSave: (card: PaperCard) => void; onClose: () => void;
}) {
  const [title, setTitle] = useState(card.title), [body, setBody] = useState(card.body), [kind, setKind] = useState(card.kind);
  const [discarding, setDiscarding] = useState(false);
  const dirty = title !== card.title || body !== card.body || kind !== card.kind;
  useEffect(() => {
    const owner = `paper-card:${card.entry_id}:${card.id}`;
    setSegmentEditorDirty('ideation', owner, dirty);
    const unregister = registerSegmentEditorCloseHandler('ideation', owner, { save: async () => false, discard: onClose });
    return () => { unregister(); setSegmentEditorDirty('ideation', owner, false); };
  }, [card.id, card.entry_id, dirty, onClose]);
  const close = () => { if (!busy) { if (dirty) setDiscarding(true); else onClose(); } };
  return <Dialog open onOpenChange={open => { if (!open) close(); }}><DialogContent layout="bounded" onPointerDownOutside={event => event.preventDefault()}>
    <DialogHeader><DialogTitle>{isNew ? '新建论文卡片' : '编辑论文卡片'}</DialogTitle><DialogDescription>一张卡片只表达一个方法或观点。原文实例放在内容后面，已有来源会保留。</DialogDescription></DialogHeader>
    <DialogBody className="space-y-4">
      <label className="block space-y-2"><span>卡片名称</span><Input aria-label="卡片名称" value={title} maxLength={150} disabled={busy} onChange={e => setTitle(e.target.value)} placeholder="例如：迁移教师知识降低推理成本" /></label>
      <Select value={kind} disabled={busy} onValueChange={value => setKind(value as CardKind)}><SelectTrigger aria-label="卡片类型"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(compactCardLabels).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select>
      <div className="flex items-center justify-between"><span>卡片内容</span><Button size="sm" variant="ghost" disabled={busy || Boolean(body.trim())} onClick={() => setBody(cardTemplateText(kind))}>填入模板</Button></div>
      <Textarea aria-label="卡片内容" value={body} maxLength={20000} disabled={busy} className="min-h-64" onChange={e => setBody(e.target.value)} placeholder="先写抽象方法，再补充核心步骤、适用边界与原文实例。" />
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {discarding && <div role="alert" className="space-y-2 rounded-md border p-3"><p>有未保存的修改，是否放弃？</p><Button size="sm" variant="outline" onClick={() => setDiscarding(false)}>继续编辑</Button><Button size="sm" variant="destructive" onClick={onClose}>放弃修改</Button></div>}
    </DialogBody>
    <DialogFooter><Button variant="outline" disabled={busy} onClick={close}>取消</Button><Button disabled={busy || !title.trim() || !body.trim()} onClick={() => onSave({ ...card, title: title.trim(), body: (kind === 'method' || kind === 'component') && !body.includes('**') ? `**${kind === 'method' ? '抽象方法' : '抽象机制'}**：${body.trim()}` : body.trim(), kind })}>{busy ? '保存中…' : '保存卡片'}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
