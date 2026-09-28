import type { SceneSettings } from './sceneState';

export function weatherEffects(input:SceneSettings) {
  return {
    wind:Math.min(18,Math.max(0,input.wind??(input.weather==='wind'?9:input.weather==='rain'?3:1))),
    cloud:input.cloud??(input.weather==='cloudy'||input.weather==='rain'?.85:input.weather==='fog'?.6:.1),
    rain:input.weather==='rain',snow:input.weather==='snow',fog:input.weather==='fog',night:!!input.night,
    precipitation:Math.min(8,Math.max(.2,input.precipitation??1.5)),
    direction:Math.sin((input.direction??270)*Math.PI/180)*-1,
  };
}
// Painted only inside the existing window aperture. No fullscreen particles or flashing lightning.
export function paintWindowWeather(ctx:CanvasRenderingContext2D,input:SceneSettings,time:number) {
  const fx=weatherEffects(input),drift=fx.direction*fx.wind;
  ctx.fillStyle=`rgba(37,49,68,${fx.night?.57:fx.cloud*.32})`;ctx.fillRect(0,0,400,480);
  if(fx.cloud>.35){
    ctx.fillStyle=`rgba(191,201,207,${fx.night?.05:.12})`;
    for(let i=0;i<5;i++){
      const x=((i*163+time*(3+fx.wind))%640)-120;
      ctx.beginPath();ctx.ellipse(x,25+i*24,120,22,0,0,Math.PI*2);ctx.fill();
    }
  }
  if(fx.fog){
    const fog=ctx.createLinearGradient(0,60,0,480);fog.addColorStop(0,'#c5d1d53d');fog.addColorStop(1,'#d5dddf9e');
    ctx.fillStyle=fog;ctx.fillRect(0,0,400,480);
  }
  if(fx.rain||fx.snow){
    ctx.strokeStyle='#dcecf2aa';ctx.fillStyle='#ffffffe0';ctx.lineWidth=1.1;
    const count=Math.min(130,35+Math.round(fx.precipitation*12));
    for(let i=0;i<count;i++){
      const speed=fx.rain?180+fx.precipitation*18:25;
      const x=((i*79+time*drift*7)%460+460)%460-30,y=(i*137+time*speed)%520-20;
      ctx.beginPath();
      if(fx.rain){ctx.moveTo(x,y);ctx.lineTo(x+drift*.7,y+15+fx.precipitation);ctx.stroke();}
      else{ctx.arc(x+Math.sin(time+i)*7,y,1.2+(i%3)*.7,0,Math.PI*2);ctx.fill();}
    }
    if(fx.rain){
      // Fine droplets sliding down the glass, distinct from rain in the distance.
      ctx.strokeStyle='#e4f4ff5c';
      for(let i=0;i<9;i++){
        const x=23+i*43,y=(i*57+time*(8+i))%480;
        ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+1,y+7);ctx.stroke();
      }
    }
  }
  if(fx.wind>=4){
    ctx.strokeStyle='#eaf0df66';ctx.lineWidth=1;
    for(let i=0;i<8;i++){
      const x=((i*89+time*drift*15)%500+500)%500-50,y=130+i*42+Math.sin(time*2+i)*7;
      ctx.beginPath();ctx.moveTo(x,y);ctx.quadraticCurveTo(x+18,y-5,x+44,y);ctx.stroke();
      if(input.season==='autumn'){
        ctx.fillStyle=i%2?'#c29252aa':'#aa7045aa';ctx.beginPath();ctx.ellipse(x,y,4,1.8,time+i,0,Math.PI*2);ctx.fill();
      }
    }
  }
}
