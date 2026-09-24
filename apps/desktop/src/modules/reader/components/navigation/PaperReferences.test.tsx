// @vitest-environment jsdom
import { useEffect } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SourceSegment } from '@/shared/types/domain';
import { PaperReferencesProvider, PaperTextPreview } from './PaperReferences';
import { ReadingNavigationScope, useReadingNavigation } from './ReadingNavigation';
const figure: SourceSegment={uid:'f',text:'Figure 3. Results',markdown:null,page_idx:1,bbox:null,segment_type:'figure'};
afterEach(cleanup);
function Adapter({jump}:{jump:()=>boolean}) {const nav=useReadingNavigation()!; useEffect(()=>nav.register({capture:()=>({pageIdx:0,offset:0,left:0}),restore:vi.fn(),navigate:jump}),[nav.register,jump]);return null;}
describe('paper reference interaction',()=>{
  it('supports focus preview, click navigation, and leaves formulas/code untouched',async()=>{
    const jump=vi.fn(()=>true);
    render(<ReadingNavigationScope><Adapter jump={jump}/><PaperReferencesProvider segments={[figure]} entryId="e" workspaceRoot={null} pdfDocument={null}>
      <PaperTextPreview markdown={'See **Figure 3**. `Figure 3` remains code.'}/>
    </PaperReferencesProvider></ReadingNavigationScope>);
    expect(screen.getAllByRole('button',{name:'Figure 3，预览或定位原文'})).toHaveLength(1);
    const link=screen.getByRole('button',{name:'Figure 3，预览或定位原文'}); fireEvent.focus(link);
    expect(await screen.findByText('Figure 3 · 第 2 页')).toBeTruthy();
    fireEvent.click(link); expect(jump).toHaveBeenCalledWith(expect.objectContaining({pageIdx:1,segmentUid:'f'}));
    await waitFor(()=>expect(screen.queryByText('Figure 3 · 第 2 页')).toBeNull());
  });
  it('offers grouped citations in an accessible chooser and reports hidden targets',async()=>{
    const jump=vi.fn(()=>false);
    const refs: SourceSegment[] = [{...figure,uid:'h',text:'References',segment_type:'heading'},
      {...figure,uid:'r1',text:'[1] First source',segment_type:'paragraph'}, {...figure,uid:'r2',text:'[2] Second source',segment_type:'paragraph'}];
    render(<ReadingNavigationScope><Adapter jump={jump}/><PaperReferencesProvider segments={refs} entryId="e" workspaceRoot={null} pdfDocument={null}>
      <PaperTextPreview markdown="Compare [1, 2]."/>
    </PaperReferencesProvider></ReadingNavigationScope>);
    fireEvent.keyDown(screen.getByRole('button',{name:'[1, 2]，预览或定位原文'}),{key:'ArrowDown'});
    const dialog=await screen.findByRole('dialog');
    expect(within(dialog).getAllByRole('button',{name:'定位原文'})).toHaveLength(2);
    fireEvent.click(within(dialog).getAllByRole('button',{name:'定位原文'})[1]);
    expect(jump).toHaveBeenCalledWith(expect.objectContaining({segmentUid:'r2'}));
    expect(within(dialog).getByRole('alert').textContent).toContain('不可见');
  });
  it('keeps a Markdown reference preview mounted when its source context updates',async()=>{
    const jump=vi.fn(()=>true), segments=[figure];
    const view=(root: string|null)=><ReadingNavigationScope><Adapter jump={jump}/><PaperReferencesProvider segments={segments} entryId="e" workspaceRoot={root} pdfDocument={null}>
      <PaperTextPreview markdown="See **Figure 3** for details."/>
    </PaperReferencesProvider></ReadingNavigationScope>;
    const {rerender}=render(view(null));
    fireEvent.focus(screen.getByRole('button',{name:'Figure 3，预览或定位原文'}));
    expect(await screen.findByText('Figure 3 · 第 2 页')).toBeTruthy();
    rerender(view('loaded-workspace'));
    expect(screen.getByText('Figure 3 · 第 2 页')).toBeTruthy();
  });
});
