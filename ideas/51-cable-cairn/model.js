(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.Cairn=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const DEFAULTS=Object.freeze({channels:4,diameter:5,clearance:.35,depth:24,wall:2.8,base:3.2});
function parameters(input={}){
 const p={...DEFAULTS,...input};for(const k of Object.keys(DEFAULTS))if(!Number.isFinite(p[k]))throw new RangeError(k+' must be finite');
 if(!Number.isInteger(p.channels)||p.channels<2||p.channels>8||p.diameter<2||p.diameter>12||p.clearance<0||p.clearance>.8||p.depth<12||p.depth>50||p.wall<1.2||p.wall>5||p.base<1.2||p.base>6)throw new RangeError('Dimensions outside the supported design range');
 p.radius=(p.diameter+2*p.clearance)/2;p.edge=p.wall+1;p.width=2*p.edge+2*p.radius*p.channels+p.wall*(p.channels-1);p.height=p.base+p.radius;return p;
}
function outline(input={}){
 const p=parameters(input),ch=Math.min(1,p.height/4),points=[[0,0],[p.width,0],[p.width,p.height-ch],[p.width-ch,p.height]];
 for(let i=p.channels-1;i>=0;i--){const x=p.edge+p.radius+i*(2*p.radius+p.wall);for(let j=0;j<=24;j++){const a=-j*Math.PI/24;points.push([x+p.radius*Math.cos(a),p.height+p.radius*Math.sin(a)]);}}
 points.push([ch,p.height],[0,p.height-ch]);return points;
}
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function triangulate(points){
 const ids=points.map((_,i)=>i),tri=[];
 while(ids.length>3){let found=false;for(let j=0;j<ids.length;j++){
  const a=ids[(j+ids.length-1)%ids.length],b=ids[j],c=ids[(j+1)%ids.length];if(cross(points[a],points[b],points[c])<=1e-10)continue;
  const occupied=ids.some(k=>k!==a&&k!==b&&k!==c&&cross(points[a],points[b],points[k])>=-1e-10&&cross(points[b],points[c],points[k])>=-1e-10&&cross(points[c],points[a],points[k])>=-1e-10);
  if(occupied)continue;tri.push([a,b,c]);ids.splice(j,1);found=true;break;
 }if(!found)throw new Error('Outline cannot be triangulated');}
 tri.push(ids.slice());return tri;
}
function mesh(input={}){
 const p=parameters(input),shape=outline(p),n=shape.length,vertices=shape.map(([x,z])=>[x,0,z]).concat(shape.map(([x,z])=>[x,p.depth,z])),faces=[];
 for(const [a,b,c] of triangulate(shape)){faces.push([a,b,c],[a+n,c+n,b+n]);}
 for(let i=0;i<n;i++){const j=(i+1)%n;faces.push([i,i+n,j+n],[i,j+n,j]);}
 return {vertices,faces,params:p};
}
function normal(a,b,c){const u=b.map((v,i)=>v-a[i]),v=c.map((x,i)=>x-a[i]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],l=Math.hypot(...n);return n.map(x=>x/l);}
function volume(m){let v=0;for(const f of m.faces){const[a,b,c]=f.map(i=>m.vertices[i]);v+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;}return v;}
function stl(input={}){const m=mesh(input),buffer=new ArrayBuffer(84+m.faces.length*50),view=new DataView(buffer),label='Cable Cairn / millimetres / flat base at Z=0';for(let i=0;i<label.length;i++)view.setUint8(i,label.charCodeAt(i));view.setUint32(80,m.faces.length,true);let offset=84;for(const f of m.faces){const points=f.map(i=>m.vertices[i]),numbers=normal(...points).concat(...points);for(const v of numbers){view.setFloat32(offset,v,true);offset+=4;}view.setUint16(offset,0,true);offset+=2;}return buffer;}
function area(input={}){const s=outline(input);return s.reduce((sum,a,i)=>{const b=s[(i+1)%s.length];return sum+a[0]*b[1]-b[0]*a[1];},0)/2;}
return {DEFAULTS,parameters,outline,mesh,normal,volume,stl,area};
});
