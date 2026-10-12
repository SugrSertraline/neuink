import { RELATION_KINDS, type RelationKind } from './relationGraph';

export type RelationLocation = { selectedId: string | null; query: string; kinds: RelationKind[] };
export type RelationNavigation = { history: RelationLocation[]; index: number };
export const relationOverview = (): RelationLocation => ({ selectedId: null, query: '', kinds: [...RELATION_KINDS] });
export const initialRelationNavigation = (): RelationNavigation => ({ history: [relationOverview()], index: 0 });
type Action = { type: 'visit'; location: RelationLocation } | { type: 'search'; query: string }
  | { type: 'back' } | { type: 'forward' } | { type: 'prune'; ids: ReadonlySet<string> };

/** Selection and filters form one location; typing replaces the current search, never 80 keystrokes of history. */
export function relationNavigation(state: RelationNavigation, action: Action): RelationNavigation {
  if (action.type === 'back' || action.type === 'forward') {
    return { ...state, index: Math.max(0, Math.min(state.history.length - 1, state.index + (action.type === 'back' ? -1 : 1))) };
  }
  if (action.type === 'prune') {
    if (!state.history.some(item => item.selectedId && !action.ids.has(item.selectedId))) return state;
    return { ...state, history: state.history.map(item => item.selectedId && !action.ids.has(item.selectedId) ? { ...item, selectedId: null } : item) };
  }
  const current = state.history[state.index];
  const location = action.type === 'search' ? { ...current, selectedId: null, query: action.query } : action.location;
  if (JSON.stringify(location) === JSON.stringify(current)) return state;
  const history = action.type === 'search' && !current.selectedId
    ? [...state.history.slice(0, state.index), location]
    : [...state.history.slice(0, state.index + 1), location].slice(-80);
  return { history, index: history.length - 1 };
}
