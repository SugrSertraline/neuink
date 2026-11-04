import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LlmProfile } from '@/shared/ipc/assistantApi';

const { generate } = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('@/modules/assistant/sdk/modelTasks', () => ({ runJsonModelTask: generate }));

import { generateFoldBatch } from './foldGeneration';

const profile: LlmProfile = {
  id: 'test', name: 'test', base_url: 'http://example.invalid', model: 'test', api_key: null,
  max_context_length: null, temperature: null, top_p: null, max_output_tokens: null, api_protocol: 'openai_compatible'
};
const batch = [{ segmentUid: 'a', pageIndex: 0, source: 'One. Two.', sentences: ['One.', 'Two.'] }];

describe('fold generation', () => {
  beforeEach(() => { generate.mockReset(); });

  it('requests the levels together and validates their source evidence', async () => {
    generate.mockResolvedValue({ units: [{ id: 'U0', role: 'claim', evidence: [0], reason: 'Two.', takeaway: 'One.', topic: 'One' }] });
    const result = await generateFoldBatch({ batch, profile });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.results[0].brief).toEqual(['One.']);
    expect(result.results[0].key).toBe('One. Two.');
    expect(result.failedSegmentUids).toEqual([]);
  });

  it('does not call a model for an empty batch and preserves structured-output errors', async () => {
    expect(await generateFoldBatch({ batch: [], profile })).toEqual({ results: [], failedSegmentUids: [] });
    expect(generate).not.toHaveBeenCalled();
    generate.mockRejectedValue(new Error('模型返回的内容不是有效 JSON。'));
    await expect(generateFoldBatch({ batch, profile })).rejects.toThrow('不是有效 JSON');
  });

  it('maps upstream unit ids back to source segments and rejects duplicate units', async () => {
    generate.mockResolvedValue({ units: [
      { id: 'U1', evidence: [0], takeaway: '第二段。', topic: '第二段', reason: '原因。' },
      { id: 'U0', evidence: [0], takeaway: 'One.', topic: 'One', reason: '' },
      { id: 'U0', evidence: [0], takeaway: 'One.', topic: 'One', reason: '' }
    ] });
    const output = await generateFoldBatch({ batch: [...batch, {
      segmentUid: 'b', pageIndex: 0, source: '第二段。', sentences: ['第二段。']
    }], profile });
    expect(output.failedSegmentUids).toEqual(['a']);
    expect(output.results[0]).toMatchObject({ segmentUid: 'b', key: '第二段。原因。', brief: ['第二段。'] });
  });

  it('reuses system model settings without an independent output limit', async () => {
    generate.mockResolvedValue({ units: [] });
    const signal = new AbortController().signal;
    await generateFoldBatch({ batch, profile, signal });
    expect(generate).toHaveBeenLastCalledWith(expect.objectContaining({
      name: 'paragraph_reading_levels', timeoutMs: 120_000, abortSignal: signal,
      settings: profile,
    }));
    const configured = { ...profile, max_output_tokens: 700, max_context_length: 262144, temperature: 0.4, top_p: 0.8 };
    await generateFoldBatch({ batch, profile: configured, signal });
    expect(generate.mock.lastCall?.[0].settings).toBe(configured);
  });

  it('restores the exact topic span when a model only changes capitalization', async () => {
    generate.mockResolvedValue({ units: [{ id: 'U0', takeaway: 'The adaptive method reduces waiting time.', topic: 'Waiting Time', evidence: [0], reason: '' }] });
    const result = await generateFoldBatch({ batch, profile });
    expect(result.failedSegmentUids).toEqual([]);
    expect(result.results[0].topic).toBe('waiting time');
    expect(generate.mock.calls[0][0].prompt).toContain('[U0] paragraph\n  0: One.\n  1: Two.');
  });

  it('continues rejecting paraphrased topics and treats topic punctuation literally', async () => {
    generate.mockResolvedValue({ units: [{ id: 'U0', takeaway: 'The gain is 5%.', topic: 'A performance improvement', evidence: [0], reason: '' }] });
    expect((await generateFoldBatch({ batch, profile })).failedSegmentUids).toEqual(['a']);
    generate.mockResolvedValue({ units: [{ id: 'U0', takeaway: 'The result uses A+B.', topic: 'a+b', evidence: [0], reason: '' }] });
    expect((await generateFoldBatch({ batch, profile })).results[0].topic).toBe('A+B');
  });
});
