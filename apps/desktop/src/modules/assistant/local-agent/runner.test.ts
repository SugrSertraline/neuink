// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runLocalAgent } from '@/shared/ipc/localAgentApi';
import { getAssistantContextSnapshot, invokeAssistantTool, loadAgentRuntimeSettings, listTools } from '@/shared/ipc/assistantApi';
import { readNote } from '@/shared/ipc/workspaceApi';
import { DEFAULT_AGENT_RUNTIME_SETTINGS } from '@/shared/lib/agentRuntimeSettings';
import { setLocalAgentEnabled } from '@/shared/lib/localAgentSettings';
import { runLocalAgentHarness } from './runner';
import { CLAUDE_PROFILE } from './session';
import type { RunAssistantHarnessOptions } from '../harness/engine';
import { getToolApprovals, requestToolApproval } from '../runtime/toolApproval';
import { getUserInputs, requestUserInput } from '../runtime/userInput';
import { inspectPdfText } from '@/shared/ipc/pdfTextApi';
vi.mock('@/shared/ipc/agentExecutionApi', () => ({ saveAgentExecution: vi.fn(async (_root, record) => ({ ...record, revision: record.revision + 1 })), readAgentExecution: vi.fn() }));
vi.mock('@/shared/ipc/localAgentApi', () => ({runLocalAgent:vi.fn()}));
vi.mock('@/shared/ipc/assistantApi', async original => ({...await original<typeof import('@/shared/ipc/assistantApi')>(),
  getAssistantContextSnapshot:vi.fn(), loadAgentRuntimeSettings:vi.fn(), listTools:vi.fn(), invokeAssistantTool:vi.fn()}));
