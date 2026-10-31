import { expect, it } from 'vitest';
import type { CardKind, IdeationState, PaperCard } from '@/shared/ipc/ideationApi';
import { branchRules, placeBranchCard } from './ideationBranches';
import { arrangeBoard } from './ideationLayout';
import { resolveAssistantReadingContext } from '@/modules/assistant/components/assistantReadingContext';
import { modelDrivenBrief } from '@/modules/assistant/harness/engine';
import type { AssistantActiveSurfaceSnapshot } from '@/shared/types/assistant';

const problem: PaperCard = { id: 'problem', entry_id: 'ideation-user', kind: 'problem', title: '缺失数据', body: '观测不完整时预测不稳定' };
const method: PaperCard = { id: 'method', entry_id: 'paper', kind: 'method', title: '重建方法', body: '重建后预测', origin: 'ai_draft' };
const board = { id: 'a', title: '当前构思', description: '研究目标', created_at: '', updated_at: '' };
const state: IdeationState = { version: 2, boards: [board], cards: [problem, method], placements: [{ id: 'p', card_id: problem.id, board_id: board.id, x: 50, y: 50 }] };

it.each(Object.keys(branchRules) as CardKind[])('offers coherent typed continuation for %s without overlapping existing nodes or slots', kind => {
  const occupied = [...state.placements, { id: 'other', card_id: 'method', x: 364, y: 360 }];
  const arranged = arrangeBoard({ ...state, placements: occupied, cards: [{ ...problem, kind }, method] }, 'p');
  const slots = arranged.slots;
  expect(slots.length).toBeGreaterThan(0);
  slots.forEach((slot, i) => {
    expect(slot.kinds.length).toBeGreaterThan(0);
    for (const p of arranged.placements) expect(slot.x < p.x + 272 && slot.x + 272 > p.x && slot.y < p.y + 218 && slot.y + 118 > p.y).toBe(false);
    for (const other of slots.slice(0, i)) expect(slot.x < other.x + 272 && slot.x + 272 > other.x && slot.y < other.y + 118 && slot.y + 118 > other.y).toBe(false);
  });
});

it('keeps proposed slots ephemeral and saves a method-to-problem edge only after filling', () => {
  const slot = arrangeBoard(state, 'p').slots.find(s => s.id === 'method')!;
  expect(state.placements).toHaveLength(1);
  const next = placeBranchCard(state, method, 100, 100, slot);
  expect(next.placements).toHaveLength(2); expect(next.cards).toHaveLength(2);
  expect(next.placements[1]).toMatchObject({ x: slot.x, y: slot.y });
  expect(next.links).toEqual([expect.objectContaining({ from: next.placements[1].id, to: 'p', kind: 'addresses', origin: 'user' })]);
  expect(() => placeBranchCard(state, problem, 0, 0, slot)).toThrow();
  expect(() => placeBranchCard({ ...state, placements: [] }, method, 0, 0, slot)).toThrow();
});

it('keeps suggested placements inside persistence bounds near the canvas edge', () => {
  const source = { ...state.placements[0], x: 10000, y: 10000 };
  const slots = arrangeBoard({ ...state, placements: [source], cards: [{ ...problem, kind: 'method' }] }, 'p').slots;
  expect(slots).toHaveLength(branchRules.method.length);
  for (const slot of slots) { expect(slot.x).toBeLessThanOrEqual(10000); expect(slot.y).toBeLessThanOrEqual(10000); expect(slot.y).toBeGreaterThanOrEqual(0); }
});

it('does not attach an idea or a stale paper when the assistant is opened manually', () => {
  const surface: AssistantActiveSurfaceSnapshot = { kind: 'ideation', surfaceKey: 'ideation', pane: 'left', capturedAt: '', entryId: 'old-paper', noteId: null, segmentUid: null };
  const resolved = resolveAssistantReadingContext({ choice: null, entries: [], items: [], activeEntry: null, activeNote: null, activeSegment: null, activeSurface: surface });
  expect(resolved).toMatchObject({ label: '不关联内容', entry: null, bound: false, unavailable: false, surface: { entryId: null } });
  const brief = modelDrivenBrief({ currentSurface: resolved.surface, history: [], mentionScope: { entry_ids: [], entry_titles: [], tag_ids: [], tag_names: [] } });
  expect(brief).not.toContain('old-paper');
  expect(brief).not.toContain('Current research idea');
});
