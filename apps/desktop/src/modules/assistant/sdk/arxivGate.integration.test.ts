import { beforeEach, expect, it, vi } from 'vitest';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import type { LlmProfile } from '@/shared/ipc/assistantApi';
import { listTools } from '@/shared/ipc/assistantApi';
import { runResearchTool } from '@/shared/ipc/researchApi';
import { createNeuinkModel } from './provider';
import { answerWithGroundedAgent } from './qna';
import { createAssistantTools } from './tools';
import { formatAssistantError } from '@/shared/lib/assistantDebug';
import { arxivGateMessage, arxivGateStatus } from '@/shared/lib/arxivGateStatus';
import { buildAssistantMessageParts } from '../components/assistantPanelState';
vi.mock('./provider',()=>({createNeuinkModel:vi.fn(),generationSettings:()=>({})}));
vi.mock('@/shared/ipc/researchApi',async original=>({...await original<typeof import('@/shared/ipc/researchApi')>(),runResearchTool:vi.fn()}));
vi.mock('@/shared/ipc/assistantApi',async original=>({...await original<typeof import('@/shared/ipc/assistantApi')>(),listTools:vi.fn(),
  loadPrompt:vi.fn(async name=>name==='qna_user'?'{{question}} {{tool_notes}}':'')}));
const scope={entry_ids:[],entry_titles:[],tag_ids:[],tag_names:[]};
const detail={code:'rate_limited',phase:'cooldown',attempts_started:1,http_status:429,retry_after_seconds:150,cooldown_until:'2030-01-01T00:00:00Z'};
beforeEach(()=>{vi.clearAllMocks();vi.mocked(listTools).mockResolvedValue([{name:'arxiv_search',description:'Search arXiv',
  parameters_schema:{type:'object',properties:{mode:{type:'string'},query:{type:'string'}},required:['mode','query']}}]);});
it('preserves cooldown through typed failure, safe rendering and saved message parts without unsafe fields',async()=>{
  vi.mocked(runResearchTool).mockRejectedValue(JSON.stringify({arxiv_gate:{...detail,request_id:'safe-id',source:'chat'}}));
  const runtime=await createAssistantTools({root:'host',scope});
  const output=await runtime.tools.arxiv_search.execute!({mode:'structured',query:'test'},{toolCallId:'limited',messages:[]});
  expect(output).toMatchObject({ok:false,code:'TOOL_RATE_LIMITED',recovery:{retryable:false},arxivGate:detail});
  expect(runtime.events[0]).toMatchObject({status:'error',arxivGate:detail});
  const message=arxivGateMessage(detail);
  expect(formatAssistantError(runtime.events[0].error)).toBe(message);
  const saved=JSON.parse(JSON.stringify(buildAssistantMessageParts({content:'',toolEvents:runtime.events})));
  expect(saved).toContainEqual(expect.objectContaining({type:'tool-result',arxivGate:detail}));
  expect(arxivGateStatus({...detail,retry_after_seconds:'evil'})).toBeUndefined();
  expect(formatAssistantError(JSON.stringify({arxiv_gate:{...detail,retry_after_seconds:-1}}))).not.toContain('-1');
});
it.each([false,true])('production agent loop reports cooldown and preserves partial=%s without another arxiv call',async partial=>{
  let turn=0;
  const model=new MockLanguageModelV3({doStream:async options=>{
    const n=turn++;
    if(n>0){const prompt=JSON.stringify(options.prompt);expect(prompt).toContain('retry_after_seconds');expect(prompt).toContain('150');
      expect(prompt).toContain('arxivGate');
      if(!partial) expect(prompt).toContain('Do not retry arXiv');
      else {expect(prompt).toContain('Preserved fixture');expect(prompt).toContain('partial');}}
    return {stream:simulateReadableStream({chunks:[{type:'stream-start',warnings:[]},...(n===0?
      [{type:'tool-call' as const,toolCallId:'query',toolName:'arxiv_search',input:JSON.stringify({mode:'structured',query:'test'})}]:
      [{type:'text-start' as const,id:'text'},{type:'text-delta' as const,id:'text',delta:partial?'已取得一篇论文，后续页面被 arXiv 限流，结果不完整，约2分30秒后可重试。':'arXiv 暂时限制了请求，约2分30秒后可重试，本次未取得论文。'},{type:'text-end' as const,id:'text'}]),
      {type:'finish',finishReason:{unified:n===0?'tool-calls':'stop',raw:n===0?'tool_calls':'stop'},
        usage:{inputTokens:{total:10,noCache:10,cacheRead:0,cacheWrite:0},outputTokens:{total:10,text:10,reasoning:0}}}]})};
  }});
  vi.mocked(createNeuinkModel).mockReturnValue(model);
  if(partial) vi.mocked(runResearchTool).mockResolvedValue({schema_version:1,status:'partial',papers:[{
    id:'arxiv:2610.12345v1',title:'Preserved fixture',authors:['Author'],year:'2026',abstract_text:'Abstract',doi:'',
    url:'https://arxiv.org/abs/2610.12345v1',pdf_url:null,provider:'arxiv',evidence_level:'abstract'}],
    errors:[{code:'rate_limited',http_status:429,gate:detail}],missing_ids:[],unresolved_ids:[],has_more:null});
  else vi.mocked(runResearchTool).mockRejectedValue(JSON.stringify({arxiv_gate:detail}));
  const result=await answerWithGroundedAgent({root:'host',scope,question:'检索论文，不下载',
    settings:{id:'fixed',model:'fixed',base_url:'https://example.invalid',api_key:null} as LlmProfile});
  expect(result.answer).toContain('2分30秒');expect(runResearchTool).toHaveBeenCalledTimes(1);expect(turn).toBe(2);
  if(partial) expect(result.answer).toContain('结果不完整');
});
