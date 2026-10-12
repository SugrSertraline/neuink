import { expect, it } from 'vitest';
import { initialRelationNavigation, relationNavigation, relationOverview } from './relationNavigation';

it('restores the complete search and relationship filter when going back and forward', () => {
  let state = initialRelationNavigation();
  state = relationNavigation(state, { type: 'search', query: '上级' });
  const filtered = { ...state.history[state.index], kinds: ['hierarchy' as const] };
  state = relationNavigation(state, { type: 'visit', location: filtered });
  state = relationNavigation(state, { type: 'visit', location: { ...filtered, selectedId: 'child', query: '' } });
  state = relationNavigation(state, { type: 'back' }); expect(state.history[state.index]).toEqual(filtered);
  state = relationNavigation(state, { type: 'forward' }); expect(state.history[state.index].selectedId).toBe('child');
  state = relationNavigation(state, { type: 'visit', location: relationOverview() });
  expect(state.history[state.index]).toEqual(relationOverview());
  state = relationNavigation(state, { type: 'back' }); expect(state.history[state.index].selectedId).toBe('child');
});

it('replaces search keystrokes and discards the abandoned forward branch', () => {
  let state = initialRelationNavigation();
  for (const query of ['s', 'so', 'soft']) state = relationNavigation(state, { type: 'search', query });
  expect(state.history).toHaveLength(1);
  state = relationNavigation(state, { type: 'visit', location: { ...relationOverview(), selectedId: 'a' } });
  state = relationNavigation(state, { type: 'back' });
  state = relationNavigation(state, { type: 'search', query: 'new' });
  expect(state.history).toHaveLength(1); expect(state.history[0].query).toBe('new');
});

it('returns to overview when a selected object disappears without losing filters or unrelated history', () => {
  let state = relationNavigation(initialRelationNavigation(), { type: 'visit', location: { selectedId: 'removed', query: '', kinds: ['source'] } });
  state = relationNavigation(state, { type: 'prune', ids: new Set(['retained']) });
  expect(state.history[state.index]).toEqual({ selectedId: null, query: '', kinds: ['source'] });
  expect(state.history[0]).toEqual(relationOverview());
});

it('bounds long browsing sessions and does not add duplicate locations', () => {
  let state = initialRelationNavigation();
  for (let i = 0; i < 100; i++) state = relationNavigation(state, { type: 'visit', location: { ...relationOverview(), selectedId: String(i) } });
  expect(state.history).toHaveLength(80); expect(state.index).toBe(79);
  expect(relationNavigation(state, { type: 'visit', location: state.history[state.index] })).toBe(state);
});
