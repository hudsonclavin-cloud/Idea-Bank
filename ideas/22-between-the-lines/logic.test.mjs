import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const m=createRequire(import.meta.url)('./logic.js');
test('Each scene supports all eight combinations of a three-part reply',()=>{
 for(let scene=0;scene<m.scenes.length;scene++)for(let mask=0;mask<8;mask++){
  let state=m.initial(scene);
  for(let part=0;part<3;part++)state=m.reduce(state,{type:'reply',part,value:(mask>>part)&1});
  const s=m.scenes[scene];assert.equal(m.compose(state),[s.openers[mask&1],s.asks[(mask>>1)&1],s.offers[(mask>>2)&1]].join(' '));
 }
});
test('Three contradictory possibilities may coexist, and toggling cannot duplicate one',()=>{
 let s=m.initial();
 for(let lens=1;lens<3;lens++){s=m.reduce(s,{type:'lens',value:lens});s=m.reduce(s,{type:'hold'});}
 assert.deepEqual(s.held,[0,1,2]);
 s=m.reduce(s,{type:'hold'});assert.deepEqual(s.held,[0,1]);
 s=m.reduce(s,{type:'hold'});assert.deepEqual(s.held,[0,1,2]);
});
test('Changing scene resets contextual choices rather than carrying assumptions over',()=>{
 let s=m.reduce(m.initial(),{type:'lens',value:2});s=m.reduce(s,{type:'unfold'});s=m.reduce(s,{type:'reply',part:0,value:1});
 assert.deepEqual(m.reduce(s,{type:'scene',value:2}),m.initial(2));
});
test('The reducer does not mutate past choices and disclosure is reversible',()=>{
 const original=m.initial();const snapshot=JSON.stringify(original);
 const altered=m.reduce(original,{type:'hold'});assert.notDeepEqual(altered,original);assert.equal(JSON.stringify(original),snapshot);
 assert.deepEqual(m.reduce(m.reduce(original,{type:'unfold'}),{type:'unfold'}),original);
});
test('Invalid indices and actions fail explicitly',()=>{
 for(const bad of [-1,4,NaN,.5])assert.throws(()=>m.initial(bad),RangeError);
 for(const value of [-1,3,.5])assert.throws(()=>m.reduce(m.initial(),{type:'lens',value}),RangeError);
 assert.throws(()=>m.reduce(m.initial(),{type:'reply',part:3,value:0}),RangeError);
 assert.throws(()=>m.reduce(m.initial(),{type:'reply',part:0,value:2}),RangeError);
 assert.throws(()=>m.reduce(m.initial(),{type:'unknown'}));
});
