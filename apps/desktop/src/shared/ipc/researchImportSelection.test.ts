import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { rememberResearchConsent, runResearchTool, type PaperSelection } from './researchApi';
vi.mock('@tauri-apps/api/core',()=>({invoke:vi.fn()}));
beforeEach(()=>vi.resetAllMocks());
const selections:PaperSelection[]=[{paperId:'legacy',cacheSource:'research'},{paperId:'new',cacheSource:'arxiv_search'}];
it('freezes mixed provenance only in host consent and dispatches the same approved IDs once',async()=>{
  vi.mocked(invoke).mockResolvedValue({results:[]});
  const original=structuredClone(selections);
  rememberResearchConsent('root','mixed','grant',original); original[0].cacheSource='arxiv_search';
  await runResearchTool('import_papers',{root:'root',paper_ids:['legacy','new'],cacheSource:'forged'},undefined,'mixed');
  expect(invoke).toHaveBeenCalledExactlyOnceWith('run_arxiv_import',{request:{root:'root',selections,approval_id:'grant',call_id:expect.any(String)}});
  await expect(runResearchTool('import_papers',{root:'root',paper_ids:['legacy','new']},undefined,'mixed')).rejects.toThrow('确认');
});
it('rejects changed IDs before dispatch and cannot consume another workspace consent',async()=>{
  rememberResearchConsent('one','change','grant',selections);
  await expect(runResearchTool('import_papers',{root:'two',paper_ids:['legacy','new']},undefined,'change')).rejects.toThrow();
  await expect(runResearchTool('import_papers',{root:'one',paper_ids:['new','legacy']},undefined,'change')).rejects.toThrow('变化');
  expect(invoke).not.toHaveBeenCalled();
});
it('cancels just the mixed native call and cleans its listener after rejection',async()=>{
  let reject!:(error:Error)=>void;
  vi.mocked(invoke).mockImplementation(command=>command==='run_arxiv_import'
    ?new Promise((_,fail)=>{reject=fail;}):Promise.resolve());
  rememberResearchConsent('cancel-root','cancel-mixed','cancel-grant',selections);
  const controller=new AbortController();const remove=vi.spyOn(controller.signal,'removeEventListener');
  const pending=runResearchTool('import_papers',{root:'cancel-root',paper_ids:['legacy','new']},controller.signal,'cancel-mixed');
  const assertion=expect(pending).rejects.toThrow('cancelled');
  const request=vi.mocked(invoke).mock.calls[0][1] as {request:{call_id:string}};
  controller.abort();reject(new Error('cancelled'));await assertion;
  expect(invoke).toHaveBeenCalledWith('cancel_research_call',{callId:request.request.call_id});
  expect(remove).toHaveBeenCalledWith('abort',expect.any(Function));
});
