import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { listUnsavedEditors } from '@/modules/reader/components/segmentEditorDirtyRegistry';
export type UnsavedEditor = ReturnType<typeof listUnsavedEditors>[number];
export function unsavedEditorLabel(target: UnsavedEditor) {
  return target.handler?.label?.() ?? (target.scopeKey.startsWith('settings') ? '设置 · 未保存的配置' :
    target.scopeKey.startsWith('library') ? '条目库 · 未保存的修改' :
    target.scopeKey.startsWith('entry-overview') ? '条目信息 · 未保存的修改' : '页面中未保存的修改或进行中的操作');
}
export function UnsavedWindowDialog({ targets, busy, error, onEdit, onCancel, onSave, onKeep, onDiscard }: {
  targets: UnsavedEditor[] | null; busy: boolean; error: string | null;
  onEdit: (target: UnsavedEditor) => void; onCancel: () => void; onSave: () => void; onKeep: () => void; onDiscard: () => void;
}) {
  const onlyMetadata = Boolean(targets?.length) && targets!.every(item => item.ownerId.startsWith('entry-metadata:') || item.ownerId.startsWith('field-definitions:'));
  return <Dialog open={targets !== null} onOpenChange={open => { if (!open && !busy) onCancel(); }}>
    <DialogContent layout="bounded" className="z-[calc(var(--z-dialog-popover)+1)] h-auto max-h-[calc(100%-2rem)]" overlayClassName="z-[calc(var(--z-dialog-popover)+1)]" showCloseButton={!busy}
      onCloseAutoFocus={event => event.preventDefault()}>
      <DialogHeader><DialogTitle>还有未保存的修改</DialogTitle>
        <DialogDescription>{onlyMetadata ? '论文信息或属性尚未保存，请选择保存或放弃后退出。3 秒内再次点击右上角关闭将不保存并强制退出。' : '请处理未保存内容；3 秒内再次点击右上角关闭将不保存并强制退出。'}</DialogDescription></DialogHeader>
      <DialogBody className="max-h-64">
        <ul className="divide-y rounded-md border">{targets?.map(target => <li key={`${target.scopeKey}/${target.ownerId}`} className="flex min-w-0 items-center gap-2 px-3 py-2">
          <span className="min-w-0 flex-1 truncate" title={unsavedEditorLabel(target)}>{unsavedEditorLabel(target)}</span>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onEdit(target)}>去处理</Button>
        </li>)}</ul>
      </DialogBody>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {!onlyMetadata && <p className="text-xs text-muted-foreground">编辑内容及设置会持续备份，密钥单独保存在系统凭据库。正在写入的任务需完成后退出；草稿恢复后仍需确认保存。</p>}
      <DialogFooter className="flex-wrap">
        <Button disabled={busy} variant="ghost" onClick={onCancel}>继续编辑</Button>
        {onlyMetadata ? <Button disabled={busy} variant="destructive" onClick={onDiscard}>不保存并退出</Button> : <Button disabled={busy} variant="outline" onClick={onKeep}>保留草稿并退出</Button>}
        <Button disabled={busy} onClick={onSave}>{busy ? '正在处理…' : '保存并退出'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
