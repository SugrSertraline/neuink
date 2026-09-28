import type { Behavior } from './sceneState';
import { sealPose } from './sealAnimation';
// Measured source rectangles; original PNG and alpha are preserved, cropped only at render time.
export const PARTS={body:[22,50,585,486],left:[630,155,345,360],right:[1120,145,380,365],tail:[106,582,440,420],happy:[580,695,425,155],sleep:[1090,720,390,135]} as const;
function part(ctx:CanvasRenderingContext2D,image:HTMLImageElement,id:keyof typeof PARTS,x:number,y:number,w:number,h:number){
  const [sx,sy,sw,sh]=PARTS[id],rx=image.naturalWidth/1536,ry=image.naturalHeight/1024;
  ctx.drawImage(image,sx*rx,sy*ry,sw*rx,sh*ry,x,y,w,h);
}
function limb(ctx:CanvasRenderingContext2D,image:HTMLImageElement,id:'left'|'right'|'tail',x:number,y:number,angle:number,w:number,h:number){
  ctx.save();ctx.translate(x,y);ctx.rotate(angle);
  const px=id==='left'?.78:id==='tail'?.16:.22,py=id==='tail'?.85:.15;
  part(ctx,image,id,-w*px,-h*py,w,h);ctx.restore();
}
export function drawSeal(ctx:CanvasRenderingContext2D,image:HTMLImageElement,behavior:Behavior,time:number,moving:boolean,x:number,y:number,scale:number){
  const pose=sealPose(behavior,time,moving);
  ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);
  ctx.fillStyle='#57432924';ctx.beginPath();ctx.ellipse(5,7,105+pose.y*.4,12,0,0,Math.PI*2);ctx.fill();
  ctx.translate(0,pose.y);ctx.rotate(pose.tilt);
  limb(ctx,image,'tail',96,-43,pose.tail,96,95);
  limb(ctx,image,'left',-87,-45,pose.leftFin,68,80);
  part(ctx,image,'body',-125,-196,250,205);
  ctx.save();ctx.translate(-48+pose.eyeX,-114);ctx.scale(1,pose.eyes);
  part(ctx,image,pose.sleepy?'sleep':'happy',-49,-18,98,36);ctx.restore();
  limb(ctx,image,'right',48,-43,pose.rightFin,76,84);
  ctx.restore();
}
export function drawTypingFin(ctx:CanvasRenderingContext2D,image:HTMLImageElement,time:number,moving:boolean,x:number,y:number,scale:number){
  const pose=sealPose('typing',time,moving);
  ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);ctx.translate(0,pose.y);
  limb(ctx,image,'right',48,-43,pose.rightFin,76,84);ctx.restore();
}
export function drawLaptop(ctx:CanvasRenderingContext2D,image:HTMLImageElement,x:number,y:number,width:number){
  ctx.save();ctx.translate(x,y);
  const height=width*835/1340;
  ctx.fillStyle='#57432924';ctx.beginPath();ctx.ellipse(width*.52,height*.96,width*.43,5,0,0,Math.PI*2);ctx.fill();
  ctx.drawImage(image,130/1536*image.naturalWidth,90/1024*image.naturalHeight,1340/1536*image.naturalWidth,835/1024*image.naturalHeight,0,0,width,height);
  ctx.restore();
}
