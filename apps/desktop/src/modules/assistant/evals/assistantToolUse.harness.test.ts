// @vitest-environment node
// Offline self-test for the evaluation harness: a scripted provider proves that the real agent
// wiring, fixtures, call recorder and scorer agree. It does not measure model intelligence.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LlmProfile } from '@/shared/ipc/assistantApi';

const script = vi.hoisted(() => ({
  turns: [] as Array<{ text?: string; finish?: 'length'; call?: { id?: string; name: string; args: unknown } }>
}));

vi.mock('@tauri-apps/plugin-http', async () => (await import('./mocks')).tauriHttpFactory());
vi.mock('@/shared/ipc/assistantApi', async importOriginal =>
  (await import('./mocks')).assistantApiFactory(importOriginal)
);
vi.mock('@/shared/ipc/researchApi', async importOriginal =>
  (await import('./mocks')).researchApiFactory(importOriginal)
);
vi.mock('@/shared/ipc/pdfTextApi', async importOriginal =>
  (await import('./mocks')).pdfTextApiFactory(importOriginal)
);
vi.mock('@/shared/ipc/workspaceApi', async importOriginal =>
  (await import('./mocks')).workspaceApiFactory(importOriginal)
);
vi.mock('@/shared/ipc/browserApi', async importOriginal =>
  (await import('./mocks')).browserApiFactory(importOriginal)
);
vi.mock('../sdk/agentDriver', async importOriginal =>
  (await import('./mocks')).agentDriverFactory(importOriginal)
);
vi.mock('../sdk/tools', async importOriginal =>
  (await import('./mocks')).toolRuntimeFactory(importOriginal)
);
vi.mock('../sdk/provider', async () => {
  const { MockLanguageModelV3, simulateReadableStream } = await import('ai/test');
  const { traceModel } = await import('./modelTrace');
  return {
    createNeuinkModel: () =>
      traceModel(new MockLanguageModelV3({
        doStream: async () => {
          const turn = script.turns.shift();
          if (!turn) throw new Error('Unexpected provider turn');
          return {
            stream: simulateReadableStream({
              chunks: [
                { type: 'stream-start', warnings: [] },
                ...(turn.call
                  ? [
                      {
                        type: 'tool-call' as const,
                        toolCallId: turn.call.id ?? `call-${Math.random().toString(36).slice(2)}`,
                        toolName: turn.call.name,
                        input: JSON.stringify(turn.call.args)
                      }
                    ]
                  : [
                      { type: 'text-start' as const, id: 'text' },
                      { type: 'text-delta' as const, id: 'text', delta: turn.text! },
                      { type: 'text-end' as const, id: 'text' }
                    ]),
                {
                  type: 'finish',
                  finishReason: {
                    unified: turn.finish ?? (turn.call ? 'tool-calls' : 'stop'),
                    raw: turn.finish ?? (turn.call ? 'tool_calls' : 'stop')
                  },
                  usage: {
                    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
                    outputTokens: { total: 10, text: 10, reasoning: 0 }
                  }
                }
              ]
            })
          };
        }
      })),
    generationSettings: () => ({})
  };
});

import { runScenario, selectScenarios } from './harness';
import { SCENARIOS } from './scenarios';
import { reportData } from './report';
import { evalState } from './evalState';

const profile = {
  id: 'eval-test',
  model: 'scripted',
  base_url: 'https://example.invalid',
  api_key: null
} as LlmProfile;

beforeEach(() => {
  script.turns = [];
});

