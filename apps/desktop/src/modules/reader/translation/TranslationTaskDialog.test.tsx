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
      expect(preview?.className).toContain('z-[var(--z-dialog-popover)]');
      expect(preview?.textContent).toContain('Preview source text');
    });
  });

  it('shows every content type and submits only the enabled types', async () => {
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
      expect(getByRole('button', { name: '翻译选中（2）' })).toBeTruthy();
    });
    expect(getByRole('button', { name: '公式 0' }).hasAttribute('disabled')).toBe(true);

    fireEvent.click(getByRole('button', { name: '段落 1' }));
    fireEvent.click(getByRole('button', { name: '翻译选中（1）' }));

    expect(onTranslate).toHaveBeenCalledWith([heading], 'pending');
  });

  it('treats legacy skipped blocks as pending and keeps the pending list visible', async () => {
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

    expect(getByText('第 1 页 · 页眉')).toBeTruthy();
    expect(getByText('待翻译')).toBeTruthy();
  });

  it('shows the active batch message and scoped job progress', () => {
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

    expect(getByText('翻译批次 1/3 · 2/5')).toBeTruthy();
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
