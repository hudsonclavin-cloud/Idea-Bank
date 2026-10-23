(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.EntropyCustoms=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const W=800,H=380,THRESHOLD=130;
function random(seed){let x=seed>>>0;return()=>{x=(x+0x6D2B79F5)>>>0;let t=x;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
function create(seed=57,count=72){
 if(!Number.isInteger(seed)||!Number.isInteger(count)||count<2||count>300)throw new RangeError('Integer seed and 2–300 particles required.');
 const rng=random(seed),particles=[];
 for(let i=0;i<count;i++){
  const side=i%2,speed=i%4<2?85:175,angle=rng()*Math.PI*2;
  particles.push({x:(side?410:10)+rng()*380,y:10+rng()*360,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,side});
 }
 return {particles,time:0,mode:'manual',open:false,aperture:90,decisions:0,admitted:0,last:null};
}
function allowed(state,p,y){
 if(Math.abs(y-H/2)>state.aperture/2)return false;
 if(state.mode==='clerk')return p.side===0?Math.hypot(p.vx,p.vy)>=THRESHOLD:Math.hypot(p.vx,p.vy)<THRESHOLD;
 return state.open;
}
function advance(p,dt,state){
 let remaining=dt;
 for(let iteration=0;remaining>1e-10&&iteration<16;iteration++){
  const crossing=(p.side===0&&p.vx>0)||(p.side===1&&p.vx<0);
  const targetX=crossing?W/2:(p.vx>0?W:0),targetY=p.vy>0?H:0;
  const tx=p.vx===0?Infinity:Math.max(0,(targetX-p.x)/p.vx);
  const ty=p.vy===0?Infinity:Math.max(0,(targetY-p.y)/p.vy);
  const t=Math.min(remaining,tx,ty);
  p.x+=p.vx*t;p.y+=p.vy*t;remaining-=t;
  if(tx<=t+1e-10){
   if(crossing){
    const passes=allowed(state,p,p.y);state.decisions++;state.admitted+=Number(passes);
    state.last={passes,side:p.side,speed:Math.hypot(p.vx,p.vy)};
    if(passes)p.side=1-p.side;else p.vx=-p.vx;
   }else p.vx=-p.vx;
  }
  if(ty<=t+1e-10)p.vy=-p.vy;
 }
}
function step(state,dt=1/60){
 if(!Number.isFinite(dt)||dt<=0||dt>.1)throw new RangeError('Timestep must be in (0, 0.1].');
 if(!Number.isFinite(state.aperture)||state.aperture<0||state.aperture>H||!['manual','clerk'].includes(state.mode))throw new RangeError('Invalid border controls.');
 for(const p of state.particles)advance(p,dt,state);
 state.time+=dt;return state;
}
function binaryEntropy(p){if(!Number.isFinite(p)||p<0||p>1)throw new RangeError('Probability must be 0–1.');return p===0||p===1?0:-p*Math.log2(p)-(1-p)*Math.log2(1-p);}
function stats(state){
 const chambers=[{count:0,energy:0,fast:0},{count:0,energy:0,fast:0}];let correct=0;
 for(const p of state.particles){const c=chambers[p.side],speed2=p.vx*p.vx+p.vy*p.vy,fast=speed2>=THRESHOLD*THRESHOLD;c.count++;c.energy+=speed2/2;c.fast+=Number(fast);correct+=Number(fast?p.side===1:p.side===0);}
 for(const c of chambers)c.mean=c.count?c.energy/c.count:0;
 return {chambers,total:chambers[0].energy+chambers[1].energy,sorted:correct/state.particles.length,recordEntropy:state.decisions?binaryEntropy(state.admitted/state.decisions):0};
}
return{W,H,THRESHOLD,create,allowed,step,stats,binaryEntropy};
});
