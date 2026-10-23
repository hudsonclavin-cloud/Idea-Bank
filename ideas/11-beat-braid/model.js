(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BeatBraid=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
function rhythm(k,n,rotate=0){
 if(!Number.isInteger(n)||n<1||n>128||!Number.isInteger(k)||k<0||k>n||!Number.isInteger(rotate))throw new RangeError('Integer pulses 0..slots; slots 1..128; integer rotation required.');
 const row=Array.from({length:n},(_,i)=>Math.floor((i+1)*k/n)!==Math.floor(i*k/n)?1:0);
 return row.map((_,i)=>row[((i-rotate)%n+n)%n]);
}
function slotDuration(bpm){if(!Number.isFinite(bpm)||bpm<20||bpm>300)throw new RangeError('Tempo must be 20..300 BPM.');return 60/bpm/4;}
function wav(a,b,bpm=108){
 if(!Array.isArray(a)||!Array.isArray(b)||!a.length||a.length!==b.length||a.length>128||[...a,...b].some(v=>v!==0&&v!==1))throw new RangeError('Equal nonempty binary rhythm rows required.');
 const rate=22050,slot=slotDuration(bpm),length=Math.floor((a.length*slot*2+.18)*rate),samples=new Float64Array(length);
 for(const [row,pitch] of [[a,660],[b,440]])for(let i=0;i<row.length*2;i++)if(row[i%row.length]){
  const start=Math.round(i*slot*rate);
  for(let j=0;j<Math.floor(.15*rate);j++){const t=j/rate;samples[start+j]+=.38*Math.min(1,t/.003)*Math.exp(-38*t)*Math.sin(2*Math.PI*pitch*t);}
 }
 const buffer=new ArrayBuffer(44+length*2),view=new DataView(buffer);const label=(offset,text)=>{for(let i=0;i<text.length;i++)view.setUint8(offset+i,text.charCodeAt(i));};
 label(0,'RIFF');view.setUint32(4,36+length*2,true);label(8,'WAVE');label(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);label(36,'data');view.setUint32(40,length*2,true);
 samples.forEach((v,i)=>view.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,v))*32767),true));return buffer;
}
return{rhythm,slotDuration,wav};
});
