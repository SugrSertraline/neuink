import { describe,it,expect } from 'vitest';
import { parseCityWeather,weatherForCode,WEATHER_MAX_AGE } from './shenyangWeather';
import { weatherEffects } from './windowWeather';
const now=Date.parse('2026-09-28T10:00:00Z');
const payload={current:{time:now/1000,weather_code:63,is_day:0,temperature_2m:12,cloud_cover:95,wind_speed_10m:8,wind_direction_10m:270,precipitation:2}};
describe('Shenyang weather normalization',()=>{
  it('maps cloud, rain, freezing rain, snow, fog and storms explicitly',()=>{
    expect([0,1,2,3,45,48,51,67,73,86,95,99].map(weatherForCode)).toEqual(['sunny','sunny','cloudy','cloudy','fog','fog','rain','rain','snow','snow','rain','rain']);
  });
  it('keeps units, timestamp, darkness and simultaneous rain/wind',()=>{
    const data=parseCityWeather(payload,now);
    expect(data).toMatchObject({weather:'rain',wind:8,cloud:.95,night:true,observedAt:now});
    expect(weatherEffects({...data,season:'autumn'})).toMatchObject({rain:true,snow:false,wind:8,night:true});
  });
  it('rejects missing, null, nonfinite, unknown, stale and future responses',()=>{
    for(const current of [null,{}, {...payload.current,wind_speed_10m:null},{...payload.current,temperature_2m:Infinity},{...payload.current,weather_code:4},{...payload.current,time:(now-WEATHER_MAX_AGE-1)/1000},{...payload.current,time:now/1000+3600}]){
      expect(()=>parseCityWeather({current},now)).toThrow();
    }
  });
  it('does not paint snow for clouds and caps storm intensity',()=>{
    expect(weatherEffects({season:'winter',weather:'cloudy'})).toMatchObject({rain:false,snow:false,cloud:.85});
    expect(weatherEffects({season:'summer',weather:'rain',wind:90,precipitation:100})).toMatchObject({wind:18,precipitation:8});
  });
});
