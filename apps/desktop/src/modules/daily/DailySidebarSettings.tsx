import { ArrowDown, ArrowUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { DAILY_SECTIONS, type DailySidebarPreferences } from './dailyLifestyle';

export function DailySidebarSettings({ preferences, update }: {
  preferences: DailySidebarPreferences; update: (change: (previous: DailySidebarPreferences) => DailySidebarPreferences) => void;
}) {
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
  </div>;
}
