import parts from './assets/seal-parts-v3.png';
import { PARTS } from './sealSprites';
const layers=[['tail',241,87,96,95],['left',20,153,68,80],['body',35,14,250,205],['happy',63,78,98,36],['right',191,154,76,84]] as const;
export function SealFallback({name}:{name:string}){
  return <span role="img" aria-label={name} className="travel-seal-still">{layers.map(([id,x,y,w,h])=>{
    const [sx,sy,sw,sh]=PARTS[id];
    return <span key={id} style={{position:'absolute',left:`${x/340*100}%`,top:`${y/250*100}%`,width:`${w/340*100}%`,height:`${h/250*100}%`,backgroundImage:`url(${parts})`,backgroundSize:`${1536/sw*100}% ${1024/sh*100}%`,backgroundPosition:`${sx/(1536-sw)*100}% ${sy/(1024-sh)*100}%`}}/>;
  })}</span>;
}
