// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastContext } from '@/shared/hooks/useToast';
import { PdfTextSelectionToolbar, type PdfTextSelectionToolbarProps, type PendingPdfTextSelection } from './PdfTextSelectionToolbar';

afterEach(cleanup);
const pending: PendingPdfTextSelection = {
  position: { x: 100, y: 120 },
  segment: { uid: 'segment-1', page_idx: 0, segment_type: 'paragraph', text: 'context', markdown: null, bbox: null },
  selection: { page_idx: 0, text: 'Selected source text', rects: [[10, 20, 30, 40]] },
};
const toast = { dismiss: vi.fn(), notify: vi.fn(() => 'toast') };
function view(props: Partial<PdfTextSelectionToolbarProps>) {
  return <ToastContext.Provider value={toast}>
    <PdfTextSelectionToolbar pending={pending} onClose={vi.fn()} {...props} />
  </ToastContext.Provider>;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('add selection translation to highlight annotation', () => {
  it.each([false, true])('adds the displayed translation with the source anchor and selected color (auto=%s)', async autoTranslate => {
    const save = deferred<void>();
    const onApply = vi.fn(() => save.promise), onClose = vi.fn();
    const onTranslate = vi.fn().mockResolvedValue('翻译内容\n第二行');
    const ui = render(view({ autoTranslate, onApply, onClose, onTranslate }));
    if (!autoTranslate) fireEvent.click(ui.getByRole('button', { name: '翻译' }));
    const button = await ui.findByRole('button', { name: '添加到高亮批注' });
    fireEvent.click(ui.getByRole('button', { name: '选择绿色高亮' }));
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onApply).toHaveBeenCalledExactlyOnceWith({
      content: '翻译内容\n第二行', contentMode: 'append', importance: 'normal',
      segment: pending.segment, selection: { ...pending.selection, color: 'green' },
    });
    expect(ui.getByRole('button', { name: '保存中…' }).hasAttribute('disabled')).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => save.resolve());
    expect(onClose).toHaveBeenCalledOnce();
    expect(onTranslate).toHaveBeenCalledOnce();
  });

  it.each(['false', 'reject'])('retains the translation after a %s save failure and retries without translating again', async failure => {
    const onApply = failure === 'false' ? vi.fn().mockResolvedValueOnce(false) : vi.fn().mockRejectedValueOnce(new Error('write failed'));
    onApply.mockResolvedValueOnce(true);
    const onClose = vi.fn(), onTranslate = vi.fn().mockResolvedValue('完整译文');
    const ui = render(view({ autoTranslate: true, onApply, onClose, onTranslate }));
    fireEvent.click(await ui.findByRole('button', { name: '添加到高亮批注' }));
    expect((await ui.findByRole('alert')).textContent).toContain('批注保存失败');
    expect(ui.getByText('完整译文')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(ui.getByRole('button', { name: '添加到高亮批注' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onApply).toHaveBeenCalledTimes(2);
    expect(onTranslate).toHaveBeenCalledOnce();
  });

  it.each(['', '   \n  '])('does not offer an annotation for empty translation %j', async translation => {
    const onApply = vi.fn();
    const ui = render(view({ autoTranslate: true, onApply, onTranslate: vi.fn().mockResolvedValue(translation) }));
    await ui.findByText('暂无译文');
    expect(ui.queryByRole('button', { name: '添加到高亮批注' })).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('does not expose a write action during loading, failure, or without a save handler', async () => {
    const translation = deferred<string>();
    const onApply = vi.fn();
    const ui = render(view({ autoTranslate: true, onApply, onTranslate: vi.fn(() => translation.promise) }));
    expect(ui.getByText('正在翻译选中文字…')).toBeTruthy();
    expect(ui.queryByRole('button', { name: '添加到高亮批注' })).toBeNull();
    ui.unmount();
    const failed = render(view({ autoTranslate: true, onApply, onTranslate: vi.fn().mockRejectedValue(new Error('network')) }));
    await failed.findByRole('alert');
    expect(failed.queryByRole('button', { name: '添加到高亮批注' })).toBeNull();
    failed.unmount();
    const readOnly = render(view({ autoTranslate: true, onTranslate: vi.fn().mockResolvedValue('只读译文') }));
    await readOnly.findByText('只读译文');
    expect(readOnly.queryByRole('button', { name: '添加到高亮批注' })).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('disables saving retained translation when a pinned toolbar has no live selection', async () => {
    const props = { autoTranslate: true, onApply: vi.fn(), onTranslate: vi.fn().mockResolvedValue('固定的译文') };
    const ui = render(view(props));
    await ui.findByText('固定的译文');
    fireEvent.click(ui.getByRole('button', { name: '固定' }));
    ui.rerender(view({ ...props, pending: null }));
    const button = ui.getByRole('button', { name: '添加到高亮批注' });
    expect(button.hasAttribute('disabled')).toBe(true);
    fireEvent.click(button);
    expect(props.onApply).not.toHaveBeenCalled();
  });

  it('does not close a new occurrence of the same text when the previous save finishes', async () => {
    const save = deferred<void>();
    const props = { autoTranslate: true, onApply: vi.fn(() => save.promise), onClose: vi.fn(), onTranslate: vi.fn().mockResolvedValue('对应译文') };
    const ui = render(view(props));
    fireEvent.click(await ui.findByRole('button', { name: '添加到高亮批注' }));
    ui.rerender(view({ ...props, pending: { ...pending, selection: { ...pending.selection, rects: [[50, 60, 70, 80]] } } }));
    await ui.findByRole('button', { name: '添加到高亮批注' });
    await act(async () => save.resolve());
    expect(props.onClose).not.toHaveBeenCalled();
    expect(ui.getByRole('button', { name: '添加到高亮批注' }).hasAttribute('disabled')).toBe(false);
  });
});
