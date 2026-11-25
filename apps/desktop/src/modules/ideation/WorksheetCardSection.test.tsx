// @vitest-environment jsdom
import { cleanup,fireEvent,render,screen } from '@testing-library/react';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { WorksheetCardSection } from './WorksheetCardSection';
vi.mock('./PaperCardBody',()=>({PaperCardBody:()=>null}));
vi.mock('@/components/ui/pointer-preview',()=>({PointerPreview:()=>null}));
const nodes=[1,2].map(i=>({id:`n${i}`,card_id:`c${i}`,x:0,y:0,card:{id:`c${i}`,entry_id:'paper',kind:'method' as const,title:`方法${i}`,body:'说明'}}));
beforeEach(()=>{
  vi.stubGlobal('PointerEvent',class extends MouseEvent { pointerId:number;isPrimary=true;constructor(type:string,init:PointerEventInit={}){super(type,init);this.pointerId=init.pointerId??1;} });
  HTMLElement.prototype.setPointerCapture=vi.fn();HTMLElement.prototype.hasPointerCapture=()=>false;HTMLElement.prototype.releasePointerCapture=vi.fn();
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
function setup(){const reorder=vi.fn();render(<TooltipProvider><WorksheetCardSection boardId="b" section="method" nodes={nodes} active={false} onChoose={vi.fn()} onDescribe={vi.fn()} onView={vi.fn()} onEdit={vi.fn()} onRemove={vi.fn()} onReorder={reorder}/></TooltipProvider>);const handle=screen.getByRole('button',{name:'拖动排序方法1'});const target=screen.getByRole('button',{name:'方法2'}).closest('article')!;vi.spyOn(target,'getBoundingClientRect').mockReturnValue({left:100,width:100,top:0,bottom:200,right:200,height:200,x:100,y:0,toJSON:()=>({})});Object.defineProperty(document,'elementFromPoint',{configurable:true,value:vi.fn(()=>target)});return{reorder,handle};}
it('commits one reorder on drop, not during pointer movement',()=>{
  const {reorder,handle}=setup();
  fireEvent.pointerDown(handle,{button:0,pointerId:1,clientX:10,clientY:10});
  fireEvent.pointerMove(handle,{pointerId:1,clientX:180,clientY:20});
  expect(reorder).not.toHaveBeenCalled();
  fireEvent.pointerUp(handle,{pointerId:1,clientX:180,clientY:20});
  expect(reorder).toHaveBeenCalledExactlyOnceWith('n1','n2',true);
});
it('cancels on Escape and supports a keyboard reorder from the handle',()=>{
  const {reorder,handle}=setup();
  fireEvent.pointerDown(handle,{button:0,pointerId:1,clientX:10,clientY:10});
  fireEvent.pointerMove(handle,{pointerId:1,clientX:180,clientY:20});
  fireEvent.keyDown(window,{key:'Escape'});
  fireEvent.pointerUp(handle,{pointerId:1,clientX:180,clientY:20});
  expect(reorder).not.toHaveBeenCalled();
  fireEvent.keyDown(handle,{key:'ArrowDown'});
  expect(reorder).toHaveBeenCalledExactlyOnceWith('n1','n2',true);
});
