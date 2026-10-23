(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.Pebble=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const defaults=Object.freeze({mass:.35,payload:.25,latent:180000,ambient:32,conductance:.55,initial:18,melt:22,cp:2000,payloadCp:3500});
function parameters(input={}){
 const p={...defaults,...input};
 for(const k of Object.keys(defaults))if(!Number.isFinite(p[k]))throw new RangeError(`${k} must be finite`);
 if(p.mass<0||p.payload<=0||p.latent<0||p.cp<=0||p.payloadCp<=0||p.conductance<0||p.initial>=p.melt||p.ambient<=p.melt)throw new RangeError('Use nonnegative buffer/latent/conductance, positive heat capacities, and initial < melt < ambient.');
 return p;
}
function budget(input={}){
 const p=parameters(input),capacity=p.mass*p.cp+p.payload*p.payloadCp,latent=p.mass*p.latent;
 const warmTime=p.conductance===0?Infinity:capacity/p.conductance*Math.log((p.ambient-p.initial)/(p.ambient-p.melt));
 const phaseTime=p.conductance===0?Infinity:latent/(p.conductance*(p.ambient-p.melt));
 return {...p,capacity,latentEnergy:latent,warmTime,phaseTime};
}
function at(seconds,input={}){
 if(!Number.isFinite(seconds)||seconds<0)throw new RangeError('Time must be finite and nonnegative.');
 const p=budget(input);let temperature,fraction=0,phase;
 if(p.conductance===0){temperature=p.initial;phase='solid';}
 else if(seconds<p.warmTime){temperature=p.ambient+(p.initial-p.ambient)*Math.exp(-p.conductance*seconds/p.capacity);phase='solid';}
 else if(p.latentEnergy>0&&seconds<p.warmTime+p.phaseTime){temperature=p.melt;fraction=(seconds-p.warmTime)/p.phaseTime;phase='melting';}
 else{temperature=p.ambient+(p.melt-p.ambient)*Math.exp(-p.conductance*(seconds-p.warmTime-p.phaseTime)/p.capacity);fraction=p.latentEnergy>0?1:0;phase='liquid';}
 const energy=p.capacity*(temperature-p.initial)+fraction*p.latentEnergy;
 return {temperature,fraction,phase,energy};
}
function timeTo(target,input={}){
 const p=budget(input);
 if(!Number.isFinite(target))throw new RangeError('Target must be finite.');
 if(target<=p.initial)return 0;
 if(p.conductance===0||target>=p.ambient)return Infinity;
 if(target<=p.melt)return p.capacity/p.conductance*Math.log((p.ambient-p.initial)/(p.ambient-target));
 return p.warmTime+p.phaseTime+p.capacity/p.conductance*Math.log((p.ambient-p.melt)/(p.ambient-target));
}
return {defaults,parameters,budget,at,timeTo};
});
