import { useEffect, useState } from 'react';
import { detectLocalAgent, type LocalAgentDetection } from '@/shared/ipc/localAgentApi';
import { LOCAL_AGENTS, localAgentName, type LocalAgentProvider } from './localAgentSettings';

/** Installation state is ephemeral. Disabling or changing focus invalidates late probes. */
export function useLocalAgentDetections(active:boolean, refreshOnFocus=false) {
  const [results,setResults]=useState<Partial<Record<LocalAgentProvider,LocalAgentDetection>>>({});
  const [attempt,setAttempt]=useState(0);
  const [busy,setBusy]=useState(false);
  useEffect(()=>{
    let alive=true, generation=0;
    if (!active) {setResults({});setBusy(false);return;}
    const detect=()=>{
      const current=++generation;setResults({});setBusy(true);
      void Promise.all(LOCAL_AGENTS.map(async agent=>{
        let value:LocalAgentDetection;
        try {value=await detectLocalAgent(agent.id);}
        catch {value={status:'error',message:`无法检测 ${localAgentName(agent.id)}，请重试。`};}
        if (alive && generation===current) setResults(existing=>({...existing,[agent.id]:value}));
      })).finally(()=>{if(alive && generation===current)setBusy(false);});
    };
    detect();if(refreshOnFocus)window.addEventListener('focus',detect);
    return ()=>{alive=false;if(refreshOnFocus)window.removeEventListener('focus',detect);};
  },[active,refreshOnFocus,attempt]);
  return {results,busy,retry:()=>setAttempt(value=>value+1)};
}
