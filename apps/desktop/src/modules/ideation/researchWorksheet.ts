import type { CardKind, IdeationState, PaperCard } from '@/shared/ipc/ideationApi';
import { nodeCard } from './ideationBoards';
export const worksheetFields = [
  { key: 'background', label: '研究背景', kind: 'background', placeholder: '研究发生在什么场景？也可以添加已有背景卡片。' },
  { key: 'problem', label: '想解决的问题', kind: 'problem', placeholder: '先用一句话描述你想解决的问题。' },
  { key: 'method', label: '可用的方法', kind: 'method', placeholder: '添加积累的方法卡片，也可以直接填写自己的方法。' },
  { key: 'constraints', label: '要求与条件（选填）', kind: 'constraint', placeholder: '已有输入、预期输出、资源限制或不希望采用的方案。' },
  { key: 'composition', label: '组合方案', kind: 'idea', placeholder: '选择方法后，让 AI 整理一个主方案；也可以自己填写。' },
] as const;
export type WorksheetField = typeof worksheetFields[number]['key'];
export const fieldCardId = (boardId: string, key: WorksheetField) => `local-idea-${boardId}-worksheet-${key}`;
export const isWorksheetCard = (id: string) => id.startsWith('local-idea-') && id.includes('-worksheet-');
export const isMethod = (card: PaperCard) => ['method', 'component'].includes(card.kind);
export const confirmedMethod = (card: PaperCard) => isMethod(card) && card.origin !== 'ai_draft' && !card.id.startsWith('local-idea-');
export function worksheetValue(state: IdeationState, boardId: string, key: WorksheetField) {
  const id = fieldCardId(boardId,key), node = state.placements.find(p => p.card_id === id);
  return node ? node.body ?? state.cards.find(c => c.id === id)?.body ?? '' : '';
}
export function setWorksheetValue(state: IdeationState, boardId: string, key: WorksheetField, body: string): IdeationState {
  const field = worksheetFields.find(f => f.key === key)!, id = fieldCardId(boardId,key);
  const existing = state.cards.find(c => c.id === id);
  if (!body && !existing) return state;
  return { ...state, cards: existing ? state.cards.map(c => c.id === id ? { ...c, body } : c) : [...state.cards, { id, entry_id: 'ideation-user', kind: field.kind as CardKind, title: field.label, body }],
    placements: state.placements.some(p => p.card_id === id) ? state.placements.map(p => p.card_id === id ? { ...p, body } : p) : [...state.placements, { id: crypto.randomUUID(), card_id: id, board_id: boardId, x: 0, y: 0 }] };
}
export function worksheetNodes(state: IdeationState) {
  return state.placements.flatMap(node => { const card = state.cards.find(c => c.id === node.card_id); return card ? [{ ...node, card: nodeCard(node,card) }] : []; });
}
export function fieldForKind(kind: CardKind): WorksheetField {
  return kind === 'background' ? 'background' : kind === 'problem' ? 'problem' : ['constraint','assumption','limitation'].includes(kind) ? 'constraints' : ['method','component'].includes(kind) ? 'method' : 'composition';
}
/** Old graph remains stored, but it must not silently constrain the new worksheet report. */
export function worksheetReportState(state: IdeationState) {
  const nonempty = new Set(worksheetNodes(state).filter(n => n.card.body.trim() || !isWorksheetCard(n.card_id)).map(n => n.id));
  return { ...state, links: [], placements: state.placements.filter(n => nonempty.has(n.id)) };
}

/** Reorder only method slots, retaining all other sections and stored historical links. */
export function moveWorksheetMethod(state: IdeationState, nodeId: string, offset: -1 | 1): IdeationState {
  const indexes = state.placements.flatMap((node,index) => { const card = state.cards.find(c => c.id === node.card_id); return card && isMethod(card) && (node.body ?? card.body).trim() ? [index] : []; });
  const position = indexes.findIndex(index => state.placements[index].id === nodeId), target = position + offset;
  if (position < 0 || target < 0 || target >= indexes.length) return state;
  const placements = [...state.placements];
  [placements[indexes[position]],placements[indexes[target]]] = [placements[indexes[target]],placements[indexes[position]]];
  return { ...state, placements };
}

export const worksheetSections = [
  { key: 'background', label: '研究背景', kind: 'background', hint: '场景、已有发现、输入输出与约束，都可以放在这里。拖动只调整展示顺序。' },
  { key: 'problem', label: '研究问题', kind: 'problem', hint: '说明想解决什么，可以包含核心问题和子问题。拖动调整关注顺序。' },
  { key: 'method', label: '方法步骤', kind: 'method', hint: '按编号从左到右、从上到下排列。拖动调整尝试顺序，AI 会检查前后衔接。' },
] as const;
export type WorksheetSection = typeof worksheetSections[number]['key'];
export function sectionForKind(kind: CardKind): WorksheetSection | 'composition' {
  if (['background','constraint','assumption','limitation','result'].includes(kind)) return 'background';
  return fieldForKind(kind) as WorksheetSection | 'composition';
}
export function sectionForNode(node: { slot?: CardKind | null; card: PaperCard }) {
  return sectionForKind(node.slot ?? node.card.kind);
}
export function addWorksheetCard(state: IdeationState, card: PaperCard, section: WorksheetSection): IdeationState {
  if (card.origin === 'ai_draft' || state.cards.find(c => c.id === card.id)?.origin === 'ai_draft') throw new Error('请先核对卡片。');
  if (state.placements.some(p => p.card_id === card.id && sectionForKind(p.slot ?? card.kind) === section)) return state;
  return { ...state, cards: state.cards.some(c => c.id === card.id) ? state.cards : [...state.cards,card], placements: [...state.placements,{id:crypto.randomUUID(),card_id:card.id,slot:section,x:0,y:0}] };
}
export function reorderWorksheetCards(state: IdeationState, section: WorksheetSection, source: string, target: string, after: boolean): IdeationState {
  const members = new Set(worksheetNodes(state).filter(n => sectionForNode(n) === section).map(n => n.id));
  if (source === target || !members.has(source) || !members.has(target)) return state;
  const ordered = state.placements.filter(n => members.has(n.id));
  const moving = ordered.find(n => n.id === source)!;
  const next = ordered.filter(n => n.id !== source);
  next.splice(next.findIndex(n => n.id === target) + (after ? 1 : 0),0,moving);
  if (next.every((n,i) => n.id === ordered[i].id)) return state;
  let index = 0;
  return { ...state, placements: state.placements.map(n => members.has(n.id) ? next[index++] : n) };
}
