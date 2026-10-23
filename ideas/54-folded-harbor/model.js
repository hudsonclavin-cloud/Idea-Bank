(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.FoldedHarbor=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const PAPERS={a4:{width:210,height:297,name:'A4'},letter:{width:215.9,height:279.4,name:'US Letter'}};
const PALETTES={tide:{ink:'#376d73',wash:'#e7eeea',paper:'#fffef9',name:'Tidal green'},clay:{ink:'#a76346',wash:'#f3e5d9',paper:'#fffdf7',name:'Harbor clay'},graphite:{ink:'#49595a',wash:'#e7e9e3',paper:'#fffef9',name:'Graphite'}};
const add=(a,b,s=1)=>[a[0]+b[0]*s,a[1]+b[1]*s];
function parameters(input={}){const p={side:40,height:28,paper:'a4',palette:'tide',...input};if(!PAPERS[p.paper]||!PALETTES[p.palette])throw new RangeError('Unknown paper or ink.');if(!Number.isFinite(p.side)||p.side<25||p.side>52||!Number.isFinite(p.height)||p.height<12||p.height>38)throw new RangeError('Side 25–52 mm; wall height 12–38 mm.');return p;}
function bounds(polygons){const points=polygons.flat();return {minX:Math.min(...points.map(v=>v[0])),maxX:Math.max(...points.map(v=>v[0])),minY:Math.min(...points.map(v=>v[1])),maxY:Math.max(...points.map(v=>v[1]))};}
function net(input={}){
 const p=parameters(input),base=Array.from({length:6},(_,i)=>[p.side*Math.cos(i*Math.PI/3),p.side*Math.sin(i*Math.PI/3)]),walls=[],tabs=[],cuts=[],folds=[];
 for(let i=0;i<6;i++){
  const a=base[i],b=base[(i+1)%6],u=[(b[0]-a[0])/p.side,(b[1]-a[1])/p.side],n=[u[1],-u[0]],topA=add(a,n,p.height),topB=add(b,n,p.height);
  const start=add(b,n,2),end=add(b,n,p.height-2),outStart=add(add(b,n,4),u,6),outEnd=add(add(b,n,p.height-4),u,6);
  walls.push([a,b,topB,topA]);tabs.push([start,outStart,outEnd,end]);folds.push([a,b],[start,end]);
  cuts.push([a,topA,topB,end,outEnd,outStart,start,b]);
 }
 const b=bounds([base,...walls,...tabs]),paper=PAPERS[p.paper],available={width:paper.width-16,height:paper.height-102};
 if(b.maxX-b.minX>available.width||b.maxY-b.minY>available.height)throw new RangeError('This net does not fit the chosen sheet at 100%.');
 const offset=[paper.width/2-(b.minX+b.maxX)/2,44+(available.height-(b.maxY-b.minY))/2-b.minY];
 return {params:p,base,walls,tabs,cuts,folds,bounds:b,paper,offset};
}
const f=n=>Number(n.toFixed(4));const points=p=>p.map(v=>v.map(f).join(',')).join(' ');
function sheetSVG(input={}){
 const m=net(input),p=m.params,c=PALETTES[p.palette],W=m.paper.width,H=m.paper.height,[dx,dy]=m.offset;
 let artwork=`<polygon points="${points(m.base)}" fill="${c.wash}"/>`;
 m.walls.forEach((wall,i)=>{artwork+=`<polygon points="${points(wall)}" fill="${c.wash}"/><text x="${f(wall.reduce((a,v)=>a+v[0],0)/4)}" y="${f(wall.reduce((a,v)=>a+v[1],0)/4)}" text-anchor="middle" font-family="monospace" font-size="3" fill="${c.ink}">${i+1}</text>`;});
 m.tabs.forEach(tab=>artwork+=`<polygon points="${points(tab)}" fill="url(#glue)"/>`);
 const radius=p.side*.7;for(let i=0;i<5;i++)artwork+=`<ellipse cx="0" cy="0" rx="${f(radius-i*3)}" ry="${f((radius-i*3)*.56)}" fill="none" stroke="${c.ink}" stroke-width=".18" opacity=".24" transform="rotate(-22)"/>`;
 artwork+=`<path d="M${f(-p.side*.2)} 0h${f(p.side*.4)}M0 ${f(-p.side*.2)}v${f(p.side*.4)}" stroke="${c.ink}" opacity=".4" stroke-width=".2"/>`;
 const cuts=m.cuts.map(line=>`<polyline points="${points(line)}"/>`).join(''),folds=m.folds.map(line=>`<polyline points="${points(line)}"/>`).join('');
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" role="img" aria-label="Folded Harbor one-to-one ${m.paper.name} cutting template"><title>Folded Harbor / ${p.side} mm side / ${p.height} mm walls</title><defs><pattern id="glue" width="2" height="2" patternUnits="userSpaceOnUse"><path d="M-1 1 1 -1M0 2 2 0M1 3 3 1" stroke="${c.ink}" stroke-width=".18" opacity=".5"/></pattern></defs><rect width="${W}" height="${H}" fill="${c.paper}"/><g fill="${c.ink}" font-family="monospace"><text x="10" y="15" font-size="3.4" letter-spacing=".5">FOLDED HARBOR / CUT, FOLD, KEEP</text><text x="10" y="23" font-size="2.7">SIDE ${p.side} mm · WALL ${p.height} mm · ${m.paper.name} · PRINT 100%</text><text x="10" y="31" font-size="2.4">A LITTLE PLACE FOR THINGS BETWEEN JOURNEYS.</text></g><g transform="translate(${f(dx)} ${f(dy)})">${artwork}<g fill="none" stroke="#263f43" stroke-width=".25" stroke-linejoin="round">${cuts}</g><g fill="none" stroke="${c.ink}" stroke-width=".22" stroke-dasharray="1.5 1">${folds}</g></g><g font-family="monospace" font-size="2.5" fill="${c.ink}"><path d="M10 ${H-48}h14" stroke="#263f43" stroke-width=".25"/><text x="28" y="${H-47}">CUT THE OUTSIDE</text><path d="M10 ${H-40}h14" stroke="${c.ink}" stroke-dasharray="1.5 1" stroke-width=".22"/><text x="28" y="${H-39}">SCORE / FOLD</text><rect x="10" y="${H-34}" width="14" height="4" fill="url(#glue)"/><text x="28" y="${H-30}">GLUE TAB BACKS TO THE NEXT WALL</text><path d="M10 ${H-17}h50M10 ${H-19}v4M60 ${H-19}v4" stroke="${c.ink}" stroke-width=".3"/><text x="66" y="${H-16}">50 mm — MEASURE BEFORE CUTTING</text><text x="10" y="${H-7}" font-size="2.2">200–250 gsm cardstock · score lightly · decorative dry desk tray / untested physical prototype</text></g></svg>`;
}
function objectSVG(input={}){
 const p=parameters(input),c=PALETTES[p.palette],scale=1.95,project=(v,z=0)=>[260+(v[0]-v[1])*.866*scale,230+(v[0]+v[1])*.42*scale-z*scale],base=net(p).base;
 const face=i=>[project(base[i]),project(base[(i+1)%6]),project(base[(i+1)%6],p.height),project(base[i],p.height)],far=[],near=[];
 for(let i=0;i<6;i++){const a=base[i],b=base[(i+1)%6];((a[0]+a[1]+b[0]+b[1])<0?far:near).push(i);}
 const wall=(i,front)=>`<polygon points="${points(face(i))}" fill="${front?c.ink:c.wash}" stroke="${c.ink}" stroke-width="1.1"/><path d="M${points([project(base[i],p.height),project(base[(i+1)%6],p.height)]).replace(' ',' L')}" fill="none" stroke="${front?'#bed0c3':c.ink}" stroke-width="1.4"/>`;
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 360" role="img" aria-label="Assembled hexagonal cardstock tray with ${p.height} millimetre walls"><title>Folded Harbor assembled preview</title><ellipse cx="260" cy="267" rx="145" ry="20" fill="#c5c9b6" opacity=".28"/>${far.map(i=>wall(i,false)).join('')}<polygon points="${points(base.map(v=>project(v)))}" fill="#f8f4df" stroke="${c.ink}"/>${[.25,.45,.65].map(r=>`<polygon points="${points(base.map(v=>project(v.map(x=>x*r))))}" fill="none" stroke="${c.ink}" stroke-width=".6" opacity=".25"/>`).join('')}${near.map(i=>wall(i,true)).join('')}<g font-family="monospace" font-size="10" fill="${c.ink}"><text x="32" y="32">ONE SHEET / SIX SHORES</text><text x="32" y="323">${2*p.side} mm ACROSS CORNERS</text><text x="488" y="323" text-anchor="end">${p.height} mm WALLS</text></g></svg>`;
}
return {PAPERS,PALETTES,parameters,net,bounds,sheetSVG,objectSVG};
});
