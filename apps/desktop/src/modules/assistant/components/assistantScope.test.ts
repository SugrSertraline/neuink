import { describe, expect, it } from 'vitest';

import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';

import {
  assistantRunBaseScope,
  buildAssistantScope,
  buildConversationMentionScope,
  buildTagMentionScopes,
  mergeScopeWithContextEntries
} from './assistantScope';

describe('buildAssistantScope', () => {
  it('uses an inline Tag as a search scope without creating document attachments', () => {
    const scope = buildAssistantScope({
      activeEntry: entry('outside', []),
      activeTag: null,
      entries: [entry('paper-a', ['methods']), entry('paper-b', ['child']), entry('outside', [])],
      selectedTagIds: ['methods'],
      tags: [
        tag('methods', 'Methods'),
        tag('child', 'Qualitative', 'methods')
      ]
    });

    expect(scope.tag_ids).toEqual(['methods', 'child']);
    expect(scope.entry_ids).toEqual(['paper-a', 'paper-b']);
    expect(scope.entry_ids).not.toContain('outside');
  });
});

describe('buildTagMentionScopes', () => {
  it('keeps each inline Tag marker mapped to its own Entry set', () => {
    const result = buildTagMentionScopes({
      entries: [entry('paper-a', ['tag-a']), entry('paper-b', ['tag-b'])],
      tagIds: ['tag-a', 'tag-b'],
      tags: [tag('tag-a', 'A'), tag('tag-b', 'B')]
    });
    expect(result['tag-a'].entry_ids).toEqual(['paper-a']);
    expect(result['tag-b'].entry_ids).toEqual(['paper-b']);
  });
});

describe('buildConversationMentionScope', () => {
  it('does not widen a new Tag conversation to the whole library', () => {
    const result = buildConversationMentionScope({ entries: [entry('outside', [])], messages: [], tags: [] });
    expect(result.entry_ids).toEqual([]);
    expect(result.tag_ids).toEqual([]);
  });

  it('adds only explicitly mentioned notes when history contains no Tag', () => {
    const result = buildConversationMentionScope({
      entries: [entry('destination', []), entry('outside', [])], tags: [],
      messages: [{ message_id: 'user', role: 'user', content: '追加到 [C1]', created_at: '', source_links: [],
        parts: [{ type: 'context-snapshot', items: [], composer: { text: '追加到 [C1]', mentions: [{
          charOffset: 4, entryId: 'destination', entryTitle: '目标笔记', id: 'note', kind: 'note',
          contentId: 'note', label: '目标笔记', marker: '[C1]'
        }] } }] }]
    });
    expect(result.entry_ids).toEqual(['destination']);
  });

  it('reconstructs Tag papers and the destination Entry after restart', () => {
    const result = buildConversationMentionScope({
      entries: [entry('paper-a', ['se']), entry('study-notes', [])],
      messages: [{
        content: '阅读 [C1]，整理到 [C2]', created_at: '', message_id: 'user-1', role: 'user',
        source_links: [], parts: [{
          composer: {
            mentions: [
              {
                charOffset: 3, entryId: '', entryTitle: '', id: 'tag:se', kind: 'tag',
                label: '软件工程', marker: '[C1]', tagId: 'se', tagName: '软件工程'
              },
              {
                charOffset: 12, entryId: 'study-notes', entryTitle: '软件工程论文学习',
                id: 'entry:study-notes', kind: 'entry', label: '软件工程论文学习', marker: '[C2]'
              }
            ],
            text: '阅读 [C1]，整理到 [C2]'
          },
          items: [],
          type: 'context-snapshot'
        }]
      }],
      tags: [tag('se', '软件工程')]
    });

    expect(result.entry_ids).toEqual(['paper-a', 'study-notes']);
    expect(result.tag_ids).toEqual(['se']);
  });
});

describe('assistantRunBaseScope', () => {
  it('preserves the original Tag scope while a clarification is being resumed', () => {
    const currentScope = scope([], []);
    const conversationScope = scope(['tag-methods'], ['paper-a', 'paper-b']);

    expect(
      assistantRunBaseScope({ currentScope, conversationScope })
    ).toEqual(conversationScope);
  });

  it('preserves conversation scope after a completed turn without magic resume parsing', () => {
    const currentScope = scope([], ['study-notes']);
    const conversationScope = scope(['tag-software'], ['paper-a', 'paper-b', 'study-notes']);

    expect(assistantRunBaseScope({
      currentScope,
      conversationScope
    })).toMatchObject({
      entry_ids: ['paper-a', 'paper-b', 'study-notes'],
      tag_ids: ['tag-software']
    });
  });
});

