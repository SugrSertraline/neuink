import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FOOD_CATEGORIES, isFoodCategory, type FoodCategory } from './foodCatalog';

export function FoodCategorySelect({ value, onChange, label = '抽取分类' }: {
  value: FoodCategory; onChange: (value: FoodCategory) => void; label?: string;
}) {
  return <Select value={value} onValueChange={next => { if (isFoodCategory(next)) onChange(next); }}>
    <SelectTrigger size="sm" className="w-full" aria-label={label}><SelectValue /></SelectTrigger>
    <SelectContent>{FOOD_CATEGORIES.map(item => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent>
  </Select>;
}
