// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useIdeationBackground } from './useIdeationBackground';
const mocks = vi.hoisted(() => ({ list: vi.fn(), generate: vi.fn() }));
vi.mock('@/shared/ipc/ideationApi', () => ({ listIdeationDrafts: mocks.list }));
vi.mock('./generateCards', () => ({ generatePaperCards: mocks.generate }));
afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear(); });
it('only reads existing cards even when the old auto-generation preference was enabled', async () => {
  localStorage.setItem('neuink.ideation.auto:root', '1');
  mocks.list.mockResolvedValue([]);
  const { result } = renderHook(() => useIdeationBackground('root', [{ id: 'a', status: 'Parsed' }] as any, { version: 2, cards: [], placements: [] }, true));
  await waitFor(() => expect(result.current.summaries).toEqual([]));
  expect(mocks.generate).not.toHaveBeenCalled();
});
it('reports catalog failures without generating replacement cards', async () => {
  mocks.list.mockRejectedValue(new Error('read'));
  const { result } = renderHook(() => useIdeationBackground('root', [], null, true));
  await waitFor(() => expect(result.current.error).toContain('读取失败'));
  expect(mocks.generate).not.toHaveBeenCalled();
});
