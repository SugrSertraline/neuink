import { useId } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { useMineruSource } from './useMineruSource';

export function MineruSourceControls({ source, disabled = false, onBeforeChoose }: {
  source: ReturnType<typeof useMineruSource>; disabled?: boolean; onBeforeChoose?: () => void;
}) {
  const id = useId();
  const busy = source.busy || disabled;
  const chooseDisabled = disabled || (source.busy && !source.searching);
  return <div className="grid min-w-0 gap-2">
    <Label htmlFor={`${id}-directory`}>MinerU 结果根目录</Label>
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Input id={`${id}-directory`} className="min-w-0 flex-[1_1_220px] text-xs" readOnly
        value={source.settings?.results_directory ?? ''} title={source.settings?.results_directory ?? ''}
        placeholder={source.busy ? '正在查找…' : '选择保存解析结果的文件夹'} />
      <Button variant="outline" disabled={chooseDisabled} onClick={() => { onBeforeChoose?.(); void source.choose(); }}>选择目录</Button>
      <Button variant="outline" disabled={busy} onClick={() => void source.detect()}>自动查找</Button>
    </div>
    {source.candidates.length > 1 && <Select disabled={busy} onValueChange={source.selectCandidate}>
      <SelectTrigger aria-label="选择找到的 MinerU 结果目录" className="w-full"><SelectValue placeholder="选择找到的结果目录" /></SelectTrigger>
      <SelectContent viewportAligned>{source.candidates.filter(candidate => candidate.results_directory).map(candidate =>
        <SelectItem key={candidate.results_directory} value={candidate.results_directory!}>{candidate.results_directory} · {candidate.count} 项{candidate.truncated ? '（部分）' : ''}</SelectItem>)}</SelectContent>
    </Select>}
    {source.error && <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive">{source.error}<Button size="xs" variant="outline" disabled={busy} onClick={() => void source.reload()}>重试</Button></div>}
    {source.notice && <p role="status" className="text-xs text-muted-foreground">{source.notice}</p>}
    {source.searching && <p role="status" className="text-xs text-muted-foreground">正在查找常见目录；现在选择目录会停止查找并切换来源。</p>}
    <p className="text-xs text-muted-foreground">仅检查常见下载和 MinerU 目录；不会扫描整个磁盘。结果保存在其他位置时，请手动选择。</p>
  </div>;
}
