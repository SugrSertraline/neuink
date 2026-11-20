import { useEffect, useId, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical, Plus, Settings2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { registerSegmentEditorCloseHandler, setSegmentEditorDirty } from '@/modules/reader/components/segmentEditorDirtyRegistry';
import { readFieldDefinitions, saveFieldDefinitions, type DatePrecision, type FieldDefinition, type FieldKind } from '@/shared/ipc/fieldDefinitionsApi';

const kinds: { value: FieldKind; label: string }[] = [
  { value: 'text', label: '文本' }, { value: 'number', label: '数字' }, { value: 'date', label: '日期' },
  { value: 'select', label: '单选' }, { value: 'multi_select', label: '多选' }, { value: 'boolean', label: '是／否' },
];

export function FieldDefinitionsPage({ root, definitions }: { root: string; definitions: FieldDefinition[] }) {
  const [items, setItems] = useState(definitions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FieldDefinition | null>(null);
  const [removing, setRemoving] = useState<FieldDefinition | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<FieldKind>('text');
  const [precision, setPrecision] = useState<DatePrecision>('day');
  const [options, setOptions] = useState<string[]>([]);
  const dragIndex = useRef<number | null>(null);
  const moveOption = (from: number, to: number) => setOptions(current => { if (to < 0 || to >= current.length || from === to) return current; const next = [...current]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next; });
  const [formError, setFormError] = useState('');
  const busyRef = useRef(false);
  const owner = useId();
  useEffect(() => {
    const unregister = registerSegmentEditorCloseHandler('field-editor', `field-definitions:${owner}`, {
      label: () => '属性配置', isBusy: () => busyRef.current, isDirty: () => false,
      save: async () => !busyRef.current, discard: () => {},
    });
    return () => { unregister(); setSegmentEditorDirty('field-editor', `field-definitions:${owner}`, false); };
  }, [owner]);
  const persist = async (next: FieldDefinition[], rename?: [string, string]) => {
    if (busyRef.current) return false;
    busyRef.current = true; setBusy(true); setError('');
    setSegmentEditorDirty('field-editor', `field-definitions:${owner}`, true);
    try {
      const saved = await saveFieldDefinitions(root, items, next, rename);
      setItems(saved); window.dispatchEvent(new CustomEvent('neuink-field-definitions-changed', { detail: { root } }));
      return true;
    } catch (caught) {
      setError(typeof caught === 'string' ? caught : '保存失败，请重新读取属性后重试。');
      return false;
    } finally {
      busyRef.current = false; setBusy(false); setSegmentEditorDirty('field-editor', `field-definitions:${owner}`, false);
    }
  };
  const reload = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { setItems(await readFieldDefinitions(root)); setError(''); }
    catch { setError('读取失败，请重试。'); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const showForm = (item?: FieldDefinition) => {
    setEditing(item ?? null); setName(item?.name ?? ''); setKind(item?.kind ?? 'text');
    setOptions(item?.options ?? []); setPrecision(item?.date_precision ?? 'day'); setFormError(''); setFormOpen(true);
  };
  const submit = async () => {
    const n = name.trim();
    const opts = options.map(value => value.trim());
    if (!n || ['title', 'description', '描述'].includes(n.toLocaleLowerCase())) { setFormError('请输入有效的属性名称。'); return; }
    if (items.some(item => item !== editing && item.name.toLocaleLowerCase() === n.toLocaleLowerCase())) { setFormError('属性名称已存在；可以在已移除属性中恢复。'); return; }
    if ((kind === 'select' || kind === 'multi_select') && (!opts.length || opts.some(option => !option) || new Set(opts.map(option => option.toLocaleLowerCase())).size !== opts.length)) { setFormError('请填写不重复的选项。'); return; }
    const selectedOptions = kind === 'select' || kind === 'multi_select' ? opts : [];
    const renamed = editing && editing.name !== n;
    const updated: FieldDefinition = { name: n, kind, options: selectedOptions, hidden: false, ...(kind === 'date' ? { date_precision: precision } : {}) };
    const next = editing ? renamed ? [...items.map(item => item.name === editing.name ? { ...item, hidden: true } : item), updated] : items.map(item => item.name === editing.name ? updated : item)
      : [...items, updated];
    if (await persist(next, renamed ? [editing.name, n] : undefined)) setFormOpen(false);
  };
  const hidden = items.filter(item => item.hidden);
  const restore = async (item: FieldDefinition) => {
    await persist(items.map(value => value.name === item.name ? { ...value, hidden: false } : value));
  };
  return <div className="flex h-full min-h-0 flex-col bg-background">
    <header className="shrink-0 border-b border-border bg-card px-4 py-3"><div className="mx-auto max-w-4xl">
      <div className="flex items-center gap-2"><Settings2 size={17} className="text-primary" aria-hidden="true"/><h1 className="text-base font-semibold">属性管理</h1><span className="mr-auto text-xs text-muted-foreground">{items.filter(item => !item.hidden).length} 个属性</span><Button size="sm" disabled={busy} onClick={() => showForm()}><Plus size={14} aria-hidden="true" />新增属性</Button></div>
      <p className="mt-1 text-xs text-muted-foreground">属性适用于当前资料库的所有条目；修改即时保存，仅保存在本机。</p></div>
    </header>
    <main className="min-h-0 flex-1 overflow-y-auto p-4"><div className="mx-auto max-w-4xl space-y-5">
      {error && <div role="alert" className="flex items-center gap-3 rounded-md border border-destructive/40 p-3 text-xs text-destructive"><span className="flex-1">{error}</span><Button size="xs" variant="outline" disabled={busy} onClick={() => void reload()}>重新读取</Button></div>}
      <section><div className="mb-2 flex items-baseline gap-2"><h2 className="text-sm font-semibold">已启用属性</h2><span className="text-xs text-muted-foreground">在条目详情中填写属性值</span></div>
        <div className="overflow-hidden rounded-md border border-border bg-card"><div className="grid grid-cols-[minmax(0,1fr)_6rem_5rem] gap-3 border-b border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground"><span>属性名称</span><span>类型</span><span className="text-right">操作</span></div>
        {items.filter(item => !item.hidden).map(item => <div key={item.name} className="grid grid-cols-[minmax(0,1fr)_6rem_5rem] items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0"><div className="min-w-0"><div className="truncate text-sm font-medium" title={item.name}>{item.name}</div>{item.options.length > 0 && <div className="truncate text-xs text-muted-foreground" title={item.options.join('、')}>{item.options.join('、')}</div>}</div><span className="text-xs text-muted-foreground">{item.kind === 'date' ? `日期 · ${{year:'年', month:'年月', day:'年月日'}[item.date_precision ?? 'day']}` : kinds.find(k => k.value === item.kind)?.label}</span><div className="flex justify-end"><Button size="xs" variant="ghost" disabled={busy} aria-label={`编辑 ${item.name}`} onClick={() => showForm(item)}>编辑</Button><Button size="xs" variant="ghost" className="text-destructive" disabled={busy} aria-label={`移除 ${item.name}`} onClick={() => setRemoving(item)}>移除</Button></div></div>)}
        {!items.some(item => !item.hidden) && <p className="p-4 text-sm text-muted-foreground">暂无启用的属性，可新增或从下方恢复。</p>}</div>
      </section>

      {hidden.length > 0 && <section className="border-t border-border pt-4"><h2 className="text-sm font-semibold">已移除属性</h2><p className="mt-1 text-xs text-muted-foreground">恢复后，之前填写的值仍会保留。</p><div className="mt-3 flex flex-wrap gap-2">{hidden.map(item => <Button key={item.name} size="xs" variant="outline" disabled={busy} onClick={() => void restore(item)}><Plus size={12} aria-hidden="true" />恢复 {item.name}</Button>)}</div></section>}
    </div></main>
    <Dialog open={formOpen} onOpenChange={value => { if (!busy) setFormOpen(value); }}><DialogContent layout="bounded" className="max-w-2xl"><DialogHeader><DialogTitle>{editing ? '编辑属性' : '新增属性'}</DialogTitle><DialogDescription>{editing ? '已填写的属性不能更改名称或类型，已使用的选项不能删除。' : '设置名称、类型和可选项，添加后适用于所有条目。'}</DialogDescription></DialogHeader><DialogBody className="space-y-4 py-2">{!editing && <h2 className="text-sm font-semibold">自定义属性</h2>}<label className="grid gap-1.5 text-xs">属性名称<Input aria-label="属性名称" value={name} disabled={busy} onChange={e => setName(e.target.value)} placeholder="例如：项目编号" /></label><label className="grid gap-1.5 text-xs">属性类型<Select value={kind} disabled={busy} onValueChange={value => setKind(value as FieldKind)}><SelectTrigger aria-label="属性类型"><SelectValue /></SelectTrigger><SelectContent>{kinds.map(k => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}</SelectContent></Select><span className="text-muted-foreground">{kind === 'date' ? '可选择日期填写精度。' : kind === 'number' ? '支持整数和小数。' : kind === 'boolean' ? '可选择是或否。' : kind === 'text' ? '填写自由文本。' : kind === 'select' ? '从选项中选择一项。' : '可选择多个选项。'}</span></label>{kind === 'date' && <div className="grid gap-1.5 text-xs"><span id="field-date-precision">日期精度</span><ToggleGroup type="single" aria-labelledby="field-date-precision" value={precision} disabled={busy} onValueChange={value => { if (value) setPrecision(value as DatePrecision); }} variant="outline" size="sm" spacing={0}><ToggleGroupItem value="year">年</ToggleGroupItem><ToggleGroupItem value="month">年月</ToggleGroupItem><ToggleGroupItem value="day">年月日</ToggleGroupItem></ToggleGroup></div>}{(kind === 'select' || kind === 'multi_select') && <section className="space-y-2"><div className="flex items-center justify-between"><span className="text-xs font-medium">选项</span><Button type="button" size="xs" variant="outline" disabled={busy} onClick={() => setOptions(current => [...current, ''])}><Plus size={12} />添加选项</Button></div><p className="text-xs text-muted-foreground">拖动或使用上下按钮调整顺序。已被使用的选项不可删除或改名。</p><div className="space-y-1">{options.map((option, index) => <div key={index} className="flex items-center gap-1" draggable={!busy} onDragStart={() => { dragIndex.current = index; }} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (dragIndex.current !== null) moveOption(dragIndex.current, index); dragIndex.current = null; }} onDragEnd={() => { dragIndex.current = null; }}><GripVertical size={16} className="shrink-0 text-muted-foreground" aria-hidden="true"/><Input aria-label={`选项 ${index + 1}`} value={option} disabled={busy} onChange={event => setOptions(current => current.map((value, i) => i === index ? event.target.value : value))}/><Button type="button" size="icon-xs" variant="ghost" aria-label={`上移选项 ${index + 1}`} disabled={busy || index === 0} onClick={() => moveOption(index, index - 1)}><ArrowUp size={13}/></Button><Button type="button" size="icon-xs" variant="ghost" aria-label={`下移选项 ${index + 1}`} disabled={busy || index === options.length - 1} onClick={() => moveOption(index, index + 1)}><ArrowDown size={13}/></Button><Button type="button" size="icon-xs" variant="ghost" aria-label={`删除选项 ${index + 1}`} disabled={busy} onClick={() => setOptions(current => current.filter((_, i) => i !== index))}><Trash2 size={13}/></Button></div>)}</div></section>}{formError && <p role="alert" className="text-xs text-destructive">{formError}</p>}{error && <p role="alert" className="text-xs text-destructive">{error}</p>}</DialogBody><DialogFooter><Button variant="outline" disabled={busy} onClick={() => setFormOpen(false)}>取消</Button><Button disabled={busy} onClick={() => void submit()}>{busy ? '保存中…' : editing ? '保存修改' : '添加属性'}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(removing)} onOpenChange={value => { if (!value && !busy) setRemoving(null); }}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>移除“{removing?.name}”？</DialogTitle><DialogDescription>该属性将从所有条目的属性列表中隐藏，已填写的值不会删除；之后可以在已移除属性中恢复。</DialogDescription></DialogHeader>{error && <p role="alert" className="text-xs text-destructive">{error}</p>}<DialogFooter><Button variant="outline" disabled={busy} onClick={() => setRemoving(null)}>取消</Button><Button variant="destructive" disabled={busy} onClick={() => { if (removing) void persist(items.map(item => item.name === removing.name ? { ...item, hidden: true } : item)).then(success => { if (success) setRemoving(null); }); }}>{busy ? '处理中…' : '确认移除'}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
