import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useId } from 'react';
import type { useZoteroSource } from './useZoteroSource';

export function ZoteroSourceControls({ source, disabled = false, showLinked = false }: {
  source: ReturnType<typeof useZoteroSource>; disabled?: boolean; showLinked?: boolean;
}) {
  const id = useId();
  const busy = source.busy || disabled;
  return <div className="grid min-w-0 gap-2">
    <Label htmlFor={`${id}-directory`}>Zotero 数据目录</Label>
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Input id={`${id}-directory`} className="min-w-0 flex-[1_1_220px] text-xs" readOnly value={source.settings?.data_directory ?? ''}
        placeholder={source.busy ? '正在读取…' : '选择包含 zotero.sqlite 的文件夹'} title={source.settings?.data_directory ?? ''} />
      <Button variant="outline" disabled={busy} onClick={() => void source.choose()}>选择目录</Button>
      <Button variant="outline" disabled={busy} onClick={() => void source.detect()}>自动查找</Button>
    </div>
    {source.candidates.length > 1 && <Select disabled={busy} onValueChange={source.selectCandidate}>
      <SelectTrigger aria-label="选择找到的 Zotero 资料库" className="w-full"><SelectValue placeholder="选择找到的资料库" /></SelectTrigger>
      <SelectContent viewportAligned>{source.candidates.map(c => <SelectItem key={c.data_directory} value={c.data_directory!}>{c.data_directory}</SelectItem>)}</SelectContent>
    </Select>}
    {showLinked && <div className="mt-2 grid gap-2">
      <p className="text-xs text-muted-foreground">部分链接附件使用相对路径。请在 Zotero 设置中查看链接附件基础目录，选择后将自动重新读取。</p>
      <Label htmlFor={`${id}-linked`}>链接附件基础目录（仅部分附件需要）</Label>
      <div className="flex min-w-0 flex-wrap items-center gap-2"><Input id={`${id}-linked`} className="min-w-0 flex-[1_1_220px] text-xs" readOnly
        value={source.settings?.linked_attachment_directory ?? ''} placeholder="选择 Zotero 中设置的链接附件基础目录" title={source.settings?.linked_attachment_directory ?? ''} />
        <Button variant="outline" disabled={busy || !source.settings?.data_directory} onClick={() => void source.choose(true)}>选择附件目录</Button>
      </div>
    </div>}
    {source.error && <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive">{source.error}<Button size="xs" variant="outline" disabled={busy} onClick={() => void source.reload()}>重试读取设置</Button></div>}
    {source.notice && <p role="status" className="text-xs text-muted-foreground">{source.notice}</p>}
  </div>;
}
