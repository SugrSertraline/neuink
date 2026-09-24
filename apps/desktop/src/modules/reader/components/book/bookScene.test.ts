// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BufferGeometry, Material, Texture, type Group, type Scene } from 'three';
import { createBookStage, type BookStage } from './bookScene';

const renders=vi.hoisted(()=>vi.fn());
const releases=vi.hoisted(()=>vi.fn());
vi.mock('three', async importOriginal => {
  const actual=await importOriginal<typeof import('three')>();
  return { ...actual, WebGLRenderer: class {
    domElement=document.createElement('canvas'); capabilities={getMaxAnisotropy:()=>4};
    setClearColor() {} setPixelRatio() {} setSize() {} render=renders; dispose=releases; forceContextLoss() {}
  }};
});
const stages: BookStage[]=[];
beforeEach(()=>{
  vi.useFakeTimers(); renders.mockClear(); releases.mockClear();
  vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>setTimeout(()=>cb(performance.now()),16));
  vi.stubGlobal('cancelAnimationFrame',clearTimeout);
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({fillRect(){},strokeRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fillText(){},measureText:(v:string)=>({width:v.length*20})} as unknown as CanvasRenderingContext2D);
});
afterEach(()=>{stages.splice(0).forEach(stage=>stage.dispose());document.body.replaceChildren();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
function host() {
  const element=document.createElement('div'); document.body.append(element);
  Object.defineProperties(element,{offsetWidth:{value:166},offsetHeight:{value:224}});
  element.style.cssText='--book-cover:#713e35;--book-ink:#f1e4c8;--atelier-book-paper:#f2e8ce;--atelier-brass-edge:#ac925d';
  return element;
}
function create(element=host(),onLost=vi.fn()) { const stage=createBookStage(element,{title:'Research paper',topic:'软件工程',bookmark:true},onLost); stages.push(stage);return stage; }
describe('book renderer resources',()=>{
  it('renders only in response to changes and settles instead of running continuously',()=>{
    const stage=create(); const initial=renders.mock.calls.length;
    vi.advanceTimersByTime(1000); expect(renders).toHaveBeenCalledTimes(initial);
    stage.point(100,-100); vi.advanceTimersByTime(1000);
    const settled=renders.mock.calls.length; expect(settled).toBeGreaterThan(initial); expect(settled).toBeLessThan(45);
    vi.advanceTimersByTime(1000); expect(renders).toHaveBeenCalledTimes(settled);
  });
  it('reveals the overview book edges while bounding the turn without lifting or scaling',()=>{
    const stage=create(); const scene=renders.mock.calls[0][0] as Scene;
    const book=scene.children[0] as Group, initial=book.rotation.clone();
    stage.point(100,-100); vi.advanceTimersByTime(1000);
    expect(book.rotation.x).toBeCloseTo(.24);
    expect(book.rotation.y).toBeCloseTo(.72);
    expect(book.position.y).toBe(0); expect(book.scale.toArray()).toEqual([1,1,1]);
    stage.rest(); vi.advanceTimersByTime(1000);
    expect(book.rotation.x).toBeCloseTo(initial.x); expect(book.rotation.y).toBeCloseTo(initial.y);
  });
  it('bounds simultaneous contexts and returns capacity after disposal',()=>{
    const first=create();create();create();expect(()=>create()).toThrow('capacity');
    first.dispose();expect(()=>create()).not.toThrow();
  });
  it('releases geometry, textures, queued frames and DOM on context loss exactly once',()=>{
    const geometry=vi.spyOn(BufferGeometry.prototype,'dispose'),material=vi.spyOn(Material.prototype,'dispose'),texture=vi.spyOn(Texture.prototype,'dispose');
    const element=host(),onLost=vi.fn(),stage=create(element,onLost);stage.point(1,1);
    element.querySelector('canvas')!.dispatchEvent(new Event('webglcontextlost',{cancelable:true}));
    const count=renders.mock.calls.length;vi.advanceTimersByTime(1000);stage.dispose();
    expect(renders).toHaveBeenCalledTimes(count);expect(onLost).toHaveBeenCalledOnce();expect(releases).toHaveBeenCalledOnce();
    expect(element.querySelector('canvas')).toBeNull();expect(element.dataset.bookRendered).toBeUndefined();
    expect(geometry).toHaveBeenCalled();expect(material).toHaveBeenCalled();expect(texture).toHaveBeenCalled();
  });
});
