import { expect, it } from 'vitest';
import { ReadingSessionBuffer } from './readingSessionBuffer';

it('keeps a continuous period through checkpoints and starts a new period after a pause', () => {
  const buffer = new ReadingSessionBuffer();
  const start = new Date('2026-10-23T12:00:00').getTime();
  buffer.add(start, start + 15_000);
  const first = buffer.snapshots()[0];
  buffer.add(start + 15_000, start + 30_000);
  buffer.acknowledge(first);
  expect(buffer.snapshots()[0]).toMatchObject({ id: first.id, active_ms: 30_000 });
  buffer.acknowledge(buffer.snapshots()[0]);
  expect(buffer.snapshots()).toHaveLength(0);
  buffer.add(start + 30_000, start + 40_000);
  expect(buffer.snapshots()[0]).toMatchObject({ id: first.id, active_ms: 40_000 });
  buffer.end(); buffer.add(start + 80_000, start + 90_000);
  expect(buffer.snapshots()[1].id).not.toBe(first.id);
  expect(buffer.snapshots()[1].active_ms).toBe(10_000);
});

it('splits a crossing interval at local midnight and retains each day during a failed save', () => {
  const buffer = new ReadingSessionBuffer();
  const start = new Date('2026-12-31T23:59:59').getTime();
  buffer.add(start, start + 3_000);
  expect(buffer.snapshots().map(item => [item.local_date, item.active_ms])).toEqual([['2026-12-31', 1000], ['2027-01-01', 2000]]);
  expect(buffer.snapshots()[0].ended_at).toBe(buffer.snapshots()[1].started_at);
  expect(buffer.snapshots()[0].id).not.toBe(buffer.snapshots()[1].id);
  const previous = buffer.snapshots()[0]; buffer.acknowledge(previous);
  buffer.add(start + 3_000, start + 4_000);
  expect(buffer.snapshots()).toHaveLength(1);
  expect(buffer.snapshots()[0]).toMatchObject({ local_date: '2027-01-01', active_ms: 3000 });
});
