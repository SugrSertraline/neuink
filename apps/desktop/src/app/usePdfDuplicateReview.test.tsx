// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ToastContext, type ToastInput } from '@/shared/hooks/useToast';
import type { PdfDuplicateReview } from '@/shared/lib/pdfDuplicate';
import { usePdfDuplicateReview } from './usePdfDuplicateReview';

afterEach(cleanup);

const review: PdfDuplicateReview = {
  candidateTitle: '新建论文',
  sourcePath: 'C:\\papers\\renamed.pdf',
  duplicate: { entryId: 'existing', title: '已有论文', fileName: 'original.pdf', contentHash: 'same-hash', inTrash: false }
};

it('keeps a bottom-right toast actionable until the user reviews both papers and continues', async () => {
  let input: ToastInput | undefined;
  const notify = vi.fn((next: ToastInput) => { input = next; return 'duplicate-toast'; });
  const dismiss = vi.fn();
  let requestReview!: ReturnType<typeof usePdfDuplicateReview>['confirm'];
  function Harness() {
    const state = usePdfDuplicateReview();
    requestReview = state.confirm;
    return state.dialog;
  }
  render(<ToastContext.Provider value={{ notify, dismiss }}><Harness /></ToastContext.Provider>);
  let decision!: Promise<boolean>;
  act(() => { decision = requestReview(review); });
  expect(input?.durationMs).toBe(Infinity);
  expect(input?.title).toBe('发现内容重复的 PDF');
  const action = render(<>{input?.action}</>);
  fireEvent.click(action.getByRole('button', { name: '查看详情' }));
  expect(screen.getByText('新建论文')).toBeTruthy();
  expect(screen.getByText('已有论文')).toBeTruthy();
  expect(screen.getByText('renamed.pdf')).toBeTruthy();
  expect(screen.getByText('original.pdf')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '仍要添加' }));
  await expect(decision).resolves.toBe(true);
  expect(dismiss).toHaveBeenCalledWith('duplicate-toast');
  action.unmount();
});

it('treats dismissing the duplicate toast as cancellation', async () => {
  let input: ToastInput | undefined;
  const notify = vi.fn((next: ToastInput) => { input = next; return 'duplicate-toast'; });
  let requestReview!: ReturnType<typeof usePdfDuplicateReview>['confirm'];
  function Harness() {
    requestReview = usePdfDuplicateReview().confirm;
    return null;
  }
  render(<ToastContext.Provider value={{ notify, dismiss: vi.fn() }}><Harness /></ToastContext.Provider>);
  let decision!: Promise<boolean>;
  act(() => { decision = requestReview(review); });
  act(() => input?.onDismiss?.());
  await expect(decision).resolves.toBe(false);
});
