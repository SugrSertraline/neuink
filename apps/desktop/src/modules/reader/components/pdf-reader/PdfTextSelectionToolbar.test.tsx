// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToastContext } from '@/shared/hooks/useToast';
import { hoverInteractionBlocked } from '@/components/ui/hover-interactions';

import {
  calculateFloatingToolbarLayout,
  PdfTextSelectionToolbar,
  type PendingPdfTextSelection
} from './PdfTextSelectionToolbar';

afterEach(cleanup);

describe('PdfTextSelectionToolbar', () => {
  it('hands the exact selection to the assistant without writing an annotation or starting translation', () => {
    const onAsk = vi.fn(), onApply = vi.fn(), onTranslate = vi.fn();
    const ui = renderToolbar({ onAsk, onApply, onTranslate });
    fireEvent.click(ui.getByRole('button', { name: '提问' }));
    expect(onAsk).toHaveBeenLastCalledWith({ segment: pending.segment, text: pending.selection.text }, 'ask');
    fireEvent.click(ui.getByRole('button', { name: '解释' }));
    expect(onAsk).toHaveBeenLastCalledWith({ segment: pending.segment, text: pending.selection.text }, 'explain');
    expect(onApply).not.toHaveBeenCalled();
    expect(onTranslate).not.toHaveBeenCalled();
  });

  it('reuses a successful selection translation and retries a failure in place', async () => {
    const onTranslate = vi.fn().mockRejectedValueOnce(new Error('network unavailable')).mockResolvedValue('重试后的译文');
    const ui = renderToolbar({ onTranslate });
    fireEvent.click(ui.getByRole('button', { name: '翻译' }));
    expect(await ui.findByRole('alert')).toBeTruthy();
    fireEvent.click(ui.getByRole('button', { name: '重试翻译' }));
    await ui.findByText('重试后的译文');
    fireEvent.click(ui.getByRole('button', { name: '高亮并批注' }));
    fireEvent.click(ui.getByRole('button', { name: '翻译' }));
    expect(ui.getByText('重试后的译文')).toBeTruthy();
    expect(onTranslate).toHaveBeenCalledTimes(2);
  });
  it('hides a page draft while turning away and restores its unsaved text on return', () => {
    const onApply = vi.fn(), onClose = vi.fn();
    const view = (visible: boolean) => <ToastContext.Provider value={{ dismiss: vi.fn(), notify: vi.fn(() => 'toast-id') }}>
      <PdfTextSelectionToolbar visible={visible} pending={pending} onApply={onApply} onClose={onClose} />
    </ToastContext.Provider>;
    const result = render(view(true));
    expect(hoverInteractionBlocked()).toBe(true);
    expect(result.getByRole('dialog').className).toContain('z-[var(--z-reader-selection)]');
    fireEvent.click(result.getByRole('button', {name:'高亮并批注'}));
    fireEvent.change(result.getByPlaceholderText('写下针对这段选中文字的批注'), {target:{value:'Unfinished research comment'}});
    result.rerender(view(false));
    expect(hoverInteractionBlocked()).toBe(false);
    expect(result.queryByPlaceholderText('写下针对这段选中文字的批注')).toBeNull();
    result.rerender(view(true));
    expect(hoverInteractionBlocked()).toBe(true);
    expect((result.getByPlaceholderText('写下针对这段选中文字的批注') as HTMLTextAreaElement).value).toBe('Unfinished research comment');
    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    result.unmount();
    expect(hoverInteractionBlocked()).toBe(false);
  });
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

  it('converts viewport geometry back to CSS coordinates at enlarged UI scale', () => {
    const layout = calculateFloatingToolbarLayout({
      anchor: { bottom: 241, left: 347, right: 624, top: 161 },
      contentHeight: 112.5,
      contentWidth: 460,
      cssScale: 1.25,
      viewport: { height: 924, left: 0, top: 0, width: 706 }
    });
    expect(layout.top * 1.25).toBe(249);
    expect(layout.left * 1.25 + 460).toBeLessThanOrEqual(698);
    expect(layout.maxWidth * 1.25).toBe(690);
  });
});

function renderToolbar({
  autoTranslate = false,
  onApply = vi.fn(),
  onClose = vi.fn(),
  onAsk,
  onTranslate = vi.fn().mockResolvedValue('译文')
}: {
  autoTranslate?: boolean;
  onApply?: ReturnType<typeof vi.fn>;
  onClose?: ReturnType<typeof vi.fn>;
  onAsk?: ReturnType<typeof vi.fn>;
  onTranslate?: ReturnType<typeof vi.fn>;
}) {
  return render(
    <ToastContext.Provider value={{ dismiss: vi.fn(), notify: vi.fn(() => 'toast-id') }}>
      <PdfTextSelectionToolbar
        autoTranslate={autoTranslate}
        pending={pending}
        onApply={onApply}
        onClose={onClose}
        onAsk={onAsk}
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
