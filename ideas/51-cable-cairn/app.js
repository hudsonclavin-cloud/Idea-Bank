(function(){'use strict';
const M=Cairn,$=id=>document.getElementById(id),keys=['channels','diameter','clearance','depth'];let view='iso';
const settings=()=>Object.fromEntries(keys.map(k=>[k,+$(k).value]));
function draw(){
 const p=M.parameters(settings()),m=M.mesh(p),vol=M.volume(m);for(const key of keys)$(key+'-out').value=key==='channels'?String(p[key]):p[key].toFixed(key==='clearance'?2:1)+' mm';
 $('footprint').textContent=p.width.toFixed(1)+' × '+p.depth+' mm';$('height').textContent=p.height.toFixed(1)+' mm';$('mass').textContent=(vol*1.24/1000).toFixed(1)+' g';
 const iso=view==='iso',proj=v=>iso?[(v[0]-v[1])*.866,(v[0]+v[1])*.44-v[2]*1.25]:[v[0],-v[2]];
 const projected=m.vertices.map(proj),xs=projected.map(v=>v[0]),ys=projected.map(v=>v[1]),xmin=Math.min(...xs),xmax=Math.max(...xs),ymin=Math.min(...ys),ymax=Math.max(...ys),scale=Math.min(470/(xmax-xmin),205/Math.max(10,ymax-ymin)),X=v=>[310+(v[0]-(xmin+xmax)/2)*scale,155+(v[1]-(ymin+ymax)/2)*scale];
 let svg='<defs><pattern id="grid" width="26" height="26" patternUnits="userSpaceOnUse"><path d="M26 0H0V26" fill="none" stroke="#cbd3bd" stroke-width=".5"/></pattern></defs><rect x="15" y="22" width="590" height="270" fill="url(#grid)"/><ellipse cx="310" cy="235" rx="222" ry="15" fill="#667c5d" opacity=".07"/>';
 if(iso){const sorted=m.faces.filter(f=>{const n=M.normal(...f.map(i=>m.vertices[i]));return n[0]+n[1]+.704*n[2]>1e-8;}).map(f=>({f,depth:f.reduce((s,i)=>s+m.vertices[i][0]+m.vertices[i][1]+m.vertices[i][2]*.704,0)/3})).sort((a,b)=>a.depth-b.depth);
 for(const {f}of sorted){const norm=M.normal(...f.map(i=>m.vertices[i])),light=Math.max(0,-norm[0]*.35-norm[1]*.45+norm[2]*.8),c=[153,172,135].map(v=>Math.round(v*(.79+.28*light)));svg+=`<path d="M${f.map(i=>X(projected[i]).map(x=>x.toFixed(2)).join(',')).join('L')}Z" fill="rgb(${c.join(',')})" stroke="rgb(${c.join(',')})" stroke-width=".7"/>`;}}
 else{const d=M.outline(p).map(v=>X([v[0],-v[1]]));svg+=`<path d="M${d.map(v=>v.join(',')).join('L')}Z" fill="#93ab80" stroke="#536b4e" stroke-width=".8"/>`;for(let i=0;i<p.channels;i++){const cx=p.edge+p.radius+i*(2*p.radius+p.wall),a=X([cx-p.radius,-p.height]),b=X([cx+p.radius,-p.height]);svg+=`<path d="M${a[0]} ${a[1]-10}H${b[0]}M${a[0]} ${a[1]-13}v6M${b[0]} ${b[1]-13}v6" stroke="#a76843" stroke-width=".7"/>`;}}
 svg+=`<g font-family="monospace" font-size="10" fill="#65805e" letter-spacing="1"><text x="25" y="319">${iso?'OBLIQUE / CABLES RUN FRONT TO BACK':'FRONT PROFILE / OPEN AT THE TOP'}</text><text x="596" y="319" text-anchor="end">${m.faces.length} FACETS</text></g>`;$('preview').innerHTML=svg;
 for(const b of document.querySelectorAll('[data-view]'))b.setAttribute('aria-pressed',b.dataset.view===view);
}
for(const k of keys)$(k).addEventListener('input',()=>{draw();$('status').textContent='The download now matches these dimensions.';});
for(const b of document.querySelectorAll('[data-view]'))b.onclick=()=>{view=b.dataset.view;draw();};
const presets={desk:{channels:4,diameter:5,clearance:.35,depth:24},slim:{channels:6,diameter:3,clearance:.25,depth:18},large:{channels:3,diameter:9,clearance:.5,depth:30}};
for(const b of document.querySelectorAll('[data-preset]'))b.onclick=()=>{for(const[k,v]of Object.entries(presets[b.dataset.preset]))$(k).value=v;draw();$('status').textContent='Preset loaded. Measure your own cables before printing.';};
$('download').onclick=()=>{const p=M.parameters(settings()),url=URL.createObjectURL(new Blob([M.stl(p)],{type:'model/stl'})),a=document.createElement('a');a.href=url;a.download=`cable-cairn-${p.channels}x${p.diameter}mm.stl`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('status').textContent=`Saved the ${p.channels}-channel model, ${p.width.toFixed(1)} × ${p.depth} × ${p.height.toFixed(1)} mm. Open in your slicer at 100% scale.`;};draw();
})();
