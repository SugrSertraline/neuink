import { beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyCardError, generatePaperCards, parseCardRelations, parseCardSuggestions, selectPaperText } from './generateCards';
import { researchPatterns } from './patterns/researchPatterns';

const mocks = vi.hoisted(() => ({ settings: vi.fn(), read: vi.fn(), run: vi.fn() }));
vi.mock('@/shared/ipc/assistantApi', () => ({ getLlmSettings: mocks.settings, readEntryAssistantContext: mocks.read,
  isLocalConversationSource: (source: { provider?: string }) => source.provider !== 'sciverse' }));
vi.mock('@/modules/assistant/sdk/modelTasks', () => ({ runJsonModelTask: mocks.run }));

vi.stubGlobal('crypto', { randomUUID: () => 'generated-card' });
const sources = [
  { entry_id: 'paper', entry_title: '论文', segment_uid: 'seg-1', page_idx: 0, quote: '真实原文' },
  { entry_id: 'paper', entry_title: '论文', segment_uid: 'seg-2', page_idx: 1, quote: '未提供正文' },
  { entry_id: 'other', entry_title: '另一篇', segment_uid: 'seg-3', page_idx: 2, quote: '不属于本论文' },
];

describe('model generated card validation', () => {
  beforeEach(() => vi.clearAllMocks());
  it('classifies failures without persisting provider text', () => {
    expect(classifyCardError({ statusCode: 429, message: 'private provider response' })).toBe('rate_limit');
    expect(classifyCardError(new Error('模型返回格式不正确'))).toBe('invalid_output');
    expect(classifyCardError(new Error('整理超时'))).toBe('timeout');
    expect(classifyCardError(new Error('sensitive provider response'))).toBe('model');
  });
  it('only attaches available sources from supplied text and the selected paper', () => {
    const cards = parseCardSuggestions({ cards: [{ kind: 'method', title: '机制', body: '解释', source_markers: ['S1', 'S2', 'S3', 'S999'] }] }, '[S1] segment_uid: seg-1\n原文\n[S3] segment_uid: seg-3\n另一篇', sources, 'paper');
    expect(cards[0].sources).toEqual([{ segment_uid: 'seg-1', page_idx: 0, quote: '真实原文' }]);
  });
  it('keeps only known pattern matches on method components', () => {
    const cards = parseCardSuggestions({ cards: [
      { kind: 'component', title: '组件', body: '机制', pattern_ids: ['heterogeneous_decomposition', 'invented_pattern'] },
      { kind: 'problem', title: '问题', body: '困难', pattern_ids: ['heterogeneous_decomposition'] }
    ] }, '', sources, 'paper');
    expect(cards[0].pattern_ids).toEqual(['heterogeneous_decomposition']);
    expect(cards[1].pattern_ids).toEqual([]);
  });
  it('rejects malformed output instead of inventing cards', () => {
    expect(() => parseCardSuggestions({ cards: [{ kind: 'unknown', title: 'x', body: 'y' }] }, '', sources, 'paper')).toThrow('没有返回可用卡片');
  });
  it('only connects known cards when the relationship has a real supplied source', () => {
    const cards = [{ id: 'a', modelRef: 'c1', kind: 'problem' as const, title: '问题', body: '内容', sources: [], selected: true },
      { id: 'b', modelRef: 'c2', kind: 'component' as const, title: '组件', body: '内容', sources: [], selected: true }];
    const value = { relations: [
      { from: 'c1', to: 'c2', kind: 'addresses', source_markers: ['S1'] },
      { from: 'c1', to: 'c2', kind: 'input', source_markers: ['S2'] },
      { from: 'c1', to: 'unknown', kind: 'related', source_markers: ['S1'] }
    ] };
    const relations = parseCardRelations(value, cards, '[S1] segment_uid: seg-1\n原文', sources, 'paper');
    expect(relations).toEqual([{ from: 'a', to: 'b', kind: 'addresses', sources: [expect.objectContaining({ segment_uid: 'seg-1' })] }]);
  });
  it('samples later segments without fabricating markers or exceeding the budget', () => {
    const text = Array.from({ length: 8 }, (_, i) => `[S${i + 1}] segment_uid: seg-${i + 1}\n${'原文'.repeat(250)}`).join('\n');
    const sample = selectPaperText(text, 1000);
    expect(sample.partial).toBe(true); expect(sample.markdown.length).toBeLessThanOrEqual(1000);
    expect(sample.markdown).toContain('[S1]'); expect(sample.markdown).toMatch(/\[S[3-8]\]/);
  });
  it('exposes all imported main patterns and subpatterns', () => {
    expect(researchPatterns).toHaveLength(15);
    expect(researchPatterns.reduce((count, pattern) => count + pattern.subpatterns.length, 0)).toBe(31);
  });
  it('sends a bounded paper to the configured model and reports partial coverage', async () => {
    mocks.settings.mockResolvedValue({ assistant_profile: { name: '测试模型', model: 'model', max_context_length: 4000 } });
    mocks.read.mockResolvedValue({ entry_id: 'paper', entry_title: '论文', markdown: `[S1] segment_uid: seg-1\n${'原文'.repeat(6000)}`, sources });
    mocks.run.mockResolvedValue({ cards: [{ kind: 'problem', title: '问题', body: '问题说明', source_markers: ['S1'] }] });
    const result = await generatePaperCards('root', 'paper', new AbortController().signal);
    expect(result.partial).toBe(true);
    expect(result.cards[0].sources[0].segment_uid).toBe('seg-1');
    expect(mocks.run.mock.calls[0][0].prompt).toContain('只提供部分');
    expect(mocks.run.mock.calls[0][0].prompt.length).toBeLessThan(5000);
  });
  it('does not call the model if parsed paper content is missing', async () => {
    mocks.settings.mockResolvedValue({ assistant_profile: { model: 'model' } });
    mocks.read.mockResolvedValue({ entry_id: 'paper', entry_title: '论文', markdown: '', sources: [] });
    await expect(generatePaperCards('root', 'paper', new AbortController().signal)).rejects.toThrow('没有可用的解析正文');
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it('does not send personal annotations and does not treat annotations as paper text', async () => {
    mocks.settings.mockResolvedValue({ assistant_profile: { model: 'model' } });
    mocks.read.mockResolvedValue({ entry_id: 'paper', entry_title: '论文', parsed_segment_count: 1, markdown: '[S1] segment_uid: seg-1\n论文原文\n## Annotations\n私人批注', sources });
    mocks.run.mockResolvedValue({ cards: [{ kind: 'method', title: '方法', body: '内容', source_markers: ['S1'] }] });
    await generatePaperCards('root', 'paper', new AbortController().signal);
    expect(mocks.run.mock.calls[0][0].prompt).not.toContain('私人批注');
    mocks.read.mockResolvedValue({ entry_id: 'paper', entry_title: '论文', parsed_segment_count: 0, markdown: '# 论文\n## Annotations\n私人批注', sources: [] });
    await expect(generatePaperCards('root', 'paper', new AbortController().signal)).rejects.toThrow('没有可用的解析正文');
  });
  it('does not return suggestions if the parsed paper changes while the model is running', async () => {
    mocks.settings.mockResolvedValue({ assistant_profile: { model: 'model' } });
    mocks.read.mockResolvedValueOnce({ entry_id: 'paper', entry_title: '论文', markdown: '[S1] segment_uid: seg-1\n旧正文', sources })
      .mockResolvedValueOnce({ entry_id: 'paper', entry_title: '论文', markdown: '[S1] segment_uid: seg-1\n新正文', sources });
    mocks.run.mockResolvedValue({ cards: [{ kind: 'method', title: '方法', body: '内容', source_markers: ['S1'] }] });
    await expect(generatePaperCards('root', 'paper', new AbortController().signal)).rejects.toThrow('解析内容在整理期间发生变化');
  });
  it('can cancel while waiting for paper or settings even if the native read never completes', async () => {
    mocks.settings.mockReturnValue(new Promise(() => {}));
    mocks.read.mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();
    const request = generatePaperCards('root', 'paper', controller.signal);
    controller.abort();
    await expect(request).rejects.toBeDefined();
    expect(mocks.run).not.toHaveBeenCalled();
  });
});