describe('mergeScopeWithContextEntries', () => {
  it('keeps Tag papers readable and adds an explicit Entry note destination', () => {
    expect(mergeScopeWithContextEntries(
      scope(['software-engineering'], ['paper-a', 'paper-b']),
      { items: [{
        addedAt: '', entryId: 'study-notes', entryTitle: '软件工程论文学习',
        id: 'entry:study-notes', kind: 'entry'
      }] }
    )).toMatchObject({
      entry_ids: ['paper-a', 'paper-b', 'study-notes'],
      entry_titles: ['paper-a', 'paper-b', '软件工程论文学习']
    });
  });
});

describe('scope intent', () => {
  it('marks a run with no selection as library intent, while keeping entry ids for legacy readers', () => {
    const result = buildAssistantScope({
      activeEntry: null, activeTag: null, selectedTagIds: [], tags: [],
      entries: [entry('paper-a', []), entry('paper-b', [])]
    });
    expect(result.scope_intent).toBe('library');
    expect(result.entry_ids).toEqual(['paper-a', 'paper-b']);
  });

  it('marks an explicit empty Tag as selection with no entries, not library', () => {
    const result = buildAssistantScope({
      activeEntry: null, activeTag: null, selectedTagIds: ['empty'], tags: [tag('empty', 'Empty')],
      entries: [entry('paper-a', ['other'])]
    });
    expect(result).toMatchObject({ scope_intent: 'selection', entry_ids: [] });
  });

  it('marks a Tag that no longer exists as unresolved', () => {
    const result = buildAssistantScope({
      activeEntry: null, activeTag: null, selectedTagIds: ['gone'], tags: [],
      entries: [entry('paper-a', [])]
    });
    expect(result.scope_intent).toBe('unresolved');
  });

  it('marks a mention of a deleted Entry as unresolved and keeps the existing mentions', () => {
    const result = buildConversationMentionScope({
      entries: [entry('destination', [])], tags: [],
      messages: [{ message_id: 'user', role: 'user', content: 'x', created_at: '', source_links: [],
        parts: [{ type: 'context-snapshot', items: [], composer: { text: 'x', mentions: [{
          charOffset: 0, entryId: 'deleted', entryTitle: 'Deleted', id: 'entry:deleted', kind: 'entry', label: 'Deleted', marker: '[C1]'
        }] } }] }]
    });
    expect(result.scope_intent).toBe('unresolved');
    expect(result.entry_ids).toEqual([]);
  });

  it('never widens a selection when merged with a library scope, and never widens an unresolved one', () => {
    const selected = { ...scope([], ['paper-a']), scope_intent: 'selection' as const };
    const library = { ...scope([], ['paper-a', 'paper-b']), scope_intent: 'library' as const };
    const unresolved = { ...scope([], []), scope_intent: 'unresolved' as const };
    expect(mergeScopeWithContextEntries(selected, { items: [] })).toEqual(selected);
    expect(assistantRunBaseScope({ currentScope: library, conversationScope: selected }).scope_intent).toBe('library');
    expect(assistantRunBaseScope({ currentScope: unresolved, conversationScope: selected }).scope_intent).toBe('unresolved');
  });

  it('narrows a legacy unscoped run to attached composer papers', () => {
    const result = mergeScopeWithContextEntries(
      { ...scope([], []) },
      { items: [{ addedAt: '', entryId: 'paper-a', entryTitle: 'A', id: 'entry:paper-a', kind: 'entry' }] }
    );
    expect(result).toMatchObject({ entry_ids: ['paper-a'], scope_intent: 'selection' });
  });
});

function scope(tag_ids: string[], entry_ids: string[]) {
  return { entry_ids, entry_titles: entry_ids, tag_ids, tag_names: tag_ids };
}

function entry(id: string, tagIds: string[]) {
  return {
    contents: [],
    id,
    pdfFileName: null,
    status: 'Parsed',
    tagIds,
    tags: [],
    title: id
  } as unknown as LibraryEntry;
}

function tag(id: string, name: string, parent_id: string | null = null) {
  return { created_at: '', id, name, parent_id, updated_at: '' };
}
