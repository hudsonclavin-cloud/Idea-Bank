(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.Slingshot=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const PLANETS={earth:{name:'Earth',mu:398600.4418,radius:6371,speed:29.78,color:'#7fc9c0'},jupiter:{name:'Jupiter',mu:126686534,radius:69911,speed:13.07,color:'#e5af81'},venus:{name:'Venus',mu:324858.592,radius:6051.8,speed:35.02,color:'#f0ca83'}};
const rad=d=>d*Math.PI/180;
function rotate(v,a){return [v[0]*Math.cos(a)-v[1]*Math.sin(a),v[0]*Math.sin(a)+v[1]*Math.cos(a)];}
function norm(v){return Math.hypot(...v);}
function add(a,b){return [a[0]+b[0],a[1]+b[1]];}
function deflection(mu,rp,speed){if(![mu,rp,speed].every(Number.isFinite)||mu<=0||rp<=0||speed<=0)throw new RangeError('Positive finite mu, periapsis and speed required');return 2*Math.asin(1/(1+rp*speed*speed/mu));}
function encounter({planet='jupiter',altitude=80000,speed=8,angle=-100,side=1}={}){
 const p=PLANETS[planet];
 if(!p||![altitude,speed,angle,side].every(Number.isFinite)||altitude<0||speed<=0||![-1,1].includes(side))throw new RangeError('Invalid encounter');
 const rp=p.radius+altitude,delta=deflection(p.mu,rp,speed),incoming=[speed*Math.cos(rad(angle)),speed*Math.sin(rad(angle))],outgoing=rotate(incoming,side*delta),vp=[p.speed,0];
 const helioIn=add(incoming,vp),helioOut=add(outgoing,vp);
 return {planet:p,rp,delta,e:1+rp*speed*speed/p.mu,speed,angle,side,incoming,outgoing,vp,helioIn,helioOut,gain:norm(helioOut)-norm(helioIn),energy:(norm(helioOut)**2-norm(helioIn)**2)/2};
}
function trajectory(encounter,count=180){
 if(!Number.isInteger(count)||count<2)throw new RangeError('At least two samples required');
 const {e,rp,side,angle}=encounter,maxRadius=rp*5,limit=Math.acos((rp*(1+e)/maxRadius-1)/e),alpha=Math.acos(1/e),rotation=rad(angle)-side*alpha;
 return Array.from({length:count},(_,i)=>{const nu=-limit+2*limit*i/(count-1),r=rp*(1+e)/(1+e*Math.cos(nu));return rotate([r*Math.cos(nu),side*r*Math.sin(nu)],rotation);});
}
return {PLANETS,rotate,norm,add,deflection,encounter,trajectory};
});
