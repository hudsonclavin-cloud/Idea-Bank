(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.RootprintModel=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
function fraction(pH,pKa=6.8){if(!Number.isFinite(pH)||!Number.isFinite(pKa))throw new Error('Finite pH and pKa required');return 1/(1+10**(pKa-pH));}
function simulate(options={}){
 const p={reserve:700,soilCapacity:180,initialSoil:140,wick:140,demand:55,evaporation:8,days:21,dt:1/24,...options};
 for(const key of ['reserve','soilCapacity','initialSoil','wick','demand','evaporation','days','dt'])if(!Number.isFinite(p[key])||p[key]<0)throw new Error('Invalid '+key);
 if(p.soilCapacity<=0||p.initialSoil>p.soilCapacity||p.dt<=0||p.days>365||p.days/p.dt>1e6)throw new Error('Invalid simulation bounds');
 let reserve=p.reserve,soil=p.initialSoil,uptake=0,evaporated=0,unmet=0,firstGap=null,time=0;
 const records=[{day:0,reserve,soil,uptake,evaporated,unmet}];
 const steps=Math.ceil(p.days/p.dt);
 for(let i=0;i<steps;i++){
  const dt=Math.min(p.dt,p.days-time);if(dt<=0)break;
  // A phenomenological wick law: wet media slow the flow, dry media speed it up.
  const transfer=Math.min(reserve,p.wick*(1-soil/p.soilCapacity)*dt,p.soilCapacity-soil);
  reserve-=transfer;soil+=transfer;
  const e=Math.min(soil,p.evaporation*dt);soil-=e;evaporated+=e;
  const requested=p.demand*dt,used=Math.min(soil,requested);soil-=used;uptake+=used;unmet+=requested-used;
  if(requested-used>1e-8&&firstGap===null)firstGap=time;
  time+=dt;records.push({day:time,reserve,soil,uptake,evaporated,unmet});
 }
 return {params:p,records,firstGap,initialWater:p.reserve+p.initialSoil};
}
function atDay(result,day){return result.records.reduce((best,r)=>Math.abs(r.day-day)<Math.abs(best.day-day)?r:best,result.records[0]);}
return {fraction,simulate,atDay};
});
