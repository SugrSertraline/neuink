import { describe, expect, it } from 'vitest';
import type { AssistantContext, AssistantSegmentContextItem } from '@/shared/types/assistant';
import { observeWorkspaceContext, scopeContextRef } from './observation';

const scope = { entry_ids: ['paper'], entry_titles: ['Paper'], tag_ids: [], tag_names: [] };
const selection: AssistantSegmentContextItem = { id: 'ui-id', kind: 'segment', entryId: 'paper', entryTitle: 'Paper',
  segmentUid: 'segment', pageIdx: 0, text: 'FROZEN_BODY_SENTINEL', addedAt: 'then' };

describe('workspace observations', () => {
  it('sends selection references without copying bodies or UI timestamps', async () => {
    const first = await observeWorkspaceContext({ scope, assistantContext: { items: [selection] } });
    const again = await observeWorkspaceContext({ scope, assistantContext: { items: [{ ...selection, id: 'other-ui-id', addedAt: 'now' }] } });
    expect(first).toEqual(again);
    expect(JSON.stringify(first)).not.toContain('FROZEN_BODY_SENTINEL');
    expect(first.pinned_segments[0].context_ref).toContain('selection:paper:segment:');
    const changed = await observeWorkspaceContext({ scope, assistantContext: { items: [{ ...selection, text: 'New content' }] } });
    expect(changed.pinned_segments[0].revision).not.toBe(first.pinned_segments[0].revision);
  });

  it('keeps explicit references distinct from the active paper and preserves clearing', async () => {
    const assistantContext: AssistantContext = { items: [{ id: 'note', addedAt: '', kind: 'entry', entryId: 'other',
      entryTitle: 'Other', contentKind: 'note', contentId: 'n', contentTitle: 'Notes' }] };
    const observed = await observeWorkspaceContext({ scope, assistantContext, currentEntry: { id: 'paper', title: 'Paper' },
      currentNote: { entryId: 'other', entryTitle: 'Other', noteId: 'n', noteTitle: 'Notes' } });
    expect(observed.active_entry?.id).toBe('paper');
    expect(observed.references[0]).toMatchObject({ entry_id: 'other', content_id: 'n' });
    const cleared = await observeWorkspaceContext({ scope });
    expect(cleared.active_note).toBeNull();
    expect(cleared.references).toEqual([]);
  });

  it('tracks browser navigation identity without leaking URL query credentials', async () => {
    const input = { scope, browserTabTarget: { id: 'tab', url: 'https://example.org/paper?token=private', title: 'Page', navigationId: 'one' } };
    const first = await observeWorkspaceContext(input);
    expect(first.browser?.url).toBe('https://example.org/paper');
    expect(JSON.stringify(first)).not.toContain('private');
    expect(await observeWorkspaceContext({ ...input, browserTabTarget: { ...input.browserTabTarget, navigationId: 'two' } })).not.toEqual(first);
  });

  it('uses metadata revisions to detect edits without including bodies', async () => {
    const input = { scope, contextSnapshot: { metadata_only: true, active_entry: { entry_id: 'paper', entry_title: 'Paper',
      has_pdf: true, parse_status: null, revision: 'v1' }, active_note: null, document: null, pinned_segments: [], warnings: [] } };
    const first = await observeWorkspaceContext(input);
    expect(first.active_entry?.revision).toBe('v1');
    expect(await observeWorkspaceContext({ ...input, contextSnapshot: { ...input.contextSnapshot,
      active_entry: { ...input.contextSnapshot.active_entry, revision: 'v2' } } })).not.toEqual(first);
    expect((await observeWorkspaceContext({ ...input, currentEntry: { id: 'other', title: 'Other' } })).active_entry?.revision).toBeUndefined();
  });

  it('keeps large library and tag catalogs behind frozen references', async () => {
    const large = { entry_ids:Array.from({length:1000},(_,i)=>`paper-${i}`),
      entry_titles:Array.from({length:1000},(_,i)=>`Paper ${i}`),tag_ids:['tag'],tag_names:['Tag'] };
    const state = await observeWorkspaceContext({scope:large, tagMentionScopes:{tag:large},
      composerSnapshot:{text:'Read [C1]',mentions:[{kind:'tag',id:'tag',marker:'[C1]',label:'Tag',
        tagId:'tag',tagName:'Tag',entryId:'',entryTitle:'',charOffset:5}]}});
    expect(JSON.stringify(state).length).toBeLessThan(1000);
    expect(state.scope).toMatchObject({entries:[],entry_count:1000,context_ref:await scopeContextRef(large)});
    expect(state.references[0]).toMatchObject({entry_count:1000,scope_ref:state.scope.context_ref});
    expect(state.references[0].entry_ids).toBeUndefined();
    const changed = await observeWorkspaceContext({scope:{...large,entry_titles:large.entry_titles.map((v,i)=>i===900?'Changed':v)}});
    expect(changed.scope.context_ref).not.toBe(state.scope.context_ref);
  });
});
