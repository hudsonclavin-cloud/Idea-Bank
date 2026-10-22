(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.Buckling=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const ends={pinned:{name:'Pin / pin',K:1},fixed:{name:'Clamp / clamp',K:.5},cantilever:{name:'Clamp / free',K:2},mixed:{name:'Clamp / pin',K:Math.PI/4.493409457909064}};
  function positive(value,name){if(!Number.isFinite(value)||value<=0)throw new RangeError(name+' must be finite and positive');return value;}
  function section(kind,widthMM,secondaryMM){
    const d=positive(widthMM,'width')/1000;let area,I;
    if(kind==='solid'){area=Math.PI*d*d/4;I=Math.PI*d**4/64;}
    else if(kind==='tube'){
      const t=positive(secondaryMM,'wall')/1000;if(2*t>=d)throw new RangeError('wall must be less than radius');
      const inner=d-2*t;area=Math.PI*(d*d-inner*inner)/4;I=Math.PI*(d**4-inner**4)/64;
    }else if(kind==='rectangle'){
      const h=positive(secondaryMM,'depth')/1000;area=d*h;I=Math.min(d*h**3,h*d**3)/12;
    }else throw new RangeError('unknown section');
    return{area,I,radius:Math.sqrt(I/area)};
  }
  function evaluate({kind='tube',width=22,secondary=1.5,length=2000,E=69,boundary='pinned',load=650}={}){
    const geometry=section(kind,width,secondary),L=positive(length,'length')/1000,modulus=positive(E,'modulus')*1e9;
    if(!ends[boundary])throw new RangeError('unknown restraint');if(!Number.isFinite(load)||load<0)throw new RangeError('load must be finite and nonnegative');
    const K=ends[boundary].K,critical=Math.PI**2*modulus*geometry.I/(K*L)**2;
    return{...geometry,L,E:modulus,K,critical,ratio:load/critical,slenderness:K*L/geometry.radius,stress:load/geometry.area};
  }
  function mode(t,boundary){
    if(!Number.isFinite(t)||t<0||t>1||!ends[boundary])throw new RangeError('mode coordinate or restraint invalid');
    if(boundary==='pinned')return Math.sin(Math.PI*t);
    if(boundary==='fixed')return(1-Math.cos(2*Math.PI*t))/2;
    if(boundary==='cantilever')return 1-Math.cos(Math.PI*t/2);
    const q=4.493409457909064,c=(1-Math.cos(q))/(q-Math.sin(q));
    const raw=u=>1-Math.cos(q*u)-c*(q*u-Math.sin(q*u));
    const max=Math.max(...Array.from({length:201},(_,i)=>raw(i/200)));
    return raw(t)/max;
  }
  return{ends,section,evaluate,mode};
});
