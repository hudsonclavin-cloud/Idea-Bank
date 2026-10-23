import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),M=require('./model.js');
const close=(a,b,eps=1e-7)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);
test('phase boundaries conserve enthalpy and temperature',()=>{
 const b=M.budget();
 close(M.at(b.warmTime).temperature,b.melt);
 close(M.at(b.warmTime).energy,b.capacity*(b.melt-b.initial));
 close(M.at(b.warmTime+b.phaseTime).fraction,1);
 close(M.at(b.warmTime+b.phaseTime).energy,b.capacity*(b.melt-b.initial)+b.latentEnergy);
 for(const t of [b.warmTime,b.warmTime+b.phaseTime])close(M.at(t-.000001).temperature,M.at(t+.000001).temperature,1e-6);
});
test('melting absorbs heat at the expected rate',()=>{
 const b=M.budget(),a=M.at(b.warmTime+10),c=M.at(b.warmTime+110);
 close(c.energy-a.energy,b.conductance*(b.ambient-b.melt)*100);
 close(a.temperature,c.temperature);
});
test('exact solution agrees with integrated Newton heat flux',()=>{
 const dt=1,limit=21600;let q=0;
 for(let t=0;t<limit;t+=dt)q+=M.defaults.conductance*(M.defaults.ambient-M.at(t+dt/2).temperature)*dt;
 close(q,M.at(limit).energy,.01);
});
test('zero conductance never warms; zero latent follows a single exponential',()=>{
 close(M.at(1e8,{conductance:0}).temperature,18);assert.equal(M.timeTo(25,{conductance:0}),Infinity);
 const p=M.budget({latent:0});
 for(const t of [0,300,3000,20000])close(M.at(t,{latent:0}).temperature,p.ambient+(p.initial-p.ambient)*Math.exp(-p.conductance*t/p.capacity));
});
test('time inversion, monotonic warming, and larger latent hold longer',()=>{
 for(const target of [19,21,22,23,25,31])close(M.at(M.timeTo(target)).temperature,target);
 let last=18;for(let t=0;t<=30000;t+=100){const s=M.at(t);assert.ok(s.temperature>=last-1e-10&&s.temperature<32);last=s.temperature;}
 assert.ok(M.timeTo(25,{latent:220000})>M.timeTo(25,{latent:100000}));
});
test('invalid physical parameters and times rejected',()=>{
 for(const p of [{mass:-1},{payload:0},{ambient:20},{latent:NaN},{conductance:-1}])assert.throws(()=>M.at(0,p),RangeError);
 assert.throws(()=>M.at(-1),RangeError);
});
