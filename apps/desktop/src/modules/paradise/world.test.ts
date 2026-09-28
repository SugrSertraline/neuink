import { describe, expect, it } from 'vitest';
import { activeTrip, createWorld, deliveredTrips, evolve, parseWorld } from './world';
import { earnedStamps, tripStory } from './destinations';
const start=()=>evolve(createWorld(),{type:'depart',now:1000,id:'one'});
describe('campus travel world',()=>{
  it('freezes destination, rotates stories and earns stamps only after returning',()=>{
    const first=evolve(createWorld(),{type:'depart',now:1000,id:'lake1',destination:'lake'});
    expect(first.trips[0].destination).toBe('lake');
    expect(earnedStamps(first,31_000)).toEqual([]);
    expect(earnedStamps(first,61_000)).toEqual(['lake']);
    const next=evolve(first,{type:'depart',now:61_000,id:'lake2',destination:'lake'});
    expect(next.trips[1].returnsAt).toBe(961_000);
    expect(tripStory(next,next.trips[0]).text).not.toBe(tripStory(next,next.trips[1]).text);
    expect(earnedStamps(next,961_000)).toEqual(['lake']);
    expect(()=>parseWorld({...first,trips:[{...first.trips[0],destination:'constructor'}]})).toThrow();
    const legacy={...first,trips:[{...first.trips[0],destination:undefined}]};
    expect(tripStory(parseWorld(legacy),legacy.trips[0]).route.name).toBe('校园散步');
  });
  it('sends a letter halfway and returns offline without timer writes',()=>{
    const w=start();
    expect(deliveredTrips(w,30_999)).toHaveLength(0);
    expect(deliveredTrips(w,31_000)).toHaveLength(1);
    expect(activeTrip(w,60_999)).toBeTruthy();
    expect(activeTrip(parseWorld(JSON.parse(JSON.stringify(w))),61_000)).toBeUndefined();
    expect(evolve(w,{type:'depart',now:2000,id:'two'})).toBe(w);
    const next=evolve(w,{type:'depart',now:61_000,id:'two'});
    expect(next.trips[1].returnsAt).toBe(361_000);
  });
  it('does not duplicate departures, collect early or grant repeated souvenirs',()=>{
    const w=start();
    expect(evolve(w,{type:'collect',id:'one',now:3000})).toBe(w);
    const collected=evolve(w,{type:'collect',id:'one',now:31_000});
    expect(collected.trips[0]).toMatchObject({read:true,collected:true});
    expect(evolve(collected,{type:'collect',id:'one',now:70_000})).toBe(collected);
    expect(evolve(w,{type:'depart',now:70_000,id:'one'})).toBe(w);
  });
  it('freezes gear for a trip and respects clock rollback',()=>{
    const w=start(),next=evolve(w,{type:'settings',name:'海豹',gear:'thermos',motion:false});
    expect(next.trips[0].gear).toBe('camera');expect(next.gear).toBe('thermos');
    expect(evolve(w,{type:'depart',now:0,id:'rollback'})).toBe(w);
  });
  it('rejects broken, duplicate, overlapping, old and future-version saves',()=>{
    const w=start();
    for(const v of [null,{}, {...w,version:1},{...w,version:3},{...w,name:''},{...w,gear:'constructor'},{...w,trips:[...w.trips,...w.trips]},
      {...w,trips:[{...w.trips[0],mailAt:0}]},{...w,trips:[{...w.trips[0],returnsAt:Infinity}]}])expect(()=>parseWorld(v)).toThrow();
    expect(parseWorld(createWorld())).toEqual(createWorld());
  });
});
