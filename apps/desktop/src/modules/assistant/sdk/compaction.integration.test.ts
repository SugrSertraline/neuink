import { recordedTurn } from './testHelpers/conversation';
import { summaryResponse } from './testHelpers/summary';
import { beforeEach, expect, it, vi } from 'vitest';
import { generateText } from 'ai';
import type { ConversationMessage, AssistantConversationMemory, LlmProfile } from '@/shared/ipc/assistantApi';
import { createNeuinkModel } from './provider';
import { scriptedModel } from './testHelpers/model';
import { answerWithGroundedAgent } from './qna';
vi.mock('ai', async original => ({ ...await original<typeof import('ai')>(), generateText: vi.fn() }));
vi.mock('./provider', () => ({ createNeuinkModel: vi.fn(), generationSettings: () => ({}) }));
vi.mock('@/shared/ipc/assistantApi', async original => ({
  ...await original<typeof import('@/shared/ipc/assistantApi')>(),
  loadPrompt: async () => '{{question}}', listTools: async () => []
}));
const settings = { id: 'compact-profile', model: 'model', max_context_length: 8_000,
  base_url: 'https://example.invalid', api_key: null } as LlmProfile;
const scope = { entry_ids: [], entry_titles: [], tag_ids: [], tag_names: [] };
const longHistory = () => Array.from({ length: 20 }, (_, index) => recordedTurn(
  'HISTORY_' + index * 2 + ' ' + 'a'.repeat(1_000),
  'HISTORY_' + (index * 2 + 1) + ' ' + 'a'.repeat(1_000) + (index === 19 ? ' LAST_HISTORY_SENTINEL' : ''), index,
  { profileId: settings.id, model: settings.model, protocol: 'openai_compatible' })).flat();
const chat = (role: 'user' | 'assistant', content: string, index: number): ConversationMessage => ({
  message_id: 'm' + index, content, role, created_at: '', source_links: [], parts: []
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(generateText).mockResolvedValue({ text: summaryResponse('Merged old questions and preferences.'), finishReason: 'stop',
    usage: { inputTokens: 500, outputTokens: 50 } } as never);
});
it('keeps the automatic suffix across a completed run, persisted conversation and next request', async () => {
  const old: AssistantConversationMemory = { summary: 'PRIOR_MEMORY_SENTINEL', decisions: [], entities: [], last_user_goal: null,
    open_items: [], user_preferences: ['OLD_PREFERENCE_SENTINEL'], message_count: 2, source_count: 0,
    pending_proposal_count: 0, updated_at: '' };
  const checkpoint = chat('assistant', '', 0);
  checkpoint.parts = [{ type: 'memory', memory: old }];
  const history = [checkpoint, ...longHistory()];
  vi.mocked(createNeuinkModel).mockReturnValue(scriptedModel([{ text: 'NEW_FINAL_ANSWER_SENTINEL' }]));
  const result = await answerWithGroundedAgent({ question: 'CURRENT_REQUEST_SENTINEL', root: 'fixture', scope, settings, conversationHistory: history });
  const memory = result.conversationMemory!;
  expect(memory).not.toHaveProperty('context_baseline');
  const retained = JSON.stringify(memory.retained_context);
  expect(retained).toContain('LAST_HISTORY_SENTINEL');
  expect(retained).toContain('CURRENT_REQUEST_SENTINEL');
  expect(retained).toContain('NEW_FINAL_ANSWER_SENTINEL');
  expect(retained).not.toContain('HISTORY_0 ');
  const supplied = vi.mocked(generateText).mock.calls.map(([call]) => call.prompt).join('\n');
  expect(supplied).toContain('PRIOR_MEMORY_SENTINEL');
  expect(supplied).toContain('OLD_PREFERENCE_SENTINEL');
  expect(supplied).toContain('HISTORY_0 ');
  const completed = chat('assistant', result.answer, 43);
  completed.parts = [{ type: 'memory', memory }, { type: 'model-transcript', transcript: result.modelTranscript! }];
  const disk: ConversationMessage[] = JSON.parse(JSON.stringify([...history, chat('user', 'CURRENT_REQUEST_SENTINEL', 42), completed]));
  const summaries = vi.mocked(generateText).mock.calls.length;
  const next = scriptedModel([{ text: 'Continued from recent context.' }]);
  vi.mocked(createNeuinkModel).mockReturnValue(next);
  await answerWithGroundedAgent({ question: 'NEXT_REQUEST', root: 'fixture', scope, settings, conversationHistory: disk });
  const request = JSON.stringify(next.doStreamCalls[0].prompt);
  expect(request).toContain('Merged old questions and preferences.');
  expect(request).toContain('LAST_HISTORY_SENTINEL');
  expect(request).toContain('NEW_FINAL_ANSWER_SENTINEL');
  expect(request).not.toContain('HISTORY_0 ');
  expect(generateText).toHaveBeenCalledTimes(summaries);
});
it('keeps a compacted request prefix fixed through a tool step, restart and another user turn', async () => {
  const currentEntry = {id:'paper-A',title:'Paper A'};
  vi.mocked(generateText).mockImplementation(async () => {
    // The live reading target changes while the submitted request is being compacted.
    currentEntry.id = 'paper-B'; currentEntry.title = 'Paper B';
    return {text:summaryResponse('Earlier discussion.'),finishReason:'stop',usage:{inputTokens:500,outputTokens:50}} as never;
  });
  const history = longHistory();
  history[history.length-1].parts = [{type:'tool-result',id:'diagram',toolName:'present_diagram',summary:'Previous diagram',
    diagram:{kind:'mindmap',title:'Previous',code:'mindmap\n  root[Topic]',sourceMarkers:[]}}];
  const model = scriptedModel([{call:{name:'read_context_reference',args:{context_ref:'latest_diagram'}}},
    {text:'已取回之前的图表代码。'}]);
  vi.mocked(createNeuinkModel).mockReturnValue(model);
  const result = await answerWithGroundedAgent({question:'取回之前的图表代码',root:'fixture',scope,settings,conversationHistory:history,currentEntry});
  const first = model.doStreamCalls[0].prompt, second = model.doStreamCalls[1].prompt;
  expect(second.slice(0,first.length)).toEqual(first);
  expect(JSON.stringify(second)).toContain('paper-A');
  expect(JSON.stringify(second)).not.toContain('paper-B');
  expect(JSON.stringify(second).match(/<workspace_context>/g)?.length)
    .toBe(JSON.stringify(first).match(/<workspace_context>/g)?.length);
  const completed = chat('assistant',result.answer,42);
  completed.parts = [{type:'memory',memory:result.conversationMemory!},{type:'model-transcript',transcript:result.modelTranscript!}];
  const disk: ConversationMessage[] = JSON.parse(JSON.stringify([...history,chat('user','取回之前的图表代码',41),completed]));
  const next = scriptedModel([{text:'继续。'}]);
  vi.mocked(createNeuinkModel).mockReturnValue(next);
  const summaries = vi.mocked(generateText).mock.calls.length;
  const again = await answerWithGroundedAgent({question:'继续',root:'fixture',scope,settings,conversationHistory:disk,
    currentEntry:{id:'paper-A',title:'Paper A'}});
  expect(next.doStreamCalls[0].prompt.slice(0,second.length)).toEqual(second);
  expect(again.modelTranscript?.inputMessages).toEqual([{role:'user',content:'继续'}]);
  expect(generateText).toHaveBeenCalledTimes(summaries);
});
it('does not advance a checkpoint or call the main model when automatic summarization fails', async () => {
  const history = longHistory();
  const before = JSON.stringify(history);
  vi.mocked(generateText).mockResolvedValue({ text: 'broken', finishReason: 'length', usage: {} } as never);
  const model = scriptedModel([{ text: 'Should not be called' }]);
  vi.mocked(createNeuinkModel).mockReturnValue(model);
  await expect(answerWithGroundedAgent({ question: 'Continue', root: 'fixture', scope, settings, conversationHistory: history }))
    .rejects.toThrow('上下文摘要无效');
  expect(model.doStreamCalls).toHaveLength(0);
  expect(JSON.stringify(history)).toBe(before);
});

