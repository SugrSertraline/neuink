import { describe, expect, it } from 'vitest';

import type { AssistantContext } from '@/shared/types/assistant';

import { observeAssistantContext } from './context';

describe('observeAssistantContext', () => {
  it('uses the active PDF Entry when no explicit context is selected', () => {
    const observed = observeAssistantContext({
      fallbackEntryId: 'paper-entry'
    });

    expect(observed.activeEntryId).toBe('paper-entry');
  });

  it('does not hydrate a selected Markdown reference as the edit target', () => {
    const assistantContext: AssistantContext = {
      items: [
        {
          addedAt: '2026-07-13T00:00:00.000Z',
          contentId: 'note-2',
          contentKind: 'note',
          contentTitle: '实验笔记',
          entryId: 'paper-entry',
          entryTitle: 'Paper',
          id: 'entry:paper-entry:note:note-2',
          kind: 'entry'
        }
      ]
    };

    const observed = observeAssistantContext({
      assistantContext,
      fallbackEntryId: 'other-entry',
      fallbackNote: { entryId: 'other-entry', noteId: 'note-1' }
    });

    expect(observed.activeEntryId).toBe('paper-entry');
    expect(observed.activeNote).toBeNull();
  });

  it('hydrates a Markdown only when the context plan marks it as the edit target', () => {
    const item = {
      addedAt: '', contentId: 'note-2', contentKind: 'note' as const,
      contentTitle: '实验笔记', entryId: 'paper-entry', entryTitle: 'Paper',
      id: 'entry:paper-entry:note:note-2', kind: 'entry' as const
    };
    const observed = observeAssistantContext({
      assistantContext: { items: [item] },
      contextPlan: {
        editTarget: { attachmentId: item.id, targetKind: 'markdown_note' },
        items: [{
          attachmentId: item.id, contentId: item.contentId, entryId: item.entryId,
          entryTitle: item.entryTitle, hydration: 'full_if_budget', kind: 'note',
          reason: 'Explicit target', role: 'edit_target'
        }],
        summary: 'one target'
      }
    });

    expect(observed.activeNote).toEqual({ entryId: 'paper-entry', noteId: 'note-2' });
  });

  it('does not fall back to the open note when multiple Markdown notes are selected', () => {
    const assistantContext: AssistantContext = {
      items: ['note-1', 'note-2'].map((noteId) => ({
        addedAt: '', contentId: noteId, contentKind: 'note' as const,
        contentTitle: noteId, entryId: 'paper-entry', entryTitle: 'Paper',
        id: `entry:paper-entry:note:${noteId}`, kind: 'entry' as const
      }))
    };

    const observed = observeAssistantContext({
      assistantContext,
      fallbackNote: { entryId: 'paper-entry', noteId: 'open-note' }
    });

    expect(observed.activeNote).toBeNull();
  });

  it('uses a pinned Segment Entry as the active Entry when it is the only context', () => {
    const observed = observeAssistantContext({
      assistantContext: {
        items: [{
          addedAt: '', entryId: 'segment-entry', entryTitle: 'Paper',
          id: 'segment:segment-entry:segment-1', kind: 'segment', pageIdx: 0,
          segmentUid: 'segment-1', text: 'Evidence'
        }]
      },
      fallbackEntryId: 'other-entry'
    });

    expect(observed.activeEntryId).toBe('segment-entry');
  });
});
