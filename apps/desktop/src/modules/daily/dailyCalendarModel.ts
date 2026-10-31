import { Solar } from 'lunar-typescript';

/** Civil dates only: no timezone conversion, credentials, network request or personal data. */
export function buildDailyCalendar(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split('-').map(Number);
  if (year < 1900 || year > 2100) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  try {
    const solar = Solar.fromYmd(year, month, day), lunar = solar.getLunar();
    const next = lunar.getNextJieQi(true), nextSolar = next.getSolar();
    return {
      date,
      lunarDate: `${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`,
      festivals: [...new Set([...solar.getFestivals(), ...lunar.getFestivals(), lunar.getJieQi()].filter(Boolean))],
      nextTerm: { name: next.getName(), date: nextSolar.toYmd(), days: nextSolar.subtract(solar) },
      suitable: lunar.getDayYi(), avoid: lunar.getDayJi(),
    };
  } catch { return null; }
}
