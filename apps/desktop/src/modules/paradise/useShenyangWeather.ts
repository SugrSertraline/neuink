import { useCallback, useEffect, useState } from 'react';
import { fetchCityWeather, parseCityWeather, WEATHER_INTERVAL, type CityWeather } from './shenyangWeather';

const CACHE_KEY='neuink:shenyang-weather:v1';
type Snapshot={payload:unknown;receivedAt:number};
function cached():Snapshot|null {
  try {
    const value=JSON.parse(localStorage.getItem(CACHE_KEY)||'null') as Snapshot|null;
    if(!value||!Number.isFinite(value.receivedAt)||value.receivedAt>Date.now())return null;
    parseCityWeather(value.payload);
    return value;
  }catch{return null;}
}
export function useShenyangWeather(enabled:boolean) {
  const [snapshot,setSnapshot]=useState<Snapshot|null>(cached);
  const [loading,setLoading]=useState(false),[error,setError]=useState('');
  const [attempt,setAttempt]=useState(0),[now,setNow]=useState(Date.now);
  const retry=useCallback(()=>setAttempt(v=>v+1),[]);
  useEffect(()=>{
    if(!enabled){setLoading(false);return;}
    let disposed=false,controller:AbortController|null=null,timeout:number|undefined;
    let lastAttempt=0;
    const refresh=async(force=false)=>{
      setNow(Date.now());
      if(document.hidden||controller||(!force&&Date.now()-lastAttempt<WEATHER_INTERVAL))return;
      lastAttempt=Date.now();
      const saved=cached();
      if(!force&&saved&&Date.now()-saved.receivedAt<WEATHER_INTERVAL){lastAttempt=saved.receivedAt;setSnapshot(saved);return;}
      const request=new AbortController();controller=request;setLoading(true);
      timeout=window.setTimeout(()=>request.abort(),10_000);
      try {
        const payload=await fetchCityWeather(request.signal);
        parseCityWeather(payload);
        if(disposed||request.signal.aborted)return;
        const next={payload,receivedAt:Date.now()};
        setSnapshot(next);setError('');setNow(Date.now());
        try{localStorage.setItem(CACHE_KEY,JSON.stringify(next));}catch{/* Cache is optional, not a game save. */}
      }catch {
        if(!disposed)setError('天气更新失败，可重试或切换手动天气');
      }finally {
        window.clearTimeout(timeout);controller=null;if(!disposed)setLoading(false);
      }
    };
    void refresh(attempt>0);
    const timer=window.setInterval(()=>void refresh(),60_000);
    const wake=()=>void refresh();
    document.addEventListener('visibilitychange',wake);window.addEventListener('online',wake);
    return()=>{disposed=true;controller?.abort();window.clearTimeout(timeout);window.clearInterval(timer);document.removeEventListener('visibilitychange',wake);window.removeEventListener('online',wake);};
  },[enabled,attempt]);
  let data:CityWeather|null=null;
  try{if(snapshot)data=parseCityWeather(snapshot.payload,now);}catch{/* Expired data must not drive the scene. */}
  const stale=!!data&&(!!error||now-data.observedAt>2*60*60_000||now-(snapshot?.receivedAt??0)>WEATHER_INTERVAL*2);
  return {data,loading,error,stale,retry};
}
