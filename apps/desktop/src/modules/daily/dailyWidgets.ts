import type { DailyWidget, WidgetKind } from '@/shared/types/daily';

/** Retained for fixtures and reading existing widget layouts. */
export function newWidget(kind: WidgetKind): DailyWidget {
  return { id: crypto.randomUUID(), kind, title: '', collapsed: false, expanded: false, note: null, list_id: 'inbox', selected_date_only: false, show_completed: false };
}
