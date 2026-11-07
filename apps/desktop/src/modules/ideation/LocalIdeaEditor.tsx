import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter } from '@/components/ui/dialog';
export function LocalIdeaEditor({ title = '', body = '', maxLength = 6000, onSave, onClose }: { title?: string; body?: string; maxLength?: number; onSave: (title: string, body: string) => void; onClose: () => void }) {
  const name = useRef(title), content = useRef(body);
  const [valid, setValid] = useState(Boolean(title.trim() && body.trim()));
  const check = () => setValid(Boolean(name.current.trim() && content.current.trim()));
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent layout="bounded"><DialogHeader><DialogTitle>编辑本构思内容</DialogTitle><DialogDescription>仅用于当前构思，不加入公共卡片库。可以填写方法、想法或待验证条件。</DialogDescription></DialogHeader><DialogBody><form id="local-idea" className="space-y-4" onSubmit={event => { event.preventDefault(); if (name.current.trim() && content.current.trim()) onSave(name.current.trim(), content.current.trim()); }}><label className="block space-y-2">标题<Input aria-label="本构思内容标题" defaultValue={title} maxLength={160} onChange={event => { name.current = event.target.value; check(); }} /></label><label className="block space-y-2">内容<Textarea aria-label="本构思内容正文" className="min-h-48" defaultValue={body} maxLength={maxLength} onChange={event => { content.current = event.target.value; check(); }} /></label></form></DialogBody><DialogFooter><Button variant="outline" onClick={onClose}>取消</Button><Button type="submit" form="local-idea" disabled={!valid}>保存到本构思</Button></DialogFooter></DialogContent></Dialog>;
}
