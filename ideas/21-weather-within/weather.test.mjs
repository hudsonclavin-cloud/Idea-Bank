import {createRequire} from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),W=require('./weather.js');
test('each feeling has its own bounded presence, without cancellation',()=>{
 const s=W.normalize({joy:75,sorrow:75,anger:150,calm:-1,wonder:NaN,uncertainty:Infinity});
 assert.deepEqual(s,{joy:75,sorrow:75,anger:100,uncertainty:0,calm:0,wonder:0});
 assert.deepEqual(W.normalize(),Object.fromEntries(W.names.map(n=>[n,0])));
});
test('all emotional layers can coexist in one valid deterministic drawing',()=>{
 const s=Object.fromEntries(W.names.map(n=>[n,100]));const a=W.svg(s,2);
 assert.equal(a,W.svg(s,2));assert.ok(a.includes('#efba70'));assert.ok(a.includes('#61768e'));assert.ok(a.includes('#c57457'));assert.ok(a.includes('#fffdf4'));assert.ok(!/NaN|Infinity/.test(a));
 assert.notEqual(a,W.svg(s,3));assert.match(a,/<svg[^>]+>/);assert.ok(a.endsWith('</svg>'));
});
test('empty state is a welcoming description, mixed states name coexistence',()=>{
 assert.equal(W.describe({}),'Room for whatever arrives.');
 assert.ok(W.describe({joy:70,sorrow:70}).includes('light'));assert.ok(W.describe({joy:70,sorrow:70}).includes('rain'));
});
test('each preset is complete, bounded, and does not mutate when normalized',()=>{
 for(const p of Object.values(W.presets)){const before=JSON.stringify(p);assert.equal(Object.keys(p).length,6);assert.deepEqual(W.normalize(p),p);W.svg(p,0);assert.equal(JSON.stringify(p),before);}
});
test('zero, full and malformed weather remain finite with predictable layer bounds',()=>{
 for(let i=0;i<=100;i++){const a=W.svg({joy:i,sorrow:100-i,uncertainty:i,anger:i,wonder:i,calm:i},i/10);assert.ok(!/NaN|Infinity|undefined/.test(a));assert.ok(a.length<30000);}
 assert.ok(!/NaN|Infinity/.test(W.svg({joy:NaN},NaN)));
});
