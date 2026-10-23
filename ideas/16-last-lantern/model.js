(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.Lantern=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
function bounds(n,r){if(!Number.isInteger(n)||n<1||n>500||!Number.isInteger(r)||r<0||r>=n)throw new RangeError('Use 1–500 candidates and 0 ≤ skip < candidates.');}
function success(n,r){bounds(n,r);if(r===0)return 1/n;let sum=0;for(let k=r;k<n;k++)sum+=1/k;return r/n*sum;}
function optimum(n){bounds(n,0);let r=0;for(let k=1;k<n;k++)if(success(n,k)>success(n,r))r=k;return r;}
function choose(order,r){bounds(order.length,r);if(!order.every(Number.isFinite))throw new RangeError('Finite ranks required.');if(r===0)return order[0];const record=Math.max(...order.slice(0,r));return order.slice(r).find(v=>v>record)??order.at(-1);}
function random(seed){let a=Number(seed)>>>0;return()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
function game(n=12,seed=1){bounds(n,0);const order=Array.from({length:n},(_,i)=>i),rng=random(seed);for(let i=n-1;i>0;i--){const j=Math.floor(rng()*(i+1));[order[i],order[j]]=[order[j],order[i]];}return {order,index:0,selected:null};}
function pass(g){if(g.selected!==null||g.index>=g.order.length-1)throw new RangeError('No further lantern can be revealed.');return {...g,index:g.index+1};}
function accept(g){if(g.selected!==null)throw new RangeError('This walk is already finished.');return {...g,selected:g.index};}
function view(g){const seen=g.order.slice(0,g.index+1),current=seen.at(-1),rank=1+seen.filter(v=>v>current).length;return {number:g.index+1,total:g.order.length,rank,record:rank===1,finished:g.selected!==null,won:g.selected!==null&&g.order[g.selected]===g.order.length-1};}
return {success,optimum,choose,random,game,pass,accept,view};
});
