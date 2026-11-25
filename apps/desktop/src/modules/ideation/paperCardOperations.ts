import type { IdeationState, PaperCard, IdeationDraft } from '@/shared/ipc/ideationApi';
export function removePaperCard(state: IdeationState, cardId: string): IdeationState {
  const nodes = new Set(state.placements.filter(node => node.card_id === cardId).map(node => node.id));
  return { ...state, cards: state.cards.filter(card => card.id !== cardId), placements: state.placements.filter(node => !nodes.has(node.id)), links: state.links?.filter(link => !nodes.has(link.from) && !nodes.has(link.to)) };
}
export function changeDraftCard(draft: IdeationDraft, cardId: string, replacement: PaperCard | null): IdeationDraft {
  return { ...draft, cards: replacement ? draft.cards.map(card => card.id === cardId ? replacement : card) : draft.cards.filter(card => card.id !== cardId),
    relations: replacement ? draft.relations : draft.relations?.filter(link => link.from !== cardId && link.to !== cardId) };
}