it('reloads automatically retained tool calls, full results and citation aliases as a complete batch', async () => {
  const history = longHistory();
  history.push(chat('user', 'Recent tool question', 40));
  const recent = chat('assistant', 'Recent answer [S1]', 41);
  recent.parts = [{ type: 'model-transcript', transcript: { inputMessages: [{ role: 'user', content: 'Recent tool question' }],
    version: 2, runId: 'old-run', capturedAt: '', profileId: settings.id, model: settings.model,
    protocol: 'openai_compatible', sources: [], displaySourceMarkers: [7], messages: [
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'historical-read', toolName: 'read_note', input: { entry_id: 'e' } }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'historical-read', toolName: 'read_note',
        output: { type: 'json', value: { markdown: 'a'.repeat(1_000) + ' FULL_TAIL_TOOL_SENTINEL', revision: 'old-revision' } } }] },
      { role: 'assistant', content: 'Recent answer [S1]' }
    ]
  } }];
  history.push(recent);
  vi.mocked(createNeuinkModel).mockReturnValue(scriptedModel([{ text: 'Continue without new tools.' }]));
  const result = await answerWithGroundedAgent({ question: 'Keep going', root: 'fixture', scope, settings, conversationHistory: history });
  const completed = chat('assistant', result.answer, 43);
  completed.parts = [{ type: 'memory', memory: result.conversationMemory! }];
  const disk: ConversationMessage[] = JSON.parse(JSON.stringify([...history, chat('user', 'Keep going', 42), completed]));
  const next = scriptedModel([{ text: 'Continued.' }]);
  vi.mocked(createNeuinkModel).mockReturnValue(next);
  await answerWithGroundedAgent({ question: 'Next', root: 'fixture', scope, settings, conversationHistory: disk });
  const prompt = next.doStreamCalls[0].prompt;
  const text = JSON.stringify(prompt);
  expect(text).toContain('FULL_TAIL_TOOL_SENTINEL');
  expect(text).toContain('old-revision');
  expect(text).toContain('[S7]');
  const assistant = prompt.find(message => message.role === 'assistant' && Array.isArray(message.content)
    && message.content.some(part => part.type === 'tool-call'));
  const tool = prompt.find(message => message.role === 'tool');
  if (assistant?.role !== 'assistant' || tool?.role !== 'tool') throw new Error('Retained tool batch missing');
  const call = assistant.content.find(part => part.type === 'tool-call');
  expect(tool.content[0]).toMatchObject({ toolCallId: call!.toolCallId });
});
