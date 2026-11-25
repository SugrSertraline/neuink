import { expect, it, vi } from 'vitest';
import { fetch as nativeFetch } from '@tauri-apps/plugin-http';
import { fetchDailyHoroscope, parseDailyHoroscope } from './dailyHoroscopeApi';

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));
const response = { code: 200, data: { name: 'libra', title: '天秤座', type: '今日运势', time: '10月31日',
  fortunetext: { all: '整体平稳。', work: '适合整理笔记。' }, todo: { yi: '宜阅读', ji: '忌拖延' } } };

it('accepts a matching Chinese daily reading and rejects stale or mismatched content', () => {
  expect(parseDailyHoroscope(response, '2026-10-31', '天秤座')).toEqual({ summary: '整体平稳。', work: '适合整理笔记。', suitable: '宜阅读', avoid: '忌拖延' });
  expect(() => parseDailyHoroscope(response, '2026-11-01', '天秤座')).toThrow('过期');
  expect(() => parseDailyHoroscope(response, '2026-10-31', '白羊座')).toThrow('无效');
});

it('requests the selected sign through the HTTPS API without a key', async () => {
  vi.mocked(nativeFetch).mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));
  const result = await fetchDailyHoroscope('2026-10-31', '天秤座', new AbortController().signal);
  expect(result.summary).toBe('整体平稳。');
  expect(vi.mocked(nativeFetch).mock.calls[0][0]).toBe('https://api.iyuns.com/api/horoscope?type=libra&time=today');
  expect(vi.mocked(nativeFetch).mock.calls[0][1]).toMatchObject({ method: 'GET', credentials: 'omit' });
});
