(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.LastGrain=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
function create(size=65){if(!Number.isInteger(size)||size<5||size>101)throw new RangeError('Use a square grid 5–101 cells wide.');return{size,cells:new Uint32Array(size*size),odometer:new Uint32Array(size*size),queued:new Uint8Array(size*size),queue:[],head:0,added:0,lost:0,topples:0};}
function enqueue(s,i){if(s.cells[i]>=4&&!s.queued[i]){s.queued[i]=1;s.queue.push(i);}}
function add(s,x,y,count=1){if(![x,y,count].every(Number.isInteger)||x<0||y<0||x>=s.size||y>=s.size||count<0||s.added+count>2000000)throw new RangeError('Choose an in-bounds cell and whole grains; reset after two million grains.');const i=y*s.size+x;s.cells[i]+=count;s.added+=count;enqueue(s,i);return s;}
function pending(s){return s.queue.length-s.head;}
function drain(s,budget=4000,order='fifo'){
 if(!Number.isInteger(budget)||budget<1||budget>100000||!['fifo','lifo'].includes(order))throw new RangeError('Positive budget up to 100000, FIFO or LIFO required.');
 let work=0;const n=s.size;
 while(work<budget&&pending(s)){
  const i=order==='fifo'?s.queue[s.head++]:s.queue.pop();s.queued[i]=0;
  const q=Math.floor(s.cells[i]/4);if(!q)continue;
  s.cells[i]-=4*q;s.odometer[i]+=q;s.topples+=q;work++;
  const x=i%n,y=Math.floor(i/n);
  for(const j of [x?i-1:-1,x<n-1?i+1:-1,y?i-n:-1,y<n-1?i+n:-1]){
   if(j<0)s.lost+=q;else{s.cells[j]+=q;enqueue(s,j);}
  }
 }
 if(s.head>4096||!pending(s)){s.queue=s.queue.slice(s.head);s.head=0;}
 return work;
}
function mass(s){let sum=0;for(const v of s.cells)sum+=v;return sum;}
function seed(size=65,pattern='mountain'){
 const s=create(size),c=Math.floor(size/2);
 if(pattern==='mountain')add(s,c,c,18000);
 else if(pattern==='fault'){
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)add(s,x,y,2);
  for(let y=4;y<size-4;y++)add(s,c+(y%5===0?1:0),y,25);
 }else if(pattern==='islands'){
  for(const[x,y]of [[.27,.27],[.73,.27],[.5,.5],[.27,.73],[.73,.73]])add(s,Math.round(x*(size-1)),Math.round(y*(size-1)),1500);
 }else throw new RangeError('Unknown landscape.');
 return s;
}
function clone(s){return{...s,cells:s.cells.slice(),odometer:s.odometer.slice(),queued:s.queued.slice(),queue:s.queue.slice()};}
return{create,add,drain,pending,mass,seed,clone};
});
