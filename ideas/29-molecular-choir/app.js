(function(){
  'use strict';
  const M=window.MolecularChoir;
  const $=(id)=>document.getElementById(id);
  let paused=matchMedia('(prefers-reduced-motion: reduce)').matches;
  let phase=0,last=0,audio=null,voiceTimer=null;
  function inputs(){return [Number($('massA').value),Number($('massB').value),Number($('stiffness').value)];}
  function drawMolecule(){
    const [a,b]=inputs();const d=M.displacement(a,b,phase,55);
    // Equilibrium positions are also arranged about the center of mass.
    const left=350-180*b/(a+b)+d.a,right=350+180*a/(a+b)+d.b;
    const rA=22+Math.cbrt(a)*7,rB=22+Math.cbrt(b)*7;
    $('left').setAttribute('cx',left);$('left').setAttribute('cy',130);$('left').setAttribute('r',rA);
    $('right').setAttribute('cx',right);$('right').setAttribute('cy',130);$('right').setAttribute('r',rB);
    for(const [id,x,text] of [['left-label',left,a+''],['right-label',right,b+'']]){const n=$(id);n.setAttribute('x',x);n.setAttribute('y',130);n.textContent=text;}
    const start=left+rA+6,end=right-rB-6;let path=`M${start},130`;
    for(let i=1;i<=18;i++)path+=` L${start+(end-start)*i/19},${130+(i%2?9:-9)}`;
    path+=` L${end},130`;$('spring').setAttribute('d',path);
  }
  function update(){
    const [a,b,k]=inputs(),base=M.mode(a,b,k),heavy=M.mode(a,b+1,k);
    for(const [id,val] of [['massA',a+' u'],['massB',b+' u'],['stiffness',k+' N/m']])$(id+'-val').textContent=val;
    $('frequency').textContent=base.thz.toFixed(2);$('reduced').textContent=base.reducedU.toFixed(3);$('audible').textContent=base.audible.toFixed(1);
    const lower=(1-heavy.hz/base.hz)*100;$('shift').textContent=lower.toFixed(1)+'% LOWER WITH +1 u';
    const max=base.wavenumber*1.22;const axis=(v)=>45+v/max*610;
    const line=(m,color,label,y)=>{const x=axis(m.wavenumber);return `<path d="M${x},101 V39" stroke="${color}" stroke-width="2"/><circle cx="${x}" cy="39" r="3" fill="${color}"/><text x="${x-7}" y="${y}" text-anchor="end" fill="${color}" font-size="10">${label}: ${m.wavenumber.toFixed(0)}</text>`;};
    let ticks='';for(let i=0;i<=4;i++){const v=max*i/4,x=axis(v);ticks+=`<path d="M${x},101v5" stroke="#737186"/><text x="${x}" y="122" fill="#aaa8bd" text-anchor="middle" font-size="9">${Math.round(v)}</text>`;}
    $('spectrum').innerHTML=`<g font-family="monospace"><path d="M45 101H655" stroke="#535064"/>${ticks}${line(base,'#c4b0fa','original',20)}${line(heavy,'#a5e8ce','heavier',53)}<text x="653" y="134" fill="#8f8ba6" font-size="8" text-anchor="end">MODEL WAVENUMBER / cm⁻¹</text></g>`;
    drawMolecule();
  }
  function setPaused(value){paused=value;$('pause').textContent=paused?'Resume motion':'Pause motion';$('pause').setAttribute('aria-pressed',String(paused));}
  $('pause').addEventListener('click',()=>setPaused(!paused));setPaused(paused);
  for(const id of ['massA','massB','stiffness'])$(id).addEventListener('input',update);
  for(const group of document.querySelectorAll('.presets'))for(const button of group.querySelectorAll('button'))button.addEventListener('click',()=>{$(group.dataset.target).value=button.dataset.mass;update();});
  let active=[];
  function stopVoices(){for(const o of active){try{o.stop();}catch{}}active=[];clearTimeout(voiceTimer);}
  $('play').addEventListener('click',async()=>{
    try{
      const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio){$('audio-status').textContent='Audio is unavailable in this browser. The model still works.';return;}
      audio=audio||new Audio();await audio.resume();stopVoices();
      const [a,b,k]=inputs(),notes=[M.mode(a,b,k),M.mode(a,b+1,k)];
      notes.forEach((mode,i)=>{const t=audio.currentTime+.04+i*.8,o=audio.createOscillator(),g=audio.createGain();o.type='sine';o.frequency.value=Math.max(20,Math.min(16000,mode.audible));g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.14,t+.03);g.gain.exponentialRampToValueAtTime(.0001,t+.65);o.connect(g).connect(audio.destination);o.start(t);o.stop(t+.7);active.push(o);o.onended=()=>{o.disconnect();g.disconnect();};});
      $('audio-status').textContent=`Original ${notes[0].audible.toFixed(0)} Hz → heavier ${notes[1].audible.toFixed(0)} Hz`;
      voiceTimer=setTimeout(()=>{$('audio-status').textContent='Listen again, or change the weight of an atom.';},1750);
    }catch{$('audio-status').textContent='Sound could not start. Try again after interacting with the page.';}
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden){stopVoices();if(audio)audio.suspend().catch(()=>{});}});
  function frame(t){const dt=Math.min(.04,(t-last)/1000||0);last=t;if(!paused){const [a,b,k]=inputs();const ratio=M.mode(a,b,k).hz/M.mode(12,1,500).hz;phase+=dt*2*Math.PI*.55*ratio;drawMolecule();}requestAnimationFrame(frame);}
  update();requestAnimationFrame(frame);
})();
