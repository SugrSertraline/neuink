import { describe,expect,it } from 'vitest';
import { resolveAtmosphere,seasonForMonth } from './sceneState';
import { createWorld,evolve,parseWorld } from './world';
describe('dorm atmosphere and poses',()=>{
  it('maps all months in Shanghai time and uses a neutral fallback without data',()=>{
    expect(Array.from({length:12},(_,i)=>seasonForMonth(i))).toEqual(['winter','winter','spring','spring','spring','summer','summer','summer','autumn','autumn','autumn','winter']);
    expect(resolveAtmosphere(undefined,Date.parse('2026-01-01T12:00:00+08:00'))).toEqual({season:'winter',weather:'sunny'});
    expect(resolveAtmosphere({season:'summer',weather:'rain'},0)).toEqual({season:'summer',weather:'rain'});
    expect(resolveAtmosphere(undefined,Date.parse('2026-02-28T18:00:00Z'),{weather:'rain',wind:7})).toEqual({season:'spring',weather:'rain',wind:7});
    expect(resolveAtmosphere({season:'winter',weather:'cloudy'},0,{weather:'rain',wind:8})).toEqual({season:'winter',weather:'cloudy'});
  });
  it('persists atmosphere separately from trip snapshots and rejects invalid saves',()=>{
    const w=evolve(createWorld(),{type:'depart',now:1,id:'one'});
    const next=evolve(w,{type:'atmosphere',value:{season:'winter',weather:'snow'}});
    expect(parseWorld(JSON.parse(JSON.stringify(next))).atmosphere).toEqual({season:'winter',weather:'snow'});
    expect(next.trips).toBe(w.trips);
    expect(()=>parseWorld({...w,atmosphere:{season:'bad',weather:'sunny'}})).toThrow();
    expect(()=>parseWorld({...w,atmosphere:null})).toThrow();
  });
});