vi.mock('@/shared/ipc/workspaceApi', () => ({readNote:vi.fn()}));
vi.mock('@/shared/ipc/pdfTextApi', async original => ({...await original<typeof import('@/shared/ipc/pdfTextApi')>(),inspectPdfText:vi.fn()}));
const session = {type:'local-agent',provider:'claude',sessionId:'550e8400-e29b-41d4-a716-446655440000',initialized:false} as const;
function options(extra:Partial<RunAssistantHarnessOptions> = {}): RunAssistantHarnessOptions {
  return {root:'C:/fixture',conversationId:'c1',question:'修改目标笔记',settings:CLAUDE_PROFILE,
    scope:{entry_ids:['entry1'],entry_titles:['Entry'],tag_ids:[],tag_names:[]},
    currentEntry:{id:'entry1',title:'Entry'}, currentNote:{entryId:'entry1',entryTitle:'Entry',noteId:'n1',noteTitle:'Note'},...extra};
}
type Handler = Parameters<typeof runLocalAgent>[3];
const call = async (handler:Handler,name:string,input:unknown,id = name) => {
  const output = await handler({type:'tool',id,name,input}) as {content:Array<{text:string}>;isError?:boolean};
  let value:unknown;
  try { value = JSON.parse(output.content[0].text); } catch { value = output.content[0].text; }
  return {...output,value:value as Record<string,unknown>};
};
const read = {entry_id:'entry1',note_id:'n1'};
const patch = {action:'patch',entry_id:'entry1',note_id:'n1',target:'markdown_note',title:'Note',
  patch_operations:[{type:'replace_lines',start_line:3,end_line:3,expected_text:'Old text',new_text:'New text'}]};
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); setLocalAgentEnabled(true);
  vi.mocked(getAssistantContextSnapshot).mockResolvedValue({active_entry:null,active_note:null,document:null,pinned_segments:[],warnings:[]});
  vi.mocked(loadAgentRuntimeSettings).mockResolvedValue(DEFAULT_AGENT_RUNTIME_SETTINGS);
  vi.mocked(listTools).mockResolvedValue([]);
  vi.mocked(readNote).mockResolvedValue({note_id:'n1',title:'Note',markdown:'# Heading\n\nOld text\n',revision:'r1',links:[]});
});
describe('Claude integration with production NeuInk tools', () => {
  it.each(['claude','codex','opencode','partial'] as const)('%s reads bounded parsed paper chunks through the production host', async mode => {
    const provider = mode === 'partial' ? 'claude' : mode;
    vi.mocked(listTools).mockResolvedValue([{name:'read_entry_assistant_context',description:'Read paper',parameters_schema:{
      type:'object',properties:{root:{type:'string'},entry_id:{type:'string'}},required:['root','entry_id'],additionalProperties:false,
    }}]);
    vi.mocked(invokeAssistantTool).mockResolvedValue({entry_id:'entry1',entry_title:'Paper',has_pdf:true,parsed_segment_count:2,
      markdown:[1,2].map(n => `[S${n}] segment_uid: s${n}\n${`Evidence ${n}. `.repeat(700)}\n`).join('\n'),
      sources:[1,2].map(n => ({entry_id:'entry1',entry_title:'Paper',page_idx:n-1,segment_uid:`s${n}`,quote:`Evidence ${n}.`}))});
    vi.mocked(runLocalAgent).mockImplementation(async (request,_signal,_event,handle) => {
      expect(request.provider).toBe(provider);
      const descriptor = request.tools.find(tool => tool.name === 'read_entry_assistant_context');
      expect(descriptor?.description).toContain('next_read');
      let input:unknown = {entry_id:'entry1'}, reads = 0;
      do {
        const page = await call(handle,'read_entry_assistant_context',input,`paper-${++reads}`);
        expect(page.isError).not.toBe(true);
        expect(page.content[0].text.length).toBeLessThan(20_000);
        expect(page.value).toMatchObject({reading_mode:'parsed_markdown',source_markers:expect.any(Array)});
        input = page.value.next_read;
        if (mode === 'partial') break;
        expect(reads).toBeLessThan(10);
      } while (input);
      return {result:mode === 'partial' ? '根据已取得的部分正文回答。[S1]' : '根据两个片段回答。[S1][S2]'};
    });
    const result = await runLocalAgentHarness(options({question:'阅读这篇论文',currentNote:null}),{...session,provider},vi.fn());
    expect(result.hadRecoverableFailures).toBe(false);
    expect(result.toolEvents?.every(event => event.status === 'done')).toBe(true);
    expect(result.sources).toHaveLength(mode === 'partial' ? 1 : 2);
    expect(result.answer.includes('尚未覆盖全部解析正文')).toBe(mode === 'partial');
    expect(inspectPdfText).not.toHaveBeenCalled();
    expect(vi.mocked(invokeAssistantTool).mock.calls.every(([name,input]) =>
      name === 'read_entry_assistant_context' && JSON.stringify(input) === JSON.stringify({root:'C:/fixture',entry_id:'entry1'}))).toBe(true);
  });
  it.each(['codex','opencode'] as const)('%s uses real host note tools and persists its returned session identity',async provider=>{
    const onSession=vi.fn(), requestToolApproval=vi.fn(async()=>false);
    vi.mocked(runLocalAgent).mockImplementation(async (request,_signal,event,handle)=>{
      expect(request.provider).toBe(provider);
      event({type:'message',value:{type:'local_agent_init',session_id:'session_real_123'}});
      expect((await call(handle,'note_propose_patch',patch)).isError).toBe(true);
      await call(handle,'read_note',read);
      expect((await call(handle,'note_propose_patch',patch)).isError).not.toBe(true);
      const approval=await call(handle,'approve_tool',{tool_name:'Bash',input:{command:'example'}});
      expect(approval.value.behavior).toBe('deny');
      return {result:'生成了待确认提案'};
    });
    const result=await runLocalAgentHarness(options({requestToolApproval}),{...session,provider},onSession);
    expect(onSession).toHaveBeenCalledWith(expect.objectContaining({provider,sessionId:'session_real_123',initialized:true}));
    expect(result.noteProposals).toHaveLength(1);
    expect(requestToolApproval).toHaveBeenCalledWith(expect.objectContaining({toolName:`${provider}.Bash`}),expect.any(AbortSignal));
  });
  it('replays the six-page rejection followed by successful 5+1 reads and reports truncated evidence', async () => {
    vi.mocked(inspectPdfText).mockImplementation(async (_root,entry,start,count) => ({entry_id:entry,entry_title:'Paper',revision:'r1',
      page_count:21,pages:Array.from({length:count},(_,n) => ({page_idx:start+n-1,text:'Actual paper text',truncated:[2,3,8,20].includes(start+n)}))}));
    vi.mocked(runLocalAgent).mockImplementation(async (request,_signal,event,handle) => {
      expect(request.prompt).toContain('Tool failures are observations');
      for (const start of [1,6,11]) await call(handle,'read_pdf_pages',{entry_id:'entry1',start_page:start,page_count:5},`batch-${start}`);
      event({type:'message',value:{type:'assistant',message:{content:[{type:'tool_use',id:'invalid',name:'mcp__neuink__read_pdf_pages',
        input:{entry_id:'entry1',start_page:16,page_count:6}}]}}});
      const rejected = await call(handle,'read_pdf_pages',{entry_id:'entry1',start_page:16,page_count:6});
      expect(rejected.isError).toBe(true); expect(inspectPdfText).toHaveBeenCalledTimes(3);
      event({type:'message',value:{type:'user',message:{content:[{type:'tool_result',tool_use_id:'invalid',is_error:true,content:rejected.content[0].text}]}}});
      expect((await call(handle,'read_pdf_pages',{entry_id:'entry1',start_page:16,page_count:5},'batch1')).isError).not.toBe(true);
      expect((await call(handle,'read_pdf_pages',{entry_id:'entry1',start_page:21,page_count:1},'batch2')).isError).not.toBe(true);
      return {result:'根据取得的正文回答。[S1]'};
    });
    const result = await runLocalAgentHarness(options(),session,vi.fn());
    expect(result.toolEvents).toContainEqual(expect.objectContaining({id:'invalid',status:'error',recovered:true}));
    expect(result.answer).toContain('第 1–21 页（共 21 页）');
    expect(result.answer).toContain('第 2–3、8、20 页正文有截断');
    expect(result.answer).toContain('不能据此确认已完整阅读');
  });
  it('returns host-classified document failures as MCP errors instead of successful text results', async () => {
    vi.mocked(inspectPdfText).mockRejectedValue(new Error('PDF 基础读取超时 secret-path'));
    vi.mocked(runLocalAgent).mockImplementation(async (_request,_signal,_event,handle) => {
      const failure = await call(handle,'read_pdf_pages',{entry_id:'entry1',start_page:1,page_count:1});
      expect(failure.isError).toBe(true); expect(failure.value.code).toBe('TOOL_EXECUTION_FAILED');
      expect(failure.content[0].text).not.toContain('secret-path');
      return {result:'未取得正文。'};
    });
    const result = await runLocalAgentHarness(options(),session,vi.fn());
    expect(result.answer).not.toContain('已扫描');
  });
  it('validates fresh reads and produces an immutable review draft without saving any files', async () => {
    const initialized = vi.fn();
    vi.mocked(runLocalAgent).mockImplementation(async (request,_signal,event,handle) => {
      expect(request.resume).toBe(false);
      expect(request.tools.some(t => t.name === 'note_propose_patch')).toBe(true);
      event({type:'message',value:{type:'system',subtype:'init',mcp_servers:[{name:'neuink',status:'connected'}]}});
      const approval = await call(handle,'approve_tool',{tool_name:'mcp__neuink__read_note',input:read});
      expect(approval.value.behavior).toBe('allow');
      await call(handle,'read_note',read);
      const output = await call(handle,'note_propose_patch',patch);
      expect(output.isError, JSON.stringify(output)).not.toBe(true);
      return {result:'修改提案等待确认。'};
    });
    const requestToolApproval = vi.fn();
    const result = await runLocalAgentHarness(options({requestToolApproval}),session,initialized);
    expect(readNote).toHaveBeenCalledOnce(); expect(requestToolApproval).not.toHaveBeenCalled();
    expect(initialized).toHaveBeenCalledWith({...session,initialized:true});
    expect(result.noteProposals).toHaveLength(1);
    expect(result.noteProposals![0]).toMatchObject({beforeMarkdown:'# Heading\n\nOld text\n',
      patchOperations:[{type:'replace_lines',startLine:3,endLine:3,expectedText:'Old text',newText:'New text'}],
      status:'pending',baseContentHash:expect.any(String),proposalDigest:expect.any(String),idempotencyKey:expect.any(String)});
  });
  it('rejects invalid parameters, failed fresh reads and out-of-scope targets without drafting writes', async () => {
    vi.mocked(readNote).mockRejectedValueOnce(new Error('note unavailable'));
    vi.mocked(runLocalAgent).mockImplementation(async (_request,_signal,_event,handle) => {
      expect((await call(handle,'read_note',{entry_id:37,note_id:'secret'})).isError).toBe(true);
      await call(handle,'read_note',read);
      expect((await call(handle,'note_propose_patch',patch)).isError).toBe(true);
      await call(handle,'read_note',{entry_id:'outside',note_id:'n1'});
      return {result:'无法修改'};
    });
    const result = await runLocalAgentHarness(options(),session,vi.fn());
    expect(result.noteProposals).toHaveLength(0); expect(readNote).toHaveBeenCalledExactlyOnceWith('C:/fixture','entry1','n1');
  });
  it('keeps native traces and presents native operations for single-call approval', async () => {
    const requestToolApproval = vi.fn(async () => false);
    vi.mocked(runLocalAgent).mockImplementation(async (_request,_signal,event,handle) => {
      event({type:'message',value:{type:'assistant',uuid:'t1',message:{content:[{type:'tool_use',id:'native',name:'Read'}]}}});
      event({type:'message',value:{type:'user',message:{content:[{type:'tool_result',tool_use_id:'native'}]}}});
      const decision = await call(handle,'approve_tool',{tool_name:'Bash',input:{command:'echo hello'}});
      expect(decision.value.behavior).toBe('deny');
      return {result:'done'};
    });
    const result = await runLocalAgentHarness(options({requestToolApproval}),{...session,initialized:true},vi.fn());
    expect(result.toolEvents).toContainEqual(expect.objectContaining({id:'native',toolName:'claude.Read',status:'done'}));
    expect(requestToolApproval).toHaveBeenCalledOnce();
    expect(vi.mocked(runLocalAgent).mock.calls[0][0].resume).toBe(true);
  });
  it('normalizes citations using one shared marker namespace', async () => {
    vi.mocked(runLocalAgent).mockResolvedValue({result:'第二来源 [S2]，第一来源 [S1]'});
    const result = await runLocalAgentHarness(options({assistantContext:{items:[1,2].map(n => ({kind:'segment' as const,id:`s${n}`,
      entryId:'entry1',entryTitle:'Entry',segmentUid:`s${n}`,pageIdx:n,text:`source ${n}`,addedAt:''}))}}),session,vi.fn());
    expect(result.answer).toBe('第二来源 [S1]，第一来源 [S2]');
    expect(result.sources.map(s => 'segment_uid' in s ? s.segment_uid : null)).toEqual(['s2','s1']);
  });
  it('respects opt-out, failed permission config and read-only policy', async () => {
    setLocalAgentEnabled(false);
    await expect(runLocalAgentHarness(options(),session,vi.fn())).rejects.toThrow('已关闭');
    expect(runLocalAgent).not.toHaveBeenCalled(); setLocalAgentEnabled(true);
    vi.mocked(loadAgentRuntimeSettings).mockRejectedValueOnce(new Error('private config'));
    await expect(runLocalAgentHarness(options(),session,vi.fn())).rejects.toThrow('权限配置');
    vi.mocked(loadAgentRuntimeSettings).mockResolvedValue({...DEFAULT_AGENT_RUNTIME_SETTINGS,
      mainAssistant:{...DEFAULT_AGENT_RUNTIME_SETTINGS.mainAssistant,sandbox:'read-only'}});
    vi.mocked(runLocalAgent).mockImplementation(async request => {
      expect(request.tools.some(t => t.name === 'note_propose_patch')).toBe(false);
      return {result:'read only'};
    });
    await runLocalAgentHarness(options(),session,vi.fn());
  });
  it('does not deliver proposals after abort even if the provider returns a late success', async () => {
    const controller = new AbortController();
    vi.mocked(runLocalAgent).mockImplementation(async (_request,_signal,_event,handle) => {
      await call(handle,'read_note',read); await call(handle,'note_propose_patch',patch);
      controller.abort(); return {result:'late success'};
    });
    await expect(runLocalAgentHarness(options({abortSignal:controller.signal}),session,vi.fn())).rejects.toMatchObject({name:'AbortError'});
  });
  it('requires a new successful target read on every resumed turn', async () => {
    vi.mocked(runLocalAgent).mockImplementationOnce(async (_request,_signal,_event,handle) => {
      await call(handle,'read_note',read); await call(handle,'note_propose_patch',patch); return {result:'first'};
    });
    expect((await runLocalAgentHarness(options(),session,vi.fn())).noteProposals).toHaveLength(1);
    vi.mocked(readNote).mockClear();
    vi.mocked(runLocalAgent).mockImplementationOnce(async (_request,_signal,_event,handle) => {
      expect((await call(handle,'note_propose_patch',patch)).isError).toBe(true); return {result:'fresh read required'};
    });
    expect((await runLocalAgentHarness(options(),{...session,initialized:true},vi.fn())).noteProposals).toHaveLength(0);
    expect(readNote).not.toHaveBeenCalled();
  });
  it.each(['approval','question'] as const)('releases a pending %s when the CLI disconnects', async kind => {
    vi.mocked(runLocalAgent).mockImplementation(async (_request,_signal,_event,handle) => {
      const pending = kind === 'approval'
        ? handle({type:'tool',id:'pending',name:'approve_tool',input:{tool_name:'Bash',input:{command:'echo example'}}})
        : handle({type:'tool',id:'pending',name:'approve_tool',input:{tool_name:'AskUserQuestion',input:{questions:[{question:'选择',options:[{label:'A'},{label:'B'}]}]}}});
      void pending.catch(() => undefined);
      expect(kind === 'approval' ? getToolApprovals().length : getUserInputs().length).toBe(1);
      throw new Error('CLI disconnected');
    });
    await expect(runLocalAgentHarness(options({requestToolApproval:requestToolApproval('fixture','c1'),requestUserInput:requestUserInput('fixture','c1')}),session,vi.fn())).rejects.toThrow('CLI disconnected');
    await vi.waitFor(() => {expect(getToolApprovals()).toHaveLength(0);expect(getUserInputs()).toHaveLength(0);});
  });
});
