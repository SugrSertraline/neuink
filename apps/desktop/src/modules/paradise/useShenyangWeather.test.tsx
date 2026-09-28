// @vitest-environment jsdom
import { afterEach,beforeEach,describe,it,expect,vi } from 'vitest';
import { act,cleanup,renderHook } from '@testing-library/react';
import { useShenyangWeather } from './useShenyangWeather';
import { WEATHER_INTERVAL,WEATHER_MAX_AGE } from './shenyangWeather';
const key='neuink:shenyang-weather:v1';
const payload=()=>({current:{time:Date.now()/1000,weather_code:63,is_day:1,temperature_2m:15,cloud_cover:80,wind_speed_10m:6,wind_direction_10m:270,precipitation:2}});
beforeEach(()=>{vi.useFakeTimers({toFake:['Date','setTimeout','clearTimeout','setInterval','clearInterval']});localStorage.clear();vi.runOnlyPendingTimers();Object.defineProperty(document,'hidden',{configurable:true,value:false});});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.useRealTimers();});
describe('weather lifecycle',()=>{
  it('loads, caches, polls at a bounded frequency and stops when inactive',async()=>{
    const fetch=vi.fn().mockImplementation(async()=>({ok:true,json:async()=>payload()}));vi.stubGlobal('fetch',fetch);
    const view=renderHook(({enabled})=>useShenyangWeather(enabled),{initialProps:{enabled:true}});
    await act(async()=>{});expect(view.result.current.data?.weather).toBe('rain');expect(fetch).toHaveBeenCalledTimes(1);
    await act(async()=>vi.advanceTimersByTimeAsync(WEATHER_INTERVAL-60_000));expect(fetch).toHaveBeenCalledTimes(1);
    await act(async()=>vi.advanceTimersByTimeAsync(60_000));expect(fetch).toHaveBeenCalledTimes(2);
    view.rerender({enabled:false});await act(async()=>vi.advanceTimersByTimeAsync(WEATHER_INTERVAL));expect(fetch).toHaveBeenCalledTimes(2);
    view.unmount();expect(vi.getTimerCount()).toBe(0);
  });
  it('uses cached data on failure but expires it instead of claiming live weather',async()=>{
    localStorage.setItem(key,JSON.stringify({payload:payload(),receivedAt:Date.now()-WEATHER_INTERVAL}));
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('offline')));
    const view=renderHook(()=>useShenyangWeather(true));await act(async()=>{});
    expect(view.result.current.stale).toBe(true);expect(view.result.current.data).not.toBeNull();
    await act(async()=>vi.advanceTimersByTimeAsync(WEATHER_MAX_AGE+60_000));expect(view.result.current.data).toBeNull();
  });
  it('aborts a request on unmount and ignores late successful responses',async()=>{
    let signal:AbortSignal|undefined,finish!:(v:unknown)=>void;
    vi.stubGlobal('fetch',vi.fn((_url,init)=>{signal=init.signal;return new Promise(r=>finish=r);}));
    const view=renderHook(()=>useShenyangWeather(true));view.unmount();expect(signal?.aborted).toBe(true);expect(vi.getTimerCount()).toBe(0);
    await act(async()=>finish({ok:true,json:async()=>payload()}));expect(localStorage.getItem(key)).toBeNull();expect(vi.getTimerCount()).toBe(0);
  });
  it('has no request in manual mode and supports explicit retry after failure',async()=>{
    const fetch=vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementation(async()=>({ok:true,json:async()=>payload()}));vi.stubGlobal('fetch',fetch);
    const view=renderHook(({enabled})=>useShenyangWeather(enabled),{initialProps:{enabled:false}});expect(fetch).not.toHaveBeenCalled();
    view.rerender({enabled:true});await act(async()=>{});expect(view.result.current.error).not.toBe('');
    await act(async()=>view.result.current.retry());expect(view.result.current.error).toBe('');expect(view.result.current.data).not.toBeNull();
  });
  it('aborts a timed-out request and does not poll aggressively',async()=>{
    const fetch=vi.fn((_url,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('aborted')))));
    vi.stubGlobal('fetch',fetch);const view=renderHook(()=>useShenyangWeather(true));
    await act(async()=>vi.advanceTimersByTimeAsync(10_000));expect(view.result.current.loading).toBe(false);expect(view.result.current.error).not.toBe('');
    await act(async()=>vi.advanceTimersByTimeAsync(120_000));expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('waits while hidden and reuses fresh cache on remount',async()=>{
    Object.defineProperty(document,'hidden',{configurable:true,value:true});
    const fetch=vi.fn().mockImplementation(async()=>({ok:true,json:async()=>payload()}));vi.stubGlobal('fetch',fetch);
    const view=renderHook(()=>useShenyangWeather(true));expect(fetch).not.toHaveBeenCalled();
    Object.defineProperty(document,'hidden',{configurable:true,value:false});
    await act(async()=>document.dispatchEvent(new Event('visibilitychange')));expect(fetch).toHaveBeenCalledTimes(1);
    view.unmount();renderHook(()=>useShenyangWeather(true));await act(async()=>{});expect(fetch).toHaveBeenCalledTimes(1);
  });
});
