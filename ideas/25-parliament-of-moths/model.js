(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.MothParliament=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function random(state){let t=state.rng+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;}
  function create(seed=25,count=140){
    const state={rng:seed>>>0,tick:0,budget:2,social:.55,lamps:[{x:.23,y:.3,name:'AMBER',color:'#edbb72'},{x:.71,y:.27,name:'ROSE',color:'#db8c95'},{x:.48,y:.72,name:'JADE',color:'#85b6a2'}],votes:[0,0,0,0],lit:[true,true,false],moths:[]};
    for(let i=0;i<count;i++)state.moths.push({x:.06+random(state)*.88,y:.06+random(state)*.88,vx:0,vy:0,choice:i%4,affinity:random(state),phase:random(state)*Math.PI*2,loyalty:random(state)});
    return state;
  }
  function elect(state){
    const counts=[0,0,0,0];for(const m of state.moths)counts[m.choice]++;
    state.votes=counts;const rank=[0,1,2].sort((a,b)=>counts[b]-counts[a]||a-b);
    state.lit=[false,false,false];for(const i of rank.slice(0,clamp(Math.round(state.budget),0,3)))state.lit[i]=true;
    return counts;
  }
  function moveLamp(state,index,x,y){if(!state.lamps[index])throw Error('Unknown lamp');state.lamps[index].x=clamp(x,.08,.92);state.lamps[index].y=clamp(y,.1,.9);}
  function step(state){
    const old=state.moths.map(m=>({x:m.x,y:m.y,choice:m.choice}));
    if(state.tick%24===0){
      for(let i=0;i<state.moths.length;i++){
        const m=state.moths[i],near=[0,0,0,0];let neighbours=0;
        for(let j=0;j<old.length;j++)if(i!==j&&Math.hypot(m.x-old[j].x,m.y-old[j].y)<.16){near[old[j].choice]++;neighbours++;}
        const scores=state.lamps.map((lamp,j)=>1.35-Math.hypot(lamp.x-m.x,lamp.y-m.y)*1.1+m.affinity*.55+(state.lit[j]?.05:0)+state.social*(neighbours?near[j]/neighbours:0)+(j===m.choice?.10:0));
        scores.push(.9+(1-m.affinity)*.8+state.social*(neighbours?near[3]/neighbours:0)+(m.choice===3?.1:0));
        m.choice=scores.indexOf(Math.max(...scores));
      }
      elect(state);
    }
    for(const m of state.moths){
      let target=m.choice===3?{x:.84,y:.78}:state.lamps[m.choice];
      const angle=m.phase+state.tick*.012,orbit=m.choice===3?.10:.07+.055*m.loyalty;
      const tx=target.x+Math.cos(angle)*orbit,ty=target.y+Math.sin(angle)*orbit;
      const lightFactor=m.choice===3||state.lit[m.choice]?1:.22;
      m.vx=(m.vx+(tx-m.x)*.0018*lightFactor)*.95;m.vy=(m.vy+(ty-m.y)*.0018*lightFactor)*.95;
      m.x=clamp(m.x+m.vx,.025,.975);m.y=clamp(m.y+m.vy,.025,.975);
    }
    state.tick++;return state;
  }
  return{create,step,elect,moveLamp,clamp};
});
