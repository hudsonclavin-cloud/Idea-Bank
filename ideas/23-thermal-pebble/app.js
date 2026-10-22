(function(){'use strict';
const $=id=>document.getElementById(id),fields=['mass','payload','ambient','latent','conductance','time'];
const canvas=$('chart'),ctx=canvas.getContext('2d');
let p;
const hours=t=>Number.isFinite(t)?`${(t/3600).toFixed(1)} h`:'∞';
function params(){return {mass:+$('mass').value/1000,payload:+$('payload').value/1000,ambient:+$('ambient').value,latent:+$('latent').value*1000,conductance:+$('conductance').value/100};}
function update(){p=params();
 $('mass-out').textContent=`${$('mass').value} g`;$('payload-out').textContent=`${$('payload').value} g`;$('ambient-out').textContent=`${p.ambient}°C`;$('latent-out').textContent=`${$('latent').value} kJ/kg`;$('conductance-out').textContent=`${p.conductance.toFixed(2)} W/K`;
 const t=+$('time').value*60,state=Pebble.at(t,p),b=Pebble.budget(p),hold=Pebble.timeTo(25,p),base=Pebble.timeTo(25,{...p,latent:0});
 $('hold').textContent=hours(hold);$('extra').textContent=Number.isFinite(hold)?`+${hours(hold-base)}`:'—';$('reserve').textContent=`${(b.latentEnergy/1000).toFixed(1)} kJ`;
 $('time-out').textContent=hours(t);$('inspect').textContent=`${state.temperature.toFixed(1)}°C · ${(state.fraction*100).toFixed(0)}% core melted`;
 $('phase-tag').textContent=state.phase.toUpperCase();$('core-shape').style.opacity=String(1-state.fraction*.32);
 draw();
}
function draw(){
 const rect=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2),w=rect.width,h=rect.height;
 canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
 const pad={l:42,r:24,t:24,b:29},pw=w-pad.l-pad.r,ph=h-pad.t-pad.b,lo=16,hi=46;
 const X=t=>pad.l+t/21600*pw,Y=temp=>pad.t+(hi-temp)/(hi-lo)*ph;
 ctx.font='9px monospace';ctx.fillStyle='#75806e';ctx.strokeStyle='#dce0d1';ctx.lineWidth=.7;
 for(let temp=20;temp<=45;temp+=5){ctx.beginPath();ctx.moveTo(pad.l,Y(temp));ctx.lineTo(w-pad.r,Y(temp));ctx.stroke();ctx.fillText(`${temp}°`,8,Y(temp)+3);}
 for(let hour=0;hour<=6;hour++){ctx.fillText(`${hour}h`,X(hour*3600)-5,h-9);}
 const b=Pebble.budget(p),s=Math.max(0,b.warmTime),e=Math.min(21600,b.warmTime+b.phaseTime);
 if(e>s){ctx.fillStyle='#bc542e0b';ctx.fillRect(X(s),pad.t,X(e)-X(s),ph);ctx.fillStyle='#b06242';ctx.font='8px monospace';if(X(e)-X(s)>68)ctx.fillText('LATENT INTERVAL',X(s)+7,pad.t+9);}
 ctx.strokeStyle='#c1c5b5';ctx.setLineDash([2,4]);ctx.beginPath();ctx.moveTo(pad.l,Y(25));ctx.lineTo(w-pad.r,Y(25));ctx.stroke();ctx.setLineDash([]);
 function curve(params,color,dashed){ctx.beginPath();for(let i=0;i<=240;i++){const t=21600*i/240;const x=X(t),y=Y(Pebble.at(t,params).temperature);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.strokeStyle=color;ctx.lineWidth=dashed?1.5:2.5;ctx.setLineDash(dashed?[5,4]:[]);ctx.stroke();ctx.setLineDash([]);}
 curve({...p,latent:0},'#949a8a',true);curve(p,'#bc542e',false);
 const t=+$('time').value*60,state=Pebble.at(t,p);ctx.strokeStyle='#9da795';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(X(t),pad.t+15);ctx.lineTo(X(t),h-pad.b);ctx.stroke();ctx.beginPath();ctx.arc(X(t),Y(state.temperature),4,0,Math.PI*2);ctx.fillStyle='#bc542e';ctx.fill();ctx.strokeStyle='#f5f3e9';ctx.lineWidth=2;ctx.stroke();
}
for(const id of fields)$(id).addEventListener('input',update);
$('reset').addEventListener('click',()=>{for(const [id,v] of Object.entries({mass:350,payload:250,ambient:32,latent:180,conductance:55,time:120}))$(id).value=v;update();});
new ResizeObserver(()=>draw()).observe(canvas);update();
})();
