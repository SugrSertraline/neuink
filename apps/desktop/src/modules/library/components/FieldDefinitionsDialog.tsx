import { useEffect, useId, useRef, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { registerSegmentEditorCloseHandler, setSegmentEditorDirty } from '@/modules/reader/components/segmentEditorDirtyRegistry';
import { readFieldDefinitions, saveFieldDefinitions, type FieldDefinition, type FieldKind } from '@/shared/ipc/fieldDefinitionsApi';

const kinds: { value: FieldKind; label: string }[] = [
  { value: 'text', label: '文本' }, { value: 'number', label: '数字' }, { value: 'date', label: '日期' },
  { value: 'select', label: '单选' }, { value: 'multi_select', label: '多选' }, { value: 'boolean', label: '是／否' },
];
export function useFieldDefinitions(root?: string | null) {
  const [state, setState] = useState<{ root: string | null | undefined; definitions: FieldDefinition[]; error: string; loading: boolean }>({root, definitions: [], error: '', loading: Boolean(root)});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!root) { setState({root, definitions: [], error: '', loading: false}); return; }
    let active = true; let generation = 0;
    const load = () => {
      const current = ++generation;
      setState({root, definitions: [], error: '', loading: true});
      void readFieldDefinitions(root).then(definitions => { if (active && current === generation) setState({root, definitions, error: '', loading: false}); })
        .catch(() => { if (active && current === generation) setState({root, definitions: [], error: '无法读取属性定义，请重试。', loading: false}); });
    };
    const changed = (event: Event) => { if ((event as CustomEvent<{root: string}>).detail?.root === root) load(); };
    load(); window.addEventListener('neuink-field-definitions-changed', changed);
    return () => { active = false; window.removeEventListener('neuink-field-definitions-changed', changed); };
  }, [root, attempt]);
  const current = state.root === root ? state : {root, definitions: [], error: '', loading: Boolean(root)};
  return { definitions: current.definitions, error: current.error, loading: current.loading, retry: () => setAttempt(n => n + 1) };
}

