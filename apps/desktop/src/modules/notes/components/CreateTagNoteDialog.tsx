import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function CreateTagNoteDialog({ tags, defaultTagId, busy, disabled = false, error, onClose, onCreate }: {
  tags: { id: string; label: string }[]; defaultTagId?: string; busy: boolean; disabled?: boolean; error: string | null;
  onClose: () => void; onCreate: (tagId: string, title: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState(defaultTagId ?? tags[0]?.id ?? '');
  const tagId = tags.some(tag => tag.id === selected) ? selected : '';
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent>
    <DialogHeader><DialogTitle>新建标签笔记</DialogTitle><DialogDescription>选择笔记所属标签；一篇笔记可以引用多篇论文。</DialogDescription></DialogHeader>
    <form className="space-y-3" onSubmit={event => { event.preventDefault(); if (tagId && title.trim() && !busy && !disabled) onCreate(tagId, title); }}>
      <Select value={tagId} onValueChange={setSelected} disabled={busy || !tags.length}>
        <SelectTrigger aria-label="笔记所属标签" className="w-full"><SelectValue placeholder="选择标签" /></SelectTrigger>
        <SelectContent viewportAligned>{tags.map(tag => <SelectItem key={tag.id} value={tag.id}>{tag.label}</SelectItem>)}</SelectContent>
      </Select>
      <Input autoFocus aria-label="笔记标题" placeholder="笔记标题" disabled={busy} value={title} onChange={event => setTitle(event.target.value)} />
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={onClose}>取消</Button><Button type="submit" disabled={disabled || busy || !tagId || !title.trim()}>创建并打开</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
