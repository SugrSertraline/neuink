import { useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cleanMealList, DAILY_SECTIONS, foodMenu, updateFoodMenu, type DailySidebarPreferences } from './dailyLifestyle';
import { FOOD_CATEGORIES, FOOD_PRESETS, type FoodCategory } from './foodCatalog';
import { FoodCategorySelect } from './FoodCategorySelect';

export function DailySidebarSettings({ preferences, update }: {
  preferences: DailySidebarPreferences; update: (change: (previous: DailySidebarPreferences) => DailySidebarPreferences) => void;
}) {
  const [category, setCategory] = useState(preferences.foodCategory);
  const [drafts, setDrafts] = useState<Partial<Record<FoodCategory, string>>>({});
  const [saved, setSaved] = useState<FoodCategory | null>(null);
  const menu = drafts[category] ?? foodMenu(preferences, category).join('\n');
  const setMenu = (value: string) => { setDrafts(previous => ({ ...previous, [category]: value })); setSaved(null); };
  const categoryLabel = FOOD_CATEGORIES.find(item => item.id === category)!.label;
  return <div className="space-y-4 text-xs">
    <div><h3 className="font-medium">左侧显示内容</h3><p className="mt-1 text-muted-foreground">勾选需要的内容，使用箭头调整顺序。</p></div>
    <div className="space-y-2">{preferences.order.map((id, index) => {
      const label = DAILY_SECTIONS.find(item => item.id === id)!.label;
      const move = (delta: number) => update(previous => { const order = [...previous.order]; [order[index], order[index + delta]] = [order[index + delta], order[index]]; return { ...previous, order }; });
      return <div key={id} className="flex items-center gap-2">
        <Checkbox id={`daily-section-${id}`} checked={!preferences.hidden.includes(id)} onCheckedChange={checked => update(previous => ({ ...previous,
          hidden: checked === true ? previous.hidden.filter(value => value !== id) : [...previous.hidden, id] }))} />
        <Label htmlFor={`daily-section-${id}`} className="mr-auto text-xs">{label}</Label>
        <Button variant="ghost" size="icon-xs" aria-label={`上移${label}`} disabled={index === 0} onClick={() => move(-1)}><ArrowUp /></Button>
        <Button variant="ghost" size="icon-xs" aria-label={`下移${label}`} disabled={index === preferences.order.length - 1} onClick={() => move(1)}><ArrowDown /></Button>
      </div>;
    })}</div>
    <div className="space-y-2 border-t pt-3">
      <FoodCategorySelect value={category} onChange={setCategory} label="编辑分类" />
      <Label htmlFor="daily-meal-menu" className="text-xs">我的菜单</Label>
      <p className="text-muted-foreground">{categoryLabel} · {cleanMealList(menu.split(/\r?\n/)).length} 项。每行一种，最多 50 种、每项 40 字。不同分类独立保存。</p>
      <Textarea id="daily-meal-menu" value={menu} maxLength={2500} className="h-40 resize-y text-xs" onChange={event => setMenu(event.target.value)} />
      <p className="text-muted-foreground">可填具体菜名、食堂档口、外卖店或品牌饮品，按你附近能买到的调整。</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => {
          update(previous => ({ ...updateFoodMenu(previous, category, menu.split(/\r?\n/)), foodCategory: category }));
          setDrafts(previous => { const next = { ...previous }; delete next[category]; return next; }); setSaved(category);
        }}>保存菜单</Button>
        <Button size="xs" variant="ghost" onClick={() => setMenu(FOOD_PRESETS[category].join('\n'))}>填入默认菜单</Button>
      </div>
      {saved === category && <p role="status" className="text-muted-foreground">{categoryLabel}菜单已更新。</p>}
    </div>
  </div>;
}