export function FieldDefinitionsDialog({ root, scopeKey = 'settings', ownerId = 'settings', definitions, onChanged, disabled, page = false }: { root: string; scopeKey?: string; ownerId?: string; definitions: FieldDefinition[]; onChanged: () => void; disabled?: boolean; page?: boolean }) {
  const [open, setOpen] = useState(page), [draft, setDraft] = useState<FieldDefinition[]>(() => page ? definitions.map(d => ({ ...d, options: [...d.options] })) : []), [baseline, setBaseline] = useState<FieldDefinition[]>(() => page ? definitions : []);
  const owner = useId();
  const rootRef = useRef(root); rootRef.current = root;
  const [openedRoot, setOpenedRoot] = useState(root);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [optionDrafts, setOptionDrafts] = useState<Record<string, string>>({});
  const [name, setName] = useState(''), [kind, setKind] = useState<FieldKind>('text'), [options, setOptions] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline) || Boolean(name.trim() || options.trim() || Object.values(optionDrafts).some(v => v.trim()));
  const latest = useRef({ dirty, busy, open });
  latest.current = { dirty, busy, open };
  const saveRef = useRef<() => Promise<boolean>>(async () => false);
  useEffect(() => {
    const unregister = registerSegmentEditorCloseHandler(scopeKey, `field-definitions:${owner}`, {
      label: () => '属性定义', reveal: () => setOpen(true), isDirty: () => latest.current.open && latest.current.dirty,
      isBusy: () => latest.current.busy, save: () => saveRef.current(),
      discard: () => { latest.current.open = false; latest.current.dirty = false; setSegmentEditorDirty(scopeKey, `field-definitions:${owner}`, false); setOpen(false); setDraft([]); setBaseline([]); setName(''); setOptions(''); setOptionDrafts({}); }
    });
    return () => { unregister(); setSegmentEditorDirty(scopeKey, `field-definitions:${owner}`, false); };
  }, [scopeKey, owner]);
  useEffect(() => { setSegmentEditorDirty(scopeKey, `field-definitions:${owner}`, open && (dirty || busy)); }, [scopeKey, owner, open, dirty, busy]);
  const requestClose = () => { if (busy) return; if (dirty) setConfirmDiscard(true); else setOpen(false); };
  const add = () => {
    const n = name.trim(), opts = options.split(/[，,\n]/).map(x => x.trim()).filter(Boolean);
    if (['title', 'description', '描述'].includes(n.toLocaleLowerCase())) { setError('该名称由系统保留，请使用其他属性名称。'); return; }
    if (!n || draft.some(d => d.name.toLocaleLowerCase() === n.toLocaleLowerCase())) { setError('请输入不重复的属性名称。'); return; }
    if ((kind === 'select' || kind === 'multi_select') && (!opts.length || new Set(opts).size !== opts.length)) { setError('请填写不重复的选项。'); return; }
    setDraft([...draft, { name: n, kind, options: kind === 'select' || kind === 'multi_select' ? opts : [], hidden: false }]); setName(''); setOptions(''); setError('');
  };
  const save = async () => {
    if (busy) return false; if (rootRef.current !== openedRoot) { setError('资料库已切换，请返回原资料库保存，或放弃本次修改。'); return false; }
    if (name.trim() || options.trim() || Object.values(optionDrafts).some(v => v.trim())) { setError('请先添加或清除正在输入的属性和选项。'); return false; }
    setBusy(true); setError('');
    try { await saveFieldDefinitions(openedRoot, baseline, draft); onChanged(); window.dispatchEvent(new CustomEvent('neuink-field-definitions-changed', { detail: { root } })); latest.current.open = false; latest.current.dirty = false; setSegmentEditorDirty(scopeKey, `field-definitions:${owner}`, false); if (page) { setBaseline(draft); } else { setOpen(false); } return true; }
    catch (e) { setError(typeof e === 'string' ? e : '保存失败，请重新读取后再试。'); return false; }
    finally { setBusy(false); }
  };
  saveRef.current = save;
  const body = <>      <fieldset disabled={busy} className="space-y-5">
        <section className="space-y-2"><h3 className="text-sm font-semibold">已启用属性</h3>
        {draft.filter(d => !d.hidden).map(d => <div key={d.name} className="rounded border border-border p-3 text-xs"><div className="flex items-center gap-2"><span className="min-w-0 flex-1 font-medium">{d.name} · {kinds.find(k => k.value === d.kind)?.label}</span><Button type="button" size="xs" variant="ghost" onClick={() => setDraft(current => current.map(v => v.name === d.name ? { ...v, hidden: true } : v))}>移除</Button></div>
          {(d.kind === 'select' || d.kind === 'multi_select') && <div className="mt-2"><p className="text-muted-foreground">选项：{d.options.join('、') || '无'}</p><OptionAdd value={optionDrafts[d.name] ?? ''} onChange={value => setOptionDrafts(current => ({ ...current, [d.name]: value }))} onAdd={option => { if (!d.options.includes(option)) setDraft(current => current.map(v => v.name === d.name ? { ...v, options: [...v.options, option] } : v)); }} /></div>}</div>)}
        <p className="text-xs text-muted-foreground">移除只隐藏属性，不会删除论文中已填写的值。</p></section>
        {draft.some(d => d.hidden) && <section className="space-y-2 border-t border-border pt-4"><h3 className="text-sm font-semibold">已移除属性</h3><div className="flex flex-wrap gap-2">{draft.filter(d => d.hidden).map(d => <Button key={d.name} type="button" size="xs" variant="outline" onClick={() => setDraft(current => current.map(v => v.name === d.name ? { ...v, hidden: false } : v))}>恢复 {d.name}</Button>)}</div></section>}
        <section className="space-y-3 border-t border-border pt-4">
          <div><h3 className="text-sm font-semibold">新增自定义属性</h3><p className="mt-1 text-xs text-muted-foreground">设置名称和类型；单选或多选可填写候选项。</p></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-xs">属性名称<Input aria-label="属性名称" value={name} onChange={e => setName(e.target.value)} placeholder="例如：项目编号" /></label>
            <label className="grid gap-1.5 text-xs">属性类型<Select value={kind} onValueChange={v => setKind(v as FieldKind)}><SelectTrigger aria-label="属性类型"><SelectValue /></SelectTrigger><SelectContent>{kinds.map(k => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}</SelectContent></Select></label>
          </div>
          {(kind === 'select' || kind === 'multi_select') && <label className="grid gap-1.5 text-xs">可选项<Input aria-label="选项" value={options} onChange={e => setOptions(e.target.value)} placeholder="例如：期刊，会议，预印本" /><span className="text-muted-foreground">用逗号分隔，添加后仍可追加。</span></label>}
          <Button type="button" size="sm" variant="outline" onClick={add}>添加属性定义</Button>
        </section>
        {root !== openedRoot && <p role="alert" className="text-xs text-destructive">资料库已切换；请返回原资料库保存，或放弃本次修改。</p>}
        {confirmDiscard && <div role="alert" className="text-xs text-destructive">有未保存的属性配置。<Button type="button" size="xs" variant="outline" onClick={() => { setOpen(false); }}>放弃修改并关闭</Button><Button type="button" size="xs" variant="ghost" onClick={() => setConfirmDiscard(false)}>继续编辑</Button></div>}
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}</fieldset>
    </>;
  const description = '为当前资料库定义属性；移除属性不会删除论文已有值，可以在已移除属性中恢复。属性定义目前仅保存在本机资料库，尚不会跨设备同步。';
  const saveButton = <Button type="button" disabled={busy || root !== openedRoot} onClick={() => void save()}>{busy ? '保存中…' : '保存属性定义'}</Button>;
  if (page) return <div className="flex h-full min-h-0 flex-col bg-background"><header className="shrink-0 border-b border-border bg-card px-4 py-3"><div className="flex items-center gap-2"><Settings2 size={17} className="text-primary" aria-hidden="true"/><h1 className="text-base font-semibold">属性管理</h1></div><p className="mt-1 text-xs text-muted-foreground">{description}</p></header><div className="min-h-0 flex-1 overflow-y-auto p-4"><div className="mx-auto max-w-3xl">{body}</div></div><footer className="flex shrink-0 justify-end border-t border-border bg-card px-4 py-3">{saveButton}</footer></div>;
  return <><Button size="sm" type="button" variant="outline" disabled={disabled} onClick={() => { setBaseline(definitions); setDraft(definitions.map(d => ({ ...d, options: [...d.options] }))); setName(''); setOptions(''); setError(''); setOpenedRoot(root); setOptionDrafts({}); setConfirmDiscard(false); setOpen(true); }}>属性管理</Button><Dialog open={open} onOpenChange={v => { if (!v) requestClose(); }}><DialogContent layout="bounded" className="max-w-xl"><DialogHeader><DialogTitle>属性管理</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader><DialogBody>{body}</DialogBody><DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={requestClose}>取消</Button>{saveButton}</DialogFooter></DialogContent></Dialog></>;
}
function OptionAdd({value, onChange, onAdd}: {value: string; onChange: (value: string) => void; onAdd: (value: string) => void}) {
  return <div className="mt-1 flex gap-2"><Input aria-label="新选项" value={value} onChange={e => onChange(e.target.value)} placeholder="新增选项" /><Button type="button" size="sm" variant="outline" disabled={!value.trim()} onClick={() => { onAdd(value.trim()); onChange(''); }}>添加选项</Button></div>;
}
