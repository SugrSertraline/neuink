import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelMessage } from 'ai';
import type { ConversationMessage, LlmProfile } from '@/shared/ipc/assistantApi';
import type { AssistantModelTranscript } from '@/shared/types/modelTranscript';
import { invokeAssistantTool } from '@/shared/ipc/assistantApi';
import { DEFAULT_AGENT_RUNTIME_SETTINGS } from '@/shared/lib/agentRuntimeSettings';
import { createNeuinkModel } from './provider';
import { scriptedModel } from './testHelpers/model';
import { answerWithGroundedAgent } from './qna';
import { conversationTranscriptSources } from '../runtime/modelTranscript';
import { buildDirectExecution } from '../runtime/executionPolicy';

vi.mock('./provider', () => ({ createNeuinkModel: vi.fn(), generationSettings: () => ({}) }));
vi.mock('@/shared/ipc/assistantApi', async original => ({
  ...await original<typeof import('@/shared/ipc/assistantApi')>(),
  loadPrompt: vi.fn(async () => '{{question}}'),
  listTools: vi.fn(async () => [{ name: 'read_segment_content', description: 'Read evidence', parameters_schema: {
    type: 'object', properties: { entry_id: { type: 'string' }, segment_uid: { type: 'string' } },
    required: ['entry_id', 'segment_uid']
  } }]),
  invokeAssistantTool: vi.fn()
}));
const settings = { id: 'profile', model: 'model', base_url: 'https://example.invalid', api_key: null } as LlmProfile;
const scope = { entry_ids: ['entry'], entry_titles: ['Paper'], tag_ids: [], tag_names: [] };
const options = { root: 'fixture', question: 'Read the trial result.', scope, settings };
function turn(content: string, role: 'user' | 'assistant', transcript?: AssistantModelTranscript): ConversationMessage {
  return { message_id: role + Math.random(), content, role, created_at: '', source_links: [],
    parts: transcript ? [{ type: 'model-transcript', transcript }] : [] };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(invokeAssistantTool).mockResolvedValue({
    entry_id: 'entry', entry_title: 'Paper', segment_uid: 'segment', page_idx: 1, text: 'FULL_TRIAL_DATA: 42 participants.'
  });
});
describe('cross-turn context through the real provider driver', () => {
  it('replays the full result on the next request without re-executing the read or duplicating text', async () => {
    const firstModel = scriptedModel([
      { call: { name: 'read_segment_content', args: { entry_id: 'entry', segment_uid: 'segment' } } },
      { text: 'The trial enrolled 42 participants [S1].' }
    ]);
    vi.mocked(createNeuinkModel).mockReturnValue(firstModel);
    const snapshots: AssistantModelTranscript[] = [];
    const first = await answerWithGroundedAgent({ ...options, onModelTranscript: value => { snapshots.push(value); } });
    expect(first.modelTranscript?.messages).toHaveLength(3);
    expect(snapshots[0].messages).toEqual([]);
    const history = JSON.parse(JSON.stringify([
      turn(options.question, 'user'), turn(first.answer, 'assistant', first.modelTranscript)
    ])) as ConversationMessage[];
    const nextModel = scriptedModel([{ text: 'As read previously, 42 participants [S1].' }]);
    vi.mocked(createNeuinkModel).mockReturnValue(nextModel);
    const next = await answerWithGroundedAgent({ ...options, question: 'How many participants was that?', conversationHistory: history });
    const prompt = nextModel.doStreamCalls[0].prompt;
    expect(JSON.stringify(prompt)).toContain('FULL_TRIAL_DATA: 42 participants.');
    expect(prompt.some(message => message.role === 'tool')).toBe(true);
    const text = JSON.stringify(prompt);
    expect(text.match(/The trial enrolled 42 participants/g)).toHaveLength(1);
    expect(invokeAssistantTool).toHaveBeenCalledOnce();
    expect(next.sources[0].quote).toContain('42 participants');
    expect(next.modelTranscript?.messages).toHaveLength(1);
    expect(JSON.stringify(next.modelTranscript?.messages)).not.toContain('FULL_TRIAL_DATA');
    expect(next.modelTranscript?.sources).toEqual([]);
  });

  it('keeps old source snapshots when the same segment changes and records only new sources', async () => {
    vi.mocked(createNeuinkModel).mockReturnValue(scriptedModel([
      { call: { name: 'read_segment_content', args: { entry_id: 'entry', segment_uid: 'segment' } } },
      { text: '42 participants [S1].' }
    ]));
    const first = await answerWithGroundedAgent(options);
    const history = [turn(options.question, 'user'), turn(first.answer, 'assistant', first.modelTranscript)];
    vi.mocked(invokeAssistantTool).mockResolvedValueOnce({
      entry_id: 'entry', entry_title: 'Paper', segment_uid: 'segment', page_idx: 1, text: 'UPDATED_TRIAL_DATA: 43 participants.'
    });
    vi.mocked(createNeuinkModel).mockReturnValue(scriptedModel([
      { call: { name: 'read_segment_content', args: { entry_id: 'entry', segment_uid: 'segment' } } },
      { text: 'The updated file reports 43 participants [S2].' }
    ]));
    const next = await answerWithGroundedAgent({ ...options, question: 'Read the current result again.', conversationHistory: history });
    expect(next.modelTranscript?.sources).toMatchObject([[2, { quote: 'UPDATED_TRIAL_DATA: 43 participants.' }]]);
    expect(next.sources[0].quote).toContain('43 participants');
    expect(next.modelTranscript?.displaySourceMarkers).toEqual([2]);
    const sources = conversationTranscriptSources([...history, turn('again', 'user'), turn(next.answer, 'assistant', next.modelTranscript)]);
    expect(sources.get(1)?.quote).toContain('42 participants');
    expect(sources.get(2)?.quote).toContain('43 participants');
  });

  it('does not let old limits or consecutive failures disable tools in a new task', async () => {
    const messages: ModelMessage[] = [];
    for (let index = 0; index < 6; index++) messages.push(
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'old-' + index, toolName: 'search_web', input: { query: 'old' } }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'old-' + index, toolName: 'search_web',
        output: { type: 'error-text', value: 'TOOL_LIMIT_REACHED：没有新信息' } }] }
    );
    const transcript: AssistantModelTranscript = {
      version: 1, runId: 'old-run', capturedAt: '', profileId: settings.id, model: settings.model,
      protocol: 'openai_compatible', messages, sources: [], outcome: 'failed'
    };
    const model = scriptedModel([
      { call: { name: 'read_segment_content', args: { entry_id: 'entry', segment_uid: 'segment' } } },
      { text: 'The new read returned 42 participants [S1].' }
    ]);
    vi.mocked(createNeuinkModel).mockReturnValue(model);
    const result = await answerWithGroundedAgent({ ...options, conversationHistory: [
      turn('Old search', 'user'), turn('Failed', 'assistant', transcript)
    ] });
    expect(invokeAssistantTool).toHaveBeenCalledOnce();
    expect(result.answer).toContain('42 participants');
    expect(model.doStreamCalls[0].tools?.some(tool => tool.type === 'function' && tool.name === 'read_segment_content')).toBe(true);
  });

  it('does not let a historical note read satisfy the current write precondition', async () => {
    const transcript: AssistantModelTranscript = {
      version: 1, runId: 'old-note', capturedAt: '', profileId: settings.id, model: settings.model,
      protocol: 'openai_compatible', sources: [], messages: [
        { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'note', toolName: 'read_note',
          input: { entry_id: 'entry', note_id: 'note' } }] },
        { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'note', toolName: 'read_note',
          output: { type: 'json', value: { entry_id: 'entry', note_id: 'note', markdown: 'Old note', revision: 'old-revision' } } }] }
      ]
    };
    const model = scriptedModel([
      { call: { name: 'note_propose_patch', args: { entry_id: 'entry', note_id: 'note', action: 'append', markdown: 'New addition' } } },
      { text: 'A fresh note read is required before proposing changes.' }
    ]);
    vi.mocked(createNeuinkModel).mockReturnValue(model);
    const result = await answerWithGroundedAgent({ ...options, currentNote: {
      entryId: 'entry', entryTitle: 'Paper', noteId: 'note', noteTitle: 'Notes'
    }, activeExecution: { agent: DEFAULT_AGENT_RUNTIME_SETTINGS.mainAssistant },
    invocationPlan: { enabledToolIds: ['note.propose_patch'], mainAssistantId: 'main-assistant', missing: [],
      mode: 'agent_execute', rationale: '', subagentTasks: [], writePolicy: 'proposal_only' },
    plan: buildDirectExecution(DEFAULT_AGENT_RUNTIME_SETTINGS, 'Append to the note.').plan,
    runtimeSettings: DEFAULT_AGENT_RUNTIME_SETTINGS, conversationHistory: [
      turn('Read note', 'user'), turn('Read', 'assistant', transcript)
    ] });
    expect(result.noteProposals).toEqual([]);
    expect(JSON.stringify(model.doStreamCalls[1].prompt)).toContain('TOOL_PREFLIGHT_FAILED');
  });
});
