/** @vitest-environment jsdom */

import { act, renderHook } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ToastContext } from '@/shared/hooks/useToast';
import type { SourceSegment } from '@/shared/types/domain';

import { useSegmentNoteDraft } from './useSegmentNoteDraft';

const segment: SourceSegment = {
  bbox: [100, 100, 900, 300],
  continuation_group_id: 'logical-segment',
  markdown: 'Source text',
  page_idx: 2,
  segment_type: 'paragraph',
  text: 'Source text',
  uid: 'real-segment'
};

function wrapper({ children }: PropsWithChildren) {
  return createElement(
    ToastContext.Provider,
    { value: { dismiss: vi.fn(), notify: vi.fn(() => 'toast') } },
    children
  );
}

describe('useSegmentNoteDraft', () => {
  it('shares live drafts and persists continuation notes with their logical uid', async () => {
    const onSaveSegmentNote = vi.fn().mockResolvedValue([]);
    const onSharedDraftChange = vi.fn();
    const { result } = renderHook(
      () => useSegmentNoteDraft({
        entryId: 'entry-1',
        notesBySegmentUid: new Map(),
        onSaveSegmentNote,
        onSharedDraftChange,
        sharedDrafts: { 'logical-segment': 'Draft from split view' }
      }),
      { wrapper }
    );

    act(() => result.current.selectSegment(segment));
    expect(result.current.noteText).toBe('Draft from split view');

    act(() => result.current.updateNoteText('Edited in floating panel'));
    expect(onSharedDraftChange).toHaveBeenLastCalledWith(
      'logical-segment',
      'Edited in floating panel'
    );

    await act(async () => {
      await result.current.saveNote();
    });
    expect(onSaveSegmentNote).toHaveBeenCalledWith(
      'entry-1',
      'logical-segment',
      'Edited in floating panel'
    );
    expect(onSharedDraftChange).toHaveBeenLastCalledWith('logical-segment', null);
  });

  it('never auto-saves and blocks switching away from a dirty segment', async () => {
    vi.useFakeTimers();
    const onSaveSegmentNote = vi.fn().mockResolvedValue([]);
    const secondSegment = { ...segment, continuation_group_id: null, uid: 'second-segment' };
    const { result } = renderHook(
      () => useSegmentNoteDraft({
        entryId: 'entry-1',
        notesBySegmentUid: new Map(),
        onSaveSegmentNote
      }),
      { wrapper }
    );

    act(() => result.current.selectSegment(segment));
    act(() => result.current.updateNoteText('Unsaved draft'));
    await act(async () => vi.advanceTimersByTimeAsync(5000));

    expect(onSaveSegmentNote).not.toHaveBeenCalled();
    act(() => result.current.selectSegment(secondSegment));
    expect(result.current.selectedSegment?.uid).toBe('real-segment');
    expect(result.current.noteText).toBe('Unsaved draft');
    vi.useRealTimers();
  });
});
