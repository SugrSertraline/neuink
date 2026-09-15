/** @vitest-environment jsdom */

import { act, cleanup, renderHook } from '@testing-library/react';
import { createElement, useState, type PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasUnsavedEntrySegmentEditors, hasUnsavedSegmentEditors, saveSegmentEditorsBeforeClose } from '../segmentEditorDirtyRegistry';

import { ToastContext } from '@/shared/hooks/useToast';
import type { SegmentBlockNote, SourceSegment } from '@/shared/types/domain';

import { useSegmentNoteDraft } from './useSegmentNoteDraft';
import { MAX_SEGMENT_NOTE_CHARACTERS } from './segmentNoteLimits';

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
  afterEach(cleanup);
  it('does not erase a shared draft edited in the other pane during a save', async () => {
    let finish!: (notes: []) => void;
    const onSaveSegmentNote = vi.fn(() => new Promise<[]>((resolve) => { finish = resolve; }));
    const onSharedDraftChange = vi.fn();
    const { result, rerender } = renderHook(({ sharedDrafts }) => useSegmentNoteDraft({ entryId: 'split-race', draftScopeKey: 'pdf:split-race', notesBySegmentUid: new Map(), onSaveSegmentNote, onSharedDraftChange, sharedDrafts }), { wrapper, initialProps: { sharedDrafts: { 'logical-segment': 'snapshot' } } });
    act(() => result.current.selectSegment(segment));
    let closing!: Promise<boolean>;
    act(() => { closing = saveSegmentEditorsBeforeClose('pdf:split-race'); });
    rerender({ sharedDrafts: { 'logical-segment': 'new text from the other pane' } });
    await act(async () => finish([]));
    expect(await closing).toBe(false);
    expect(result.current.noteText).toBe('new text from the other pane');
    expect(onSharedDraftChange).not.toHaveBeenCalledWith('logical-segment', null);
  });
  it.each(['newer text', ''])('protects real legacy-scoped drafts and retains pending edits (%j)', async (newText) => {
    let finish!: (notes: SegmentBlockNote[]) => void;
    const onSaveSegmentNote = vi.fn(() => new Promise<SegmentBlockNote[]>((resolve) => { finish = resolve; }));
    const onSharedDraftChange = vi.fn();
    const { result } = renderHook(() => {
      const [notes, setNotes] = useState<SegmentBlockNote[]>([]);
      return useSegmentNoteDraft({ entryId: 'race', draftScopeKey: 'entry-content:race|pdf', notesBySegmentUid: new Map(notes.map((note) => [note.segment_uid, note])), onSegmentNotesSaved: setNotes, onSaveSegmentNote, onSharedDraftChange });
    }, { wrapper });
    act(() => result.current.selectSegment(segment));
    act(() => result.current.updateNoteText('snapshot'));
    expect(hasUnsavedEntrySegmentEditors('race')).toBe(true);
    let closing!: Promise<boolean>;
    act(() => { closing = saveSegmentEditorsBeforeClose('pdf:race'); });
    act(() => result.current.updateNoteText(newText));
    expect(hasUnsavedSegmentEditors('pdf:race')).toBe(true);
    await act(async () => finish([{ segment_uid: 'logical-segment', text: 'snapshot', created_at: '', updated_at: '' }]));
    expect(await closing).toBe(false);
    expect(result.current.noteText).toBe(newText);
    expect(result.current.noteDirty).toBe(true);
    expect(hasUnsavedSegmentEditors('pdf:race')).toBe(true);
    expect(onSharedDraftChange).not.toHaveBeenCalledWith('logical-segment', null);
    expect(onSaveSegmentNote).toHaveBeenCalledWith('race', 'logical-segment', 'snapshot');
  });
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

  it('does not call the save callback when the Markdown text is over the limit', async () => {
    const onSaveSegmentNote = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(
      () => useSegmentNoteDraft({
        entryId: 'entry-1',
        notesBySegmentUid: new Map(),
        onSaveSegmentNote
      }),
      { wrapper }
    );

    act(() => result.current.selectSegment(segment));
    act(() => result.current.updateNoteText('x'.repeat(MAX_SEGMENT_NOTE_CHARACTERS + 1)));

    await act(async () => {
      await result.current.saveNote();
    });

    expect(onSaveSegmentNote).not.toHaveBeenCalled();
  });

  it('allows formatted Markdown when visible text is within the limit', async () => {
    const onSaveSegmentNote = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(
      () => useSegmentNoteDraft({
        entryId: 'entry-1',
        notesBySegmentUid: new Map(),
        onSaveSegmentNote
      }),
      { wrapper }
    );

    act(() => result.current.selectSegment(segment));
    act(() =>
      result.current.updateNoteText(
        `<span style="color: #da1e28">${'x'.repeat(MAX_SEGMENT_NOTE_CHARACTERS)}</span>`
      )
    );

    await act(async () => {
      await result.current.saveNote();
    });

    expect(onSaveSegmentNote).toHaveBeenCalled();
  });
});
