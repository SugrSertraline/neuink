// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { EntryTranslation } from '@/shared/ipc/workspaceApi';
import type { SourceSegment } from '@/shared/types/domain';

import { TranslationTaskDialog } from './TranslationTaskDialog';

class TestPointerEvent extends MouseEvent {
  pointerId: number;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}

beforeAll(() => {
  Object.defineProperty(window, 'PointerEvent', {
    configurable: true,
    value: TestPointerEvent
  });
  Object.defineProperty(globalThis, 'PointerEvent', {
    configurable: true,
    value: TestPointerEvent
  });
});

afterEach(cleanup);

describe('TranslationTaskDialog', () => {
  it('offers pause/cancel and keeps stopping feedback above progress updates', () => {
    const onPause = vi.fn();
    const onCancel = vi.fn();
    const props = { open: true, busy: true, segments: [segment], translation: null, onOpenChange: vi.fn(), onTranslate: vi.fn(), onPause, onCancel };
    const view = render(<TranslationTaskDialog {...props} />);
    fireEvent.click(view.getByRole('button', { name: '暂停翻译' }));
    fireEvent.click(view.getByRole('button', { name: '取消翻译' }));
    expect(onPause).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
    view.rerender(<TranslationTaskDialog {...props} stopPending="cancel" message="正在翻译 · 已接收 123 字" />);
    expect(view.getByRole('button', { name: '暂停翻译' })).toHaveProperty('disabled', true);
    expect(view.getByRole('button', { name: '取消翻译' })).toHaveProperty('disabled', true);
    expect(view.getByText(/正在取消翻译/)).toBeTruthy();
    expect(view.queryByText(/已接收 123/)).toBeNull();
  });

  it.each(['paused', 'canceled'] as const)('allows a new selection when %s has no saved task', (status) => {
    const translation = { ...translationWithSkippedSegment(segment), status, segments: [] };
    const view = render(<TranslationTaskDialog open segments={[segment]} translation={translation} onOpenChange={vi.fn()} onTranslate={vi.fn()} />);
    expect(view.getByText(status === 'paused' ? /已暂停：/ : /已取消：/)).toBeTruthy();
    fireEvent.click(view.getByRole('checkbox', { name: '选择第 1 页 段落' }));
    expect(view.getByRole('button', { name: '翻译选中（1）' })).toHaveProperty('disabled', false);
    expect(view.queryByRole('button', { name: '取消翻译' })).toBeNull();
  });
  it('keeps the paused selection locked and offers resume/cancel; cancellation clears task selection', () => {
    const onResume = vi.fn();
    const onCancel = vi.fn();
    const props = { open: true, segments: [segment], onOpenChange: vi.fn(), onTranslate: vi.fn(), onResume, onCancel };
    const saved: EntryTranslation = { ...translationWithSkippedSegment(segment), status: 'paused', segments: [],
      task: { job_id: 'j1', profile_id: 'm1', force: true, source_hashes: { [segment.uid]: 'hash' }, remaining_segment_uids: [segment.uid], created_at: '' } };
    const view = render(<TranslationTaskDialog {...props} translation={saved} />);
    expect(view.getByRole('checkbox', { name: '选择第 1 页 段落' })).toHaveProperty('disabled', true);
    expect(view.getByRole('button', { name: '翻译选中（1）' })).toHaveProperty('disabled', true);
    fireEvent.click(view.getByRole('button', { name: '继续翻译' }));
    expect(onResume).toHaveBeenCalledOnce();
    view.rerender(<TranslationTaskDialog {...props} translation={saved} stopPending="resume" />);
    expect(view.getByRole('button', { name: '继续翻译' })).toHaveProperty('disabled', true);
    expect(view.getByRole('button', { name: '取消翻译' })).toHaveProperty('disabled', true);
    view.rerender(<TranslationTaskDialog {...props} translation={saved} />);
    fireEvent.click(view.getByRole('button', { name: '取消翻译' }));
    expect(onCancel).toHaveBeenCalledOnce();
    view.rerender(<TranslationTaskDialog {...props} translation={{ ...saved, status: 'canceled', task: null }} />);
    expect(view.queryByRole('button', { name: '继续翻译' })).toBeNull();
    expect(view.queryByRole('button', { name: '取消翻译' })).toBeNull();
    expect(view.getByRole('button', { name: '翻译选中（0）' })).toBeTruthy();
    expect(view.getByRole('checkbox', { name: '选择第 1 页 段落' })).toHaveProperty('disabled', false);
  });
  it('renders source previews above the dialog layer', async () => {
    const { getByRole } = render(
      <TranslationTaskDialog
        open
        segments={[segment]}
        translation={null}
        onOpenChange={vi.fn()}
        onTranslate={vi.fn()}
      />
    );

    fireEvent.pointerEnter(getByRole('button', { name: '查看原文' }));

    await waitFor(() => {
      const preview = document.querySelector<HTMLElement>(
        '[data-slot="hover-card-content"]'
      );
      expect(preview).not.toBeNull();
      expect(preview?.closest('[data-slot="overlay-viewport"]')?.className).toContain('z-[var(--z-dialog-popover)]');
      expect(preview?.textContent).toContain('Preview source text');
    });
  });

  it('starts empty and lets the user select individual blocks', async () => {
    const onTranslate = vi.fn().mockResolvedValue(undefined);
    const heading = sourceSegment('heading-1', 'heading', 'A heading');
    const paragraph = sourceSegment('paragraph-1', 'paragraph', 'A paragraph');
    const { getByRole } = render(
      <TranslationTaskDialog
        open
        segments={[heading, paragraph]}
        translation={null}
        onOpenChange={vi.fn()}
        onTranslate={onTranslate}
      />
    );

    await waitFor(() => {
      expect(getByRole('button', { name: '翻译选中（0）' })).toBeTruthy();
    });
    expect(getByRole('button', { name: '公式 0' }).hasAttribute('disabled')).toBe(true);

    const checkboxes = getByRole('dialog').querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(Array.from(checkboxes).every((checkbox) => !checkbox.checked)).toBe(true);
    fireEvent.click(getByRole('checkbox', { name: '选择第 1 页 段落' }));
    fireEvent.click(getByRole('button', { name: '翻译选中（1）' }));

    expect(onTranslate).toHaveBeenCalledWith([paragraph], 'pending');
  });

  it('does not auto-select a whole type when it is shown again', async () => {
    const paragraph = sourceSegment('paragraph-1', 'paragraph', 'A paragraph');
    const { getByRole } = render(
      <TranslationTaskDialog
        open
        segments={[paragraph]}
        translation={null}
        onOpenChange={vi.fn()}
        onTranslate={vi.fn()}
      />
    );

    await waitFor(() => expect(getByRole('button', { name: '翻译选中（0）' })).toBeTruthy());
    fireEvent.click(getByRole('button', { name: '段落 1' }));
    fireEvent.click(getByRole('button', { name: '段落 1' }));

    expect(getByRole('button', { name: '翻译选中（0）' })).toBeTruthy();
    expect(getByRole('checkbox', { name: '选择第 1 页 段落' })).toHaveProperty('checked', false);
  });

  it('keeps skipped blocks visible without making them retryable', async () => {
    const skipped = sourceSegment('skipped-1', 'page_header', 'Conference header');
    const { getByRole, getByText } = render(
      <TranslationTaskDialog
        open
        segments={[skipped]}
        translation={translationWithSkippedSegment(skipped)}
        onOpenChange={vi.fn()}
        onTranslate={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(getByRole('button', { name: '待翻译 1' })).toBeTruthy();
    });
    fireEvent.click(getByRole('button', { name: '待翻译 1' }));

    expect(getByText('第 1 页')).toBeTruthy();
    expect(getByText('页眉')).toBeTruthy();
    expect(getByText('已跳过')).toBeTruthy();
    expect(getByRole('checkbox', { name: '选择第 1 页 页眉' })).toHaveProperty('disabled', true);
  });

  it('locks row selection while a translation task is running', async () => {
    const { getByRole } = render(
      <TranslationTaskDialog
        busy
        open
        progress={{ current: 1, percent: 50, total: 2 }}
        segments={[segment, sourceSegment('paragraph-2', 'paragraph', 'Second paragraph')]}
        translation={null}
        onOpenChange={vi.fn()}
        onTranslate={vi.fn()}
      />
    );

    await waitFor(() => {
      const checkboxes = Array.from(getByRole('dialog').querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
      expect(checkboxes.length).toBe(3);
      expect(checkboxes.every((checkbox) => checkbox.disabled)).toBe(true);
    });
  });

  it('shows stable translation action and scoped job progress', () => {
    const { getByText } = render(
      <TranslationTaskDialog
        busy
        message="翻译批次 1/3"
        open
        progress={{ current: 2, percent: 40, total: 5 }}
        segments={[segment]}
        translation={null}
        onOpenChange={vi.fn()}
        onTranslate={vi.fn()}
      />
    );

    expect(getByText('正在翻译 · 2/5')).toBeTruthy();
  });

  it('hides persistent low-level errors and keeps failed blocks retryable', () => {
    const rawError = '翻译模型调用失败，已停止全部任务：LLM did not return a JSON object';
    const failedTranslation: EntryTranslation = {
      ...translationWithSkippedSegment(segment),
      error: rawError,
      progress: { failed: 1, skipped: 0, total: 1, translated: 0 },
      status: 'failed',
      segments: [{
        ...translationWithSkippedSegment(segment).segments[0],
        error: rawError,
        status: 'failed'
      }]
    };
    const { getByText, queryByText } = render(
      <TranslationTaskDialog
        open
        segments={[segment]}
        translation={failedTranslation}
        onOpenChange={vi.fn()}
        onTranslate={vi.fn()}
      />
    );

    expect(queryByText(rawError)).toBeNull();
    expect(getByText('翻译失败，可重试')).toBeTruthy();
  });
});

const segment: SourceSegment = {
  bbox: [100, 100, 900, 300],
  markdown: null,
  page_idx: 0,
  segment_type: 'paragraph',
  text: 'Preview source text',
  uid: 'segment-preview'
};

function sourceSegment(
  uid: string,
  segmentType: SourceSegment['segment_type'],
  text: string,
): SourceSegment {
  return {
    bbox: [100, 100, 900, 300],
    markdown: null,
    page_idx: 0,
    segment_type: segmentType,
    text,
    uid,
  };
}

function translationWithSkippedSegment(source: SourceSegment): EntryTranslation {
  return {
    created_at: '2026-07-17T00:00:00Z',
    entry_id: 'entry-1',
    error: null,
    model: 'test-model',
    paper_context: null,
    progress: { failed: 0, skipped: 1, total: 1, translated: 0 },
    schema_version: 1,
    segments: [{
      error: null,
      page_idx: source.page_idx,
      segment_type: source.segment_type,
      segment_uid: source.uid,
      source_hash: 'hash',
      source_text: source.text,
      status: 'skipped',
      translated_text: null,
      updated_at: '2026-07-17T00:00:00Z',
    }],
    source_language: 'en',
    status: 'partial',
    target_language: 'zh-CN',
    updated_at: '2026-07-17T00:00:00Z',
  };
}
