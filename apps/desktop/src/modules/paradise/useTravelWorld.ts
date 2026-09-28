import { useEffect, useRef, useState } from 'react';
import { readParadise, saveParadise } from '@/shared/ipc/paradiseApi';
import { createWorld, evolve, parseWorld, type Action, type World } from './world';

/** Save acknowledgement is authoritative. No background polling or optimistic rewards. */
export function useTravelWorld(root:string,active:boolean) {
  const [world,setWorld]=useState<World|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [reload,setReload]=useState(0),[now,setNow]=useState(Date.now()),[visible,setVisible]=useState(!document.hidden);
  const session=useRef({root,revision:0,world:null as World|null,locked:false,alive:false});
  useEffect(()=>{
    const current={root,revision:0,world:null as World|null,locked:false,alive:true};session.current=current;
    setWorld(null);setError('');setBusy(false);
    readParadise(root).then(saved=>{
      const next=saved?parseWorld(saved.world):createWorld();
      if(!current.alive)return;current.revision=saved?.revision??0;current.world=next;setWorld(next);setNow(Date.now());
    }).catch(e=>{if(current.alive)setError(String(e));});
    return()=>{current.alive=false;};
  },[root,reload]);
  useEffect(()=>{
    const update=()=>{setVisible(!document.hidden);setNow(Date.now());};
    document.addEventListener('visibilitychange',update);window.addEventListener('focus',update);
    return()=>{document.removeEventListener('visibilitychange',update);window.removeEventListener('focus',update);};
  },[]);
  useEffect(()=>{if(!active||!visible)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[active,visible]);
  async function act(action:Action) {
    const current=session.current;
    if(!current.alive||current.root!==root||!current.world||current.locked||error)return false;
    current.locked=true;setBusy(true);
    try {
      const next=evolve(current.world,action);if(next===current.world)return true;
      const saved=await saveParadise(current.root,current.revision,next);
      const accepted=parseWorld(saved.world);
      if(current.alive){current.revision=saved.revision;current.world=accepted;setWorld(accepted);setNow(Date.now());}
      return true;
    } catch(e) {if(current.alive)setError(`保存未确认，请重新载入核对存档。${String(e)}`);return false;}
    finally {current.locked=false;if(current.alive)setBusy(false);}
  }
  return {world,error,busy,now,visible,act,retry:()=>setReload(k=>k+1)};
}
