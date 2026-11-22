// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RetrievalPathSetting } from './RetrievalPathSetting';
import { readUnifiedRetrieval, writeUnifiedRetrieval } from '@/shared/lib/retrievalMode';

vi.mock('@/shared/ipc/workspaceApi', () => ({
  getTextModelSettings: vi.fn(async () => ({ colbert_head_present: false, sparse_head_present: false }))
}));

vi.mock('@/shared/lib/retrievalMode', () => ({
  DEFAULT_MULTIVECTOR: {
    enabled: false,
    mode: 'bge_m3_hybrid',
    max_full_scope_segments: 600,
    rescore_window: 100
  },
  readUnifiedRetrieval: vi.fn(),
  writeUnifiedRetrieval: vi.fn(),
  readRetrievalSettings: vi.fn(async () => ({
    unified: false,
    multivector: {
      enabled: false,
      mode: 'bge_m3_hybrid',
      max_full_scope_segments: 600,
      rescore_window: 100
    }
  })),
  writeRetrievalSettings: vi.fn(async (settings: { multivector?: { enabled: boolean } }) => settings)
}));

afterEach(cleanup);

beforeEach(() => {
  vi.mocked(readUnifiedRetrieval).mockReset();
  vi.mocked(writeUnifiedRetrieval).mockReset();
});

describe('RetrievalPathSetting', () => {
  it('does nothing while its tab is inactive', () => {
    render(<RetrievalPathSetting active={false} />);
    expect(readUnifiedRetrieval).not.toHaveBeenCalled();
  });

  it('reflects the stored flag', async () => {
    vi.mocked(readUnifiedRetrieval).mockResolvedValue(true);
    render(<RetrievalPathSetting active />);
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: '使用组合检索' }).getAttribute('aria-checked')).toBe('true')
    );
  });

  it('stores the new flag through the backend', async () => {
    vi.mocked(readUnifiedRetrieval).mockResolvedValue(false);
    vi.mocked(writeUnifiedRetrieval).mockResolvedValue(true);
    render(<RetrievalPathSetting active />);
    await waitFor(() => expect(readUnifiedRetrieval).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('switch', { name: '使用组合检索' }));
    await waitFor(() => expect(writeUnifiedRetrieval).toHaveBeenCalledWith(true));
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: '使用组合检索' }).getAttribute('aria-checked')).toBe('true')
    );
  });

  it('rolls the switch back when the save is rejected', async () => {
    vi.mocked(readUnifiedRetrieval).mockResolvedValue(false);
    vi.mocked(writeUnifiedRetrieval).mockRejectedValue(new Error('rejected'));
    render(<RetrievalPathSetting active />);
    await waitFor(() => expect(readUnifiedRetrieval).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('switch', { name: '使用组合检索' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('未能保存检索路径设置'));
    expect(screen.getByRole('switch', { name: '使用组合检索' }).getAttribute('aria-checked')).toBe('false');
  });
});
