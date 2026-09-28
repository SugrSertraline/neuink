import { describe,expect,it } from 'vitest';
import { sampleKeys,sealPose,SEAL_CLIPS,ACTION_SECONDS } from './sealAnimation';
describe('2D cutout keyframes',()=>{
  it('keeps idle perfectly still and settles every gesture once',()=>{
    expect(sealPose('idle',0,true)).toEqual(sealPose('idle',321,true));
    for(const action of Object.keys(ACTION_SECONDS) as (keyof typeof ACTION_SECONDS)[]){
      expect(sealPose(action,ACTION_SECONDS[action],true)).toEqual(sealPose('idle',0,true));
      expect(sealPose(action,300,true)).toEqual(sealPose('idle',0,true));
      expect(sealPose(action,.2,true).x).toBe(0);
    }
  });
  it('keeps all loop boundaries continuous',()=>{
    for(const keys of Object.values(SEAL_CLIPS)){
      expect(keys[0][1]).toBe(keys[keys.length-1][1]);
      expect(sampleKeys(keys,.999999)).toBeCloseTo(sampleKeys(keys,0),4);
    }
  });
  it('animates fins independently and uses a separate sleeping expression',()=>{
    expect(sealPose('wave',.5,true).rightFin).not.toBe(sealPose('wave',0,true).rightFin);
    expect(sealPose('wave',.5,true).leftFin).toBe(sealPose('wave',0,true).leftFin);
    expect(sealPose('typing',.2,true).leftFin).not.toBe(sealPose('typing',.2,true).rightFin);
    expect(sealPose('sleep',1,true).sleepy).toBe(true);
    expect(sealPose('hop',.56,true).y).toBeLessThan(-20);
    expect(sealPose('look',1,true).eyeX).toBeGreaterThan(0);
  });
  it('has a stable reduced-motion pose for every action',()=>{
    for(const action of ['idle','wave','hop','typing','sleep','look'] as const){
      expect(sealPose(action,0,false)).toEqual(sealPose(action,.5,false));
    }
  });
});
