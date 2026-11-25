import { FOOD_CATEGORIES, FOOD_PRESETS, LEGACY_DRINK_PRESETS, foodMenuLimit, isFoodCategory, type FoodCategory, type OtherFoodCategory } from './foodCatalog';
export const DAILY_SIDEBAR_KEY = 'neuink.daily.sidebar.v1';
export const DAILY_SECTIONS = [
  { id: 'calendar', label: '节令与黄历' }, { id: 'meal', label: '今天吃什么' },
  { id: 'horoscope', label: '星座运势' }, { id: 'advice', label: '阅读建议' },
] as const;
export type DailySection = typeof DAILY_SECTIONS[number]['id'];
export const ZODIAC_SIGNS = ['白羊座', '金牛座', '双子座', '巨蟹座', '狮子座', '处女座', '天秤座', '天蝎座', '射手座', '摩羯座', '水瓶座', '双鱼座'] as const;
export const DEFAULT_MEALS = FOOD_PRESETS.meal;
type FoodChoice = { date: string; name: string };
export type DailySidebarPreferences = {
  order: DailySection[]; hidden: DailySection[]; zodiac: string; meals: string[];
  lastMeal: FoodChoice | null;
  foodCategory: FoodCategory;
  foodMenus: Record<OtherFoodCategory, string[]>;
  foodChoices: Partial<Record<FoodCategory, FoodChoice>>;
  foodMenuVersion: 2;
  legacyDiningMenu?: string[];
};
export function cleanMealList(items: unknown, limit = 50): string[] {
  return Array.isArray(items) ? [...new Set(items.filter((v): v is string => typeof v === 'string').map(v => v.trim().slice(0, 40)).filter(Boolean))].slice(0, limit) : DEFAULT_MEALS;
}
export function normalizeDailySidebar(value: unknown): DailySidebarPreferences {
  const input = value && typeof value === 'object' ? value as Partial<DailySidebarPreferences> : {};
  const valid = (value: unknown): value is DailySection => DAILY_SECTIONS.some(item => item.id === value);
  const order = [...new Set(Array.isArray(input.order) ? input.order.filter(valid) : [])];
  const choice = (last: unknown): FoodChoice | null => {
    if (!last || typeof last !== 'object') return null;
    const item = last as Partial<FoodChoice>;
    return typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date) && typeof item.name === 'string'
      ? { date: item.date, name: item.name.slice(0, 40) } : null;
  };
  const foodMenus = {} as DailySidebarPreferences['foodMenus'];
  const foodChoices: DailySidebarPreferences['foodChoices'] = {};
  const oldMenus = (input as { foodMenus?: Record<string, unknown> }).foodMenus ?? {};
  const oldChoices = (input as { foodChoices?: Record<string, unknown> }).foodChoices ?? {};
  const legacyDrinks = (['soda', 'tea', 'coffee'] as const).flatMap(id =>
    Array.isArray(oldMenus[id]) ? oldMenus[id] as string[] : [...LEGACY_DRINK_PRESETS[id]]);
  for (const { id } of FOOD_CATEGORIES) {
    if (id !== 'meal') foodMenus[id] = Array.isArray(oldMenus[id]) ? cleanMealList(oldMenus[id], foodMenuLimit(id))
      : input.foodMenuVersion !== 2 && (['soda', 'tea', 'coffee'] as const).some(oldId => Array.isArray(oldMenus[oldId]))
        ? cleanMealList(legacyDrinks, foodMenuLimit(id)) : [...FOOD_PRESETS[id]];
    const saved = choice(input.foodChoices?.[id]);
    if (saved) foodChoices[id] = saved;
  }
  if (!foodChoices.drink) {
    const priorCategory = (input as { foodCategory?: string }).foodCategory;
    const preferred = priorCategory === 'soda' || priorCategory === 'tea' || priorCategory === 'coffee' ? priorCategory : null;
    const candidates = ([preferred, 'soda', 'tea', 'coffee'] as const).filter((id): id is 'soda' | 'tea' | 'coffee' => Boolean(id));
    const latest = candidates.map(id => choice(oldChoices[id])).filter((saved): saved is FoodChoice => saved !== null && foodMenus.drink.includes(saved.name))
      .sort((left, right) => right.date.localeCompare(left.date))[0];
    if (latest) foodChoices.drink = latest;
  }
  const lastMeal = choice(input.lastMeal);
  if (!foodChoices.meal && lastMeal) foodChoices.meal = lastMeal;
  // Upgrade the original untouched preset once; preserve custom and intentionally empty menus.
  const meals = cleanMealList(input.meals);
  const originalPreset = !input.foodCategory && meals.join('\n') === DEFAULT_MEALS.slice(0, 12).join('\n');
  return {
    order: [...order, ...DAILY_SECTIONS.map(item => item.id).filter(id => !order.includes(id))],
    hidden: Array.isArray(input.hidden) ? [...new Set(input.hidden.filter(valid))] : [],
    zodiac: ZODIAC_SIGNS.some(sign => sign === input.zodiac) ? input.zodiac! : '',
    meals: originalPreset ? [...DEFAULT_MEALS] : meals,
    lastMeal, foodMenus, foodChoices, foodMenuVersion: 2,
    legacyDiningMenu: Array.isArray(input.legacyDiningMenu) ? cleanMealList(input.legacyDiningMenu)
      : Array.isArray(oldMenus.dining) ? cleanMealList(oldMenus.dining) : undefined,
    foodCategory: isFoodCategory(input.foodCategory) ? input.foodCategory
      : ['soda', 'tea', 'coffee'].includes(String(input.foodCategory)) ? 'drink' : 'meal',
  };
}
export function foodMenu(preferences: DailySidebarPreferences, category: FoodCategory) {
  return category === 'meal' ? preferences.meals : preferences.foodMenus[category];
}
export function updateFoodMenu(preferences: DailySidebarPreferences, category: FoodCategory, items: string[]): DailySidebarPreferences {
  const menu = cleanMealList(items, foodMenuLimit(category));
  return category === 'meal' ? { ...preferences, meals: menu }
    : { ...preferences, foodMenus: { ...preferences.foodMenus, [category]: menu } };
}
export function chooseMeal(meals: string[], previous: string, random = Math.random()) {
  const pool = meals.length > 1 ? meals.filter(item => item !== previous) : meals;
  return pool[Math.min(pool.length - 1, Math.floor(Math.max(0, Math.min(1, random)) * pool.length))] ?? '';
}
