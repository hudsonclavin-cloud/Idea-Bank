(function(){'use strict';
const M=OneThread,$=id=>document.getElementById(id);let route=[],width=8,height=6,seed=15,position=0,playing=false,last=0;
function stop(){playing=false;$('play').textContent='Trace the route';$('play').setAttribute('aria-pressed','false');}
function render(){const total=route.length-1;$('drawing').innerHTML=M.svg(route,width,height,position);$('position').value=`${position} / ${total}`;$('progress').value=position;$('stitch-count').textContent=total;$('wrap-count').textContent=route.slice(1).filter((b,i)=>M.crossing(route[i],b,width,height)).length;
$('current').textContent=position===0?'Start at (0, 0). The whole journey returns here.':`Stitch ${position}: `+M.instruction(route[position-1],route[position],width,height);for(const li of $('steps').children)li.classList.toggle('active',Number(li.dataset.step)===position);$('back').disabled=position===0;$('step').disabled=position===total;}
function rebuild(){try{const w=Number($('width').value),h=Number($('height').value),s=Number($('seed').value);M.validate(w,h,s);stop();width=w;height=h;seed=s;route=M.circuit(width,height,seed);position=route.length-1;$('width-value').value=width;$('height-value').value=height;$('seed-label').textContent='SEED '+String(seed).padStart(3,'0');$('progress').max=position;$('steps').innerHTML=route.slice(1).map((b,i)=>`<li data-step="${i+1}">${M.instruction(route[i],b,width,height)}</li>`).join('');$('status').textContent='';render();}catch(e){stop();$('status').textContent=e.message;}}
for(const id of ['width','height','seed'])$(id).addEventListener('input',rebuild);
$('new').addEventListener('click',()=>{$('seed').value=(seed+1)>>>0;rebuild();});
$('progress').addEventListener('input',()=>{stop();position=Number($('progress').value);render();});
$('back').addEventListener('click',()=>{stop();position=Math.max(0,position-1);render();});$('step').addEventListener('click',()=>{stop();position=Math.min(route.length-1,position+1);render();});
$('play').addEventListener('click',()=>{if(playing){stop();return;}if(position===route.length-1)position=0;playing=true;$('play').textContent='Pause tracing';$('play').setAttribute('aria-pressed','true');last=0;render();});
$('save').addEventListener('click',()=>{const data=M.svg(route,width,height,route.length-1),url=URL.createObjectURL(new Blob([data],{type:'image/svg+xml'})),a=document.createElement('a');a.href=url;a.download=`one-thread-${width}x${height}-${seed}.svg`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('status').textContent='Saved the complete sewing map.';});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
function frame(now){if(playing&&now-last>180){position=Math.min(route.length-1,position+1);render();last=now;if(position===route.length-1)stop();}requestAnimationFrame(frame);}rebuild();requestAnimationFrame(frame);
})();
