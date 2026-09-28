import type { World, TravelGear } from '@/shared/types/paradise';
import type { TravelDestination } from '@/shared/types/paradise';
import { DESTINATIONS, isDestination } from './destinations';
export type { World, Trip, TravelGear } from '@/shared/types/paradise';
export const GEARS: Record<TravelGear, { name: string; letter: string; souvenir: string }> = {
  camera: { name: '相机', letter: '发现一束落在路上的阳光，想把这一刻寄给你。你慢慢读，我晚些时候回来。', souvenir: '光影照片' },
  notebook: { name: '手记', letter: '一路记下了风的方向，还有树叶的形状。好奇心装满了小本子，回来讲给你听。', souvenir: '观察小笺' },
  thermos: { name: '水壶', letter: '找了个安静的地方歇一会儿。今天不赶路，带一点好心情回宿舍。', souvenir: '散步书签' },
};
export const createWorld = (): World => ({version:2,name:'小海豹',gear:'camera',motion:true,trips:[]});
const stamp=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const gear=(v:unknown):v is TravelGear=>typeof v==='string'&&Object.prototype.hasOwnProperty.call(GEARS,v);
export const validAtmosphere=(v:World['atmosphere'])=>v===undefined||!!v&&['auto','spring','summer','autumn','winter'].includes(v.season)&&['auto','sunny','cloudy','wind','rain','snow','fog'].includes(v.weather);
export function parseWorld(value:unknown):World {
  const w=value as World;
  if(!w||w.version!==2||typeof w.name!=='string'||!w.name.trim()||[...w.name].length>40||
    !gear(w.gear)||typeof w.motion!=='boolean'||!validAtmosphere(w.atmosphere)||!Array.isArray(w.trips)||w.trips.length>500||
    w.trips.some((t,i)=>!t||typeof t.id!=='string'||!t.id||t.id.length>100||!stamp(t.startedAt)||!stamp(t.mailAt)||!stamp(t.returnsAt)||
      t.mailAt<=t.startedAt||t.returnsAt<=t.mailAt||!gear(t.gear)||(t.destination!==undefined&&!isDestination(t.destination))||typeof t.read!=='boolean'||typeof t.collected!=='boolean'||
      (i>0&&t.startedAt<w.trips[i-1].returnsAt))||new Set(w.trips.map(t=>t.id)).size!==w.trips.length)
    throw new Error('旅行存档格式不正确，原文件未被覆盖。');
  return w;
}
export const activeTrip=(w:World,now:number)=>w.trips.find(t=>t.returnsAt>now);
export const deliveredTrips=(w:World,now:number)=>w.trips.filter(t=>t.mailAt<=now);
export type Action={type:'depart';now:number;id:string;destination?:TravelDestination}|{type:'read'|'collect';id:string;now:number}|{type:'settings';name:string;gear:TravelGear;motion:boolean}|{type:'atmosphere';value:NonNullable<World['atmosphere']>};
export function evolve(w:World,a:Action):World {
  if(a.type==='atmosphere')return parseWorld({...w,atmosphere:a.value});
  if(a.type==='depart'){
    if(!stamp(a.now)||activeTrip(w,a.now)||w.trips.length>=500||!a.id||w.trips.some(t=>t.id===a.id))return w;
    const destination=a.destination??'trial';
    if(!isDestination(destination))return w;
    const duration=w.trips.length?DESTINATIONS[destination].duration:60_000;
    return parseWorld({...w,trips:[...w.trips,{id:a.id,startedAt:a.now,mailAt:a.now+duration/2,returnsAt:a.now+duration,gear:w.gear,destination,read:false,collected:false}]});
  }
  if(a.type==='settings')return parseWorld({...w,name:a.name.trim(),gear:a.gear,motion:a.motion});
  let changed=false;
  const trips=w.trips.map(t=>{
    if(t.id!==a.id||t.mailAt>a.now||(t.read&&(a.type==='read'||t.collected)))return t;
    changed=true;return {...t,read:true,collected:a.type==='collect'||t.collected};
  });
  return changed?{...w,trips}:w;
}
