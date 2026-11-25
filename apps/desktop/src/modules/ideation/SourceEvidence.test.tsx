// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SourceEvidence } from './SourceEvidence';
const source = vi.hoisted(() => vi.fn());
vi.mock('@/shared/ipc/assistantApi', () => ({ readSegmentContent: source }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('keeps the snapshot and refuses to navigate when the source has changed', async () => {
  source.mockResolvedValue({ segment_uid: 'seg-1', page_idx: 1, text: '不同的原文' });
  const open = vi.fn();
  render(<SourceEvidence root="r" entryId="e" source={{ segment_uid: 'seg-1', page_idx: 1, quote: '之前的摘录' }} onOpen={open} />);
  fireEvent.click(screen.getByText('核对原文 · 第 2 页'));
  await screen.findByRole('alert');
  expect(screen.getByText('之前的摘录')).toBeTruthy();
  expect(open).not.toHaveBeenCalled();
});
