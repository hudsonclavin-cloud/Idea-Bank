(function(){'use strict';
const M=MoireMail,$=id=>document.getElementById(id);let palette='oxide',start=null;
function render(){const angle=Number($('angle').value),spacing=Number($('spacing').value),beat=M.wavelength(spacing,angle);$('postcard').innerHTML=M.svg({spacing,angle,palette});$('angle-value').value=angle.toFixed(1)+'°';$('spacing-value').value=spacing+' units';$('beat').innerHTML=Number.isFinite(beat)?beat.toFixed(1)+' <small>units</small>':'∞ <small>aligned layers</small>';$('explanation').textContent=angle===0?'The gratings agree. There is no finite beat wave.':Math.abs(angle)<3?'A small disagreement leaves a very long wave.':'The large pattern comes from the gap between two small ones.';for(const b of document.querySelectorAll('[data-angle]'))b.setAttribute('aria-pressed',Math.abs(Number(b.dataset.angle)-angle)<.05);}
for(const id of ['angle','spacing'])$(id).addEventListener('input',render);
for(const b of document.querySelectorAll('[data-angle]'))b.addEventListener('click',()=>{$('angle').value=b.dataset.angle;render();});
for(const b of document.querySelectorAll('[data-palette]'))b.addEventListener('click',()=>{palette=b.dataset.palette;for(const other of document.querySelectorAll('[data-palette]'))other.setAttribute('aria-pressed',other===b);render();});
$('align').addEventListener('click',()=>{$('angle').value=0;render();});
function pointerAngle(e){const r=$('postcard').getBoundingClientRect();return Math.atan2(e.clientY-(r.top+r.height/2),e.clientX-(r.left+r.width/2))*180/Math.PI;}
$('postcard').addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&e.button!==0)return;start={angle:Number($('angle').value),pointer:pointerAngle(e)};$('postcard').setPointerCapture(e.pointerId);});
$('postcard').addEventListener('pointermove',e=>{if(!start)return;$('angle').value=M.dragAngle(start.angle,start.pointer,pointerAngle(e)).toFixed(1);render();});
for(const event of ['pointerup','pointercancel','lostpointercapture'])$('postcard').addEventListener(event,()=>start=null);
$('postcard').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();$('angle').value=Math.max(-45,Math.min(45,Number($('angle').value)+(e.key==='ArrowRight'?.1:-.1))).toFixed(1);render();});
$('download').addEventListener('click',()=>{const svg=M.svg({spacing:Number($('spacing').value),angle:Number($('angle').value),palette});const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'})),a=document.createElement('a');a.href=url;a.download='moire-mail.svg';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});render();
})();