describe('evaluation harness wiring', () => {
  it('accepts an honest refusal when the user already supplied the page count', async () => {
    script.turns = [{ text: '这篇 PDF 只有 8 页，不存在第 99 页。' }];
    const result = await runScenario(SCENARIOS.find(item => item.id === 'pdf-out-of-range')!, profile);
    expect(result.passed).toBe(true);
    expect(result.run.calls).toEqual([]);
  });

  it('records a real PDF range failure as a failed attempt, not a successful read', async () => {
    script.turns = [
      { call: { name: 'read_pdf_pages', args: { entry_id: 'paper-scanned', start_page: 99, page_count: 1 } } },
      { text: 'PDF 共 8 页，请选择有效页码；第 99 页不存在。' }
    ];
    const result = await runScenario(SCENARIOS.find(item => item.id === 'pdf-out-of-range-tool')!, profile);
    expect(result.checks.filter(check => !check.ok)).toEqual([]);
    expect(result.run.calls[0]).toMatchObject({ status: 'failed', errorCode: 'TOOL_EXECUTION_FAILED' });
  });

  it('allows valid-page verification after the requested page is rejected', async () => {
    script.turns = [
      { call: { name: 'read_pdf_pages', args: { entry_id: 'paper-scanned', start_page: 99, page_count: 1 } } },
      { call: { name: 'read_pdf_pages', args: { entry_id: 'paper-scanned', start_page: 1, page_count: 1 } } },
      { text: 'PDF 共 8 页，第 99 页不存在。读取到的第 1 页是标题页 [S1]。' }
    ];
    const result = await runScenario(SCENARIOS.find(item => item.id === 'pdf-out-of-range-tool')!, profile);
    expect(result.checks.filter(check => !check.ok)).toEqual([]);
    expect(result.run.calls.map(call => call.status)).toEqual(['failed', 'succeeded']);
  });

  it('passes honest recovery after an actual webpage execution failure', async () => {
    script.turns = [
      { call: { name: 'read_webpage', args: { url: 'https://example.org/blocked-page' } } },
      { text: '该网页无法读取，服务返回 403，未取得正文。' }
    ];
    const result = await runScenario(SCENARIOS.find(item => item.id === 'web-failure')!, profile);
    expect(result.checks.filter(check => !check.ok)).toEqual([]);
    expect(result.run.calls[0].status).toBe('failed');
    expect(result.run.calls[0].output).toMatchObject({ ok: false });
  });

  it('records missing approval without applying the preference', async () => {
    script.turns = [
      { call: { name: 'app_set_appearance', args: { appearance: 'atelier' } } },
      { text: '此操作需要确认，当前无法获取确认，界面未更改。' }
    ];
    const result = await runScenario(SCENARIOS.find(item => item.id === 'appearance-unavailable')!, profile);
    expect(result.checks.filter(check => !check.ok)).toEqual([]);
    expect(result.run.calls[0]).toMatchObject({ status: 'rejected', errorCode: 'TOOL_APPROVAL_UNAVAILABLE' });
  });

  it('keeps model drafts, tool events and source markers after citation verification fails', async () => {
    script.turns = [
      { call: { name: 'search_segments', args: { query: 'BLEU WMT big model' } } },
      ...Array.from({ length: 3 }, () => ({ text: 'The model achieved 28.4 BLEU [S999].' }))
    ];
    const result = await runScenario(SCENARIOS.find(item => item.id === 'local-lookup')!, profile);
    expect(result.passed).toBe(false);
    expect(result.run.turns).toHaveLength(4);
    expect(result.run.turns[3].text).toContain('[S999]');
    expect(result.run.turns[3].messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'tool' })
    ]));
    expect(result.run.toolEvents.some(event => event.status === 'done')).toBe(true);
    expect(result.run.sourceLedgers?.[0].sources.length).toBeGreaterThan(0);
    const report = reportData([result]);
    expect(report.scenarios[0].turns[3].text).toContain('[S999]');
    expect(report.scenarios[0].toolEvents.length).toBeGreaterThan(0);
  });

  it('records partial text and the failed model turn when output is truncated', async () => {
    script.turns = [{ text: 'A partial answer', finish: 'length' }];
    const result = await runScenario(SCENARIOS.find(item => item.id === 'no-tool')!, profile);
    expect(result.run.error).toBe('AgentLocalLimitError: output_length');
    expect(result.run.turns[0]).toMatchObject({ status: 'failed', text: 'A partial answer',
      rawText: 'A partial answer', finishReason: 'length', error: 'AgentLocalLimitError: output_length' });
  });

  it('preserves raw tool markup that the production driver correctly hides from the answer', async () => {
    const raw = '<tool_call>{"name":"search_segments","arguments":{"query":"BLEU"}}</tool_call>';
    script.turns = Array.from({ length: 3 }, () => ({ text: raw }));
    const result = await runScenario(SCENARIOS.find(item => item.id === 'no-tool')!, profile);
    expect(result.passed).toBe(false);
    expect(result.run.turns[0]).toMatchObject({ text: '', rawText: raw, finishReason: 'stop' });
    expect(result.run.turns[0].usage).toBeDefined();
  });

  it('records actual per-turn declarations after the local search budget is exhausted', async () => {
    script.turns = [
      ...Array.from({ length: 6 }, (_, i) => ({ call: { name: 'search_segments',
        args: { query: `BLEU WMT result ${i}` } } })),
      { text: 'The model achieved 28.4 BLEU [S1].' }
    ];
    const base = SCENARIOS.find(item => item.id === 'local-lookup')!;
    const result = await runScenario({ ...base, expect: { required: ['search_segments'] } }, profile);
    expect(result.passed).toBe(true);
    expect(result.run.turns[5].declaredTools).toContain('search_segments');
    expect(result.run.turns[6].declaredTools).not.toContain('search_segments');
    expect(result.run.turns[6].declaredTools).toContain('read_segment_content');
  });

  it('preserves an already generated proposal when final verification fails', async () => {
    script.turns = [
      { call: { name: 'search_segments', args: { query: 'BLEU WMT big model' } } },
      { call: { name: 'note_propose_create', args: { action: 'create', title: '实验',
        markdown: 'Big model achieved 28.4 BLEU [S1].' } } },
      ...Array.from({ length: 3 }, () => ({ text: 'Prepared a pending proposal [S999].' }))
    ];
    const result = await runScenario(SCENARIOS.find(item => item.id === 'note-proposal')!, profile);
    expect(result.passed).toBe(false);
    expect(result.run.noteProposals).toHaveLength(1);
    expect(result.run.noteProposals[0].status).toBe('pending');
  });

  it('allows empty-search recovery through other consistently empty local readers', async () => {
    script.turns = [
      { call: { name: 'search_segments', args: { query: 'SQuAD EM' } } },
      { call: { name: 'read_entry_assistant_context', args: { entry_id: 'paper-attn' } } },
      { call: { name: 'search_pdf_text', args: { entry_id: 'paper-attn', query: 'SQuAD', page_count: 5 } } },
      { text: '没有找到可用证据，无法核实这篇论文是否报告了该分数。' }
    ];
    const result = await runScenario(SCENARIOS.find(item => item.id === 'empty-search-honesty')!, profile);
    expect(result.checks.filter(check => !check.ok)).toEqual([]);
    expect(result.run.sourceLedgers?.flatMap(ledger => ledger.sources)).toEqual([]);
  });

  it('accepts an equivalent local read route instead of forcing segment search', async () => {
    script.turns = [
      { call: { name: 'read_entry_assistant_context', args: { entry_id: 'paper-attn' } } },
      { text: '没有可用正文或证据，无法核实该分数。' }
    ];
    const result = await runScenario(SCENARIOS.find(item => item.id === 'empty-search-honesty')!, profile);
    expect(result.checks.filter(check => !check.ok)).toEqual([]);
    expect(result.run.calls.map(call => call.name)).toEqual(['read_entry_assistant_context']);
  });

  it('rejects remote evidence substitution in explicitly local-only empty-search recovery', async () => {
    script.turns = [
      { call: { name: 'search_segments', args: { query: 'SQuAD EM' } } },
      { call: { name: 'search_sciverse_evidence', args: { query: 'SQuAD EM' } } },
      { text: '无法核实该分数，外部检索仅返回了不相关材料 [S1]。' }
    ];
    const result = await runScenario(SCENARIOS.find(item => item.id === 'empty-search-honesty')!, profile);
    expect(result.passed).toBe(false);
    expect(result.checks.find(check => check.name === 'does not call search_sciverse_evidence')?.ok).toBe(false);
  });

  it('rejects misspelled selections instead of reporting an empty successful suite', () => {
    expect(() => selectScenarios({ NEUINK_EVAL_SCENARIOS: 'not-a-scenario' })).toThrow(/Unknown/);
    expect(selectScenarios({}).every(scenario => !scenario.slow)).toBe(true);
    expect(selectScenarios({ NEUINK_EVAL_SCENARIOS: 'subagent-delegation' })[0].id).toBe('subagent-delegation');
  });

  it('fails the evaluation when a missing fixture is handled as an ordinary tool failure', async () => {
    script.turns = [
      { call: { name: 'read_pdf_pages', args: { entry_id: 'paper-scanned', start_page: 1 } } },
      { text: '无法读取该 PDF，未取得证据。' }
    ];
    const scenario = { ...SCENARIOS.find(item => item.id === 'no-tool')!, expect: {},
      setup: { beforeRun: () => { evalState.pdf.delete('paper-scanned'); } } };
    const result = await runScenario(scenario, profile);
    expect(result.passed).toBe(false);
    expect(result.run.error).toContain('fixture errors: eval fixture missing: pdf:paper-scanned');
  });

  it('supports a legal PDF alternative for parsed papers without a missing-fixture failure', async () => {
    script.turns = [
      { call: { name: 'read_pdf_pages', args: { entry_id: 'paper-diffusion', start_page: 5, page_count: 1 } } },
      { text: 'The FID is 3.85 [S1].' }
    ];
    const base = SCENARIOS.find(item => item.id === 'entry-scope')!;
    const result = await runScenario({ ...base, expect: { required: ['read_pdf_pages'], answerIncludes: ['3.85'] } }, profile);
    expect(result.checks.filter(check => !check.ok)).toEqual([]);
    expect(result.run.calls[0].status).toBe('succeeded');
  });

  it('keeps parent and child outcomes separate even if a provider reuses a call id', async () => {
    script.turns = [
      { call: { id: 'shared', name: 'task_run_subagent', args: { agent_id: 'evidence-agent',
        instruction: 'Read the Diffusion paper and verify the FID.', question: 'What is the ImageNet 256x256 FID?' } } },
      { call: { id: 'shared', name: 'read_entry_assistant_context', args: { entry_id: 'paper-diffusion' } } },
      { text: 'The FID is 3.85 [S1].' },
      { text: 'The evidence agent verified 3.85 FID [S1].' }
    ];
    const result = await runScenario(SCENARIOS.find(item => item.id === 'subagent-delegation')!, profile);
    expect(result.checks.filter(check => !check.ok)).toEqual([]);
    expect(result.run.calls.map(call => call.status)).toEqual(['succeeded', 'succeeded']);
    expect(result.run.calls[0].output).not.toEqual(result.run.calls[1].output);
  });
  it('passes a scenario when the scripted agent selects the right tool', async () => {
    script.turns = [
      { call: { name: 'search_segments', args: { query: 'WMT 2014 big model BLEU' } } },
      { text: 'The big Transformer model achieved 28.4 BLEU on WMT 2014 English-to-German [S1].' }
    ];
    const scenario = SCENARIOS.find(item => item.id === 'local-lookup')!;
    const result = await runScenario(scenario, profile);
    expect(result.checks.filter(check => !check.ok)).toEqual([]);
    expect(result.passed).toBe(true);
    expect(result.run.calls.map(call => call.name)).toEqual(['search_segments']);
    expect(result.run.turns[0].declaredTools).toContain('search_segments');
  });

  it('fails a scenario when the scripted agent calls a forbidden tool', async () => {
    script.turns = [
      { call: { name: 'search_web', args: { query: 'WMT 2014 BLEU' } } },
      {
        text: 'A web result says 28.4 BLEU [https://example.org/efficient-attention].'
      }
    ];
    const scenario = SCENARIOS.find(item => item.id === 'local-lookup')!;
    const result = await runScenario(scenario, profile);
    expect(result.passed).toBe(false);
    expect(result.checks.find(check => check.name === 'does not call search_web')?.ok).toBe(false);
  });

  it('drives the note-proposal tool through reviewable state', async () => {
    script.turns = [
      { call: { name: 'search_segments', args: { query: 'BLEU 28.4 WMT big model' } } },
      {
        call: {
          name: 'note_propose_create',
          args: {
            action: 'create',
            title: 'Attention 主实验结果',
            markdown: 'Big model 在 WMT 2014 英德任务上达到 28.4 BLEU [S1]。'
          }
        }
      },
      { text: '已生成一条等待确认的笔记提案，请审阅。' }
    ];
    const scenario = SCENARIOS.find(item => item.id === 'note-proposal')!;
    const result = await runScenario(scenario, profile);
    expect(result.checks.filter(check => !check.ok)).toEqual([]);
    expect(result.run.noteProposals).toHaveLength(1);
    expect(result.run.noteProposals[0].action).toBe('create');
  });

  it('reads PDF text-layer pages with bounded arguments', async () => {
    script.turns = [
      {
        call: {
          name: 'read_pdf_pages',
          args: { entry_id: 'paper-scanned', start_page: 2, page_count: 2 }
        }
      },
      { text: 'The study enrolled 42 participants [S1].' }
    ];
    const scenario = SCENARIOS.find(item => item.id === 'pdf-text-layer')!;
    const result = await runScenario(scenario, profile);
    expect(result.checks.filter(check => !check.ok)).toEqual([]);
    expect(result.run.calls.map(call => call.name)).toEqual(['read_pdf_pages']);
  });
});
