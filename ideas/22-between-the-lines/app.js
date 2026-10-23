(function(){
 'use strict';
 const M=Between,$=id=>document.getElementById(id);let state=M.initial();
 function button(text,pressed,action,key){const b=document.createElement('button');if(key)b.dataset.focusKey=key;b.type='button';b.textContent=text;b.setAttribute('aria-pressed',String(pressed));b.addEventListener('click',action);return b;}
 function send(action){state=M.reduce(state,action);render();}
 function render(){
  const focusKey=document.activeElement?.dataset.focusKey;
  const scene=M.scenes[state.scene],context=scene.contexts[state.lens];
  document.documentElement.style.setProperty('--accent',context.color);
  $('scenes').replaceChildren(...M.scenes.map((s,i)=>button(`${String(i+1).padStart(2,'0')}  ${s.label}`,i===state.scene,()=>send({type:'scene',value:i}),'scene-'+i)));
  $('relationship').textContent=scene.relationship;$('time').textContent=scene.time;$('message').textContent=scene.message;
  $('lenses').replaceChildren(...scene.contexts.map((c,i)=>button(c.name,i===state.lens,()=>send({type:'lens',value:i}),'lens-'+i)));
  $('lensCount').textContent=`0${state.lens+1} / 03`;$('thought').textContent=`“${context.thought}”`;$('detail').textContent=context.detail;
  $('hold').setAttribute('aria-pressed',String(state.held.includes(state.lens)));$('hold').textContent=state.held.includes(state.lens)?'Release this possibility −':'Keep this possibility +';
  $('heldCount').textContent=`${state.held.length} held together`;
  $('held').replaceChildren(...state.held.map(i=>{const s=document.createElement('span');s.textContent=scene.contexts[i].name;s.style.borderColor=scene.contexts[i].color;return s;}));
  $('unfold').setAttribute('aria-expanded',String(state.unfolded));$('clue').hidden=!state.unfolded;$('clue').textContent=scene.clue;
  $('replyChoices').replaceChildren(...[scene.openers,scene.asks,scene.offers].map((choices,part)=>{const d=document.createElement('div');d.className='choice-part';const label=document.createElement('span');label.textContent=['01 / ACKNOWLEDGE','02 / ASK','03 / LEAVE ROOM'][part];d.append(label,...choices.map((text,i)=>button(text,state.reply[part]===i,()=>send({type:'reply',part,value:i}),'reply-'+part+'-'+i)));return d;}));
  // Rebuild a draft only when its composing choices change, not when a lens changes.
  const signature=state.scene+':'+state.reply.join(',');
  if($('draft').dataset.signature!==signature){$('draft').value=M.compose(state);$('draft').dataset.signature=signature;}
  if(focusKey)document.querySelector('[data-focus-key="'+focusKey+'"]')?.focus({preventScroll:true});
 }
 $('hold').addEventListener('click',()=>send({type:'hold'}));$('unfold').addEventListener('click',()=>send({type:'unfold'}));
 $('reset').addEventListener('click',()=>{$('draft').dataset.signature='';send({type:'reset'});});
 render();
})();
