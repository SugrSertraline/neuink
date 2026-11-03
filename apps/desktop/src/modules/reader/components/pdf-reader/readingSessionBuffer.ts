import type { ReadingSession } from '@/shared/types/domain';
import { formatLocalDate } from '../libraryReading';

/** Cumulative checkpoints keep retries idempotent, including after a midnight split. */
export class ReadingSessionBuffer {
  private current: ReadingSession | null = null;
  private pending = new Map<string, ReadingSession>();

  add(start: number, end: number) {
    let cursor = start;
    while (cursor < end) {
      const date = new Date(cursor);
      const localDate = formatLocalDate(date);
      const midnight = new Date(date); midnight.setHours(24, 0, 0, 0);
      const until = Math.min(end, midnight.getTime());
      if (!this.current || this.current.local_date !== localDate || Date.parse(this.current.ended_at) !== cursor) {
        this.current = { id: crypto.randomUUID(), local_date: localDate, started_at: new Date(cursor).toISOString(), ended_at: new Date(cursor).toISOString(), active_ms: 0 };
      }
      this.current = { ...this.current, ended_at: new Date(until).toISOString(), active_ms: this.current.active_ms + until - cursor };
      this.pending.set(this.current.id, this.current);
      cursor = until;
    }
  }

  end() { this.current = null; }
  snapshots() { return [...this.pending.values()]; }
  acknowledge(snapshot: ReadingSession) {
    if (this.pending.get(snapshot.id)?.active_ms === snapshot.active_ms) this.pending.delete(snapshot.id);
  }
}
