import { useSyncExternalStore } from 'react';
import type { ToastInput } from '../hooks/useToast';

export type NotificationRecord = Pick<ToastInput, 'title' | 'description' | 'tone' | 'navigation'> & { id: string; time: number };
let records: NotificationRecord[] = [];
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => records;
export const useNotificationHistory = () => useSyncExternalStore(subscribe, snapshot, snapshot);
export function rememberNotification(id: string, input: ToastInput) {
  // No callbacks, actions, credentials or persistence: expired undo actions must not be replayable.
  records = [{ id, title: input.title, description: input.description, tone: input.tone, navigation: input.navigation, time: Date.now() }, ...records].slice(0, 50);
  listeners.forEach(listener => listener());
}
export function clearNotificationHistory() {
  records = [];
  listeners.forEach(listener => listener());
}
