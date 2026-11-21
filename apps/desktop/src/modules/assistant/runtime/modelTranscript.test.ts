import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';
import type { ConversationMessage } from '@/shared/ipc/assistantApi';
import type { AssistantModelTranscript } from '@/shared/types/modelTranscript';
import { modelTranscript, replayModelTranscript, conversationTranscriptSources, transcriptObservations } from './modelTranscript';
import { renderConversationContext, renderConversationTranscript } from './conversationTranscript';
import { SourceLedger } from './sourceLedger';

const source = { entry_id: 'entry', entry_title: 'Paper', segment_uid: 'segment', page_idx: 1, quote: 'Actual evidence.' };
const record = (messages: ModelMessage[], extra: Partial<AssistantModelTranscript> = {}): AssistantModelTranscript => ({
  version: 2, inputMessages: [], runId: 'execution-1', capturedAt: '2026-10-27T12:00:00Z', profileId: 'profile', model: 'model',
  protocol: 'anthropic', messages, sources: [[1, source]], ...extra
});
const chat = (role: 'user' | 'assistant', content: string, transcript?: AssistantModelTranscript): ConversationMessage => ({
  message_id: role, role, content, created_at: '', source_links: [],
  parts: transcript ? [{ type: 'model-transcript', transcript }] : []
});
const batch: ModelMessage[] = [
  { role: 'assistant', content: [
    { type: 'reasoning', text: 'Compare both.', providerOptions: { anthropic: { signature: 'sig' } } },
    { type: 'tool-call', toolCallId: 'call-1', toolName: 'read_segment_content', input: { entry_id: 'entry', segment_uid: 'segment' } },
    { type: 'tool-call', toolCallId: 'call-2', toolName: 'search_web', input: { query: 'trial' } }
  ] },
  { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call-1', toolName: 'read_segment_content',
    output: { type: 'json', value: { text: 'FULL_CONTENT_SENTINEL [S1]', providerOptions: { bodyField: 'keep this data' } } } }] },
  { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call-2', toolName: 'search_web',
    output: { type: 'error-text', value: 'TOOL_EXECUTION_FAILED' } }] },
  { role: 'assistant', content: 'A verified answer [S1].' }
];

