import type { SceneInput } from './sceneState';
import { ACTION_SECONDS } from './sealAnimation';
import { drawLaptop, drawSeal } from './sealSprites';
import { paintWindowWeather, weatherEffects } from './windowWeather';
import seasonsUrl from './assets/seasons-v2.png';
import partsUrl from './assets/seal-parts-v3.png';
import laptopUrl from './assets/laptop-rear-v4.png';
import roomUrl from './assets/dorm-window-v4.png';

/** Flat raster layers in painted perspective. No WebGL, geometry, lights or 3D models. */
export function createDormScene(host:HTMLElement,initial:SceneInput,onError:(message:string)=>void,onReady=()=>{},onActionEnd=()=>{}) {
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
  if(!ctx)throw new Error('Canvas 2D unavailable');
  canvas.setAttribute('aria-hidden','true');
  const exterior=document.createElement('canvas');exterior.width=400;exterior.height=480;
  const weather=exterior.getContext('2d');
  if(!weather)throw new Error('Window Canvas 2D unavailable');
  host.appendChild(canvas);
  const season=new Image(),parts=new Image(),laptop=new Image(),room=new Image(),images=[season,parts,laptop,room];
  let input=initial,disposed=false,failed=false,frame=0,last=0,clock=0,actionClock=0,loaded=0;
  let focused=document.hasFocus(),sequence=initial.sequence;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  // Repaint only the existing table in front of the seated character. All coordinates
  // belong to the same 1600x1000 artboard, including narrow viewports (camera crop only).
  const deskClip=new Path2D();
  [[0,720],[330,727],[1069,760],[1069,801],[872,922],[872,1000],[0,1000]].forEach(([x,y],i)=>i?deskClip.lineTo(x,y):deskClip.moveTo(x,y));deskClip.closePath();
  function allowed(){return !failed&&loaded===images.length&&input.moving&&focused&&!document.hidden&&!reduced.matches;}
  function running(){
    const fx=weatherEffects(input);
    return allowed()&&((!input.away&&actionClock<ACTION_SECONDS[input.behavior])||fx.rain||fx.snow||fx.cloud>.35||fx.wind>=4);
  }
  function draw(){
    if(disposed||failed||loaded!==images.length||!ctx||!weather)return;
    const moving=!reduced.matches,behavior=actionClock>=ACTION_SECONDS[input.behavior]?'idle':input.behavior;
    ctx.setTransform(canvas.width/1600,0,0,canvas.height/1000,0,0);ctx.clearRect(0,0,1600,1000);
    const index=['spring','summer','autumn','winter'].indexOf(input.season);
    weather.clearRect(0,0,400,480);
    weather.drawImage(season,(index%2)*season.naturalWidth/2,Math.floor(index/2)*season.naturalHeight/2,season.naturalWidth/2,season.naturalHeight/2,0,0,400,480);
    paintWindowWeather(weather,input,clock);
    // Actual alpha holes in the room expose this lower scenery layer. No scenery
    // painted on top of the frame or competing baked-in outdoor photograph.
    ctx.drawImage(exterior,820,35,375,525);
    ctx.save();if(input.night)ctx.filter='brightness(.78)';
    ctx.drawImage(room,0,0,1600,1000);
    if(!input.away)drawSeal(ctx,parts,behavior,actionClock,moving,972,791,.96);
    ctx.save();ctx.clip(deskClip);ctx.drawImage(room,0,0,1600,1000);ctx.restore();
    drawLaptop(ctx,laptop,775,701,205);
    ctx.restore();
  }
  function tick(stamp:number){
    frame=0;if(disposed||failed)return;
    if(stamp-last>=1000/24){
      const dt=Math.min((stamp-last)/1000,.08),before=actionClock,duration=ACTION_SECONDS[input.behavior];
      clock+=dt;if(!input.away)actionClock+=dt;last=stamp;draw();
      if(before<duration&&actionClock>=duration)onActionEnd();
    }
    if(running())frame=requestAnimationFrame(tick);
  }
  function refresh(){
    if(disposed||failed)return;cancelAnimationFrame(frame);frame=0;last=performance.now();draw();
    if(running())frame=requestAnimationFrame(tick);
  }
  function resize(){
    const w=host.clientWidth,h=host.clientHeight;if(w<=0||h<=0)return;
    const ratio=Math.min(window.devicePixelRatio||1,1.5);canvas.width=Math.max(1,Math.round(w*ratio));canvas.height=Math.max(1,Math.round(h*ratio));refresh();
  }
  const observer=new ResizeObserver(resize);observer.observe(host);
  if(host.parentElement?.parentElement)observer.observe(host.parentElement.parentElement);
  const focus=()=>{focused=true;refresh();},blur=()=>{focused=false;refresh();};
  window.addEventListener('focus',focus);window.addEventListener('blur',blur);document.addEventListener('visibilitychange',refresh);reduced.addEventListener('change',refresh);
  const fail=()=>{if(disposed||failed)return;failed=true;cancelAnimationFrame(frame);window.clearTimeout(loadTimeout);onError('手绘场景素材未能加载，旅行存档不受影响。请重试。');};
  const loadTimeout=window.setTimeout(fail,15_000);
  images.forEach(image=>{
    image.onload=()=>{if(disposed||failed)return;loaded++;if(loaded===images.length){window.clearTimeout(loadTimeout);onReady();refresh();}};
    image.onerror=fail;
  });
  season.src=seasonsUrl;parts.src=partsUrl;laptop.src=laptopUrl;room.src=roomUrl;resize();
  return {
    update(next:SceneInput){if(disposed)return;if(next.sequence!==sequence){actionClock=0;sequence=next.sequence;}input=next;refresh();},
    dispose(){
      if(disposed)return;disposed=true;cancelAnimationFrame(frame);window.clearTimeout(loadTimeout);observer.disconnect();
      window.removeEventListener('focus',focus);window.removeEventListener('blur',blur);document.removeEventListener('visibilitychange',refresh);reduced.removeEventListener('change',refresh);
      images.forEach(image=>{image.onload=image.onerror=null;image.src='';});
      canvas.remove();canvas.width=canvas.height=0;exterior.width=exterior.height=0;
    },
  };
}
