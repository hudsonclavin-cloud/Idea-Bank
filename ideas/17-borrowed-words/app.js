(function(){'use strict';
const M=BorrowedWords,$=id=>document.getElementById(id),examples={
 light:{source:'we carry the dark until we find a little light.\n\nthere is enough room in the night for all the things we have not learned to say.',target:'we find light'},
 sea:{source:'the harbour holds its breath. somewhere beyond the ropes, a small boat remembers the sea.\n\nwe wait beside the water until the morning lets us go.',target:'the sea lets us go'},
 quiet:{source:'keep the quiet things: a cup cooling by the window, the slow work of rain, a door left open.\n\nsome days the smallest kindness is enough.',target:'keep a window open'}
};let current=null,source='',revealed=false;
function setRevealed(value){revealed=value;$('blackout').classList.toggle('revealed',value);$('reveal').setAttribute('aria-pressed',String(value));$('reveal').textContent=value?'Lay the ink back down':'Lift the ink';}
function render(){
 try{
  source=$('source').value;current=M.find(source,$('target').value);$('error').textContent='';$('blackout').replaceChildren();
  for(const part of M.segments(source,current)){const span=document.createElement('span');span.textContent=part.text;if(part.kind!=='space')span.className=part.kind;$('blackout').append(span);}
  $('poem').textContent=current.chosen.map(t=>t.word).join(' ');$('window').textContent=current.chosen.length+' KEPT / '+current.window.length+' WORD WINDOW';$('spans').replaceChildren();
  for(const token of current.chosen){const li=document.createElement('li');li.textContent=token.word+' — '+token.start+':'+token.end;$('spans').append(li);}
  $('reveal').disabled=false;$('download').disabled=false;setRevealed(false);
 }catch(e){current=null;$('error').textContent=e.message;$('window').textContent='WAITING FOR A THREAD';$('blackout').replaceChildren();$('poem').textContent='No thread found yet.';$('spans').replaceChildren();$('reveal').disabled=true;$('download').disabled=true;}
}
function sample(name){const item=examples[name];$('source').value=item.source;$('target').value=item.target;render();}
$('find').addEventListener('click',render);$('target').addEventListener('keydown',e=>{if(e.key==='Enter')render();});
for(const button of document.querySelectorAll('[data-sample]'))button.addEventListener('click',()=>sample(button.dataset.sample));
$('reveal').addEventListener('click',()=>setRevealed(!revealed));
$('download').addEventListener('click',()=>{if(!current)return;const text=M.blackout(source,current)+'\n\n'+current.chosen.map(t=>t.word).join(' ')+'\n';const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='borrowed-words.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});sample('light');
})();
