(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.EqualShares=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const EXAMPLE=Object.freeze([1500,1500,900,500,500,200]);
function validate(weights,seats){
 if(!Array.isArray(weights)||!weights.length||weights.length>100||weights.some(w=>!Number.isSafeInteger(w)||w<=0))throw new RangeError('Use 1–100 positive integer weights, each within the safe integer range.');
 if(!Number.isInteger(seats)||seats<0||seats>10000)throw new RangeError('Seats must be a whole number from 0 to 10000.');
}
function allocate(weights,seats){
 validate(weights,seats);const total=weights.reduce((a,w)=>a+BigInt(w),0n);
 const rows=weights.map((weight,i)=>{const numerator=BigInt(weight)*BigInt(seats);return {i,weight,numerator,denominator:total,base:Number(numerator/total),remainder:numerator%total,extra:false};});
 const ranked=[...rows].sort((a,b)=>a.remainder===b.remainder?a.i-b.i:a.remainder>b.remainder?-1:1);
 const remaining=seats-rows.reduce((a,r)=>a+r.base,0);
 for(const row of ranked.slice(0,remaining))row.extra=true;
 return{seats,total,rows,allocation:rows.map(r=>r.base+Number(r.extra))};
}
function compare(weights,seats){
 if(seats>=10000)throw new RangeError('Comparison needs fewer than 10000 starting seats.');
 const before=allocate(weights,seats),after=allocate(weights,seats+1);
 return{before,after,losers:before.allocation.flatMap((a,i)=>after.allocation[i]<a?[i]:[])};
}
function parseWeights(text){
 const raw=String(text).trim();if(/,\s*,|^,|,$/.test(raw))throw new RangeError('Each comma must separate two weights.');
 const cells=raw.split(/[\s,]+/);
 if(!cells.length||cells.some(s=>!/^\d+$/.test(s)))throw new RangeError('Separate positive whole-number weights with commas or spaces.');
 const weights=cells.map(Number);validate(weights,0);return weights;
}
function scan(weights,start=1,stop=100){
 if(!Number.isInteger(start)||!Number.isInteger(stop)||start<0||stop>1000||stop<start)throw new RangeError('Scan interval must be within 0–1000.');
 const out=[];for(let n=start;n<stop;n++){const result=compare(weights,n);if(result.losers.length)out.push({seats:n,losers:result.losers});}return out;
}
function fraction(n,d){if(d<=0n||n<0n)throw new RangeError('Nonnegative fraction required.');let a=n,b=d;while(b){const r=a%b;a=b;b=r;}return n===0n?'0':d/a===1n?String(n/a):`${n/a}/${d/a}`;}
return{EXAMPLE,allocate,compare,parseWeights,scan,fraction};
});
