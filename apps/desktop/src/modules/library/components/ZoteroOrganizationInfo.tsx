import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ZoteroOrganization } from '@/shared/ipc/workspaceApi';
import type { TagMeta } from '@/shared/types/domain';
import { buildTagPathById } from '../utils/tagTree';

/** Source organization is read-only; copying is an explicit local tag action. */
export function ZoteroOrganizationInfo({ organization, tagPaths, tags, onAddTagPath, draft = false, compact = false, onOpenDetails }: {
  organization: ZoteroOrganization[]; tagPaths: string[]; tags: TagMeta[];
  draft?: boolean;
  compact?: boolean;
  onOpenDetails?: () => void;
  onAddTagPath: (path: string) => Promise<unknown> | unknown;
}) {
  const id = useId();
  const [selected, setSelected] = useState<{ label: string; kind: '分类' | '标签' } | null>(null);
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const sourceTags = [...new Set(organization.flatMap(source => source.tags))];
  const collections = [...new Set(organization.flatMap(source => source.collections))];
  const hiddenCount = compact ? Math.max(0, collections.length - 2) + Math.max(0, sourceTags.length - 3) : 0;
  const sourceOptions = [...collections.map(label => ({ label, kind: '分类' as const })), ...sourceTags.map(label => ({ label, kind: '标签' as const }))];
  const sourceKey = (option: { kind: string; label: string }) => JSON.stringify([option.kind, option.label]);
  const choose = (kind: '分类' | '标签', label: string) => {
    setSelected({ kind, label }); setPath(kind === '分类' ? label.split(' / ').join('/') : label.split('/').join('／')); setError(null); setNotice('');
  };
  const existingPaths = [...new Set(buildTagPathById(tags).values())].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const add = async () => {
    if (pending.current) return;
    const normalized = path.split('/').map(part => part.trim()).join('/');
    if (!normalized || normalized.split('/').some(part => !part) || /[,，\n\r]/.test(normalized)) {
      setError('请输入有效的标签路径，层级用 / 分隔，名称不能包含逗号或换行。'); return;
    }
    pending.current = true; setBusy(true); setError(null);
    try { await onAddTagPath(normalized); setNotice(draft ? `已加入标签草稿，保存条目后生效：${normalized}` : `已添加到我的标签：${normalized}`); setSelected(null); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { pending.current = false; setBusy(false); }
  };
  const rows = (values: string[], kind: '分类' | '标签') => <div className="space-y-1">
    <p className="text-xs text-muted-foreground">{kind} · {values.length}</p>
    {values.length ? (compact ? values.slice(0, kind === '分类' ? 2 : 3) : values).map(value => <div key={value} className="flex min-w-0 items-start gap-2 text-xs">
      <span className={`min-w-0 flex-1 py-1 ${compact ? 'truncate' : 'break-words'}`} title={value}>{value}</span>
      <Button size="xs" variant="ghost" className="shrink-0 text-xs" disabled={busy || kind === '标签' && !value.includes('/') && tagPaths.includes(value)}
        aria-label={`添加${kind} ${value} 到我的标签`} onClick={() => choose(kind, value)}>{kind === '标签' && !value.includes('/') && tagPaths.includes(value) ? '已添加' : compact ? '添加' : '添加到我的标签'}</Button>
    </div>) : <p className="text-xs text-muted-foreground">无来源{kind}</p>}
  </div>;
  return <section aria-label="Zotero 分类与标签" className="min-w-0 space-y-2">
    <div className="flex items-center gap-2"><h3 className="text-xs font-medium">Zotero 分类与标签</h3><span className="text-xs text-muted-foreground">来源只读</span></div>
    <p className="text-xs text-muted-foreground">与我的标签独立，随来源扫描更新。添加后只创建本地关联。</p>
    {rows(collections, '分类')}{rows(sourceTags, '标签')}
    {compact && hiddenCount > 0 && <Button size="xs" variant="ghost" className="px-0 text-xs" onClick={() => { const first = sourceOptions[0]; if (first) choose(first.kind, first.label); }}>选择其他来源分类或标签添加</Button>}
    {compact && onOpenDetails && <Button size="xs" variant="link" className="max-w-full px-0 text-xs" onClick={onOpenDetails}>{hiddenCount ? `已收起其余 ${hiddenCount} 项，` : ''}在条目详情查看全部</Button>}
    {notice && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}
    <Dialog open={Boolean(selected)} onOpenChange={open => { if (!open && !busy) setSelected(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>添加到我的标签</DialogTitle><DialogDescription>复制这项来源信息为本地标签，可以改名或选择已有路径；之后两边独立维护。</DialogDescription></DialogHeader>
        <p className="break-words text-sm">Zotero {selected?.kind}：{selected?.label}</p>
        {compact && selected && <Select value={sourceKey(selected)} onValueChange={value => { const option = sourceOptions.find(option => sourceKey(option) === value); if (option) choose(option.kind, option.label); }}>
          <SelectTrigger aria-label="选择来源分类或标签"><SelectValue /></SelectTrigger>
          <SelectContent>{sourceOptions.map(option => <SelectItem key={sourceKey(option)} value={sourceKey(option)}>{option.kind}：{option.label}</SelectItem>)}</SelectContent>
        </Select>}
        <div className="space-y-2"><Label htmlFor={`${id}-path`}>本地标签路径</Label>
          <Input id={`${id}-path`} list={`${id}-existing`} value={path} disabled={busy} onChange={event => setPath(event.target.value)} />
          <datalist id={`${id}-existing`}>{existingPaths.map(value => <option key={value} value={value} />)}</datalist>
          <p className="text-xs text-muted-foreground">/ 表示本地层级。已有路径会复用，不会重复创建。{selected?.kind === '标签' && selected.label.includes('/') ? '来源标签中的 / 默认替换为全角／，避免意外拆成层级。' : ''}</p>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setSelected(null)}>取消</Button><Button disabled={busy} onClick={() => void add()}>{busy ? '正在添加…' : '确认添加'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
