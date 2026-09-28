import { useRef, useState } from 'react';
import { ArrowLeft, Settings, X, MapPin, Sun, Laptop } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import { useTravelWorld } from './useTravelWorld';
import { activeTrip, deliveredTrips, GEARS } from './world';
import { TravelPanels, panelTitles, type Panel } from './TravelPanels';
import dorm from './assets/dorm-clear-desk-v3.png';
import { DormScene } from './DormScene';
import { RoomControls } from './RoomControls';
import { BEHAVIORS, resolveAtmosphere, SEASONS, WEATHER, type Behavior } from './sceneState';
import './travel.css';
import './travel-material.css';
import { DESTINATIONS, destinationOf } from './destinations';
import { useShenyangWeather } from './useShenyangWeather';

type Props={root:string;active:boolean;onBack:()=>void;entries?:LibraryEntry[];onOpenEntry?:(entry:LibraryEntry)=>void};
export function ParadisePage({root,active,onBack}:Props){
  const {world,error,busy,now,visible,act,retry}=useTravelWorld(root,active);
  const automatic=!!world&&(!world.atmosphere||world.atmosphere.weather==='auto');
  const cityWeather=useShenyangWeather(active&&visible&&automatic);
  const [element,setElement]=useState<HTMLElement|null>(null),[panel,setPanel]=useState<Panel|null>(null);
  const [greeting,setGreeting]=useState(false),[imageError,setImageError]=useState(false),[imageAttempt,setImageAttempt]=useState(0);
  const [behavior,setBehavior]=useState<Behavior>('idle'),[sequence,setSequence]=useState(0);
  const play=(value:Behavior)=>{setBehavior(value);setSequence(v=>v+1);setPanel(null);};
  const trigger=useRef<HTMLElement|null>(null);
  const open=(next:Panel)=>{trigger.current=document.activeElement as HTMLElement;setPanel(next);};
  const failure=error&&<div role="alert" className="travel-error"><p>{error}</p><Button disabled={busy} onClick={retry}>重新载入存档</Button></div>;
  if(!world)return <section className="seal-travel travel-loading"><div className="travel-paper"><h2>校园旅行</h2>{failure||<p role="status">正在打开宿舍…</p>}<Button onClick={onBack}>返回阅读</Button></div></section>;
  const trip=activeTrip(world,now),letters=deliveredTrips(world,now),unread=letters.filter(t=>!t.read).length;
  const minutes=trip?Math.max(1,Math.ceil((trip.returnsAt-now)/60000)):0;
  const disabled=busy||!!error;
  const atmosphere=resolveAtmosphere(world.atmosphere,now,cityWeather.data);
  const climateLabel=automatic?cityWeather.data?`沈阳 ${Math.round(cityWeather.data.temperature)}° · ${WEATHER[atmosphere.weather]}${cityWeather.stale?' · 缓存':''}`:cityWeather.loading?'沈阳 · 获取天气…':'天气未连接 · 示意':`${SEASONS[atmosphere.season]} · ${WEATHER[atmosphere.weather]}`;
  return <section ref={setElement} className="seal-travel" aria-label="校园旅行" data-weather={atmosphere.weather} data-night={!!atmosphere.night} data-season={atmosphere.season} data-moving={active&&visible&&world.motion&&!panel}>
    <div className="travel-stage" key={imageAttempt}>
      <img className="travel-room" src={dorm} alt="" onError={()=>setImageError(true)}/>
      <DormScene input={{...atmosphere,behavior,sequence,away:!!trip,moving:active&&visible&&world.motion&&!panel}} name={world.name} onActionEnd={()=>setBehavior('idle')} onLaptop={()=>play('typing')} onWave={()=>{play('wave');setGreeting(true);}}/>
    </div>
    <header className="travel-header"><Button className="travel-wood" onClick={onBack}><ArrowLeft size={18}/>返回阅读</Button><span className="travel-place">宿舍</span><Button className="travel-climate" onClick={()=>open('room')}><Sun size={16}/>{climateLabel}</Button><Button className="travel-wood travel-settings" aria-label="伙伴与偏好" onClick={()=>open('settings')}><Settings size={20}/></Button></header>
    <div className="travel-status travel-paper" role="status">{trip?`${world.name}出门中 · 约 ${minutes} 分钟后回来`:greeting?'今天也一起慢慢来吧。':world.trips.length?`${world.name}回来了 · 在家休息`:`${world.name} · 在家等你`}</div>
    {imageError&&<div className="travel-asset-error" role="alert">场景素材加载失败，操作仍然可用。<Button onClick={()=>{setImageError(false);setImageAttempt(v=>v+1);}}>重试场景图片</Button></div>}
    {!panel&&failure&&<div className="travel-alert">{failure}</div>}
    <div className="travel-depart">
      <Button className="travel-primary" disabled={disabled||!!trip||world.trips.length>=500} onClick={()=>open('destinations')}>{busy?'正在保存…':trip?'正在散步':'去逛逛'}<MapPin size={18}/></Button>
      <Button className="travel-paper" variant="outline" onClick={()=>open('bag')}><span className="travel-object travel-object-bag" aria-hidden="true"/>行囊 · {GEARS[world.gear].name}</Button>
      <Button className="travel-paper" variant="outline" onClick={()=>open('destinations')}><MapPin size={16}/>旅行册 · 选择地点</Button>
      <Button variant="outline" onClick={()=>open('room')}><Laptop size={16}/>{trip?'布置窗景':`陪伴 · ${BEHAVIORS[behavior]}`}</Button>
      {trip&&<div className="travel-route"><span>{DESTINATIONS[destinationOf(trip)].name} · {now<trip.mailAt?'正在收集故事':'来信已寄出'}</span><progress aria-label="旅行进度" max={trip.returnsAt-trip.startedAt} value={Math.max(0,now-trip.startedAt)}/></div>}
      {!world.trips.length&&<span className="travel-route">首次约 1 分钟，途中会寄来信</span>}
      {world.trips.length>=500&&<span className="travel-route">旅行记录已满，已有照片仍可查看</span>}
    </div>
    <nav className="travel-dock" aria-label="旅行物品">
      <Button onClick={()=>open('letters')}><span className="travel-object travel-object-letter" aria-hidden="true"/><span>来信{unread>0&&<b className="travel-badge">{unread}</b>}</span></Button>
      <Button onClick={()=>open('album')}><span className="travel-object travel-object-album" aria-hidden="true"/><span>相册</span></Button>
      <Button onClick={()=>open('journal')}><span className="travel-object travel-object-journal" aria-hidden="true"/><span>手记</span></Button>
    </nav>
    <Dialog open={!!panel&&active} onOpenChange={value=>{if(!value)setPanel(null);}}>
      <DialogContent portalContainer={element} className="travel-modal" overlayClassName="travel-overlay" showCloseButton={false} aria-describedby={undefined}
        onCloseAutoFocus={e=>{e.preventDefault();trigger.current?.focus();}}>
        <header className="travel-modal-header"><DialogTitle>{panel?panelTitles[panel]:''}</DialogTitle><Button aria-label="关闭游戏面板" variant="ghost" onClick={()=>setPanel(null)}><X/></Button></header>
        {failure}
        {busy&&<p role="status" className="travel-saving">正在保存…</p>}
        <div className="travel-modal-scroll">{panel==='room'?<RoomControls world={world} disabled={disabled} away={!!trip} behavior={behavior} onBehavior={play} act={act} cityWeather={cityWeather}/>:panel&&<TravelPanels key={panel} panel={panel} world={world} now={now} disabled={disabled} act={act} onDepart={()=>setPanel(null)}/>}</div>
      </DialogContent>
    </Dialog>
  </section>;
}
