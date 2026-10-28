import { invoke } from '@tauri-apps/api/core';
import type { DailySnapshot, DailyState } from '@/shared/types/daily';

export function dailyCommand<T>(root: string, action: Record<string, unknown>): Promise<T> {
  return invoke<T>('daily_workspace', { request: { root, action } });
}
export const readDailyState = (root: string) => dailyCommand<DailySnapshot>(root, { kind: 'read' });
export const recommendationCommand = <T,>(root: string, action: Record<string, unknown>) => invoke<T>('daily_recommendations', { request: { root, action } });
export const saveDailyState = (root: string, snapshot: DailySnapshot, state: DailyState) => dailyCommand<DailySnapshot>(root, { kind: 'save', expected_revision: snapshot.revision, state });
