import { beforeEach, expect, it, vi } from 'vitest';
import { listTools } from '@/shared/ipc/assistantApi';
import { runResearchTool } from '@/shared/ipc/researchApi';
import { createAssistantTools } from './tools';
import { agentExecutors } from './agentDriver';
import type { ToolApprovalRequest } from '../runtime/toolApproval';
import { DEFAULT_AGENT_RUNTIME_SETTINGS } from '@/shared/lib/agentRuntimeSettings';
import { buildDirectExecution } from '../runtime/executionPolicy';

vi.mock('@/shared/ipc/assistantApi',async original=>({...await original<typeof import('@/shared/ipc/assistantApi')>(),listTools:vi.fn()}));
vi.mock('@/shared/ipc/researchApi',async original=>({...await original<typeof import('@/shared/ipc/researchApi')>(),runResearchTool:vi.fn()}));
const scope={entry_ids:[],entry_titles:[],tag_ids:[],tag_names:[]};
function createRuntime() {
  const settings=structuredClone(DEFAULT_AGENT_RUNTIME_SETTINGS);
  return createAssistantTools({root:'host',scope,runtimeSettings:settings,activeExecution:{agent:settings.mainAssistant},
    ...buildDirectExecution(settings,'检索并下载论文')});
}
const paper=(id:string)=>({id,title:id,authors:['A'],year:'2024',abstract_text:'Abstract',doi:'',
  url:'https://arxiv.org/abs/'+id,pdf_url:'https://arxiv.org/pdf/'+id,provider:'arxiv',evidence_level:'abstract'});
beforeEach(()=>{
  vi.resetAllMocks();vi.mocked(listTools).mockResolvedValue(['arxiv_search','search_papers','import_papers'].map(name=>({
    name,description:name,parameters_schema:{type:'object',additionalProperties:false,properties:name==='import_papers'
      ?{paper_ids:{type:'array',items:{type:'string'}}}:{query:{type:'string'},mode:{type:'string'}},
      required:name==='import_papers'?['paper_ids']:['query']},
  })));
});
it('binds mixed provenance on the production tool definitions without changing model args and freezes it before approval',async()=>{
  vi.mocked(runResearchTool).mockResolvedValueOnce({papers:[paper('old')]}).mockResolvedValueOnce({schema_version:1,status:'ok',papers:[paper('new')]})
    .mockResolvedValueOnce({results:[{id:'old',status:'imported'},{id:'new',status:'imported'}]});
  const runtime=await createRuntime();
  await runtime.tools.search_papers.execute!({query:'old'},{toolCallId:'old-search',messages:[]});
  await runtime.tools.arxiv_search.execute!({mode:'structured',query:'new'},{toolCallId:'new-search',messages:[]});
  const approval=vi.fn(async(request:ToolApprovalRequest)=>{
    expect(request.input).toEqual({paper_ids:['old','new']});
    expect(request.paperSelections).toEqual([{paperId:'old',cacheSource:'research'},{paperId:'new',cacheSource:'arxiv_search'}]);
    // A concurrent result must not retarget the already pending operation.
    runtime.events.push({id:'later',toolName:'search_papers',status:'done',researchPapers:[paper('new')]});
    return true;
  });
  const executor=agentExecutors(runtime.tools,approval).import_papers;
  await executor({paper_ids:['old','new']},{id:'import-call'});
  expect(approval).toHaveBeenCalledTimes(1);
  expect(vi.mocked(runResearchTool).mock.calls[2][1]).toEqual({root:'host',paper_ids:['old','new']});
  expect(runtime.events.slice(0,2).map(event=>event.researchCacheSource)).toEqual(['research','arxiv_search']);
});
it('rejects an import before requesting approval when its latest record has conflicting provenance',async()=>{
  const runtime=await createRuntime();
  runtime.events.push({id:'conflict',toolName:'arxiv_search',status:'done',researchCacheSource:'research',researchPapers:[paper('new')]});
  const approve=vi.fn(async()=>true);
  await expect(agentExecutors(runtime.tools,approve).import_papers({paper_ids:['new']},{id:'reject'})).rejects.toThrow();
  expect(approve).not.toHaveBeenCalled();expect(runResearchTool).not.toHaveBeenCalled();
});
