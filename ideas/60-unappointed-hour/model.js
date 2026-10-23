(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.Unappointed=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const TAU=2*Math.PI;
const wrap=x=>((x%TAU)+TAU)%TAU;
function rng(seed){let n=seed>>>0;return()=>{n=(n+0x6d2b79f5)>>>0;let t=n;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
function create(seed=60,count=96){
 if(!Number.isInteger(count)||count<2||count>200||!Number.isInteger(seed)||seed<0||seed>4294967295)throw new RangeError('Use 2–200 oscillators and an unsigned 32-bit seed.');
 const random=rng(seed),agents=Array.from({length:count},()=>({x:.04+.92*random(),y:.06+.78*random(),phase:TAU*random(),offset:2*random()-1,wing:random()*TAU}));
 return{agents,time:0,seed};
}
function parameters(p={}){const q={coupling:3.6,spread:.18,radius:.28,...p};if(!Object.values(q).every(Number.isFinite)||q.coupling<0||q.coupling>8||q.spread<0||q.spread>.5||q.radius<.02||q.radius>1.5)throw new RangeError('Coupling 0–8, spread 0–0.5 Hz, radius 0.02–1.5 required.');return q;}
function derivatives(state,p={}){
 const q=parameters(p),a=state.agents;
 return a.map((v,i)=>{let sum=0,n=0;for(let j=0;j<a.length;j++)if(i!==j&&Math.hypot(v.x-a[j].x,v.y-a[j].y)<=q.radius){sum+=Math.sin(a[j].phase-v.phase);n++;}return TAU*(.65+v.offset*q.spread)+(n?q.coupling*sum/n:0);});
}
function step(state,p={},dt=1/60){
 if(!Number.isFinite(dt)||dt<=0||dt>.05)throw new RangeError('Timestep must be in (0, 0.05] seconds.');
 const d=derivatives(state,p);state.agents.forEach((a,i)=>a.phase=wrap(a.phase+d[i]*dt));state.time+=dt;return state;
}
function order(state){let x=0,y=0;for(const a of state.agents){x+=Math.cos(a.phase);y+=Math.sin(a.phase);}return Math.min(1,Math.hypot(x,y)/state.agents.length);}
function disturb(state,x=.5,y=.5,radius=.19){if(![x,y,radius].every(Number.isFinite)||x<0||x>1||y<0||y>1||radius<=0||radius>1.5)throw new RangeError('Disturbance must be inside the field with positive radius.');let count=0;for(const a of state.agents)if(Math.hypot(a.x-x,a.y-y)<=radius){a.phase=wrap(a.phase+Math.PI);count++;}return count;}
function scatter(state,seed=1){const random=rng(seed);for(const a of state.agents)a.phase=TAU*random();return state;}
function brightness(phase){if(!Number.isFinite(phase))throw new RangeError('Finite phase required.');return Math.exp(8*(Math.cos(phase)-1));}
return{TAU,wrap,rng,create,parameters,derivatives,step,order,disturb,scatter,brightness};
});
