import { fetch as nativeFetch } from '@tauri-apps/plugin-http';

const SIGN_SLUGS: Record<string, string> = {
  白羊座: 'aries', 金牛座: 'taurus', 双子座: 'gemini', 巨蟹座: 'cancer',
  狮子座: 'leo', 处女座: 'virgo', 天秤座: 'libra', 天蝎座: 'scorpio',
  射手座: 'sagittarius', 摩羯座: 'capricorn', 水瓶座: 'aquarius', 双鱼座: 'pisces',
};

export type DailyHoroscope = { summary: string; work: string; suitable: string; avoid: string };

export function parseDailyHoroscope(value: unknown, date: string, zodiac: string): DailyHoroscope {
  const response = value as { code?: unknown; data?: Record<string, unknown> } | null;
  const data = response?.data;
  const text = data?.fortunetext as Record<string, unknown> | undefined;
  const todo = data?.todo as Record<string, unknown> | undefined;
  const [, month, day] = /^(\d{1,2})月(\d{1,2})日$/.exec(String(data?.time ?? '')) ?? [];
  const [, expectedMonth, expectedDay] = date.split('-').map(Number);
  if (response?.code !== 200 || data?.name !== SIGN_SLUGS[zodiac] || data?.title !== zodiac || data?.type !== '今日运势'
    || Number(month) !== expectedMonth || Number(day) !== expectedDay
    || typeof text?.all !== 'string' || !text.all.trim() || typeof text.work !== 'string' || !text.work.trim()) {
    throw new Error('星座接口返回了无效或过期的内容。');
  }
  const clean = (item: unknown, limit: number) => typeof item === 'string' ? item.trim().slice(0, limit) : '';
  return { summary: clean(text.all, 360), work: clean(text.work, 280),
    suitable: clean(todo?.yi, 80), avoid: clean(todo?.ji, 80) };
}

export async function fetchDailyHoroscope(date: string, zodiac: string, signal: AbortSignal): Promise<DailyHoroscope> {
  const slug = SIGN_SLUGS[zodiac];
  if (!slug) throw new Error('请先选择星座。');
  const response = await nativeFetch(`https://api.iyuns.com/api/horoscope?type=${slug}&time=today`, {
    method: 'GET', credentials: 'omit', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
  });
  if (!response.ok) throw new Error(`星座接口返回 HTTP ${response.status}。`);
  if (Number(response.headers.get('content-length')) > 12_000) throw new Error('星座接口响应过大。');
  const raw = await response.text();
  if (raw.length > 12_000) throw new Error('星座接口响应过大。');
  return parseDailyHoroscope(JSON.parse(raw), date, zodiac);
}
