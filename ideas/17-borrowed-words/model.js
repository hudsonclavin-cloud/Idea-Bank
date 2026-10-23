(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BorrowedWords=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
function tokens(text){return [...String(text).matchAll(/[\p{L}\p{N}_]+/gu)].map(m=>({word:m[0],start:m.index,end:m.index+m[0].length}));}
function find(text,target){
 if(typeof text!=='string'||typeof target!=='string')throw new TypeError('Source and target must be text.');
 if(text.length>20000||target.length>2000)throw new RangeError('Use at most 20,000 source characters and 2,000 target characters.');
 const source=tokens(text),wanted=tokens(target).map(t=>t.word.toLowerCase());
 if(!wanted.length)throw new Error('Give the hidden sentence at least one word.');
 if(wanted.length>80)throw new RangeError('Use at most 80 target words.');
 const starts=Array(wanted.length).fill(null);let best=null;
 for(let i=0;i<source.length;i++){
  const word=source[i].word.toLowerCase();
  for(let j=wanted.length-1;j>=0;j--){
   if(word===wanted[j]&&(j===0||starts[j-1]!==null)){
    const start=j===0?i:starts[j-1];starts[j]=start;
    if(j===wanted.length-1){const candidate={length:i-start+1,start,end:i};if(!best||candidate.length<best.length||(candidate.length===best.length&&start<best.start))best=candidate;}
   }
  }
 }
 if(!best)throw new Error('Those words do not appear in that order. Try another sentence, or borrow words from the source.');
 const chosen=[];let j=0;
 for(let i=best.start;i<=best.end;i++)if(source[i].word.toLowerCase()===wanted[j]){chosen.push(source[i]);j++;if(j===wanted.length)break;}
 return {chosen,window:best,wordCount:source.length};
}
function segments(text,result){
 const keep=new Set(result.chosen.map(t=>t.start));const out=[];let cursor=0;
 for(const token of tokens(text)){
  if(token.start>cursor)out.push({text:text.slice(cursor,token.start),kind:'space'});
  out.push({text:token.word,kind:keep.has(token.start)?'kept':'redacted'});cursor=token.end;
 }
 if(cursor<text.length)out.push({text:text.slice(cursor),kind:'space'});return out;
}
function blackout(text,result){return segments(text,result).map(s=>s.kind==='redacted'?'█'.repeat(Array.from(s.text).length):s.text).join('');}
return {tokens,find,segments,blackout};
});
