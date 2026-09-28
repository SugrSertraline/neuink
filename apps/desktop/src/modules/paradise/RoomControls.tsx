import { Button } from '@/components/ui/button';
import { BEHAVIORS, SEASONS, WEATHER, type Behavior } from './sceneState';
import type { Action, World } from './world';
import type { useShenyangWeather } from './useShenyangWeather';

export function RoomControls({world,disabled,away,behavior,onBehavior,act,cityWeather}:{world:World;disabled:boolean;away:boolean;behavior:Behavior;onBehavior:(behavior:Behavior)=>void;act:(action:Action)=>Promise<boolean>;cityWeather:ReturnType<typeof useShenyangWeather>}) {
  const atmosphere=world.atmosphere??{season:'auto',weather:'auto'};
  return <div className="travel-form">
    <fieldset disabled={away}><legend>陪小海豹做点什么</legend><div className="travel-action-options">{Object.entries(BEHAVIORS).map(([id,label])=><Button key={id} aria-pressed={behavior===id} onClick={()=>onBehavior(id as Behavior)}>{label}</Button>)}</div></fieldset>
    {away?<p>伙伴正在出门，归来后可以和它互动。</p>:<p>选择动作后回到宿舍播放；“用笔记本”仅是陪伴动画，不会读取或修改你的论文。</p>}
    <fieldset disabled={disabled}><legend>窗外的季节</legend><div className="travel-action-options">{Object.entries({auto:'跟随月份',...SEASONS}).map(([id,label])=><Button key={id} aria-pressed={atmosphere.season===id} onClick={()=>void act({type:'atmosphere',value:{...atmosphere,season:id as typeof atmosphere.season}})}>{label}</Button>)}</div></fieldset>
    <fieldset disabled={disabled}><legend>窗外的天气</legend><div className="travel-action-options">{Object.entries({auto:'跟随沈阳天气',...WEATHER}).map(([id,label])=><Button key={id} aria-pressed={atmosphere.weather===id} onClick={()=>void act({type:'atmosphere',value:{...atmosphere,weather:id as typeof atmosphere.weather}})}>{label}</Button>)}</div></fieldset>
    {atmosphere.weather==='auto'&&<div className="travel-weather-report" role="status">
      {cityWeather.data?<p>辽宁·沈阳 · {cityWeather.data.temperature}°C · {WEATHER[cityWeather.data.weather]} · 风速 {cityWeather.data.wind} m/s · {cityWeather.data.night?'夜间':'白天'}<br/>{cityWeather.stale?'缓存天气 · ':''}数据时间 {new Date(cityWeather.data.observedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</p>:<p>{cityWeather.loading?'正在获取沈阳天气…':'暂无可用天气，暂用晴天示意，不代表实际天气。'}</p>}
      {cityWeather.error&&<p className="text-destructive">{cityWeather.error}。</p>}
      <Button disabled={cityWeather.loading} onClick={cityWeather.retry}>{cityWeather.loading?'正在更新…':'刷新天气'}</Button>
    </div>}
    <p>数据来自 <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a>（CC BY 4.0），是气象模型当前值，非气象站秒级实测。前台每 15 分钟更新，失败最多保留 6 小时缓存；固定查询沈阳市，不读取用户定位。手动天气为模拟效果。</p>
    <p>季节按北京时间月份变化；窗景为游戏示意，不代表真实校园建筑。</p>
    <p>轻柔动画可在“伙伴与偏好”关闭，系统减少动态效果优先。</p>
  </div>;
}
