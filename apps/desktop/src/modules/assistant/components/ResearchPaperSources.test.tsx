// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ToastContext } from '@/shared/hooks/useToast';
import { approveResearchImport, previewResearchImport, approveSelectedImport, previewSelectedImport,
  rememberResearchConsent, runResearchTool, type ResearchPaper } from '@/shared/ipc/researchApi';
import { ResearchPaperAction, ResearchPaperActionsProvider } from './ResearchPaperActions';
import { ToolApprovalPanel } from './ToolApprovalPanel';
import { requestToolApproval, getToolApprovals, decideToolApproval } from '../runtime/toolApproval';
import { getAssistantBackgroundRuns, setAssistantBackgroundRun } from './assistantBackgroundRuns';

vi.mock('@/shared/ipc/researchApi',async original=>({...await original<typeof import('@/shared/ipc/researchApi')>(),
  approveResearchImport:vi.fn(),previewResearchImport:vi.fn(),approveSelectedImport:vi.fn(),previewSelectedImport:vi.fn(),
  rememberResearchConsent:vi.fn(),runResearchTool:vi.fn()}));
const paper:ResearchPaper={id:'arxiv:2401.00001v2',title:'Legacy title',authors:['A'],year:'2024',abstract_text:'Short',
  doi:'',url:'https://arxiv.org/abs/2401.00001v2',pdf_url:'https://arxiv.org/pdf/2401.00001v2',provider:'arxiv',evidence_level:'abstract'};
const complete={...paper,title:'Complete search title',abstract_text:'Complete',categories:['cs.LG']};
beforeEach(()=>{
  vi.resetAllMocks();vi.mocked(previewResearchImport).mockResolvedValue([paper]);
  vi.mocked(previewSelectedImport).mockResolvedValue([complete]);
  vi.mocked(approveResearchImport).mockResolvedValue();vi.mocked(approveSelectedImport).mockResolvedValue();
});
afterEach(()=>{cleanup();setAssistantBackgroundRun(null);getToolApprovals().forEach(item=>decideToolApproval(item.id,false));});
function setup(){return render(<ToastContext.Provider value={{notify:()=>'',dismiss:()=>{}}}>
  <ResearchPaperActionsProvider root="source-root"><section aria-label="legacy"><ResearchPaperAction paper={paper}/></section>
    <section aria-label="search"><ResearchPaperAction paper={complete} cacheSource="arxiv_search"/></section>
  </ResearchPaperActionsProvider></ToastContext.Provider>);}
it('keeps two same-ID previews distinct, shares the actual import lock and retains stopped state only for its source',async()=>{
  let reject!:(error:Error)=>void;
  vi.mocked(runResearchTool).mockImplementation(()=>new Promise((_,fail)=>{reject=fail;}));
  const view=setup(),legacy=within(view.getByRole('region',{name:'legacy'})),search=within(view.getByRole('region',{name:'search'}));
  fireEvent.click(legacy.getByRole('button',{name:'添加到本地'}));
  await waitFor(()=>expect(legacy.getByRole('button',{name:'确认添加'})).toBeTruthy());
  fireEvent.click(search.getByRole('button',{name:'添加到本地'}));
  await waitFor(()=>expect(search.getByRole('button',{name:'确认添加'})).toBeTruthy());
  expect(legacy.getByText('确认下载并添加《Legacy title》？不会自动解析、添加标签或修改笔记。')).toBeTruthy();
  expect(search.getByText('确认下载并添加《Complete search title》？不会自动解析、添加标签或修改笔记。')).toBeTruthy();
  expect(previewResearchImport).toHaveBeenCalledExactlyOnceWith('source-root',[paper.id]);
  expect(previewSelectedImport).toHaveBeenCalledExactlyOnceWith('source-root',[{paperId:paper.id,cacheSource:'arxiv_search'}]);
  fireEvent.click(search.getByRole('button',{name:'确认添加'}));
  await waitFor(()=>expect(runResearchTool).toHaveBeenCalledTimes(1));
  fireEvent.click(legacy.getByRole('button',{name:'确认添加'}));
  expect(approveResearchImport).not.toHaveBeenCalled();
  expect(approveSelectedImport).toHaveBeenCalledWith('source-root',[{paperId:paper.id,cacheSource:'arxiv_search'}],[complete],expect.any(String));
  const runs=getAssistantBackgroundRuns();expect(runs).toHaveLength(1);
  expect(runs[0].paperSelections).toEqual([{paperId:paper.id,cacheSource:'arxiv_search'}]);
  await act(async()=>{runs[0].abortController.abort();reject(new Error('stopped'));});
  expect(search.getByRole('alert')).toBeTruthy();expect(legacy.getByRole('button',{name:'确认添加'})).toBeTruthy();
  expect(getAssistantBackgroundRuns()).toHaveLength(0);
});
it('previews and confirms a mixed batch once and freezes host provenance across approval',async()=>{
  const next={...complete,id:'arxiv:2401.00002v1'};
  const selections=[{paperId:paper.id,cacheSource:'research' as const},{paperId:next.id,cacheSource:'arxiv_search' as const}];
  vi.mocked(previewSelectedImport).mockResolvedValue([paper,next]);
  const promise=requestToolApproval('mixed-root','chat')({toolName:'import_papers',toolCallId:'mixed-call',
    input:{paper_ids:[paper.id,next.id]},paperSelections:selections});
  const view=render(<ToolApprovalPanel root="mixed-root" conversationId="chat" onOpen={()=>{}}/>);
  await waitFor(()=>expect(view.getByRole('button',{name:'确认下载 2 篇'})).toBeTruthy());
  selections[0].cacheSource='arxiv_search' as never;
  const frozen=[{paperId:paper.id,cacheSource:'research'},{paperId:next.id,cacheSource:'arxiv_search'}];
  fireEvent.click(view.getByRole('button',{name:'确认下载 2 篇'}));
  await expect(promise).resolves.toBe(true);
  expect(previewSelectedImport).toHaveBeenCalledExactlyOnceWith('mixed-root',frozen);
  expect(approveSelectedImport).toHaveBeenCalledExactlyOnceWith('mixed-root',frozen,[paper,next],expect.any(String));
  expect(rememberResearchConsent).toHaveBeenCalledWith('mixed-root','mixed-call',expect.any(String),frozen);
  expect(approveResearchImport).not.toHaveBeenCalled();
});
