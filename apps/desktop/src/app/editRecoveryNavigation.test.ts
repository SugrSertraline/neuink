import { expect, it } from 'vitest';
import { recoverySurface, unsavedSurface } from './editRecoveryNavigation';
import { initialWorkspaceSurfaceLayout } from './workspaceSurface';
const draft = { key: 'x', kind: 'note' as const, label: 'Draft', ownerId: 'entry', targetId: 'n', scopeKey: '', updatedAt: '', payload: {} };
it('opens the correct owned note and the selected annotation segment', () => {
  expect(recoverySurface(draft)).toEqual({ kind: 'note', entryId: 'entry', noteId: 'n' });
  expect(recoverySurface({ ...draft, ownerId: 'tag-reading:tag' })).toMatchObject({ kind: 'owned-note', target: { owner: { kind: 'tag_reading', tag_id: 'tag' }, note_id: 'n' } });
  expect(recoverySurface({ ...draft, kind: 'annotation', targetId: 'segment' })).toEqual({ kind: 'segment-notes', entryId: 'entry', segmentUid: 'segment', mode: 'annotation' });
});
it('locates a nested editor in its actual duplicated view', () => {
  const surface = { kind: 'pdf' as const, entryId: 'entry', viewId: 'second' };
  expect(unsavedSurface({ scopeKey: 'pdf:entry:view:second/annotation', ownerId: 'a', handler: undefined }, { ...initialWorkspaceSurfaceLayout, rightTabs: [surface], right: surface })).toEqual(surface);
});
it('selects the settings section containing the unsaved translation service', () => {
  expect(recoverySurface({ ...draft, kind: 'settings', targetId: 'models-connections' })).toMatchObject({ kind: 'settings', target: { id: 'models-connections' } });
  expect(recoverySurface({ ...draft, kind: 'entry' })).toEqual({ kind: 'entry-overview', entryId: 'entry' });
  expect(recoverySurface({ ...draft, kind: 'tag-description', ownerId: 'tag' })).toMatchObject({ kind: 'tag-details', tagId: 'tag', view: 'overview' });
  expect(unsavedSurface({ scopeKey: 'settings', ownerId: 'form', handler: { save: async () => false, discard: () => {}, settingsTargetId: 'translation-sources' } }, initialWorkspaceSurfaceLayout))
    .toMatchObject({ kind: 'settings', target: { id: 'translation-sources' } });
});