describe('persisted model transcript replay', () => {
  it('replays v2 inputs and native IDs verbatim and does not duplicate UI user messages', () => {
    const inputMessages: ModelMessage[] = [{ role: 'user', content: 'Actual submitted request' }];
    const saved = record(batch, { version: 2, inputMessages, outcome: 'completed' });
    const replay = replayModelTranscript(saved);
    expect(replay).toEqual([...inputMessages, ...batch]);
    const history = [chat('user', 'Visible submitted request'), chat('assistant', 'Visible answer', saved)];
    expect(renderConversationTranscript(history)).toEqual([...inputMessages, ...batch]);
  });
  it('round-trips full outputs, errors, call ordering and matching IDs without mutating storage', () => {
    const saved = JSON.parse(JSON.stringify(record(batch)));
    const before = JSON.stringify(saved);
    const replay = replayModelTranscript(saved);
    expect(replay).toHaveLength(4);
    expect(JSON.stringify(replay)).toContain('FULL_CONTENT_SENTINEL [S1]');
    expect(replay[0]).toMatchObject({ content: [
      { type: 'reasoning', providerOptions: { anthropic: { signature: 'sig' } } },
      { type: 'tool-call', toolCallId: 'call-1' }, { type: 'tool-call', toolCallId: 'call-2' }
    ] });
    expect(replay[1]).toMatchObject({ role: 'tool', content: [{ toolCallId: 'call-1', output: { type: 'json' } }] });
    expect(replay[2]).toMatchObject({ role: 'tool', content: [{ toolCallId: 'call-2', output: { type: 'error-text' } }] });
    expect(JSON.stringify(saved)).toBe(before);
  });

  it('does not duplicate visible turns or rewrite native IDs across tasks', () => {
    const history = [
      chat('user', 'First request'), chat('assistant', 'UI answer [S1].', record(batch, {
        inputMessages: [{ role: 'user', content: 'First request' }]
      })),
      chat('user', 'Follow up'), chat('assistant', 'UI answer again.', record(batch, {
        runId: 'execution-2', sources: [], inputMessages: [{ role: 'user', content: 'Follow up' }]
      }))
    ];
    const replay = renderConversationTranscript(history);
    expect(JSON.stringify(replay)).not.toContain('UI answer');
    const calls = replay.flatMap(message => message.role === 'assistant' && Array.isArray(message.content)
      ? message.content.filter(part => part.type === 'tool-call').map(part => part.toolCallId) : []);
    expect(calls).toEqual(['call-1', 'call-2', 'call-1', 'call-2']);
    expect(replay.filter(message => message.content === 'First request')).toHaveLength(1);
    expect(replay.filter(message => message.content === 'Follow up')).toHaveLength(1);
  });

  it('keeps completed results but does not invent a result for an interrupted sibling call', () => {
    const replay = replayModelTranscript(record(batch.slice(0, 2), { outcome: 'cancelled' }));
    const text = JSON.stringify(replay);
    expect(text).toContain('FULL_CONTENT_SENTINEL');
    expect(text).not.toContain('"type":"tool-call","toolCallId":"call-2"');
    expect(text).toContain('outcome is unknown');
    expect(text).toContain('Historical task cancelled');
    expect(replay.filter(message => message.role === 'tool')).toHaveLength(1);
  });

  it('drops orphan results and duplicate IDs rather than creating invalid provider messages', () => {
    const replay = replayModelTranscript(record([batch[1], batch[0], batch[0], batch[1]]));
    const calls = replay.flatMap(turn => turn.role === 'assistant' && Array.isArray(turn.content)
      ? turn.content.filter(part => part.type === 'tool-call') : []);
    const results = replay.flatMap(turn => turn.role === 'tool' ? turn.content : []);
    expect(calls).toHaveLength(results.length);
    expect(JSON.stringify(replay)).toContain('outcome is unknown');
  });

  it('removes incompatible reasoning/signatures while preserving tool-result data on model switches', () => {
    const replay = replayModelTranscript(record(batch), { profileId: 'other', model: 'other', protocol: 'google' });
    expect(JSON.stringify(replay)).not.toContain('"signature"');
    expect(JSON.stringify(replay)).not.toContain('"type":"reasoning"');
    expect(JSON.stringify(replay)).toContain('keep this data');
    expect(JSON.stringify(replay)).toContain('"providerOptions":{"bodyField":"keep this data"}');
  });

  it('ignores display-only history and honours the current memory boundary', () => {
    const legacy = chat('assistant', 'Legacy answer [S99].');
    legacy.parts = [{ type: 'tool-result', id: 'old', toolName: 'read', summary: 'UI summary only' }];
    expect(renderConversationTranscript([chat('user', 'Question'), legacy])).toEqual([]);
    const checkpoint = chat('assistant', '');
    checkpoint.parts = [{ type: 'memory', memory: {
      summary: 'Earlier memory', decisions: [], entities: [], last_user_goal: null, open_items: [], user_preferences: [],
      message_count: 2, source_count: 1, pending_proposal_count: 0, updated_at: ''
    } }];
    const context = renderConversationContext([chat('user', 'Old'), chat('assistant', 'UI', record(batch)), checkpoint,
      chat('user', 'New'), chat('assistant', '', record([], { inputMessages: [{ role: 'user', content: 'New' }] }))]);
    expect(JSON.stringify(context)).toContain('Earlier memory');
    expect(JSON.stringify(context)).not.toContain('FULL_CONTENT_SENTINEL');
    expect(context[context.length - 1]?.content).toBe('New');
  });

  it('preserves source mappings across boundaries and allocates changed snapshots separately', () => {
    const history = [chat('assistant', 'UI', record(batch))];
    const ledger = new SourceLedger(conversationTranscriptSources(history));
    expect(ledger.add(source)).toBe(1);
    expect(ledger.add({ ...source, quote: 'The paper has changed.' })).toBe(2);
    expect(ledger.sources.get(1)?.quote).toBe('Actual evidence.');
    expect(() => conversationTranscriptSources([...history, chat('assistant', 'UI2', record([], {
      sources: [[1, { ...source, quote: 'different' }]]
    }))])).toThrow('编号冲突');
  });

  it('extracts citation metadata only from actual successful results', () => {
    const saved = record([
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'web', toolName: 'search_web', input: {} }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'web', toolName: 'search_web',
        output: { type: 'json', value: { results: [{ url: 'https://example.org', content: 'Returned content.' }] } } }] }
    ]);
    expect(transcriptObservations([chat('assistant', '', saved)])).toEqual([
      { toolName: 'search_web', output: { results: [{ url: 'https://example.org', content: 'Returned content.' }] } }
    ]);
    expect(transcriptObservations([chat('assistant', '', record(batch))])).toHaveLength(1);
  });

  it.each([1, 99])('does not replay v%s records or fall back to visible text', version => {
    const invalid = record(batch, { version: version as 2 });
    expect(modelTranscript(chat('assistant', 'UI', invalid))).toBeUndefined();
    const context = renderConversationContext([chat('user', 'Question'), chat('assistant', 'UI [S999]', invalid)]);
    expect(context).toEqual([]);
    expect(conversationTranscriptSources([chat('assistant', '', invalid)]).size).toBe(0);
  });

  it('requires saved inputs instead of reconstructing them from UI text', () => {
    const invalid = JSON.parse(JSON.stringify(record(batch)));
    delete invalid.inputMessages;
    expect(modelTranscript(chat('assistant', 'UI', invalid))).toBeUndefined();
    expect(renderConversationContext([chat('user', 'Question'), chat('assistant', 'UI', invalid)])).toEqual([]);
  });
});
