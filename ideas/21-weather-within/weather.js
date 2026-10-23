(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.WeatherWithin=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const names=['joy','sorrow','anger','uncertainty','calm','wonder'];
const presets={bittersweet:{joy:58,sorrow:65,anger:0,uncertainty:16,calm:35,wonder:28},threshold:{joy:35,sorrow:0,anger:12,uncertainty:80,calm:12,wonder:72},harbor:{joy:22,sorrow:20,anger:0,uncertainty:8,calm:88,wonder:25}};
function normalize(input={}){return Object.fromEntries(names.map(n=>[n,Number.isFinite(+input[n])?Math.max(0,Math.min(100,+input[n])):0]));}
function describe(input){const s=normalize(input);const active=names.filter(n=>s[n]>=20).sort((a,b)=>s[b]-s[a]);if(!active.length)return 'Room for whatever arrives.';const fragments={joy:'a little light',sorrow:'rain that belongs here',anger:'a charge in the air',uncertainty:'an unfinished horizon',calm:'a place to rest',wonder:'something still undiscovered'};return active.slice(0,3).map(n=>fragments[n]).join(' · ')+'.';}
function svg(input={},time=0){
const s=normalize(input), t=Number.isFinite(time)?time:0;
let out='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" role="img" aria-labelledby="sky-title"><title id="sky-title">Weather Within: a sky holding several feelings at once</title><rect width="800" height="500" fill="#e7e1ed"/><rect y="300" width="800" height="200" fill="#d8dce1"/>';
// Nothing subtracts from anything else: light and rain occupy the same sky.
if(s.joy){const r=24+s.joy*.65;out+=`<circle cx="575" cy="155" r="${r+20}" fill="#f6dbab" opacity=".24"/><circle cx="575" cy="155" r="${r}" fill="#efba70" opacity="${.25+s.joy/150}"/>`;for(let j=0;j<12;j++){const a=j*Math.PI/6;out+=`<path d="M ${575+Math.cos(a)*(r+12)} ${155+Math.sin(a)*(r+12)} L ${575+Math.cos(a)*(r+22)} ${155+Math.sin(a)*(r+22)}" stroke="#cc9555" stroke-width="1" opacity=".45"/>`;}}
for(let layer=0;layer<7;layer++){const y=110+layer*34;const drift=Math.sin(t*.12+layer)*8;out+=`<path d="M -40 ${y+30} Q ${110+drift} ${y-20-s.sorrow*.3} 260 ${y+8} T 540 ${y+2} T 840 ${y+25} L 840 ${y+50} Q 670 ${y+20} 520 ${y+36} T 220 ${y+39} T -40 ${y+50} Z" fill="${layer%2?'#8c829f':'#bbb0c4'}" opacity="${.13+s.sorrow*.0017}"/>`;}
if(s.uncertainty){for(let j=0;j<6;j++){const y=235+j*20;out+=`<path d="M -20 ${y} Q 200 ${y-20} 400 ${y+9} T 830 ${y-5}" fill="none" stroke="#f8f3ef" stroke-width="${8+s.uncertainty*.16}" opacity="${s.uncertainty/250}"/>`;}}
if(s.sorrow){const n=Math.ceil(s.sorrow*.8);for(let i=0;i<n;i++){const x=(i*137.507+Math.sin(t*.12)*8)%800;const y=115+((i*71+t*26)%240);out+=`<path d="M ${x} ${y} l -5 14" stroke="#61768e" stroke-width="1.2" opacity="${.2+s.sorrow/220}"/>`;}}
if(s.wonder){for(let i=0;i<Math.ceil(s.wonder*.24);i++){const x=65+(i*137.5)%690,y=45+(i*53.31)%170,sz=2+(i%3);out+=`<path d="M ${x-sz} ${y} H ${x+sz} M ${x} ${y-sz} V ${y+sz}" stroke="#fffdf4" stroke-width="1" opacity="${.5+.25*Math.sin(t+i)}"/>`;}}
if(s.anger){out+=`<path d="M 280 164 l -18 44 22 -6 -27 61 47 -68 -23 5 18 -36" fill="#c57457" opacity="${s.anger/125}"/>`;}
for(let j=0;j<13;j++){const y=348+j*11,a=3+(100-s.calm)*.055;out+=`<path d="M -10 ${y} Q 120 ${y-a+Math.sin(t*.4+j)*2} 260 ${y} T 530 ${y} T 810 ${y}" fill="none" stroke="${j%3===0?'#a1908f':'#879da4'}" stroke-width="${j%3===0?1.4:.7}" opacity=".5"/>`;}
out+='<path d="M 360 500 Q 369 454 400 430 Q 431 454 440 500" fill="#c5b4aa" opacity=".7"/><path d="M 400 430 v 70" stroke="#a59893" stroke-width=".7"/><circle cx="400" cy="430" r="2" fill="#52656a"/></svg>';
return out;
}
return {names,presets,normalize,describe,svg};
});
