import { expect, it } from 'vitest';
import { changeDraftCard, removePaperCard } from './paperCardOperations';
import type { IdeationState, IdeationDraft } from '@/shared/ipc/ideationApi';
it('removes references across boards while preserving unrelated cards and links', () => {
 const state: IdeationState = { version: 2, cards: [{ id: 'a', entry_id: 'paper', title: 'a', body: 'a', kind: 'method' }, { id: 'b', entry_id: 'paper', title: 'b', body: 'b', kind: 'method' }], placements: [{ id: 'a1', card_id: 'a', board_id: 'one', x: 0, y: 0 }, { id: 'a2', card_id: 'a', board_id: 'two', x: 0, y: 0 }, { id: 'b1', card_id: 'b', board_id: 'two', x: 0, y: 0 }], links: [{ id: 'edge', from: 'a2', to: 'b1' }] };
 const result = removePaperCard(state, 'a'); expect(result.cards.map(c => c.id)).toEqual(['b']); expect(result.placements.map(n => n.id)).toEqual(['b1']); expect(result.links).toEqual([]); expect(state.cards).toHaveLength(2);
});
it('keeps an empty ready draft record after deleting its final card', () => {
 const draft: IdeationDraft = { entry_id: 'paper', status: 'ready', model: 'model', partial: false, cards: [{ id: 'a', entry_id: 'paper', title: 'a', body: 'a', kind: 'method' }] };
 expect(changeDraftCard(draft, 'a', null)).toMatchObject({ status: 'ready', cards: [] });
});
