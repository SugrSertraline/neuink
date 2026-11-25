import { researchInput } from './researchPlan';
import { expect, it } from 'vitest';
import { state,board } from './researchPlan.fixtures';
import { addWorksheetCard, reorderWorksheetCards, sectionForNode, worksheetNodes, moveWorksheetMethod, setWorksheetValue, worksheetValue, worksheetReportState } from './researchWorksheet';
import { copyBoard, updateBoardGraph } from './ideationBoards';
it('saves fields in the owning idea and preserves other boards and old links', () => {
  const other = { ...state.placements[0], id: 'other-node', board_id: 'other' };
  const initial = { ...state, placements: [...state.placements,other] };
  const next = updateBoardGraph(initial,board.id,s => setWorksheetValue(s,board.id,'problem','新的问题'));
  expect(worksheetValue(next,board.id,'problem')).toBe('新的问题');
  expect(next.links).toEqual(initial.links);
  expect(next.placements).toContainEqual(other);
  const again = setWorksheetValue(next,board.id,'problem','修订问题');
  expect(again.cards.length).toBe(next.cards.length);
  expect(again.placements.length).toBe(next.placements.length);
  const report = worksheetReportState(again);
  expect(report.links).toEqual([]);
  expect(again.links).toEqual(state.links);
  expect(worksheetReportState(setWorksheetValue(again,board.id,'problem','')).placements.length).toBe(initial.placements.length);
});

it('copies private worksheet fields without sharing subsequent edits', () => {
  const original = setWorksheetValue(state,board.id,'problem','原问题');
  const copied = copyBoard(original,board.id,'copy');
  expect(worksheetValue(copied,'copy','problem')).toBe('原问题');
  const changed = setWorksheetValue(copied,'copy','problem','新问题');
  expect(worksheetValue(changed,board.id,'problem')).toBe('原问题');
  expect(worksheetValue(changed,'copy','problem')).toBe('新问题');
});

it('moves methods only and passes explicit order into worksheet reports', () => {
  const second = {...state.cards[0],id:'second'};
  const original = {...state,cards:[...state.cards,second],placements:[...state.placements,{...state.placements[0],id:'n3',card_id:'second'}]};
  const moved = moveWorksheetMethod(original,'n3',-1);
  expect(moved.placements.map(n=>n.id)).toEqual(['n3','n2','n1']);
  expect(moved.links).toEqual(original.links);
  expect(moveWorksheetMethod(moved,'n3',-1)).toBe(moved);
  const report = worksheetReportState(moved);
  const input = researchInput(board,report,new Set(report.placements.map(n=>n.id)),'问题',undefined,true);
  expect(input.methodOrder).toEqual(['C1','C3']);
});

it('inserts any confirmed material into the chosen section and prevents cross-section reordering', () => {
  const material={...state.cards[0],id:'constraint',kind:'constraint' as const};
  const next=addWorksheetCard(state,material,'background');
  expect(sectionForNode(worksheetNodes(next).find(n=>n.card_id==='constraint')!)).toBe('background');
  expect(addWorksheetCard(next,material,'background')).toBe(next);
  expect(()=>addWorksheetCard(state,{...material,origin:'ai_draft'},'background')).toThrow();
  expect(reorderWorksheetCards(next,'background',next.placements[2].id,'n1',false)).toBe(next);
  const another=addWorksheetCard(next,{...material,id:'more'},'background');
  const reordered=reorderWorksheetCards(another,'background',another.placements[3].id,another.placements[2].id,false);
  expect(reordered.placements.slice(0,2)).toEqual(state.placements);
  expect(reordered.placements.slice(2).map(n=>n.card_id)).toEqual(['more','constraint']);
  expect(reordered.links).toEqual(state.links);
});
