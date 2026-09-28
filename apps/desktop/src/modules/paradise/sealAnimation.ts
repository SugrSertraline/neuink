import type { Behavior } from './sceneState';
type Key = readonly [number, number];
// Normalized cutout keyframes; matching endpoints prevent jumps at loop boundaries.
export const SEAL_CLIPS = {
  breathe: [[0,0],[.45,-2],[1,0]],
  wave: [[0,-.1],[.2,-1.45],[.35,-1.05],[.5,-1.55],[.65,-1.05],[.8,-1.4],[1,-.1]],
  hop: [[0,0],[.18,3],[.4,-28],[.6,-25],[.83,2],[1,0]],
  typeLeft: [[0,-.62],[.25,-.83],[.5,-.62],[.75,-.43],[1,-.62]],
  typeRight: [[0,-.85],[.25,-.57],[.5,-.85],[.75,-1.03],[1,-.85]],
  tail: [[0,-.06],[.5,.08],[1,-.06]],
  blink: [[0,1],[.9,1],[.94,.08],[.98,1],[1,1]],
} as const satisfies Record<string, readonly Key[]>;
export function sampleKeys(keys:readonly Key[],phase:number):number {
  const p=((phase%1)+1)%1;
  for(let i=1;i<keys.length;i++){
    const [end,b]=keys[i], [start,a]=keys[i-1];
    if(p<=end){const f=(p-start)/(end-start),ease=f*f*(3-2*f);return a+(b-a)*ease;}
  }
  return keys[0][1];
}
export function sealPose(behavior:Behavior,time:number,moving:boolean){
  if(time>=ACTION_SECONDS[behavior])behavior='idle';
  const active=behavior!=='idle',t=moving&&active?Math.max(0,time):0,typing=behavior==='typing',sleep=behavior==='sleep';
  return {
    x:0,
    y:behavior==='hop'?sampleKeys(SEAL_CLIPS.hop,t/1.4):0,
    tilt:sleep?.09:behavior==='look'?-.06:0,
    leftFin:typing?sampleKeys(SEAL_CLIPS.typeLeft,t/.6):-.05,
    rightFin:typing?sampleKeys(SEAL_CLIPS.typeRight,t/.6):behavior==='wave'?sampleKeys(SEAL_CLIPS.wave,t/2.5):.04,
    tail:0,eyes:1,
    sleepy:sleep,eyeX:typing?8:behavior==='look'?12:0,
  };
}
// User-triggered gestures finish once; idle has no breathing, blinking or tail loop.
export const ACTION_SECONDS:Record<Behavior,number>={idle:0,wave:2.5,hop:1.4,typing:5.4,sleep:5,look:3};
