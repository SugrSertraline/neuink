import { expect, it } from 'vitest';
import { analyzeResearchGraph } from './analyzeResearchGraph';
import { researchInput } from './researchPlan';
import { board, state } from './researchPlan.fixtures';
it('detects removed connections without inventing a method chain', () => {
 const input = researchInput(board, state, new Set(['n1','n2']), 'goal');
 expect(analyzeResearchGraph(input).components).toHaveLength(1);
 expect(analyzeResearchGraph({...input,links:[]}).isolated_refs).toEqual(['C1','C2']);
});
it('preserves edge direction and semantic type independently of display label', () => {
 const input=researchInput(board,{...state,links:state.links!.map(l=>({...l,label:'自定义说明'}))},new Set(['n1','n2']),'goal');
 expect(analyzeResearchGraph(input).edges[0]).toMatchObject({from:'C1',to:'C2',kind:'combines',label:'自定义说明'});
});
