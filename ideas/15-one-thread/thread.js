(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.OneThread=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
function validate(width,height,seed){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<3||height<3||width>30||height>30)throw new RangeError('Grid dimensions must be integers from 3 to 30.');
 if(!Number.isInteger(seed)||seed<0||seed>4294967295)throw new RangeError('Seed must be an unsigned 32-bit integer.');
}
function random(seed){let a=seed>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
function circuit(width,height,seed=15){
 validate(width,height,seed);const n=width*height,adj=Array.from({length:n},()=>new Set()),rng=random(seed);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const a=y*width+x;
  for(const b of [y*width+(x+1)%width,((y+1)%height)*width+x]){adj[a].add(b);adj[b].add(a);}
 }
 const stack=[0],out=[];
 while(stack.length){const a=stack[stack.length-1];if(adj[a].size){const neighbours=[...adj[a]].sort((a,b)=>a-b),b=neighbours[Math.floor(rng()*neighbours.length)];adj[a].delete(b);adj[b].delete(a);stack.push(b);}else out.push(stack.pop());}
 return out.reverse().map(i=>[i%width,Math.floor(i/width)]);
}
function crossing(a,b,width,height){
 if(a[1]===b[1]&&Math.abs(a[0]-b[0])===width-1)return'horizontal';
 if(a[0]===b[0]&&Math.abs(a[1]-b[1])===height-1)return'vertical';
 return null;
}
function instruction(a,b,width,height){const wrap=crossing(a,b,width,height);return`(${a[0]}, ${a[1]}) → (${b[0]}, ${b[1]})${wrap?' · join opposite '+(wrap==='horizontal'?'left/right':'top/bottom')+' edges':''}`;}
function colour(i,total){return`hsl(${(8+234*i/Math.max(1,total)).toFixed(1)},45%,38%)`;}
function svg(route,width,height,progress=route.length-1){
 validate(width,height,0);if(!Array.isArray(route)||route.length!==2*width*height+1)throw new RangeError('A complete circuit is required.');
 if(!Number.isInteger(progress)||progress<0||progress>=route.length)throw new RangeError('Progress must be a valid stitch index.');
 const S=40,M=62,W=(width-1)*S+2*M,H=(height-1)*S+2*M,point=p=>[M+p[0]*S,M+p[1]*S];
 const path=(a,b,c,dash='',opacity=1)=>`<path d="M${a[0]},${a[1]} L${b[0]},${b[1]}" stroke="${c}" stroke-width="2.8" stroke-linecap="round" opacity="${opacity}"${dash?' stroke-dasharray="'+dash+'"':''}/>`;
 let grid='',threads='',labels='';
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const p=point([x,y]);grid+=`<circle cx="${p[0]}" cy="${p[1]}" r="1.8" fill="#c9bba6"/>`;
  if(x<width-1)grid+=path(p,point([x+1,y]),'#ddd1be','',.55);
  if(y<height-1)grid+=path(p,point([x,y+1]),'#ddd1be','',.55);
 }
 for(let i=0;i<route.length-1;i++){
  const a=route[i],b=route[i+1],wrap=crossing(a,b,width,height),c=i<progress?colour(i,route.length-1):'#e4d9c9',p=point(a),q=point(b);
  if(wrap==='horizontal')for(const v of [p,q])threads+=path(v,[v[0]===M?M-30:W-M+30,v[1]],c,'3 4');
  else if(wrap==='vertical')for(const v of [p,q])threads+=path(v,[v[0],v[1]===M?M-30:H-M+30],c,'3 4');
  else threads+=path(p,q,c);
 }
 for(let x=0;x<width;x++)labels+=`<text x="${M+x*S}" y="20" text-anchor="middle">${x}</text>`;
 for(let y=0;y<height;y++)labels+=`<text x="16" y="${M+y*S+3}" text-anchor="middle">${y}</text>`;
 const at=point(route[progress]),start=point(route[0]);
 return`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="One Thread: ${progress} of ${route.length-1} stitches, dashed stitches join opposite edges"><title>One Thread — a single closed Euler circuit</title><defs><pattern id="linen" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 0H8M0 0V8" stroke="#d7c9b2" stroke-width=".3" opacity=".5"/></pattern></defs><rect width="${W}" height="${H}" fill="#faf3e5"/><rect x="25" y="25" width="${W-50}" height="${H-50}" rx="12" fill="url(#linen)" stroke="#b9aa91" stroke-dasharray="1 5"/><g font-family="monospace" font-size="9" fill="#8e7c66">${labels}</g><g fill="none">${grid}${threads}<circle cx="${start[0]}" cy="${start[1]}" r="7" stroke="#71634e" stroke-width="1"/><circle cx="${at[0]}" cy="${at[1]}" r="4" fill="#9b4e3d" stroke="#faf3e5" stroke-width="1.5"/></g></svg>`;
}
return{circuit,crossing,instruction,svg,validate};
});
