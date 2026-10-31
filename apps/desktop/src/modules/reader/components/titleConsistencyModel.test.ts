import { expect, it, vi } from 'vitest';
import { getLlmSettings } from '@/shared/ipc/assistantApi';
import { runJsonModelTask } from '@/modules/assistant/sdk/modelTasks';
import type { TitleConsistency } from '@/shared/ipc/workspaceApi';
import { parseTitleReview, reviewTitleConsistency } from './titleConsistencyModel';

vi.mock('@/shared/ipc/assistantApi', () => ({ getLlmSettings: vi.fn() }));
vi.mock('@/modules/assistant/sdk/modelTasks', () => ({ runJsonModelTask: vi.fn() }));

const inspection: TitleConsistency = {
  entry_title: 'upload', pdf_file_name: 'upload.pdf', source_revision: 'rev',
  evidence: ['Journal heading', 'A Reliable Paper Title', 'Abstract', 'Paper body']
};

it('accepts a grounded model title even when the first heading heuristic missed it', () => {
  const result = parseTitleReview({ status: 'mismatch', paper_title: 'A Reliable Paper Title',
    entry_mismatch: true, pdf_mismatch: true, reason: '第二行是论文标题。' }, inspection);
  expect(result).toMatchObject({ suggestedTitle: 'A Reliable Paper Title', entryMismatch: true,
    pdfMismatch: true, suggestedPdfFileName: 'A Reliable Paper Title.pdf' });
});

it('rejects a title that is absent from the parsed page', () => {
  expect(() => parseTitleReview({ status: 'mismatch', paper_title: 'Invented Paper Title' }, inspection))
    .toThrow('无法在解析文字中核实');
});

it('does not suggest changes when the model cannot establish a mismatch', () => {
  expect(parseTitleReview({ status: 'uncertain', paper_title: '' }, inspection)).toBeNull();
  expect(parseTitleReview({ status: 'match', paper_title: '' }, inspection)).toBeNull();
});

it('uses the configured assistant model with bounded parsed-page evidence', async () => {
  vi.mocked(getLlmSettings).mockResolvedValue({ assistant_profile: { id: 'model-1', model: 'chosen-model',
    base_url: 'https://model.example', max_output_tokens: 2000 }, profiles: [] } as never);
  vi.mocked(runJsonModelTask).mockResolvedValue({ status: 'mismatch', paper_title: 'A Reliable Paper Title',
    reason: '首页第二行是标题。' });
  const result = await reviewTitleConsistency(inspection, true);
  expect(result?.suggestedTitle).toBe('A Reliable Paper Title');
  expect(runJsonModelTask).toHaveBeenCalledWith(expect.objectContaining({
    name: 'paper_title_check', settings: expect.objectContaining({ model: 'chosen-model', max_output_tokens: 700 }),
    prompt: expect.stringContaining('A Reliable Paper Title')
  }));
});
