import { expect, it } from 'vitest';
import type { IdeationState } from '@/shared/ipc/ideationApi';
import { hasNodeOverlap, positionBranchSlots } from './ideationSlots';
import { nodeHeight, nodeWidth } from './ideationLayout';

const state: IdeationState = { version: 2, cards: [{ id: 'c', kind: 'problem', entry_id: 'local', title: '', body: '' }],
  placements: [{ id: 'p', card_id: 'c', x: 80, y: 80 }, { id: 'other', card_id: 'c', x: 512, y: 120 }] };

it('reserves full card space at every ghost slot without changing saved nodes', () => {
  const original = structuredClone(state), slots = positionBranchSlots(state, 'p');
  expect(slots).toHaveLength(4);
  for (const slot of slots) expect(hasNodeOverlap([...state.placements, { ...slot, card_id: 'c' }])).toBe(false);
  expect(state).toEqual(original);
  expect(positionBranchSlots(state, 'p', slots)).toEqual(slots);
  expect(new Set(slots.map(slot => `${slot.x}:${slot.y}`)).size).toBe(1);
});

it('aligns a free right-hand branch and uses a nearby row when that column is occupied', () => {
  const single = { ...state, placements: [state.placements[0]] };
  expect(positionBranchSlots(single, 'p')[0]).toMatchObject({ x: 448, y: 80 });
  expect(positionBranchSlots(single, 'p', [], [], true)[0]).toMatchObject({ x: 80, y: 330 });
  const occupied = { ...state, placements: [state.placements[0],
    { id: 'm1', card_id: 'c', x: 448, y: 0 }, { id: 'm2', card_id: 'c', x: 448, y: 250 }] };
  const slot = positionBranchSlots(occupied, 'p')[0];
  expect(slot.x).toBe(80);
  expect(slot.y).toBeLessThan(occupied.placements[2].y + nodeHeight);
  expect(hasNodeOverlap([...occupied.placements, { ...slot, card_id: 'c' }])).toBe(false);
});

it('consumes a filled slot and adapts only remaining suggestions around it', () => {
  const slots = positionBranchSlots(state, 'p'), filled = slots[0];
  const next = { ...state, placements: [...state.placements, { ...filled, id: 'filled', card_id: 'c' }] };
  const remaining = positionBranchSlots(next, 'p', slots, [filled.id]);
  expect(remaining).toHaveLength(3);
  expect(remaining.some(slot => slot.id === filled.id)).toBe(false);
  remaining.forEach(slot => expect(hasNodeOverlap([...next.placements, { ...slot, card_id: 'c' }])).toBe(false));
  const restored = positionBranchSlots(next, 'p', remaining);
  expect(restored).toHaveLength(4);
  expect(restored.find(slot => slot.id === filled.id)).not.toMatchObject({ x: filled.x, y: filled.y });
});

it('handles missing selection, board boundaries, and true overlaps separately from touching edges', () => {
  expect(positionBranchSlots(state, null)).toEqual([]);
  expect(positionBranchSlots(state, 'deleted')).toEqual([]);
  const atEdge = { ...state, placements: [{ ...state.placements[0], x: 10000, y: 10000 }] };
  positionBranchSlots(atEdge, 'p').forEach(slot => {
    expect(slot.x).toBeGreaterThanOrEqual(0); expect(slot.x).toBeLessThanOrEqual(10000);
    expect(slot.y).toBeGreaterThanOrEqual(0); expect(slot.y).toBeLessThanOrEqual(10000);
  });
  expect(hasNodeOverlap([{ ...state.placements[0], x: 0, y: 0 }, { ...state.placements[1], x: nodeWidth, y: 0 }])).toBe(false);
  expect(hasNodeOverlap([{ ...state.placements[0], x: 0, y: 0 }, { ...state.placements[1], x: 1, y: nodeHeight - 1 }])).toBe(true);
});
