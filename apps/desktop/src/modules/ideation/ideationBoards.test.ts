import { expect, it } from 'vitest';
import type { IdeationState } from '@/shared/ipc/ideationApi';
import { copyBoard, migrateIdeation, nodeCard, projectBoard, updateBoardGraph } from './ideationBoards';

function fixture(): IdeationState {
  return { version: 2, cards: [{ id: 'c', entry_id: 'paper', kind: 'problem', title: '原始问题', body: '论文内容' }],
    boards: ['a', 'b'].map(id => ({ id, title: id, description: '', created_at: '', updated_at: '' })),
    placements: [{ id: 'n1', card_id: 'c', board_id: 'a', x: 20, y: 40, title: '局部标题' }, { id: 'n2', card_id: 'c', board_id: 'a', x: 400, y: 40 }, { id: 'n3', card_id: 'c', board_id: 'b', x: 30, y: 40 }],
    links: [{ id: 'r', from: 'n1', to: 'n2', kind: 'progression', label: '改进', description: '检查前提' }] };
}
it('migrates legacy placements without losing source content or modifying its input', () => {
  const legacy: IdeationState = { version: 1, cards: fixture().cards, placements: [{ id: 'old', card_id: 'c', x: 0, y: 0, slot: 'problem' }] };
  const next = migrateIdeation(legacy);
  expect(next.version).toBe(2); expect(next.boards?.[0].title).toBe('已有构思');
  expect(next.placements[0]).toMatchObject({ board_id: 'legacy-board', x: 70, y: 70, slot: undefined });
  expect(legacy.placements[0].slot).toBe('problem'); expect(next.cards).toBe(legacy.cards);
});
it('projects one graph and isolates edits to it, including a late update after switching boards', () => {
  let state = fixture();
  const updateA = (change: (graph: IdeationState) => IdeationState) => { state = updateBoardGraph(state, 'a', change); };
  expect(projectBoard(state, 'b').placements.map(p => p.id)).toEqual(['n3']);
  updateA(graph => ({ ...graph, placements: graph.placements.map(p => p.id === 'n1' ? { ...p, body: '局部改写' } : p) }));
  expect(state.cards[0].body).toBe('论文内容'); expect(projectBoard(state, 'b').placements[0].body).toBeUndefined();
  expect(nodeCard(projectBoard(state, 'a').placements[0], state.cards[0]).body).toBe('局部改写');
  state.boards![0].deleted_at = 'today';
  const before = state; updateA(graph => ({ ...graph, placements: [] })); expect(state).toBe(before);
});
it('copies a graph with new node and relation identities while reusing its source cards', () => {
  const state = fixture(), copied = copyBoard(state, 'a', 'copy'), graph = projectBoard(copied, 'copy');
  expect(copied.cards).toBe(state.cards); expect(graph.placements).toHaveLength(2);
  expect(graph.placements[0]).toMatchObject({ card_id: 'c', title: '局部标题' });
  expect(graph.links?.[0]).toMatchObject({ kind: 'progression', label: '改进', description: '检查前提', from: graph.placements[0].id, to: graph.placements[1].id });
  expect(graph.links?.[0].id).not.toBe('r'); expect(projectBoard(copied, 'a').placements).toEqual(projectBoard(state, 'a').placements);
});
