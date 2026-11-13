import { useEffect, useId, useRef, useState } from 'react';
import { Eye, EyeOff, Tags, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/shared/hooks/useToast';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';

type Action = 'tags' | 'trash' | 'hide' | 'restore';
const actionNames: Record<Action, string> = { tags: '添加标签', trash: '移入回收站', hide: '隐藏来源条目', restore: '恢复来源条目' };
export function LibrarySelectionActions({ active, context, selected, total, hidden, sourceUnavailable, tagPaths, onClear, onSelectAll, onComplete, onDelete, onSetHidden, onAddTags }: {
  active: boolean; context: string; selected: LibraryEntry[]; total: number; hidden: boolean; sourceUnavailable: boolean; tagPaths: string[];
  onClear: () => void; onSelectAll: () => void; onComplete: (ids: string[]) => void;
  onDelete: (id: string) => Promise<void> | void; onSetHidden?: (id: string, hidden: boolean) => Promise<void>;
  onAddTags?: (id: string, paths: string[]) => Promise<unknown> | unknown;
}) {
  const { notify } = useToast();
  const fieldId = useId();
  const [plan, setPlan] = useState<{ action: Action; entries: LibraryEntry[] } | null>(null);
  const [path, setPath] = useState(''), [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(0);
  const pending = useRef(false), live = useRef(true), scope = useRef(context); scope.current = context;
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => { if (!pending.current) { setPlan(null); setError(null); } }, [context, active]);
  const external = (entry: LibraryEntry) => Boolean(entry.sourceInfo?.kinds.length);
  const locals = selected.filter(entry => !external(entry)), sources = selected.filter(external);
  const begin = (action: Action, entries: LibraryEntry[]) => { if (!entries.length || pending.current) return; setPath(''); setError(null); setProgress(0); setPlan({ action, entries }); };
  const submit = async () => {
    if (!plan || pending.current) return;
    const tagPath = path.split('/').map(part => part.trim()).join('/');
    if (plan.action === 'tags' && (!tagPath || tagPath.split('/').some(part => !part) || /[,，\n\r]/.test(tagPath))) { setError('请输入有效的标签路径，层级用 / 分隔。'); return; }
    const startedIn = context;
    pending.current = true; setBusy(true); setError(null);
    const done: string[] = [], failed: LibraryEntry[] = [];
    for (const entry of plan.entries) {
      if (!live.current || scope.current !== startedIn) break;
      try {
        if (plan.action === 'trash') { if (external(entry)) throw new Error('来源条目只能隐藏。'); await onDelete(entry.id); }
        else if (plan.action === 'tags') { if (!onAddTags) throw new Error('标签操作暂不可用。'); await onAddTags(entry.id, [tagPath]); }
        else { if (!onSetHidden || !external(entry)) throw new Error('来源操作暂不可用。'); await onSetHidden(entry.id, plan.action === 'hide'); }
        done.push(entry.id);
      } catch { failed.push(entry); }
      if (live.current) setProgress(done.length + failed.length);
    }
    pending.current = false;
    if (!live.current) return;
    setBusy(false);
    if (scope.current !== startedIn) { setPlan(null); return; }
    onComplete(done);
    if (failed.length) { setPlan({ ...plan, entries: failed }); setError(`${done.length} 篇已完成，${failed.length} 篇失败。已保留失败项，可重试。`); setProgress(0); }
    else { setPlan(null); notify({ tone: 'success', title: `已${actionNames[plan.action]} ${done.length} 篇条目` }); }
  };
  return <>
    {active && <div role="region" aria-label="批量操作" className="flex min-w-0 flex-wrap items-center gap-1.5 whitespace-nowrap text-xs">
      <span role="status" className="tabular-nums">已选 {selected.length} / {total} 篇</span>
      <Button size="xs" variant="ghost" disabled={!total || busy} onClick={onSelectAll}>{total > 0 && selected.length === total ? '取消全选' : '全选当前结果'}</Button>
      <Button size="xs" variant="ghost" disabled={!selected.length || busy} onClick={onClear}>清空选择</Button>
      <div className="flex min-w-0 flex-wrap gap-1">
        <Button size="xs" variant="outline" disabled={!selected.length || !onAddTags || busy} onClick={() => begin('tags', selected)}><Tags aria-hidden="true" />添加标签</Button>
        {sources.length > 0 && <Button size="xs" variant="outline" disabled={!onSetHidden || sourceUnavailable || busy} onClick={() => begin(hidden ? 'restore' : 'hide', sources)}>{hidden ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}{hidden ? '恢复来源' : '隐藏来源'} {sources.length} 篇</Button>}
        {locals.length > 0 && <Button size="xs" variant="outline" disabled={sourceUnavailable || busy} onClick={() => begin('trash', locals)}><Trash2 aria-hidden="true" />移入回收站 {locals.length} 篇</Button>}
      </div>
    </div>}
    <Dialog open={Boolean(plan)} onOpenChange={open => { if (!open && !pending.current) setPlan(null); }}>
      <DialogContent layout="bounded" className="max-w-lg sm:max-w-lg">
        <DialogHeader><DialogTitle>批量{plan ? actionNames[plan.action] : '操作'}</DialogTitle><DialogDescription>
          {plan?.action === 'trash' ? '仅将下列本地条目及其内容移入回收站，可以恢复。' : plan?.action === 'tags' ? '为下列条目追加本地标签，已有标签保留。' : '仅调整 Zotero / MinerU 来源条目在 NeuInk 中的显示，来源原文保留。'}
        </DialogDescription></DialogHeader>
        {plan?.action === 'tags' && <div className="space-y-1"><Label htmlFor={fieldId}>标签路径</Label><Input id={fieldId} list={`${fieldId}-paths`} value={path} disabled={busy} onChange={event => setPath(event.target.value)} placeholder="例如：研究/待阅读" /><datalist id={`${fieldId}-paths`}>{tagPaths.map(path => <option key={path} value={path} />)}</datalist></div>}
        <DialogBody><ul className="space-y-1 text-xs">{plan?.entries.map(entry => <li key={entry.id} className="truncate" title={entry.title}>{entry.title}</li>)}</ul></DialogBody>
        {busy && <p role="status" className="text-xs text-muted-foreground">正在处理 {progress} / {plan?.entries.length} 篇…</p>}
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setPlan(null)}>取消</Button><Button variant={plan?.action === 'trash' ? 'destructive' : 'default'} disabled={busy} onClick={() => void submit()}>{busy ? '正在处理…' : `确认${plan ? actionNames[plan.action] : ''}`}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
