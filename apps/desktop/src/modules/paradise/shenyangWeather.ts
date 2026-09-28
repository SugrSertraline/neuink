import type { Weather } from './sceneState';

// Fixed city-level coordinates: no geolocation, credentials or workspace data.
export const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast?latitude=41.8057&longitude=123.4315&current=temperature_2m,is_day,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m&wind_speed_unit=ms&timeformat=unixtime&timezone=Asia%2FShanghai';
export const WEATHER_INTERVAL = 15 * 60_000;
export const WEATHER_MAX_AGE = 6 * 60 * 60_000;
export type CityWeather = {
  observedAt:number; temperature:number; weather:Weather; cloud:number;
  wind:number; direction:number; precipitation:number; night:boolean;
};
const codes = [0,1,2,3,45,48,51,53,55,56,57,61,63,65,66,67,71,73,75,77,80,81,82,85,86,95,96,99];
export function weatherForCode(code:number):Weather {
  if([71,73,75,77,85,86].includes(code))return 'snow';
  if(code>=51)return 'rain';
  if(code===45||code===48)return 'fog';
  return code>=2?'cloudy':'sunny';
}
export function parseCityWeather(payload:unknown, now=Date.now()):CityWeather {
  const current=(payload as {current?:Record<string,unknown>}|null)?.current;
  const number=(key:string,min:number,max:number)=>{
    const v=current?.[key];
    if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw new Error('天气数据不完整');
    return v;
  };
  const observedAt=number('time',0,Number.MAX_SAFE_INTEGER)*1000;
  if(observedAt>now+15*60_000||now-observedAt>WEATHER_MAX_AGE)throw new Error('天气数据已过期');
  const code=number('weather_code',0,99),day=number('is_day',0,1);
  if(!codes.includes(code)||!Number.isInteger(day))throw new Error('天气代码无效');
  return {observedAt,weather:weatherForCode(code),temperature:number('temperature_2m',-90,60),
    cloud:number('cloud_cover',0,100)/100,wind:number('wind_speed_10m',0,120),
    direction:number('wind_direction_10m',0,360),precipitation:number('precipitation',0,300),night:day===0};
}
export async function fetchCityWeather(signal:AbortSignal):Promise<unknown> {
  const response=await fetch(WEATHER_URL,{signal,credentials:'omit',referrerPolicy:'no-referrer'});
  if(!response.ok)throw new Error(`天气服务暂不可用（HTTP ${response.status}）`);
  return response.json();
}
