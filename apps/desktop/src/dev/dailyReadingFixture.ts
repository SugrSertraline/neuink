import { formatLocalDate } from '@/modules/reader/components/libraryReading';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { EntryReadingState } from '@/shared/types/domain';

export const entries: LibraryEntry[] = Array.from({ length: 20 }, (_, index) => ({
  id: `daily-${index}`, title: ['TADIFF: Text-Guided Diffusion for Time Series Forecasting', '基于扩散模型的多变量时间序列预测：方法、数据集和实验对照', 'Denoising Diffusion Probabilistic Models'][index % 3] + (index > 2 ? ` · ${index + 1}` : ''),
  contents: [], fields: {}, tagIds: [], tags: [], createdAt: '', updatedAt: '', pdfFileName: 'sample.pdf',
  status: 'Parsed', progress: 100, parseMessage: null, parseEndpoint: null
}));
export const states: Record<string, EntryReadingState> = Object.fromEntries(entries.map((entry, index) => {
  const daily_active_ms = Object.fromEntries(Array.from({ length: 84 }, (_, offset) => {
    const date = new Date(); date.setDate(date.getDate() - offset);
    return [formatLocalDate(date), offset % 3 === 1 ? 0 : ((index + offset) % 7) * 60000];
  }));
  return [entry.id, {
  entry_id: entry.id, version: 1, document_hash: null, mode: 'pdf', current_page_idx: 2, page_count: 12, visited_pages: [0, 1, 2],
  total_active_ms: Object.values(daily_active_ms).reduce((sum, value) => sum + value, 0), session_count: 3, last_read_at: new Date().toISOString(),
  daily_active_ms,
  reading_sessions: Object.entries(daily_active_ms).flatMap(([date, activeMs]) => activeMs <= 0 ? [] : [0.4, 0.6].map((fraction, part) => {
    const start = new Date(`${date}T08:00:00`).getTime() + index * 600_000 + part * 300_000;
    return { id: `${entry.id}-${date}-${part}`, local_date: date, started_at: new Date(start).toISOString(), ended_at: new Date(start + activeMs * fraction).toISOString(), active_ms: activeMs * fraction };
  })),
}]; }));
