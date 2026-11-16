import { describe, expect, it } from 'vitest';
import type { ScopeSnapshot } from '@/shared/ipc/assistantApi';
import { frozenScopeFromSnapshot, resolveSearchScope, type LibraryEntryRef } from '../sdk/searchScope';
import { retrievalRunScope } from './assistantScope';

/**
 * Host run path for `search_library`: the run's explicit scope is built by `retrievalRunScope`,
 * frozen from the snapshot, then resolved against the library. These cases reproduce the scope
 * widening reported in review.
 */

const library: LibraryEntryRef[] = [
  { id: 'A', title: 'Paper A' },
  { id: 'B', title: 'Paper B' },
  { id: 'X', title: 'Paper X' }
];

const libraryScope: ScopeSnapshot = { tag_ids: [], tag_names: [], entry_ids: [], entry_titles: [], scope_intent: 'library' };
const emptyMentions: ScopeSnapshot = { tag_ids: [], tag_names: [], entry_ids: [], entry_titles: [] };

function retrieve({
  contextIds = [],
  currentScope,
  mentionScope = emptyMentions
}: {
  contextIds?: string[];
  currentScope: ScopeSnapshot;
  mentionScope?: ScopeSnapshot;
}) {
  const runScope = retrievalRunScope({
    contextItems: contextIds.map((id) => ({ entryId: id, entryTitle: `Paper ${id}` })),
    currentScope,
    mentionScope
  });
  return resolveSearchScope({ kind: 'unspecified' }, frozenScopeFromSnapshot(runScope), library);
}

describe('search_library host run scope', () => {
  it('narrows a global current scope to an explicitly attached paper', () => {
    const resolved = retrieve({ contextIds: ['X'], currentScope: libraryScope });
    expect(resolved).toEqual({ status: 'resolved', scope_kind: 'explicit_single', entry_ids: ['X'] });
  });

  it('keeps a persisted global conversation with a current empty Tag empty', () => {
    // Conversation history never reaches retrieval, so only the current empty Tag selection counts.
    const emptyTag: ScopeSnapshot = { tag_ids: ['tag-empty'], tag_names: ['Empty'], entry_ids: [], entry_titles: [], scope_intent: 'selection' };
    expect(retrieve({ currentScope: emptyTag })).toEqual({ status: 'empty', scope_kind: 'explicit_tag' });
  });

  it('does not let an explicit empty Tag become another paper set through an attachment', () => {
    const emptyTag: ScopeSnapshot = { tag_ids: ['tag-empty'], tag_names: ['Empty'], entry_ids: [], entry_titles: [], scope_intent: 'selection' };
    expect(retrieve({ contextIds: ['X'], currentScope: emptyTag })).toEqual({ status: 'empty', scope_kind: 'explicit_tag' });
  });

  it('searches only the current selection A when a historical B exists', () => {
    const currentA: ScopeSnapshot = { tag_ids: [], tag_names: [], entry_ids: ['A'], entry_titles: ['Paper A'], scope_intent: 'selection' };
    expect(retrieve({ currentScope: currentA })).toEqual({ status: 'resolved', scope_kind: 'explicit_single', entry_ids: ['A'] });
  });

  it('keeps an explicit current Tag as explicit_tag output', () => {
    const tag: ScopeSnapshot = { tag_ids: ['tag-1'], tag_names: ['Tag 1'], entry_ids: ['A', 'B'], entry_titles: ['Paper A', 'Paper B'], scope_intent: 'selection' };
    expect(retrieve({ currentScope: tag })).toEqual({ status: 'resolved', scope_kind: 'explicit_tag', entry_ids: ['A', 'B'] });
  });

  it('reads an absent intent with a non-empty tag_ids and empty entry_ids as an empty tag, not the library', () => {
    // A snapshot written before scope_intent existed: no intent field at all.
    const legacyEmptyTag: ScopeSnapshot = { tag_ids: ['tag-old'], tag_names: ['Old'], entry_ids: [], entry_titles: [] };
    expect(resolveSearchScope({ kind: 'unspecified' }, frozenScopeFromSnapshot(legacyEmptyTag), library))
      .toEqual({ status: 'empty', scope_kind: 'explicit_tag' });
  });

  it('keeps a whole-library run whole when nothing explicit is present', () => {
    expect(retrieve({ currentScope: libraryScope, mentionScope: emptyMentions })).toEqual({ status: 'library' });
  });

  it('stops for clarification when a mention or tag is unresolved', () => {
    const unresolved: ScopeSnapshot = { tag_ids: [], tag_names: [], entry_ids: [], entry_titles: [], scope_intent: 'unresolved' };
    expect(retrieve({ contextIds: ['A'], currentScope: libraryScope, mentionScope: unresolved })).toEqual({ status: 'unresolved' });
  });

  it('never returns a paper outside the current library for an attached entry', () => {
    const resolved = retrieve({ contextIds: ['gone'], currentScope: libraryScope });
    expect(resolved.status).toBe('invalid');
    expect(resolved).toMatchObject({ message: expect.stringContaining('不在当前资料库中') });
  });
});
