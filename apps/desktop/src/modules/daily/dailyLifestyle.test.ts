import { expect, it } from 'vitest';
import { chooseMeal, cleanMealList, dailyFortune, normalizeDailySidebar, ZODIAC_SIGNS } from './dailyLifestyle';
import { FOOD_CATEGORIES, FOOD_PRESETS } from './foodCatalog';

it('normalizes malformed saved preferences without losing supported sections or restoring intentionally empty menus', () => {
  const result = normalizeDailySidebar({ order: ['meal', 'unknown', 'meal'], hidden: ['advice', 'unknown'], zodiac: 'unknown', meals: [], lastMeal: { date: 'bad', name: 4 } });
  expect(result.order).toEqual(['meal', 'calendar', 'horoscope', 'advice']);
  expect(result.hidden).toEqual(['advice']); expect(result.zodiac).toBe(''); expect(result.meals).toEqual([]); expect(result.lastMeal).toBeNull();
});
it('cleans custom menus, removes duplicates and bounds item and list lengths', () => {
  expect(cleanMealList([' 面条 ', '', '面条', null, '米饭'])).toEqual(['面条', '米饭']);
  expect(cleanMealList(Array.from({ length: 70 }, (_, i) => `${i}`))).toHaveLength(50);
  expect(cleanMealList(['长'.repeat(100)])[0]).toHaveLength(40);
});
it('chooses only from the menu, avoids immediate repeats and handles one or zero choices', () => {
  for (const random of [0, .3, .6, .999, 1]) expect(['饭', '饺子']).toContain(chooseMeal(['面', '饭', '饺子'], '面', random));
  expect(chooseMeal(['面'], '面')).toBe('面'); expect(chooseMeal([], '')).toBe('');
});
it('keeps a daily sign stable across reloads and produces defined phrases for every sign', () => {
  for (const sign of ZODIAC_SIGNS) {
    const a = dailyFortune('2026-10-27', sign);
    expect(a).toEqual(dailyFortune('2026-10-27', sign));
    expect(Object.values(a).every(value => typeof value === 'string' && value.length > 0)).toBe(true);
  }
  expect(dailyFortune('2026-10-27', '白羊座')).not.toEqual(dailyFortune('2026-10-28', '白羊座'));
});
it('migrates the old default menu but preserves custom menus, empty categories and old daily results', () => {
  const lastMeal = { date: '2026-10-27', name: '寿司' };
  const migrated = normalizeDailySidebar({ meals: FOOD_PRESETS.meal.slice(0, 12), lastMeal });
  expect(migrated.meals).toEqual(FOOD_PRESETS.meal);
  expect(migrated.foodChoices.meal).toEqual(lastMeal);
  const custom = normalizeDailySidebar({ meals: ['一食堂'], foodMenus: { soda: [], tea: [' 柠檬水 ', '柠檬水'] }, foodCategory: 'bad', foodChoices: { soda: { date: null, name: 1 } } });
  expect(custom.meals).toEqual(['一食堂']); expect(custom.foodMenus.soda).toEqual([]);
  expect(custom.foodMenus.tea).toEqual(['柠檬水']); expect(custom.foodCategory).toBe('meal');
  expect(custom.foodChoices.soda).toBeUndefined();
});
it('provides distinct food, dining and drink pools with bounded unique candidates', () => {
  for (const { id } of FOOD_CATEGORIES) {
    expect(FOOD_PRESETS[id].length).toBeGreaterThan(1);
    expect(cleanMealList(FOOD_PRESETS[id])).toEqual(FOOD_PRESETS[id]);
  }
  expect(FOOD_PRESETS.soda).toEqual(expect.arrayContaining(['雪碧', '可口可乐']));
  expect(FOOD_PRESETS.tea).toContain('蜜雪冰城柠檬水');
  expect(FOOD_PRESETS.dining).toEqual(expect.arrayContaining(['食堂吃饭', '点一份外卖']));
});
