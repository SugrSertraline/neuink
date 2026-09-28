import type { World } from '@/shared/types/paradise';
export const SEASONS = { spring: '春日', summer: '夏日', autumn: '秋日', winter: '冬日' } as const;
export const WEATHER = { sunny: '晴天', cloudy: '阴天', wind: '刮风', rain: '下雨', snow: '飘雪', fog: '薄雾' } as const;
export const BEHAVIORS = { idle: '发呆', wave: '挥挥手', hop: '开心蹦跳', typing: '用笔记本', sleep: '打个盹', look: '看窗外' } as const;
export type Season = keyof typeof SEASONS;
export type Weather = keyof typeof WEATHER;
export type Behavior = keyof typeof BEHAVIORS;
export type SceneSettings = { season: Season; weather: Weather; wind?:number; direction?:number; cloud?:number; precipitation?:number; night?:boolean };
export type SceneInput = SceneSettings & { behavior: Behavior; away: boolean; moving: boolean; sequence: number };
export function seasonForMonth(month: number): Season {
  return month >= 2 && month <= 4 ? 'spring' : month >= 5 && month <= 7 ? 'summer' : month >= 8 && month <= 10 ? 'autumn' : 'winter';
}
export function resolveAtmosphere(value:World['atmosphere'],now:number,live?:Omit<SceneSettings,'season'>|null):SceneSettings {
  const month=new Date(now+8*3600_000).getUTCMonth();
  const season=value?.season&&value.season!=='auto'?value.season:seasonForMonth(month);
  if((!value?.weather||value.weather==='auto')&&live)return {...live,season};
  const weather=value?.weather&&value.weather!=='auto'?value.weather:'sunny';
  return {season,weather};
}
