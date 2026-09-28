import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { TravelDestination, World } from '@/shared/types/paradise';
import { activeTrip, GEARS, type Action } from './world';
import { DESTINATIONS, destinationOf, earnedStamps } from './destinations';

export function TravelDestinations({world, now, disabled, act, onDepart}: {
  world: World; now: number; disabled: boolean; act: (a: Action) => Promise<boolean>; onDepart: () => void;
}) {
  const [destination, setDestination] = useState<TravelDestination>('informatics');
  const trip = activeTrip(world, now), stamps = earnedStamps(world, now);
  const route = DESTINATIONS[destination];
  return <div className="travel-form">
    <p>选一个想让伙伴去的地方。你继续阅读，它会带着来信回来；不需要保持游戏打开。</p>
    <fieldset disabled={disabled || !!trip} className="travel-destinations"><legend>这次去哪里？</legend>
      {(Object.entries(DESTINATIONS) as [TravelDestination, typeof route][]).map(([id, place]) =>
        <label key={id} data-selected={destination === id}>
          <input type="radio" name="travel-destination" checked={destination === id} onChange={() => setDestination(id)}/>
          <span><strong>{place.name}</strong><small>{place.description}</small>
            <small>{!world.trips.length ? '首次体验约 1 分钟' : `约 ${place.duration / 60000} 分钟`} · {id === 'trial' ? '示意插画' : '文字明信片 · 照片待补充'}</small></span>
          {stamps.includes(id) && <span className="travel-stamp">已到访</span>}
        </label>)}
    </fieldset>
    <p>携带：{GEARS[world.gear].name}。出发后行囊和目的地不会被后续设置改变。</p>
    {trip ? <p role="status">正在前往／游览{DESTINATIONS[destinationOf(trip)].name}，归来后再安排下一程。</p> :
      <Button disabled={disabled || world.trips.length >= 500} onClick={async () => {
        if (await act({type:'depart', destination, now:Date.now(), id:crypto.randomUUID()})) onDepart();
      }}>带上{GEARS[world.gear].name}，出发去{route.name}</Button>}
    <small>校园来信为预设虚构小故事，不代表真实活动或实时天气。缺少参考图时不会显示假实景。</small>
  </div>;
}
