import test from 'node:test';
import assert from 'node:assert/strict';
import M from './model.js';

test('same seed and controls reproduce every concentration',()=>{const a=M.create(24,24,918),b=M.create(24,24,918);for(let i=0;i<50;i++){M.step(a,.035,.06);M.step(b,.035,.06);}assert.deepEqual(a.u,b.u);assert.deepEqual(a.v,b.v);assert.notDeepEqual(a.v,M.create(24,24,919).v);});
test('uniform A=1 B=0 is an exact equilibrium',()=>{const s=M.create(24,24);s.u.fill(1);s.v.fill(0);for(let i=0;i<30;i++)M.step(s,.035,.06);for(const v of s.u)assert.ok(Math.abs(v-1)<1e-12);for(const v of s.v)assert.equal(v,0);});
test('periodic stencil has zero sum and wraps over both edges',()=>{const w=8,h=8,a=new Float64Array(w*h);a[0]=1;let sum=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++)sum+=M.laplacian(a,w,h,x,y);assert.ok(Math.abs(sum)<1e-12);assert.equal(M.laplacian(a,w,h,7,0),.2);assert.equal(M.laplacian(a,w,h,7,7),.05);assert.equal(M.laplacian(a,w,h,0,0),-1);});
test('reaction update matches a uniform-field analytic step',()=>{const s=M.create(8,8);s.u.fill(.6);s.v.fill(.2);M.step(s,.03,.06,.5);assert.ok(Math.abs(s.u[0]-(.6+.5*(-.6*.2*.2+.03*.4)))<1e-12);assert.ok(Math.abs(s.v[0]-(.2+.5*(.6*.2*.2-.09*.2)))<1e-12);});
test('all three cultures remain finite, bounded, and nontrivial',()=>{for(const p of Object.values(M.PRESETS)){const s=M.create(112,112,3);for(let i=0;i<500;i++)M.step(s,p.feed,p.kill);for(const field of [s.u,s.v])for(const v of field)assert.ok(Number.isFinite(v)&&v>=0&&v<=1);assert.ok(M.measure(s).coverage>0);}});
test('planting respects periodic boundaries and leaves distant cells intact',()=>{const s=M.create(24,24);s.u.fill(1);s.v.fill(0);M.plant(s,0,0,2,.4);assert.equal(s.v[23],.4);assert.equal(s.v[23*24],.4);assert.equal(s.v[12*24+12],0);});
test('parameters reject nonfinite and unsafe timestep values',()=>{for(const args of [[NaN,.06,1],[.03,Infinity,1],[.03,.06,0],[.03,.06,1.1],[-1,.06,1]])assert.throws(()=>M.params(...args),RangeError);assert.throws(()=>M.create(7,8),RangeError);assert.throws(()=>M.plant(M.create(8,8),NaN,2),RangeError);});
