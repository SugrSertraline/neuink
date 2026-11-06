import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { listUnsavedEditors } from '@/modules/reader/components/segmentEditorDirtyRegistry';
export type UnsavedEditor = ReturnType<typeof listUnsavedEditors>[number];
export function unsavedEditorLabel(target: UnsavedEditor) {
  return target.handler?.label?.() ?? (target.scopeKey.startsWith('settings') ? '设置 · 未保存的配置' :
    target.scopeKey.startsWith('library') ? '条目库 · 未保存的修改' :
    target.scopeKey.startsWith('entry-overview') ? '条目信息 · 未保存的修改' : '页面中未保存的修改或进行中的操作');
}
export function UnsavedWindowDialog({ targets, busy, error, onEdit, onCancel, onSave, onKeep }: {
  targets: UnsavedEditor[] | null; busy: boolean; error: string | null;
  onEdit: (target: UnsavedEditor) => void; onCancel: () => void; onSave: () => void; onKeep: () => void;
}) {
  return <Dialog open={targets !== null} onOpenChange={open => { if (!open && !busy) onCancel(); }}>
    <DialogContent layout="bounded" className="h-auto max-h-[calc(100%-2rem)]" showCloseButton={!busy}
      onCloseAutoFocus={event => event.preventDefault()}>
      <DialogHeader><DialogTitle>还有未保存的修改</DialogTitle>
        <DialogDescription>已定位到修改页面。可以继续编辑，或保留本地草稿后退出；草稿不会覆盖正式笔记。</DialogDescription></DialogHeader>
      <DialogBody className="max-h-64">
        <ul className="divide-y rounded-md border">{targets?.map(target => <li key={`${target.scopeKey}/${target.ownerId}`} className="flex min-w-0 items-center gap-2 px-3 py-2">
          <span className="min-w-0 flex-1 truncate" title={unsavedEditorLabel(target)}>{unsavedEditorLabel(target)}</span>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onEdit(target)}>去处理</Button>
        </li>)}</ul>
      </DialogBody>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <p className="text-xs text-muted-foreground">编辑内容及设置会持续备份，密钥单独保存在系统凭据库。正在写入的任务需完成后退出；草稿恢复后仍需确认保存。</p>
      <DialogFooter className="flex-wrap">
        <Button disabled={busy} variant="ghost" onClick={onCancel}>继续编辑</Button>
        <Button disabled={busy} variant="outline" onClick={onKeep}>保留草稿并退出</Button>
        <Button disabled={busy} onClick={onSave}>{busy ? '正在处理…' : '保存并退出'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
