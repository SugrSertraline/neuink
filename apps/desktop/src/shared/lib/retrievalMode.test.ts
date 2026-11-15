import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  readUnifiedRetrieval,
  resetUnifiedRetrievalCache,
  writeUnifiedRetrieval
} from './retrievalMode';
import { getRetrievalSettings, saveRetrievalSettings } from '@/shared/ipc/workspaceApi';

vi.mock('@/shared/ipc/workspaceApi', () => ({
  getRetrievalSettings: vi.fn(),
  saveRetrievalSettings: vi.fn()
}));

beforeEach(() => {
  resetUnifiedRetrievalCache();
  vi.mocked(getRetrievalSettings).mockReset();
  vi.mocked(saveRetrievalSettings).mockReset();
});

describe('unified retrieval flag', () => {
  it('reads the backend once and reuses the answer', async () => {
    vi.mocked(getRetrievalSettings).mockResolvedValue({ unified: true });
    expect(await readUnifiedRetrieval()).toBe(true);
    expect(await readUnifiedRetrieval()).toBe(true);
    expect(getRetrievalSettings).toHaveBeenCalledTimes(1);
  });

  it('fails closed: an unreadable setting keeps the batch path', async () => {
    vi.mocked(getRetrievalSettings).mockRejectedValue(new Error('ipc down'));
    expect(await readUnifiedRetrieval()).toBe(false);
    // The cache is dropped so a later turn can retry.
    vi.mocked(getRetrievalSettings).mockResolvedValue({ unified: true });
    expect(await readUnifiedRetrieval()).toBe(true);
    expect(getRetrievalSettings).toHaveBeenCalledTimes(2);
  });

  it('a save replaces the cached value with what the backend stored', async () => {
    vi.mocked(getRetrievalSettings).mockResolvedValue({ unified: false });
    vi.mocked(saveRetrievalSettings).mockResolvedValue({ unified: true });
    expect(await readUnifiedRetrieval()).toBe(false);
    expect(await writeUnifiedRetrieval(true)).toBe(true);
    expect(await readUnifiedRetrieval()).toBe(true);
    // No extra read: the write already told us the stored value.
    expect(getRetrievalSettings).toHaveBeenCalledTimes(1);
  });

  it('a rejected save leaves the previous value in place', async () => {
    vi.mocked(getRetrievalSettings).mockResolvedValue({ unified: false });
    vi.mocked(saveRetrievalSettings).mockRejectedValue(new Error('rejected'));
    await expect(writeUnifiedRetrieval(true)).rejects.toThrow('rejected');
    expect(await readUnifiedRetrieval()).toBe(false);
  });
});
