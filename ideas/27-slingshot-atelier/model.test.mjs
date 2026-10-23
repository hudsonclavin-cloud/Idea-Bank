import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';const M=createRequire(import.meta.url)('./model.js');
const near=(a,b,tol=1e-9)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);
test('planet-frame speed is invariant across worlds and orientations',()=>{for(const planet of Object.keys(M.PLANETS))for(const angle of [-180,-60,0,80,180])for(const side of [-1,1]){const e=M.encounter({planet,angle,side});near(M.norm(e.incoming),e.speed);near(M.norm(e.outgoing),e.speed);}});
test('very distant flyby tends to the zero-deflection, zero energy-change limit',()=>{const e=M.encounter({altitude:1e18});assert.ok(e.delta<1e-10);near(e.gain,0);near(e.energy,0,1e-7);});
test('increasing altitude or excess speed reduces deflection',()=>{assert.ok(M.encounter({altitude:10000}).delta>M.encounter({altitude:100000}).delta);assert.ok(M.encounter({speed:4}).delta>M.encounter({speed:12}).delta);});
test('energy transfer equals planet velocity dotted with excess-vector change',()=>{const e=M.encounter();near(e.energy,e.vp[0]*(e.outgoing[0]-e.incoming[0]));});
test('valid encounter can gain or lose sun-frame energy',()=>{assert.ok(M.encounter({angle:-110}).gain>0);assert.ok(M.encounter({angle:30}).gain<0);});
test('hyperbola has correct periapsis and constant radius at cropped endpoints',()=>{const e=M.encounter();const points=M.trajectory(e,181);near(M.norm(points[90]),e.rp,1e-6);near(M.norm(points[0]),e.rp*5,1e-6);near(M.norm(points.at(-1)),e.rp*5,1e-6);});
test('invalid physical inputs are rejected',()=>{for(const x of [{planet:'pluto'},{speed:0},{altitude:-1},{angle:NaN},{side:0}])assert.throws(()=>M.encounter(x),RangeError);for(const a of [[0,1,1],[1,0,1],[1,1,Infinity]])assert.throws(()=>M.deflection(...a),RangeError);});
