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
