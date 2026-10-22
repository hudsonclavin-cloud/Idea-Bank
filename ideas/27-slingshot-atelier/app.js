'use strict';
const $=id=>document.getElementById(id),M=Slingshot;let sunFrame=true;
const polar=(v,s=1,cx=0,cy=0)=>[cx+v[0]*s,cy-v[1]*s];
const coord=p=>p.map(n=>n.toFixed(2)).join(',');
const signed=(n,d=2)=>(n>=0?'+':'−')+Math.abs(n).toFixed(d);
function arrow(a,b,color,id){return `<path d="M${coord(a)} L${coord(b)}" fill="none" stroke="${color}" stroke-width="2" marker-end="url(#${id})"/>`;}
function markers(){return `<defs><marker id="inArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10" fill="#a8b7e3"/></marker><marker id="outArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10" fill="#efbe79"/></marker><marker id="pArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10" fill="#7fc9c0"/></marker></defs>`;}
function render(){
 const e=M.encounter({planet:$('planet').value,altitude:+$('altitude').value,speed:+$('speed').value,angle:+$('angle').value,side:+$('side').value});
 $('altitudeValue').textContent=(e.rp-e.planet.radius).toLocaleString()+' km above surface';$('speedValue').textContent=e.speed.toFixed(1)+' km/s';$('angleValue').textContent=e.angle+'° to planet motion';$('planetLabel').textContent=e.planet.name.toUpperCase()+' ENCOUNTER';
 $('turn').textContent=(e.delta*180/Math.PI).toFixed(1)+'°';$('gain').textContent=signed(e.gain)+' km/s';$('energy').textContent=signed(e.energy,1)+' km²/s²';
 const orbit=M.trajectory(e),scale=165/(e.rp*5),cx=360,cy=195,r=e.planet.radius*scale;let drawing=markers();
 for(let x=0;x<720;x+=30)drawing+=`<path d="M${x} 0V390" stroke="#283640" stroke-width=".5"/>`;
 for(let y=15;y<390;y+=30)drawing+=`<path d="M0 ${y}H720" stroke="#283640" stroke-width=".5"/>`;
 drawing+=`<circle cx="${cx}" cy="${cy}" r="${e.rp*scale}" fill="none" stroke="#537078" stroke-dasharray="2 6"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="${e.planet.color}" opacity=".9"/><circle cx="${cx}" cy="${cy}" r="${r*1.08}" fill="none" stroke="${e.planet.color}" opacity=".3"/>`;
 const halfway=Math.floor(orbit.length/2),pts=orbit.map(p=>polar(p,scale,cx,cy));
 for(const [a,b,color,id] of [[0,halfway,'#a8b7e3','inArrow'],[halfway,orbit.length-1,'#efbe79','outArrow']])drawing+=`<path d="M${pts.slice(a,b+1).map(coord).join(' L')}" fill="none" stroke="${color}" stroke-width="2.3" marker-end="url(#${id})"/>`;
 drawing+=arrow([cx,cy+60],[cx+75,cy+60],'#7fc9c0','pArrow');
 drawing+=`<text x="${cx+7}" y="${cy+82}" fill="#7fc9c0" font-size="10" font-family="monospace">planet ${e.planet.speed.toFixed(2)} km/s →</text><text x="25" y="30" fill="#8fa3ab" font-size="10" font-family="monospace">NO ENGINES. JUST A BEND.</text><text x="25" y="365" fill="#8fa3ab" font-size="9" font-family="monospace">rₚ = ${Math.round(e.rp).toLocaleString()} km · hyperbolic excess = ${e.speed.toFixed(1)} km/s</text>`;
 $('orbit').innerHTML=drawing;
 const gain=e.gain>.005,loss=e.gain<-.005;
 $('story').textContent=gain?'The planet lends a little speed.':loss?'The traveller pays it back.':'The bend changes direction, not speed.';
 $('explanation').textContent=`In the planet's frame, arrival and departure both measure ${e.speed.toFixed(1)} km/s. In the Sun's frame, the planet adds its own motion to each vector. This geometry ${gain?'increases':loss?'decreases':'preserves'} the traveller's speed. The planet's corresponding recoil is omitted in this massive-planet approximation.`;
 const a=sunFrame?e.helioIn:e.incoming,b=sunFrame?e.helioOut:e.outgoing,max=Math.max(M.norm(a),M.norm(b),e.planet.speed),s=130/max,origin=[200,105];
 let v=markers()+`<path d="M20 105H430M200 10V190" stroke="#34434b" stroke-width="1"/><text x="375" y="124" fill="#83969e" font-size="9" font-family="monospace">+x motion</text>`;
 if(sunFrame){const p=polar(e.vp,s,...origin);v+=arrow(origin,p,'#7fc9c0','pArrow');v+=`<path d="M${coord(p)} L${coord(polar(a,s,...origin))} M${coord(p)} L${coord(polar(b,s,...origin))}" fill="none" stroke="#60747e" stroke-dasharray="3 4"/>`;}
 v+=arrow(origin,polar(a,s,...origin),'#a8b7e3','inArrow')+arrow(origin,polar(b,s,...origin),'#efbe79','outArrow');$('vectors').innerHTML=v;
 $('velocityReadout').textContent=`IN ${M.norm(a).toFixed(2)} km/s  /  OUT ${M.norm(b).toFixed(2)} km/s`;
 $('sunFrame').setAttribute('aria-pressed',sunFrame);$('planetFrame').setAttribute('aria-pressed',!sunFrame);
}
for(const id of ['planet','altitude','speed','angle','side'])$(id).addEventListener('input',render);
$('sunFrame').onclick=()=>{sunFrame=true;render();};$('planetFrame').onclick=()=>{sunFrame=false;render();};
$('gainPreset').onclick=()=>{$('angle').value=-110;$('side').value=1;render();};$('losePreset').onclick=()=>{$('angle').value=30;$('side').value=1;render();};render();
