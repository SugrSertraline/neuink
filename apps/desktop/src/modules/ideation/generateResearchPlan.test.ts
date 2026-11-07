import { beforeEach, expect, it, vi } from 'vitest';
import { generateResearchPlan } from './generateResearchPlan';
import { researchInput } from './researchPlan';
import { board, state, plan } from './researchPlan.fixtures';
const mocks = vi.hoisted(() => ({ settings: vi.fn(), read: vi.fn(), run: vi.fn() }));
vi.mock('@/shared/ipc/assistantApi', () => ({ getLlmSettings: mocks.settings, readSegmentContent: mocks.read }));
vi.mock('@/modules/assistant/sdk/modelTasks', () => ({ runJsonModelTask: mocks.run }));
const input = () => researchInput(board, state, new Set(['n1', 'n2']), '减少计算量');
beforeEach(() => { vi.resetAllMocks(); mocks.settings.mockResolvedValue({ assistant_profile: { model: 'test', max_context_length: 16000 } }); mocks.read.mockResolvedValue({ text: '原文内容' }); mocks.run.mockResolvedValue(plan); });
it('passes the chosen graph and verified source text using the assistant settings', async () => {
  const result = await generateResearchPlan('root', input(), new AbortController().signal);
  expect(result.plan.verdict).toBe('conditional');
  expect(mocks.run).toHaveBeenCalledTimes(3);
  expect(JSON.parse(mocks.run.mock.calls[2][0].prompt).previous).toHaveLength(2);
  const prompt = JSON.parse(mocks.run.mock.calls[0][0].prompt);
  expect(prompt.input.cards).toHaveLength(2); expect(prompt.input.links).toHaveLength(1);
  expect(prompt.evidence[0].text).toBe('原文内容');
  expect(mocks.run.mock.calls[0][0].settings.max_context_length).toBe(16000);
});
it('reports changed and unavailable sources without presenting them as verified evidence', async () => {
  mocks.read.mockResolvedValue({ text: '被修改的文本' });
  const result = await generateResearchPlan('root', input(), new AbortController().signal);
  expect(result.evidenceStatus).toContain('已变化'); expect(JSON.parse(mocks.run.mock.calls[0][0].prompt).evidence[0].text).toBe('');
  mocks.read.mockRejectedValue(new Error('unavailable'));
  expect((await generateResearchPlan('root', input(), new AbortController().signal)).evidenceStatus).toContain('无法读取');
});
it('does not request a model for an empty selection or insufficient context', async () => {
  await expect(generateResearchPlan('root', { ...input(), cards: [] }, new AbortController().signal)).rejects.toThrow('1–40');
  mocks.settings.mockResolvedValue({ assistant_profile: { model: 'test', max_context_length: 1600 } });
  await expect(generateResearchPlan('root', input(), new AbortController().signal)).rejects.toThrow();
  expect(mocks.run).not.toHaveBeenCalled();
});
it('cancels a source read even when its IPC promise does not resolve', async () => {
  mocks.read.mockReturnValue(new Promise(() => {}));
  const controller = new AbortController(); const work = generateResearchPlan('root', input(), controller.signal);
  await vi.waitFor(() => expect(mocks.read).toHaveBeenCalled()); controller.abort();
  await expect(work).rejects.toBeDefined(); expect(mocks.run).not.toHaveBeenCalled();
});
