import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { FOOD_CATEGORIES, FOOD_PRESETS, foodMenuLimit, type FoodCategory } from './foodCatalog';
import { FoodCategorySelect } from './FoodCategorySelect';
import { foodMenu, updateFoodMenu, type DailySidebarPreferences } from './dailyLifestyle';

type Menus = Record<FoodCategory, string[]>;
type Removed = { category: FoodCategory; index: number; name: string };

export function FoodMenuDialog({ preferences, save, onClose }: {
  preferences: DailySidebarPreferences;
  save: (change: (previous: DailySidebarPreferences) => DailySidebarPreferences) => boolean;
  onClose: () => void;
}) {
  const [category, setCategory] = useState<FoodCategory>(preferences.foodCategory);
  const [menus, setMenus] = useState<Menus>(() => Object.fromEntries(FOOD_CATEGORIES.map(({ id }) => [id, [...foodMenu(preferences, id)]])) as Menus);
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<{ index: number; name: string } | null>(null);
  const [removed, setRemoved] = useState<Removed | null>(null);
  const [error, setError] = useState('');
  const items = menus[category];
  const limit = foodMenuLimit(category);
  const label = FOOD_CATEGORIES.find(item => item.id === category)!.label;
  const replace = (next: string[]) => { setMenus(previous => ({ ...previous, [category]: next })); setError(''); };
  const check = (raw: string, except = -1) => {
    const name = raw.trim();
    if (!name) return '请输入名称。';
    if (name.length > 40) return '每项最多 40 字。';
    if (items.some((item, index) => index !== except && item === name)) return '这个选项已在当前分类中。';
    return '';
  };
  const add = () => {
    const issue = check(newName);
    if (issue) { setError(issue); return; }
    if (items.length >= limit) { setError(`当前分类最多 ${limit} 项。`); return; }
    replace([...items, newName.trim()]); setNewName(''); setRemoved(null);
  };
  const commitEdit = () => {
    if (!editing) return;
    const issue = check(editing.name, editing.index);
    if (issue) { setError(issue); return; }
    replace(items.map((item, index) => index === editing.index ? editing.name.trim() : item)); setEditing(null); setRemoved(null);
  };
  const finishCurrent = () => {
    const current = [...items];
    if (editing) {
      const issue = check(editing.name, editing.index);
      if (issue) { setError(issue); return null; }
      current[editing.index] = editing.name.trim();
    }
    if (newName.trim()) {
      const name = newName.trim();
      if (name.length > 40 || current.includes(name) || current.length >= limit) {
        setError(name.length > 40 ? '每项最多 40 字。' : current.includes(name) ? '这个选项已在当前分类中。' : `当前分类最多 ${limit} 项。`);
        return null;
      }
      current.push(name);
    }
    return current;
  };
  const selectCategory = (next: FoodCategory) => {
    const current = finishCurrent();
    if (!current) return;
    setMenus(previous => ({ ...previous, [category]: current }));
    setCategory(next); setEditing(null); setRemoved(null); setError(''); setNewName('');
  };
  const persist = () => {
    const current = finishCurrent();
    if (!current) return;
    const nextMenus = { ...menus, [category]: current };
    const saved = save(previous => {
      let next = previous;
      for (const { id } of FOOD_CATEGORIES) next = updateFoodMenu(next, id, nextMenus[id]);
      return { ...next, foodCategory: category };
    });
    if (saved) onClose();
    else setError('菜单暂时无法保存到本机，请重试。');
  };
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent layout="bounded" aria-describedby="food-menu-description">
      <DialogHeader><DialogTitle>编辑吃喝菜单</DialogTitle>
        <DialogDescription id="food-menu-description">按分类管理候选项。保存后会用于随机挑选；关闭窗口可放弃本次修改。</DialogDescription></DialogHeader>
      <DialogBody className="space-y-3 pr-1 text-xs">
        <div className="space-y-1"><span className="font-medium">分类</span>
          <FoodCategorySelect value={category} onChange={selectCategory} label="菜单分类" /></div>
        <div className="flex items-center justify-between gap-2"><p className="text-muted-foreground">{label} · {items.length}/{limit} 项</p>
          <Button size="xs" variant="ghost" onClick={() => { replace([...FOOD_PRESETS[category]]); setEditing(null); setRemoved(null); setNewName(''); }}>恢复默认</Button></div>
        <form className="flex gap-2" onSubmit={event => { event.preventDefault(); add(); }}>
          <Input aria-label="新增菜单选项" maxLength={40} value={newName} placeholder="添加菜名、店铺或饮品" onChange={event => { setNewName(event.target.value); setError(''); }} />
          <Button type="submit" size="sm" disabled={items.length >= limit}>添加</Button>
        </form>
        {error && <p role="alert" className="text-destructive">{error}</p>}
        {removed?.category === category && <div role="status" className="flex items-center gap-2 text-muted-foreground">已删除“{removed.name}”
          <Button size="xs" variant="link" onClick={() => { replace([...items.slice(0, removed.index), removed.name, ...items.slice(removed.index)]); setRemoved(null); }}>撤销删除</Button></div>}
        <ul aria-label="当前分类菜单" className="divide-y divide-border border-y border-border">
          {items.map((name, index) => <li key={`${index}:${name}`} className="flex min-h-10 items-center gap-2 py-1.5">
            {editing?.index === index ? <>
              <Input aria-label={`修改${name}`} value={editing.name} maxLength={40} autoFocus onChange={event => { setEditing({ index, name: event.target.value }); setError(''); }}
                onKeyDown={event => { if (event.key === 'Enter') commitEdit(); if (event.key === 'Escape') setEditing(null); }} />
              <Button size="xs" onClick={commitEdit}>确定</Button><Button size="xs" variant="ghost" onClick={() => setEditing(null)}>取消</Button>
            </> : <><span className="min-w-0 flex-1 break-words text-[13px]">{name}</span>
              <Button size="xs" variant="ghost" aria-label={`编辑${name}`} onClick={() => { setEditing({ index, name }); setError(''); }}>编辑</Button>
              <Button size="xs" variant="ghost" aria-label={`删除${name}`} onClick={() => { replace(items.filter((_, position) => position !== index)); setEditing(null); setRemoved({ category, index, name }); }}>删除</Button></>}
          </li>)}
        </ul>
        {!items.length && <p className="py-2 text-center text-muted-foreground">当前分类还没有选项，可在上方添加。</p>}
      </DialogBody>
      <DialogFooter><Button variant="outline" onClick={onClose}>取消</Button><Button onClick={persist}>保存菜单</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
