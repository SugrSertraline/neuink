import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { SceneInput } from './sceneState';
import { SealFallback } from './SealFallback';
import type { createDormScene } from './dormRenderer';

export function DormScene({input,onWave,onLaptop,onActionEnd,name}:{input:SceneInput;onWave:()=>void;onLaptop?:()=>void;onActionEnd?:()=>void;name:string}) {
  const host=useRef<HTMLDivElement>(null),latest=useRef(input),engine=useRef<ReturnType<typeof createDormScene>>();
  const [error,setError]=useState(''),[ready,setReady]=useState(false),[attempt,setAttempt]=useState(0);
  latest.current=input;
  const finished=useRef(onActionEnd);finished.current=onActionEnd;
  useEffect(()=>{
    let cancelled=false;setReady(false);setError('');
    import('./dormRenderer').then(({createDormScene})=>{
      if(cancelled||!host.current)return;
      try{engine.current=createDormScene(host.current,latest.current,message=>{if(!cancelled)setError(message);},()=>{if(!cancelled)setReady(true);},()=>{if(!cancelled)finished.current?.();});}
      catch{setError('当前设备未能启动手绘动画，已保留静态画面与旅行操作。');}
    }).catch(()=>{if(!cancelled)setError('场景模块加载失败，请重试。');});
    return()=>{cancelled=true;engine.current?.dispose();engine.current=undefined;};
  },[attempt]);
  useEffect(()=>{engine.current?.update(input);},[input.behavior,input.season,input.weather,input.away,input.moving,input.sequence,input.wind,input.direction,input.cloud,input.precipitation,input.night]);
  useEffect(()=>{if(error){engine.current?.dispose();engine.current=undefined;setReady(false);}},[error]);
  return <>
    <div ref={host} className="travel-canvas"/>
    {!ready&&!error&&<span className="sr-only" role="status">正在加载手绘动画…</span>}
    {!input.away&&<button className="travel-companion travel-companion-hit" aria-label={`和${name}打招呼`} onClick={onWave}>{!ready&&<SealFallback name={name}/>}</button>}
    {ready&&!input.away&&<button className="travel-laptop-hit" aria-label="使用笔记本电脑" title="使用笔记本电脑" onClick={onLaptop}/>}
    {error&&<div className="travel-scene-error" role="alert">{error}<Button onClick={()=>setAttempt(v=>v+1)}>重试手绘场景</Button></div>}
  </>;
}
