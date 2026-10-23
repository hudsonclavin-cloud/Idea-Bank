(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.LoadedCircle=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const presets=Object.freeze({circle:[[2,2,4,4,9,9],[1,1,6,6,8,8],[3,3,5,5,7,7]],ladder:[[1,2,3],[3,4,5],[5,6,7]],mirror:[[1,2,3],[1,2,3],[1,2,3]]});
function validate(a){if(!Array.isArray(a)||a.length<1||a.length>12||a.some(x=>!Number.isSafeInteger(x)||Math.abs(x)>9999))throw new RangeError('Each die needs 1–12 integer faces, from −9999 to 9999.');return a;}
function parse(text){if(typeof text!=='string'||!text.trim())throw new RangeError('Enter at least one face.');const parts=text.split(',').map(s=>s.trim());if(parts.some(s=>!/^[-+]?\d+$/.test(s)))throw new RangeError('Separate integer faces with commas.');return validate(parts.map(Number));}
function match(a,b){validate(a);validate(b);let wins=0,ties=0;const cells=a.map(x=>b.map(y=>{const result=x>y?1:x===y?0:-1;wins+=result===1;ties+=result===0;return result;}));return{wins,ties,losses:a.length*b.length-wins-ties,total:a.length*b.length,cells};}
function fraction(n,d){if(!Number.isSafeInteger(n)||!Number.isSafeInteger(d)||n<0||d<=0)throw new RangeError('Nonnegative integer numerator and positive denominator required.');let a=n,b=d;while(b){const r=a%b;a=b;b=r;}return n/a+'/'+d/a;}
function graph(dice){if(!Array.isArray(dice)||dice.length!==3)throw new RangeError('Three dice required.');return [[0,1],[1,2],[2,0]].map(([a,b])=>{const odds=match(dice[a],dice[b]);return{a,b,...odds,winner:odds.wins===odds.losses?null:odds.wins>odds.losses?a:b};});}
return{presets,parse,validate,match,fraction,graph};
});
