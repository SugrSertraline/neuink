// @vitest-environment jsdom
import { afterEach,beforeEach,expect,it,vi,type MockInstance } from 'vitest';
import { createDormScene } from './dormRenderer';
import type { SceneInput } from './sceneState';
const initial:SceneInput={season:'spring',weather:'rain',behavior:'idle',sequence:0,moving:true,away:false};
let images:MockImage[]=[];
class MockImage {naturalWidth=1536;naturalHeight=1024;src='';onload:(()=>void)|null=null;onerror:(()=>void)|null=null;constructor(){images.push(this);}}
const disconnect=vi.fn(),raf=vi.fn((_callback:FrameRequestCallback)=>1),cancel=vi.fn();
const context={setTransform:vi.fn(),clearRect:vi.fn(),drawImage:vi.fn(),save:vi.fn(),restore:vi.fn(),clip:vi.fn(),translate:vi.fn(),scale:vi.fn(),rotate:vi.fn(),beginPath:vi.fn(),ellipse:vi.fn(),arc:vi.fn(),fill:vi.fn(),fillRect:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),quadraticCurveTo:vi.fn(),stroke:vi.fn(),createLinearGradient:vi.fn(()=>({addColorStop:vi.fn()}))};
let getContext:MockInstance<HTMLCanvasElement['getContext']>;
beforeEach(()=>{
  vi.useFakeTimers();images=[];vi.clearAllMocks();
  getContext=vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(document,'hasFocus').mockReturnValue(true);
  Object.defineProperty(document,'hidden',{configurable:true,value:false});
  vi.stubGlobal('Image',MockImage);vi.stubGlobal('Path2D',class{moveTo(){}lineTo(){}closePath(){}});
  vi.stubGlobal('ResizeObserver',class{observe(){}disconnect=disconnect;});
  vi.stubGlobal('requestAnimationFrame',raf);vi.stubGlobal('cancelAnimationFrame',cancel);
  vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}));
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
function host(){const el=document.createElement('div');Object.defineProperties(el,{clientWidth:{value:800},clientHeight:{value:500}});return el;}
it('requests only 2D canvases and waits for all image layers',()=>{
  const el=host(),ready=vi.fn(),engine=createDormScene(el,initial,vi.fn(),ready);
  expect(getContext.mock.calls.every(call=>call[0]==='2d')).toBe(true);
  expect(raf).not.toHaveBeenCalled();images[0].onload?.();images[1].onload?.();expect(ready).not.toHaveBeenCalled();
  images[2].onload?.();expect(ready).not.toHaveBeenCalled();images[3].onload?.();expect(ready).toHaveBeenCalledOnce();expect(context.drawImage).toHaveBeenCalled();expect(raf).toHaveBeenCalled();
  raf.mockClear();engine.update({...initial,moving:false});expect(raf).not.toHaveBeenCalled();
  engine.dispose();engine.dispose();expect(disconnect).toHaveBeenCalledOnce();expect(el.children.length).toBe(0);expect(vi.getTimerCount()).toBe(0);
});
it('leaves sunny idle still and draws room, seated seal, desk then laptop in order',()=>{
  const engine=createDormScene(host(),{...initial,weather:'sunny'},vi.fn());
  images.forEach(i=>i.onload?.());expect(raf).not.toHaveBeenCalled();
  const draws=context.drawImage.mock.calls.map(c=>c[0]);
  const roomFirst=draws.indexOf(images[3]),roomLast=draws.lastIndexOf(images[3]);
  expect(roomLast).toBeGreaterThan(roomFirst);expect(draws.indexOf(images[1])).toBeGreaterThan(roomFirst);
  expect(draws.lastIndexOf(images[1])).toBeLessThan(roomLast);expect(draws.indexOf(images[2])).toBeGreaterThan(roomLast);
  engine.update({...initial,weather:'sunny',behavior:'wave',sequence:1});expect(raf).toHaveBeenCalled();engine.dispose();
});
it('cleans up an early unmount and ignores late image callbacks',()=>{
  const ready=vi.fn(),engine=createDormScene(host(),initial,vi.fn(),ready),late=images[0].onload;
  engine.dispose();late?.();expect(ready).not.toHaveBeenCalled();expect(images.every(i=>i.onload===null&&i.onerror===null&&i.src==='')).toBe(true);expect(vi.getTimerCount()).toBe(0);
});
it('finishes a gesture once, pauses on blur and does not restart on weather updates',()=>{
  const end=vi.fn(),input={...initial,weather:'sunny' as const,behavior:'wave' as const,sequence:1};
  const engine=createDormScene(host(),input,vi.fn(),vi.fn(),end);images.forEach(i=>i.onload?.());
  window.dispatchEvent(new Event('blur'));raf.mockClear();engine.update(input);expect(raf).not.toHaveBeenCalled();
  window.dispatchEvent(new Event('focus'));
  let stamp=performance.now();
  for(let i=0;i<70;i++){
    const callback=raf.mock.calls[raf.mock.calls.length-1]?.[0];
    raf.mockClear();stamp+=50;callback?.(stamp);
  }
  expect(end).toHaveBeenCalledOnce();expect(raf).not.toHaveBeenCalled();
  engine.update({...input,season:'summer'});expect(raf).not.toHaveBeenCalled();engine.dispose();
});
it('fails once on asset timeout without starting animation',()=>{
  const error=vi.fn(),engine=createDormScene(host(),initial,error);
  vi.advanceTimersByTime(15_000);expect(error).toHaveBeenCalledOnce();images.forEach(i=>i.onload?.());expect(raf).not.toHaveBeenCalled();engine.dispose();
});
