// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToastContext } from '@/shared/hooks/useToast';

import {
  calculateFloatingToolbarLayout,
  PdfTextSelectionToolbar,
  type PendingPdfTextSelection
} from './PdfTextSelectionToolbar';

afterEach(cleanup);

describe('PdfTextSelectionToolbar', () => {
  it('saves a plain highlight without creating comment content', async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const { getByRole } = renderToolbar({ onApply, onClose });

    fireEvent.click(getByRole('button', { name: '仅高亮' }));

    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    expect(onApply.mock.calls[0][0]).toMatchObject({
      content: '',
      importance: 'normal',
      selection: { color: 'yellow', text: 'Selected source text' }
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('creates a text-selection annotation from the same toolbar', async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    const { getByPlaceholderText, getByRole } = renderToolbar({ onApply });

    fireEvent.click(getByRole('button', { name: '高亮并批注' }));
    fireEvent.change(getByPlaceholderText('写下针对这段选中文字的批注'), {
      target: { value: 'Important conclusion' }
    });
    fireEvent.click(getByRole('button', { name: '保存选区批注' }));

    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    expect(onApply.mock.calls[0][0].content).toBe('Important conclusion');
  });

  it('shows a quick translation without saving an annotation', async () => {
    const onApply = vi.fn();
    const onTranslate = vi.fn().mockResolvedValue('选中文字的译文');
    const { getByRole, findByText } = renderToolbar({ onApply, onTranslate });

    fireEvent.click(getByRole('button', { name: '翻译' }));

    expect(await findByText('选中文字的译文')).toBeTruthy();
    expect(onTranslate).toHaveBeenCalledWith({
      segment: pending.segment,
      text: 'Selected source text'
    });
    expect(onApply).not.toHaveBeenCalled();
  });

  it('keeps highlighting available while translation is still running', async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    const onTranslate = vi.fn(() => new Promise<string>(() => undefined));
    const { getByRole, getByText } = renderToolbar({ onApply, onTranslate });

    fireEvent.click(getByRole('button', { name: '翻译' }));

    expect(getByText('正在翻译选中文字…')).toBeTruthy();
    expect(getByRole('button', { name: '仅高亮' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(getByRole('button', { name: '仅高亮' }));

    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
  });

  it('automatically translates a new selection when enabled', async () => {
    const onTranslate = vi.fn().mockResolvedValue('自动译文');
    const { findByText } = renderToolbar({ autoTranslate: true, onTranslate });

    expect(await findByText('自动译文')).toBeTruthy();
    expect(onTranslate).toHaveBeenCalledTimes(1);
  });

  it('flips above the selection and stays inside the viewport near the bottom edge', () => {
    const layout = calculateFloatingToolbarLayout({
      anchor: { bottom: 710, left: 930, right: 980, top: 690 },
      contentHeight: 280,
      contentWidth: 368,
      viewport: { height: 720, left: 0, top: 0, width: 1024 }
    });

    expect(layout.placement).toBe('above');
    expect(layout.left).toBeGreaterThanOrEqual(8);
    expect(layout.left + 368).toBeLessThanOrEqual(1016);
    expect(layout.top).toBeGreaterThanOrEqual(8);
  });

  it('constrains an oversized menu to the larger available side', () => {
    const layout = calculateFloatingToolbarLayout({
      anchor: { bottom: 330, left: 200, right: 260, top: 310 },
      contentHeight: 900,
      contentWidth: 368,
      viewport: { height: 600, left: 0, top: 0, width: 800 }
    });

    expect(layout.placement).toBe('above');
    expect(layout.maxHeight).toBe(294);
    expect(layout.top).toBe(8);
  });
});

function renderToolbar({
  autoTranslate = false,
  onApply = vi.fn(),
  onClose = vi.fn(),
  onTranslate = vi.fn().mockResolvedValue('译文')
}: {
  autoTranslate?: boolean;
  onApply?: ReturnType<typeof vi.fn>;
  onClose?: ReturnType<typeof vi.fn>;
  onTranslate?: ReturnType<typeof vi.fn>;
}) {
  return render(
    <ToastContext.Provider value={{ dismiss: vi.fn(), notify: vi.fn(() => 'toast-id') }}>
      <PdfTextSelectionToolbar
        autoTranslate={autoTranslate}
        pending={pending}
        onApply={onApply}
        onClose={onClose}
        onTranslate={onTranslate}
      />
    </ToastContext.Provider>
  );
}

const pending: PendingPdfTextSelection = {
  position: { x: 100, y: 120 },
  segment: {
    bbox: [100, 100, 800, 220],
    markdown: null,
    page_idx: 0,
    segment_type: 'paragraph',
    text: 'Paragraph context',
    uid: 'segment-1'
  },
  selection: {
    page_idx: 0,
    rects: [[100, 110, 400, 140]],
    text: 'Selected source text'
  }
};
