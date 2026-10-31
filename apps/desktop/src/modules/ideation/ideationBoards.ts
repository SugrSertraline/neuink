import type { IdeationBoard, IdeationLink, IdeationLinkKind, IdeationState, PaperCard, Placement } from '@/shared/ipc/ideationApi';

export const linkLabels: Record<IdeationLinkKind, string> = {
  related: '关联', addresses: '尝试解决', motivates: '引出', progression: '递进改进', combines: '组合',
  decomposes: '拆解', input: '提供输入', depends_on: '依赖', supports: '支持', challenges: '反例／质疑',
  contrasts: '对照', tests: '检验', limits: '限制', feedback: '反馈', hypothesis: '待验证', alternative: '替代方案',
};
export const relationLabel = (link: IdeationLink) => link.label?.trim() || linkLabels[link.kind ?? 'related'];
export const nodeCard = (placement: Placement, card: PaperCard): PaperCard => ({ ...card, title: placement.title ?? card.title, body: placement.body ?? card.body });

export function migrateIdeation(state: IdeationState): IdeationState {
  if (state.version === 2) return state;
  const board: IdeationBoard = { id: 'legacy-board', title: '已有构思', description: '', created_at: '', updated_at: '' };
  return { ...state, version: 2, boards: [board], placements: state.placements.map((p, index) => ({
    ...p, board_id: board.id, ...(p.slot ? { x: p.slot === 'problem' ? 70 : 420, y: Math.min(10000, 70 + index * 150), slot: undefined } : {}),
  })) };
}

/** The card library is shared; spatial nodes, edits and relationships belong to one board. */
export function projectBoard(state: IdeationState, boardId: string | null): IdeationState {
  const placements = state.placements.filter(node => node.board_id === boardId);
  const ids = new Set(placements.map(node => node.id));
  return { ...state, placements, links: (state.links ?? []).filter(link => ids.has(link.from) && ids.has(link.to)) };
}

export function updateBoardGraph(state: IdeationState, boardId: string | null, change: (graph: IdeationState) => IdeationState): IdeationState {
  const board = state.boards?.find(item => item.id === boardId && !item.deleted_at);
  if (boardId && !board) return state; // A late drop must never resurrect a deleted board.
  const graph = projectBoard(state, boardId);
  const next = change(graph);
  if (next === graph) return state;
  const oldIds = new Set(graph.placements.map(node => node.id));
  return { ...state, cards: next.cards,
    boards: state.boards?.map(item => item.id === boardId ? { ...item, updated_at: new Date().toISOString() } : item),
    placements: [...state.placements.filter(node => node.board_id !== boardId), ...(board ? next.placements.map(node => ({ ...node, board_id: board.id })) : [])],
    links: [...(state.links ?? []).filter(link => !oldIds.has(link.from) && !oldIds.has(link.to)), ...(board ? next.links ?? [] : [])],
  };
}

export function copyBoard(state: IdeationState, sourceId: string, id: string = crypto.randomUUID()): IdeationState {
  const source = state.boards?.find(board => board.id === sourceId && !board.deleted_at);
  if (!source) return state;
  const graph = projectBoard(state, sourceId);
  const ids = new Map(graph.placements.map(node => [node.id, crypto.randomUUID()]));
  const now = new Date().toISOString();
  return { ...state,
    boards: [...(state.boards ?? []), { ...source, id, title: `${source.title.slice(0, 110)}（副本）`, created_at: now, updated_at: now }],
    placements: [...state.placements, ...graph.placements.map(node => ({ ...node, id: ids.get(node.id)!, board_id: id }))],
    links: [...(state.links ?? []), ...(graph.links ?? []).map(link => ({ ...link, id: crypto.randomUUID(), from: ids.get(link.from)!, to: ids.get(link.to)! }))],
  };
}
