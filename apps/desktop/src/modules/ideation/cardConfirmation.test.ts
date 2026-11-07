import { expect, it, vi } from 'vitest';
import { placeCard, placeDraftCard } from './ideationUtils';
import { placeBranchCard } from './ideationBranches';
import { generateResearchPlan } from './generateResearchPlan';
import { readIdeationDraft } from '@/shared/ipc/ideationApi';
vi.mock('@/shared/ipc/ideationApi', () => ({ readIdeationDraft: vi.fn() }));
const card = { id: 'c', entry_id: 'e', title: '方法', body: '机制', kind: 'method' as const, origin: 'ai_draft' as const };
it('rejects unconfirmed AI cards at direct and branch placement boundaries', () => {
  const update = vi.fn();
  expect(() => placeCard(update, card, 0, 0)).toThrow('确认');
  expect(update).not.toHaveBeenCalled();
  expect(() => placeBranchCard({ version: 2, cards: [], placements: [] }, card, 0, 0)).toThrow('确认');
  expect(placeBranchCard({ version: 2, cards: [], placements: [] }, { ...card, origin: 'ai_reviewed' }, 0, 0).placements).toHaveLength(1);
});
it('rereads confirmation before adding a draft, including legacy drafts without origin', async () => {
  const update = vi.fn();
  vi.mocked(readIdeationDraft).mockResolvedValue({ revision: 'r', draft: { entry_id: 'e', status: 'ready', model: 'm', partial: false, cards: [{ ...card, origin: undefined }] } });
  await expect(placeDraftCard('root', update, 'e', 'c', 0, 0)).rejects.toThrow('确认');
  expect(update).not.toHaveBeenCalled();
});
it('rejects historical unconfirmed canvas inputs before invoking the model', async () => {
  await expect(generateResearchPlan('root', { goal: '目标', cards: [card] } as any, new AbortController().signal)).rejects.toThrow('未确认');
});
