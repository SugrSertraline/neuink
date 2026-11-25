import { FoodCategorySelect } from './FoodCategorySelect';
import { MealSlotWidget } from './MealSlotWidget';
import { FOOD_CATEGORIES } from './foodCatalog';
import { foodMenu, type DailySidebarPreferences } from './dailyLifestyle';

export function DailyFoodPicker({ active, date, preferences, update, onSettings }: {
  active: boolean; date: string; preferences: DailySidebarPreferences;
  update: (change: (previous: DailySidebarPreferences) => DailySidebarPreferences) => void;
  onSettings: () => void;
}) {
  const category = preferences.foodCategory;
  const definition = FOOD_CATEGORIES.find(item => item.id === category)!;
  const selected = preferences.foodChoices[category];
  return <MealSlotWidget scope={category} active={active} date={date} meals={foodMenu(preferences, category)}
    kind={definition.kind} selected={selected?.date === date ? selected.name : ''} onSettings={onSettings}
    controls={<FoodCategorySelect value={category} onChange={foodCategory => update(previous => ({ ...previous, foodCategory }))} />}
    onPick={name => update(previous => ({ ...previous,
      ...(category === 'meal' ? { lastMeal: { date, name } } : {}),
      foodChoices: { ...previous.foodChoices, [category]: { date, name } },
    }))} />;
}
