import type { NoteTarget } from './domain';

// Keep the legacy entertainment kind readable without exposing a timer or rewriting saved layouts.
export type WidgetKind = 'note' | 'todos' | 'journal' | 'entertainment' | 'recommendations';
export type DailyWidget = {
  id: string; kind: WidgetKind; title: string; collapsed: boolean; expanded: boolean;
  note: NoteTarget | null; list_id: string; selected_date_only: boolean; show_completed: boolean;
};
export type TodoList = { id: string; title: string };
export type DailyTodo = { id: string; list_id: string; text: string; date: string | null; completed: boolean; deleted: boolean };
export type RecommendationPreferences = { interests: string[]; exclusions: string[]; enabled: boolean };
export type DailyState = {
  version: number; widgets: DailyWidget[]; lists: TodoList[]; todos: DailyTodo[];
  recommendation_preferences: RecommendationPreferences;
};
export type DailySnapshot = { revision: string; state: DailyState };
