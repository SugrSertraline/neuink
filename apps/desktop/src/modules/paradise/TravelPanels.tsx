import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GEARS, deliveredTrips, type Action, type World, type TravelGear } from './world';
import photo from './assets/trial-photo.png';
import { DESTINATIONS, destinationOf, earnedStamps, tripStory } from './destinations';
import { TravelDestinations } from './TravelDestinations';

export type Panel='letters'|'album'|'journal'|'settings'|'bag'|'destinations'|'room';
export const panelTitles:Record<Panel,string>={letters:'校园来信',album:'旅行相册',journal:'旅行手记',settings:'伙伴与偏好',bag:'准备行囊',destinations:'桌上的旅行册',room:'宿舍里的小日子'};
type Props={panel:Panel;world:World;now:number;disabled:boolean;act:(a:Action)=>Promise<boolean>;onDepart:()=>void};
export function TravelPanels({panel,world,now,disabled,act,onDepart}:Props){
  const [name,setName]=useState(world.name),[gear,setGear]=useState<TravelGear>(world.gear),[motion,setMotion]=useState(world.motion);
  const [index,setIndex]=useState(0),[saved,setSaved]=useState(false),[imageFailed,setImageFailed]=useState(false);
  const delivered=deliveredTrips(world,now).slice().reverse();
  const letters=panel==='album'?delivered.filter(t=>t.collected):delivered;
  const selected=letters[Math.min(index,Math.max(0,letters.length-1))];
  if(panel==='destinations')return <TravelDestinations world={world} now={now} disabled={disabled} act={act} onDepart={onDepart}/>;
  if(panel==='bag'||panel==='settings')return <div className="travel-form">
    <p>行囊不消耗资源，也不是出发的前置任务。携带物会改变来信和纪念物，下次出发时生效。</p>
    <fieldset disabled={disabled}><legend>下次想带什么？</legend><div className="travel-gears">{Object.entries(GEARS).map(([id,g])=><label key={id}><input type="radio" name="travel-gear" checked={gear===id} onChange={()=>{setGear(id as TravelGear);setSaved(false);}}/>{g.name}<small>{g.souvenir}</small></label>)}</div></fieldset>
    {panel==='settings'&&<><label htmlFor="travel-name">伙伴的名字</label><Input id="travel-name" value={name} maxLength={40} disabled={disabled} onChange={e=>{setName(e.target.value);setSaved(false);}}/><label><input type="checkbox" checked={motion} disabled={disabled} onChange={e=>{setMotion(e.target.checked);setSaved(false);}}/> 开启轻柔待机动画</label><p>无需 API，不调用模型，不读取你的论文正文。系统“减少动态效果”优先。</p></>}
    <Button disabled={disabled||!name.trim()} onClick={async()=>setSaved(await act({type:'settings',name,gear,motion}))}>保存偏好</Button>{saved&&<p role="status">已保存，下次出发使用这份行囊。</p>}
  </div>;
  if(panel==='journal')return <div className="travel-form">
    <p>已经出发 {world.trips.length} 次 · 已收藏 {world.trips.filter(t=>t.collected).length} 张明信片</p>
    <h3>校园足迹</h3>
    <div className="travel-stamps">{Object.entries(DESTINATIONS).map(([id,route])=><div key={id} data-earned={earnedStamps(world,now).includes(id as ReturnType<typeof destinationOf>)}><strong>{route.stamp}</strong><small>{route.name}</small><span>{earnedStamps(world,now).includes(id as ReturnType<typeof destinationOf>)?'已归来 · 印章已留下':'完成旅行后获得'}</span></div>)}</div>
    <p>纪念物来自每次来信，收藏明信片即可保留。不需要连续打卡，也不会扣除已有成果。</p>
    {!world.trips.length?<p>第一篇手记，从一次小小的出发开始。</p>:<ol className="travel-journal">{world.trips.slice().reverse().map((t,i)=><li key={t.id}><strong>第 {world.trips.length-i} 次 · {DESTINATIONS[destinationOf(t)].name} · {t.returnsAt>now?'出门中':'已归来'}</strong><span>{new Date(t.startedAt).toLocaleString('zh-CN')} · 携带{GEARS[t.gear].name}</span><small>{t.mailAt<=now?tripStory(world,t).souvenir:'还在寻找值得记录的片刻'} · {t.collected?'已珍藏':t.mailAt<=now?'可在来信中收藏':'等待来信'}</small></li>)}</ol>}
  </div>;
  if(!selected)return <div className="travel-empty"><span aria-hidden="true">✉</span><h3>{panel==='album'?'相册还没有收藏':'还没有来信'}</h3><p>{panel==='album'?'收到来信后，点击“收进相册”留下喜欢的瞬间。':'第一次散步约 1 分钟，途中会寄来一封信。你可以先回去阅读。'}</p></div>;
  const story=tripStory(world,selected);
  return <><div className="travel-letter"><figure>{destinationOf(selected)!=='trial'?<div className="travel-photo-placeholder"><strong>{story.route.name}</strong><span>文字明信片</span><small>真实参考图待补充<br/>先把今天的故事寄给你</small></div>:imageFailed?<div role="alert">照片暂时打不开。<Button onClick={()=>setImageFailed(false)}>重试图片</Button></div>:<img src={photo} alt="海豹在林荫路招手的游戏旅行照片" onError={()=>setImageFailed(true)}/>}<figcaption>{story.route.name} · {new Date(selected.startedAt).toLocaleDateString('zh-CN')}</figcaption><small>{destinationOf(selected)==='trial'?'游戏插画，非真实校园实拍':'校园主题虚构故事 · 非实景照片'}</small></figure><article><p className="travel-eyebrow">第 {world.trips.findIndex(t=>t.id===selected.id)+1} 次旅行</p><h3>寄给你的一个小小瞬间</h3><p>{story.text}</p><p>{GEARS[selected.gear].letter}</p><p className="travel-souvenir">带回的小纪念 · {story.souvenir} · {GEARS[selected.gear].souvenir}</p><small>来自 {world.name}</small><div className="travel-letter-actions"><Button disabled={disabled||selected.collected} onClick={()=>void act({type:'collect',id:selected.id,now:Date.now()})}>{selected.collected?'已收进相册':'收进相册'}</Button>{!selected.read&&<Button variant="outline" disabled={disabled} onClick={()=>void act({type:'read',id:selected.id,now:Date.now()})}>标为已读</Button>}</div></article></div><div className="travel-pagination"><Button variant="ghost" disabled={index<=0} onClick={()=>setIndex(i=>i-1)}>上一封</Button><span>{Math.min(index+1,letters.length)} / {letters.length}</span><Button variant="ghost" disabled={index>=letters.length-1} onClick={()=>setIndex(i=>i+1)}>下一封</Button></div></>;
}
