(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.Afterimage=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
function valid(row){return Array.isArray(row)&&row.length>0&&row.every(v=>v===0||v===1);}
function rule(row){if(!valid(row))throw new RangeError('A nonempty binary ring is required.');return row.map((v,i)=>row[(i+row.length-1)%row.length]^row[(i+1)%row.length]);}
function step(state,reverse=false){
 if(!Array.isArray(state)||state.length!==2||!valid(state[0])||!valid(state[1])||state[0].length!==state[1].length)throw new RangeError('Two equal nonempty binary rings are required.');
 const [a,b]=state, transformed=rule(reverse?a:b);
 return reverse?[b.map((v,i)=>v^transformed[i]),a.slice()]:[b.slice(),a.map((v,i)=>v^transformed[i])];
}
function initial(width=81,seed='1'){
 if(!Number.isInteger(width)||width<3||width>160)throw new RangeError('Width must be an integer from 3 to 160.');
 let hash=2166136261;for(const c of String(seed)){hash^=c.codePointAt(0);hash=Math.imul(hash,16777619);}
 const current=Array.from({length:width},()=>{hash+=0x6D2B79F5;let t=hash;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296<.5?0:1;});
 return [Array(width).fill(0),current];
}
function equal(a,b){return a.length===b.length&&a.every((row,i)=>row.length===b[i].length&&row.every((v,j)=>v===b[i][j]));}
function svg(rows){if(!rows.length||!rows.every(valid)||!rows.every(r=>r.length===rows[0].length))throw new RangeError('Equal binary rows required.');const w=rows[0].length,h=rows.length,cells=rows.map((r,y)=>r.map((v,x)=>v?`M${x} ${y}h1v1h-1z`:'').join('')).join('');return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><title>Afterimage: a reversible cellular print</title><rect width="${w}" height="${h}" fill="#eee7d5"/><path fill="#204b50" d="${cells}"/></svg>`;}
return {rule,step,initial,equal,svg};
});
