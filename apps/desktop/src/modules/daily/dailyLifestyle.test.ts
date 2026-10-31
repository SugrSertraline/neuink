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
  const custom = normalizeDailySidebar({ meals: ['一食堂'], foodMenus: { drink: [] }, foodCategory: 'bad' });
  expect(custom.meals).toEqual(['一食堂']); expect(custom.foodMenus.drink).toEqual([]);
  expect(custom.foodCategory).toBe('meal');
});
it('provides distinct food and merged drink pools with bounded unique candidates', () => {
  for (const { id } of FOOD_CATEGORIES) {
    expect(FOOD_PRESETS[id].length).toBeGreaterThan(1);
    expect(cleanMealList(FOOD_PRESETS[id], id === 'drink' ? 150 : 50)).toEqual(FOOD_PRESETS[id]);
  }
  expect(FOOD_PRESETS.drink).toEqual(expect.arrayContaining(['雪碧', '可口可乐', '蜜雪冰城柠檬水', '拿铁']));
  expect(FOOD_CATEGORIES.map(item => item.id)).toEqual(['meal', 'snack', 'feast', 'drink']);
});
it('migrates three old drink menus and the selected drink without restoring removed items later', () => {
  const migrated = normalizeDailySidebar({ foodCategory: 'tea', foodMenus: { soda: ['可乐', '柠檬水'], tea: ['柠檬水', '奶茶'], coffee: ['拿铁'], dining: ['食堂吃饭'] },
    foodChoices: { tea: { date: '2026-10-27', name: '奶茶' } } });
  expect(migrated.foodCategory).toBe('drink');
  expect(migrated.foodMenus.drink).toEqual(['可乐', '柠檬水', '奶茶', '拿铁']);
  expect(migrated.foodChoices.drink?.name).toBe('奶茶');
  expect(migrated.legacyDiningMenu).toEqual(['食堂吃饭']);
  const saved = normalizeDailySidebar(JSON.parse(JSON.stringify({ ...migrated, foodMenus: { drink: ['奶茶'] } })));
  expect(saved.foodMenus.drink).toEqual(['奶茶']);
});
it('keeps all distinct custom drinks from three full legacy menus', () => {
  const legacy = normalizeDailySidebar({ foodMenus: {
    soda: Array.from({ length: 50 }, (_, i) => `汽水${i}`),
    tea: Array.from({ length: 50 }, (_, i) => `茶饮${i}`),
    coffee: Array.from({ length: 50 }, (_, i) => `咖啡${i}`),
  }, foodChoices: { soda: { date: '2026-10-26', name: '汽水1' }, tea: { date: '2026-10-27', name: '茶饮1' } } });
  expect(legacy.foodMenus.drink).toHaveLength(150);
  expect(legacy.foodChoices.drink?.name).toBe('茶饮1');
});
