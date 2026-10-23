import { createRequire } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);const M=require('./molecule.js');
const close=(a,b,t=1e-12)=>assert.ok(Math.abs(a-b)<=Math.max(1,Math.abs(a),Math.abs(b))*t,`${a} != ${b}`);
test('reduced mass and frequency are symmetric under swapping atoms',()=>{
 for(const a of [1,2,12,16,40])for(const b of [1,2,12,16,40]){
  const m=M.mode(a,b,500),r=M.mode(b,a,500);close(m.reducedU,r.reducedU);close(m.hz,r.hz);
 }
 close(M.mode(12,12,500).reducedU,6);
});
test('SI conversion agrees with direct independent oscillator calculation',()=>{
 const m=M.mode(1,1,100);close(m.reducedKg,M.U/2);
 close(m.hz,Math.sqrt(100/(M.U/2))/(2*Math.PI));close(m.wavenumber,m.hz/299792458/100);
});
test('frequency scales with square root of stiffness and inverse square root of common mass',()=>{
 const f=M.mode(12,1,500).hz;close(M.mode(12,1,2000).hz,2*f);close(M.mode(48,4,500).hz,f/2);
});
test('heavier isotope is lower and every animation displacement preserves center of mass',()=>{
 for(const a of [1,12,40])for(const b of [1,16,40]){
  assert.ok(M.mode(a,b+1,500).hz<M.mode(a,b,500).hz);
  for(let phase=0;phase<7;phase+=.17){const d=M.displacement(a,b,phase,55);assert.ok(Math.abs(a*d.a+b*d.b)<1e-10);close(d.b-d.a,55*Math.sin(phase));}
 }
});
test('invalid physical inputs fail explicitly',()=>{
 for(const value of [0,-1,NaN,Infinity])for(let i=0;i<3;i++){const a=[12,1,500];a[i]=value;assert.throws(()=>M.mode(...a),RangeError);}
 assert.throws(()=>M.displacement(1,2,Infinity),RangeError);
});
test('fixed audio translation preserves interval ratios throughout controls',()=>{
 for(const a of [1,40])for(const b of [1,40])for(const k of [50,1000]){
  const base=M.mode(a,b,k),heavy=M.mode(a,b+1,k);close(base.audible/heavy.audible,base.hz/heavy.hz);assert.ok(base.audible>=20&&base.audible<=16000);
 }
});
