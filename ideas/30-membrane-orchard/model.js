(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.Orchard=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const PRESETS=Object.freeze({
  lace:{feed:.029,kill:.057,label:'Lace / wandering threads'},
  islands:{feed:.0367,kill:.0649,label:'Islands / patient colonies'},
  coral:{feed:.0545,kill:.062,label:'Coral / crowded growth'}
});
function params(feed,kill,dt=1){
  if(!Number.isFinite(feed)||!Number.isFinite(kill)||feed<0||feed>.1||kill<0||kill>.1||!Number.isFinite(dt)||dt<=0||dt>1)throw new RangeError('Feed and kill must be 0..0.1; timestep must be (0,1].');
}
function random(seed){let n=(Number(seed)>>>0)||1;return()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};}
function create(w=112,h=112,seed=7){
  if(!Number.isInteger(w)||!Number.isInteger(h)||w<8||h<8||w>256||h>256)throw new RangeError('Grid dimensions must be integers 8..256.');
  const n=w*h,s={w,h,u:new Float64Array(n).fill(1),v:new Float64Array(n),nu:new Float64Array(n),nv:new Float64Array(n),age:0};
  const rng=random(seed);
  for(let i=0;i<21;i++)plant(s,(.1+.8*rng())*w,(.1+.8*rng())*h,2.5+rng()*2.6,.4+rng()*.15);
  return s;
}
function plant(s,cx,cy,radius=4,strength=.5){
  if(![cx,cy,radius,strength].every(Number.isFinite)||radius<=0||radius>Math.max(s.w,s.h)||strength<0||strength>1)throw new RangeError('Invalid planting parameters.');
  for(let y=Math.floor(cy-radius);y<=Math.ceil(cy+radius);y++)for(let x=Math.floor(cx-radius);x<=Math.ceil(cx+radius);x++){
    if((x-cx)**2+(y-cy)**2>radius*radius)continue;
    const i=((y%s.h+s.h)%s.h)*s.w+(x%s.w+s.w)%s.w;
    s.v[i]=strength;s.u[i]=1-strength;
  }
}
function laplacian(a,w,h,x,y){
  const xm=x===0?w-1:x-1,xp=x===w-1?0:x+1,ym=(y===0?h-1:y-1)*w,yp=(y===h-1?0:y+1)*w,row=y*w;
  return -a[row+x]+.2*(a[row+xm]+a[row+xp]+a[ym+x]+a[yp+x])+.05*(a[ym+xm]+a[ym+xp]+a[yp+xm]+a[yp+xp]);
}
function step(s,feed,kill,dt=1){
  params(feed,kill,dt);const {w,h,u,v,nu,nv}=s;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x,uvv=u[i]*v[i]*v[i];
    nu[i]=Math.max(0,Math.min(1,u[i]+dt*(laplacian(u,w,h,x,y)-uvv+feed*(1-u[i]))));
    nv[i]=Math.max(0,Math.min(1,v[i]+dt*(.5*laplacian(v,w,h,x,y)+uvv-(feed+kill)*v[i])));
  }
  s.u=nu;s.v=nv;s.nu=u;s.nv=v;s.age+=dt;return s;
}
function measure(s){let sum=0,active=0;for(const value of s.v){sum+=value;if(value>.15)active++;}return {mean:sum/s.v.length,coverage:active/s.v.length};}
return {PRESETS,params,random,create,plant,laplacian,step,measure};
});
