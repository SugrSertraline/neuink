// @vitest-environment node
// Opt-in; only synthetic conversation data goes to the user's configured provider.
import { readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { generateText } from 'ai';
import type { ConversationMessage, LlmProfile } from '@/shared/ipc/assistantApi';
import { updateConversationMemory } from '../harness/conversationMemory';
import { renderConversationContext } from '../runtime/conversationTranscript';
import { createNeuinkModel } from './provider';

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: globalThis.fetch }));
const settingsPath = process.env.NEUINK_LIVE_SETTINGS;
it.skipIf(!settingsPath)('live manual compact repairs a last-reply checkpoint and preserves earlier facts for the next request', async () => {
  const saved = JSON.parse(await readFile(settingsPath!, 'utf8')) as { llm_profiles: LlmProfile[]; assistant_llm_profile_id: string };
  const profile = saved.llm_profiles.find(item => item.id === saved.assistant_llm_profile_id);
  if (!profile?.api_key) throw new Error('No configured profile credential');
  const settings = { ...profile, max_context_length: 8_000, max_output_tokens: 4_096, temperature: 0, top_p: null };
  const chat = (role: 'user' | 'assistant', content: string, index: number): ConversationMessage => ({
    role, content, message_id: 'fixture-' + index, created_at: '', source_links: [], parts: []
  });
  const history = [chat('user', '我叫林同学，请用中文回答。', 0), chat('assistant', '记住了。', 1),
    chat('user', '介绍虚构论文 NEBULA-42，其实验有 23 名参与者，然后生成思维导图。', 2),
    chat('assistant', '已介绍论文，尚未完成思维导图。', 3), chat('user', '你好。', 4), chat('assistant', '你好！', 5)];
  history[3].parts = [{ type: 'model-transcript', transcript: { version: 1, runId: 'fixture', capturedAt: '',
    profileId: settings.id, model: settings.model, protocol: settings.api_protocol ?? '', sources: [], messages: [
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'read', toolName: 'read_segment_content', input: {} }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'read', toolName: 'read_segment_content',
        output: { type: 'text', value: 'Synthetic appendix data. '.repeat(1_400) } }] },
      { role: 'user', content: 'Internal verification feedback for the SAME task: Complete the original user request, not a summary.' },
      { role: 'assistant', content: 'NEBULA-42 有 23 名参与者；思维导图尚未完成。' }
    ] } }];
  const damaged = chat('assistant', '', 6);
  damaged.parts = [{ type: 'memory', memory: { summary: '如果你有什么需要，随时告诉我。', decisions: [], entities: [],
    last_user_goal: null, open_items: [], user_preferences: [], message_count: 6, source_count: 0, pending_proposal_count: 0, updated_at: '' } }];
  history.push(damaged, chat('user', '谢谢。', 7));
  try {
    const memory = await updateConversationMemory({ history, settings, answer: '', question: '', pendingProposalCount: 0, sourceCount: 0 });
    expect(memory.summary).toContain('林同学');
    expect(memory.summary).toContain('NEBULA-42');
    expect(memory.summary).toContain('23');
    expect(memory.summary).toContain('思维导图');
    const checkpoint = chat('assistant', '', 8);
    checkpoint.parts = [{ type: 'memory', memory }];
    const reloaded: ConversationMessage[] = JSON.parse(JSON.stringify([...history, checkpoint]));
    const reply = await generateText({ model: createNeuinkModel(settings), maxRetries: 0, maxOutputTokens: 2_048,
      abortSignal: AbortSignal.timeout(120_000), system: '根据已有记忆回答，缺失的信息不要猜测。',
      messages: [...renderConversationContext(reloaded), { role: 'user', content: '我叫什么，论文编号是什么，实验有几个人，还有什么未完成？' }] });
    expect(reply.text).toContain('林同学');
    expect(reply.text).toContain('NEBULA-42');
    expect(reply.text).toMatch(/23|二十三/);
    expect(reply.text).toContain('思维导图');
  } catch (error) {
    if (error instanceof Error && error.name === 'AssertionError') throw error;
    const failure = error as { name?: string; statusCode?: number };
    throw new Error(`Live compact failed: kind=${failure?.name ?? 'unknown'}, HTTP=${failure?.statusCode ?? 'none'} (provider details redacted)`);
  }
}, 180_000);
