import { repairConfirmedResearchLinks } from './ideationBoards';
import { expect, it } from 'vitest';
import { applyRelationSuggestions, parseRelationSuggestions } from './relationSuggestions';
import { researchInput } from './researchPlan';
import { board, state } from './researchPlan.fixtures';
const input = () => researchInput(board, state, new Set(state.placements.map(p => p.id)), '研究目标');
it('validates references and preserves existing relations', () => {
  const source = input(); source.links = [];
  const proposal = { from: source.cards[0].ref, to: source.cards[1].ref, kind: 'input', reason: '上游表征作为下游输入', conditions: '维度需验证' };
  const links = parseRelationSuggestions({ relations: [proposal, proposal] }, source);
  expect(links).toHaveLength(1);
  expect(() => parseRelationSuggestions({ relations: [{ ...proposal, to: 'C99' }] }, source)).toThrow();
  expect(() => parseRelationSuggestions({ relations: [{ ...proposal, to: proposal.from }] }, source)).toThrow();
  expect(() => parseRelationSuggestions({ relations: [{ ...proposal, conditions: '' }] }, source)).toThrow();
  const graph = { ...state, links: [] };
  const accepted = applyRelationSuggestions(graph, links);
  expect(graph.links).toHaveLength(0);
  expect(accepted.links).toHaveLength(1);
  expect(accepted.links?.[0].origin).toBe('user');
  expect(applyRelationSuggestions(accepted, links).links).toHaveLength(1);
  expect(applyRelationSuggestions({ ...graph, placements: [] }, links).links).toHaveLength(0);
});
it('does not propose replacements for existing directed connections', () => {
  const source = input();
  const a = source.cards[0].ref, b = source.cards[1].ref;
  source.links = [{ ref: 'E1', from: a, to: b, kind: 'related', relation: '关联', origin: 'user', sources: [], description: undefined, entryId: undefined }];
  expect(parseRelationSuggestions({ relations: [{ from: a, to: b, kind: 'input', reason: '建议', conditions: '待验证' }] }, source)).toEqual([]);
  expect(parseRelationSuggestions({ relations: [] }, source)).toEqual([]);
});

it('modifies and deletes only the reviewed existing relationship', () => {
  const source = input(); const a = source.cards[0], b = source.cards[1];
  const graph = { ...state, links: [{ id: 'existing', from: a.nodeId, to: b.nodeId, kind: 'related' as const }] };
  source.links = [{ ref: 'E1', from: a.ref, to: b.ref, kind: 'related', relation: '关联', origin: 'user', sources: [], description: undefined, entryId: undefined }];
  const proposal = { from: a.ref, to: b.ref, kind: 'input', reason: '建议', conditions: '待验证' };
  const modify = parseRelationSuggestions({ relations: [{ ...proposal, action: 'modify' }] }, source);
  expect(applyRelationSuggestions(graph, modify).links?.[0]).toMatchObject({ id: 'existing', kind: 'input' });
  const remove = parseRelationSuggestions({ relations: [{ ...proposal, action: 'delete' }] }, source);
  expect(applyRelationSuggestions(graph, remove).links).toHaveLength(0);
  expect(applyRelationSuggestions({ ...graph, links: [{ ...graph.links[0], kind: 'supports' }] }, remove).links).toHaveLength(1);
});

it('repairs confirmed canvas proposals but preserves unconfirmed paper evidence validation', () => {
  const base = { id: 'l', from: 'a', to: 'b', origin: 'ai_inferred' as const };
  const graph = { ...state, links: [{ ...base, description: 'AI 建议（用户已核对，仍需验证）：组合' }, { ...base, id: 'paper', description: '论文提取关系' }] };
  const fixed = repairConfirmedResearchLinks(graph);
  expect(fixed.links?.[0].origin).toBe('user');
  expect(fixed.links?.[1].origin).toBe('ai_inferred');
  expect(repairConfirmedResearchLinks(fixed)).toBe(fixed);
});

it('keeps AI additions sparse across repeated requests without changing manual links', () => {
  const source = input(); source.links = [];
  source.cards = Array.from({ length: 5 }, (_, i) => ({ ...source.cards[0], ref: `C${i+1}`, nodeId: `n${i+1}` }));
  const proposal = (from: string, to: string, kind = 'input') => ({ from, to, kind, reason: '主线步骤', conditions: '接口待验证' });
  const relations = [proposal('C1', 'C2'), proposal('C2', 'C1'), proposal('C2', 'C3'), proposal('C1', 'C3'), proposal('C3', 'C4'), proposal('C4', 'C5')];
  expect(parseRelationSuggestions({ relations }, source)).toHaveLength(4);
  source.links = [{ ref: 'E1', from: 'C1', to: 'C2', kind: 'input', relation: '输入', origin: 'user', sources: [], description: undefined, entryId: undefined }];
  expect(parseRelationSuggestions({ relations }, source)).toHaveLength(3);
  expect(source.links).toHaveLength(1);
  source.cards[4].kind = 'constraint';
  expect(parseRelationSuggestions({ relations: [proposal('C4', 'C5'), proposal('C3', 'C4', 'supports')] }, source)).toEqual([]);
});
