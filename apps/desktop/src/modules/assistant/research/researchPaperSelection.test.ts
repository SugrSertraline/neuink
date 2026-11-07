import { expect, it } from 'vitest';
import type { AssistantToolTraceEvent, AssistantMessagePart } from '@/shared/ipc/assistantApi';
import { buildAssistantMessageParts } from '../components/assistantPanelState';
import { researchPapersFromEvents, researchPapersFromParts, resolvePaperSelections } from './researchPaperSelection';

const paper = { id:'arxiv:2401.00001v2', title:'Paper', authors:['A'], year:'2024', abstract_text:'Abstract',
  doi:'', url:'https://arxiv.org/abs/2401.00001v2', pdf_url:'https://arxiv.org/pdf/2401.00001v2', provider:'arxiv', evidence_level:'abstract' };
function event(toolName: string, id: string): AssistantToolTraceEvent {
  return { id, toolName, status:'done', summary:'Search', researchPapers:[{...paper,title:id}] };
}
it('uses event insertion order after reverse completion and retains identical provenance through message persistence', () => {
  const events:AssistantToolTraceEvent[] = [{...event('arxiv_search','first'),status:'running'},event('search_papers','second')];
  events[0] = event('arxiv_search','first'); // first call finishes after second; array position does not move.
  expect(researchPapersFromEvents(events)).toEqual([{paper:{...paper,title:'second'},cacheSource:'research'}]);
  expect(resolvePaperSelections(events,{paper_ids:[paper.id]})).toEqual([{paperId:paper.id,cacheSource:'research'}]);
  const parts=JSON.parse(JSON.stringify(buildAssistantMessageParts({content:'Answer',toolEvents:events})));
  expect(researchPapersFromParts(parts)).toEqual(researchPapersFromEvents(events));
});
it('recovers valid legacy history but never guesses across failed, conflicting, unknown or malformed origins', () => {
  const restored=event('arxiv_search','search');
  const valid=buildAssistantMessageParts({content:'',toolEvents:[restored]});
  expect(researchPapersFromParts(valid)[0].cacheSource).toBe('arxiv_search');
  const result:AssistantMessagePart={type:'tool-result',id:'old',toolName:'arxiv_search',summary:'',researchPapers:[paper],
    researchSearch:{schema_version:1,status:'partial'} as never};
  expect(researchPapersFromParts([result])[0].cacheSource).toBe('arxiv_search');
  expect(researchPapersFromParts([{...result,researchSearch:undefined}])[0].cacheSource).toBeNull();
  expect(researchPapersFromParts([{type:'tool-call',id:'old',toolName:'search_papers',status:'done'},result])[0].cacheSource).toBeNull();
  for(const later of [event('unknown','unknown'), {...event('arxiv_search','conflict'),researchCacheSource:'research' as const},
    {...event('arxiv_search','malformed'),researchPapers:[{...paper,authors:undefined} as never]}]) {
    const selected=researchPapersFromEvents([event('search_papers','earlier'),later]);
    expect(selected).toHaveLength(1);expect(selected[0].cacheSource).toBeNull();
    expect(()=>resolvePaperSelections([event('search_papers','earlier'),later],{paper_ids:[paper.id]})).toThrow('来源');
  }
  expect(researchPapersFromParts([{type:'tool-call',id:'old',toolName:'arxiv_search',status:'error'},result])).toEqual([]);
});
it('keeps versions separate, permits mixed host selections and rejects duplicate or unresolved IDs', () => {
  const legacy=event('search_papers','legacy');const search=event('arxiv_search','search');
  search.researchPapers=[{...paper,id:'arxiv:2401.00001v1'}];
  expect(resolvePaperSelections([legacy,search],{paper_ids:[paper.id,'arxiv:2401.00001v1']})).toEqual([
    {paperId:paper.id,cacheSource:'research'},{paperId:'arxiv:2401.00001v1',cacheSource:'arxiv_search'}]);
  expect(()=>resolvePaperSelections([legacy],{paper_ids:[paper.id,paper.id]})).toThrow();
  expect(()=>resolvePaperSelections([legacy],{paper_ids:['missing']})).toThrow();
});
