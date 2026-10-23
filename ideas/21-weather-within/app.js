'use strict';
const W=WeatherWithin;
const labels={joy:['Joy','#c9924f'],sorrow:['Sorrow','#788ca7'],anger:['Anger','#b77960'],uncertainty:['Uncertainty','#aaa3b3'],calm:['Calm','#6f9297'],wonder:['Wonder','#9281a4']};
let state={...W.presets.bittersweet},paused=matchMedia('(prefers-reduced-motion: reduce)').matches,time=0,last=0,note=1;
const sky=document.getElementById('sky'),description=document.getElementById('description');
const sliders=document.getElementById('sliders');
for(const name of W.names){const div=document.createElement('div');div.className='slider';const label=document.createElement('label');label.htmlFor=name;label.textContent=labels[name][0];const value=document.createElement('output');value.id=name+'-value';value.htmlFor=name;label.append(value);const input=document.createElement('input');input.type='range';input.id=name;input.min=0;input.max=100;input.step=1;input.style.setProperty('--tint',labels[name][1]);input.addEventListener('input',()=>{state[name]=+input.value;sync();});div.append(label,input);sliders.append(div);}
function draw(){sky.innerHTML=W.svg(state,time);}
function sync(){for(const name of W.names){document.getElementById(name).value=state[name];document.getElementById(name+'-value').value=state[name]+' / 100';}description.textContent=W.describe(state);draw();}
for(const button of document.querySelectorAll('[data-preset]'))button.addEventListener('click',()=>{state={...W.presets[button.dataset.preset]};document.getElementById('noteNo').textContent=String(++note).padStart(3,'0');sync();});
document.getElementById('clear').addEventListener('click',()=>{state=W.normalize();sync();});
const pause=document.getElementById('pause');function pauseLabel(){pause.textContent=paused?'Let it move':'Pause motion';pause.setAttribute('aria-pressed',String(paused));}pauseLabel();pause.addEventListener('click',()=>{paused=!paused;pauseLabel();});
document.getElementById('save').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([W.svg(state,time)],{type:'image/svg+xml'}));const a=document.createElement('a');a.href=url;a.download='weather-within.svg';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
function frame(now){if(!paused&&now-last>90){time+=Math.min(.2,(now-last)/1000);last=now;draw();}else if(paused){last=now;}requestAnimationFrame(frame);}sync();requestAnimationFrame(frame);
