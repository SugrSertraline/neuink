import { expect,it,vi } from 'vitest';
import { parseMethodAdvice, recommendMethods } from './methodRecommendations';
import type { PaperCard } from '@/shared/ipc/ideationApi';
const api = vi.hoisted(() => ({ settings: vi.fn(), run: vi.fn() }));
vi.mock('@/shared/ipc/assistantApi', () => ({ getLlmSettings: api.settings }));
vi.mock('@/modules/assistant/sdk/modelTasks', () => ({ runJsonModelTask: api.run }));
const card: PaperCard = { id:'m', entry_id:'paper', title:'方法', body:'内容',kind:'method',origin:'ai_reviewed' };
const advice = { recommendations:[{ cardId:'m',relation:'alternative',reason:'理由',combination:'替换',caution:'待验证' }],gap:'',plan:'' };
it('allows only real confirmed unique cards and at most three suggestions', () => {
  expect(parseMethodAdvice(advice,[card]).recommendations[0].relation).toBe('alternative');
  expect(() => parseMethodAdvice(advice,[])).toThrow();
  expect(() => parseMethodAdvice(advice,[{...card,origin:'ai_draft'}])).toThrow();
  expect(() => parseMethodAdvice({...advice,recommendations:[...advice.recommendations,...advice.recommendations]},[card])).toThrow();
  expect(parseMethodAdvice({recommendations:[],gap:'没有合适方法',plan:''},[]).gap).toBe('没有合适方法');
});
it('uses configured assistant and excludes selected methods from candidates', async () => {
  api.settings.mockResolvedValue({assistant_profile:{max_context_length:16000,max_output_tokens:4000}});
  api.run.mockResolvedValue({recommendations:[],gap:'没有其他候选',plan:''});
  await recommendMethods({goal:'问题',background:'',constraints:'',selected:[card],candidates:[card],mode:'recommend'},new AbortController().signal);
  const call=api.run.mock.calls[api.run.mock.calls.length-1]![0];
  expect(JSON.parse(call.prompt).candidates).toEqual([]);
  expect(call.settings.max_output_tokens).toBe(4000);
});

it('recommends constraints as background, but rejects them as method recommendations', () => {
  const constraint={...card,kind:'constraint' as const};
  expect(parseMethodAdvice(advice,[constraint],'background').recommendations).toHaveLength(1);
  expect(()=>parseMethodAdvice(advice,[constraint],'method')).toThrow();
});
