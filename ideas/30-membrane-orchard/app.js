(function(){'use strict';
const M=Orchard,$=id=>document.getElementById(id),canvas=$('field'),ctx=canvas.getContext('2d'),pixels=ctx.createImageData(112,112);
let seed=7,state=M.create(112,112,seed),feed=.029,kill=.057,paused=matchMedia('(prefers-reduced-motion: reduce)').matches,painting=false,last=0,warm=0;
const colours=[[237,237,194],[178,194,130],[82,124,87],[30,74,61],[18,45,43]];
function draw(){for(let i=0;i<state.v.length;i++){let t=Math.min(3.999,Math.max(0,state.v[i]*7.5)),a=Math.floor(t),f=t-a;for(let c=0;c<3;c++)pixels.data[i*4+c]=Math.round(colours[a][c]*(1-f)+colours[a+1][c]*f);pixels.data[i*4+3]=255;}ctx.putImageData(pixels,0,0);const stats=M.measure(state);$('coverage').textContent=(stats.coverage*100).toFixed(1)+'%';$('age').textContent='t '+Math.round(state.age);}
function sync(){feed=Number($('feed').value);kill=Number($('kill').value);$('feed-value').value=feed.toFixed(4);$('kill-value').value=kill.toFixed(4);for(const b of document.querySelectorAll('[data-preset]')){const p=M.PRESETS[b.dataset.preset],selected=Math.abs(feed-p.feed)<1e-6&&Math.abs(kill-p.kill)<1e-6;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',selected);}}
function setPause(){const b=$('pause');b.textContent=paused?'Resume':'Pause';b.setAttribute('aria-pressed',String(paused));$('status').textContent=paused?'RESTING':'CULTIVATING';}
function reset(){state=M.create(112,112,seed);$('specimen-number').textContent=String(seed).padStart(3,'0');warm=0;draw();}
for(const b of document.querySelectorAll('[data-preset]'))b.addEventListener('click',()=>{const p=M.PRESETS[b.dataset.preset];$('feed').value=p.feed;$('kill').value=p.kill;sync();reset();});
for(const id of ['feed','kill'])$(id).addEventListener('input',sync);
$('pause').addEventListener('click',()=>{paused=!paused;setPause();});$('reset').addEventListener('click',()=>{seed++;reset();});
$('plant').addEventListener('click',()=>{M.plant(state,56,56,6,.55);draw();});
function paint(e){const r=canvas.getBoundingClientRect();M.plant(state,(e.clientX-r.left)/r.width*112,(e.clientY-r.top)/r.height*112,4,.55);draw();}
canvas.addEventListener('pointerdown',e=>{painting=true;canvas.setPointerCapture(e.pointerId);paint(e);});canvas.addEventListener('pointermove',e=>{if(painting)paint(e);});canvas.addEventListener('pointerup',()=>painting=false);canvas.addEventListener('pointercancel',()=>painting=false);
function frame(now){if(!paused&&now-last>24){const start=performance.now();let steps=0;do{M.step(state,feed,kill);steps++;warm++;}while(steps<24&&performance.now()-start<10);draw();last=now;}requestAnimationFrame(frame);}
// A paused culture still opens with a formed specimen. Compute in short slices,
// drawing each slice, without movement once preparation is complete.
if(paused){let prepared=0;const prepare=()=>{const start=performance.now();do{M.step(state,feed,kill);prepared++;}while(prepared<220&&performance.now()-start<9);draw();if(prepared<220)requestAnimationFrame(prepare);};requestAnimationFrame(prepare);}
sync();setPause();draw();requestAnimationFrame(frame);
})();
