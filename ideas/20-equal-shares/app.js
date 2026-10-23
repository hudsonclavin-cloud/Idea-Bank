(function(){'use strict';
const M=EqualShares,$=id=>document.getElementById(id);let weights=[...M.EXAMPLE];
function name(i){return String.fromCharCode(65+i);}
function render(){
 const seats=Number($('seats').value),c=M.compare(weights,seats);$('seat-value').value=seats;$('totals').textContent=seats+' → '+(seats+1);$('table-caption').textContent='Exact division of '+seats+' seats, before the increase';
 const max=Math.max(1,...c.before.allocation,...c.after.allocation),h=weights.length*45+35;let svg='';
 for(let i=0;i<weights.length;i++){
  const y=25+i*45,a=c.before.allocation[i],b=c.after.allocation[i],loss=b<a,colour=loss?'#ae5b45':'#c49c59';
  svg+=`<g><text x="25" y="${y+13}" font-family="monospace" font-size="11" fill="#253f37">${name(i)}</text><path d="M60 ${y+3}H550" stroke="#e1e3d7"/><rect x="60" y="${y-3}" width="${a/max*465}" height="7" fill="#4d7360" opacity=".6"/><rect x="60" y="${y+8}" width="${b/max*465}" height="7" fill="${colour}"/><text x="550" y="${y+12}" font-family="monospace" font-size="11" fill="${colour}">${a} → ${b}${loss?' −1':''}</text></g>`;
 }
 $('chart').setAttribute('viewBox',`0 0 640 ${h}`);$('chart').innerHTML=svg;
 $('story').textContent=c.losers.length?`The pie grows. ${c.losers.map(i=>'Group '+name(i)).join(' and ')} ${c.losers.length===1?'loses':'lose'} a seat. Every quota rule was followed.`:'This time, adding a seat leaves every group at least as well represented.';
 $('rows').innerHTML=c.before.rows.map((r,i)=>`<tr><td>${name(i)}</td><td>${r.weight.toLocaleString('en-US')}</td><td>${M.fraction(r.numerator,r.denominator)}</td><td>${r.base}</td><td>${M.fraction(r.remainder,r.denominator)}</td><td class="${r.extra?'extra':''}">${r.extra?'+1':'—'}</td><td>${c.before.allocation[i]}</td></tr>`).join('');
 $('previous').disabled=seats===1;$('next').disabled=seats===100;
}
$('apply').addEventListener('click',()=>{try{const next=M.parseWeights($('weights').value);if(next.length>12)throw new Error('Use up to 12 groups in the browser view.');weights=next;$('error').textContent='';$('scan-result').textContent='Compare each total with the next one.';render();}catch(e){$('error').textContent=e.message;}});
$('seats').addEventListener('input',render);
for(const [id,d] of [['previous',-1],['next',1]])$(id).addEventListener('click',()=>{$('seats').value=Math.max(1,Math.min(100,Number($('seats').value)+d));render();});
$('witness').addEventListener('click',()=>{weights=[...M.EXAMPLE];$('weights').value=weights.join(', ');$('seats').value=25;$('error').textContent='';$('scan-result').textContent='Compare each total with the next one.';render();});
$('scan').addEventListener('click',()=>{const found=M.scan(weights,1,100);$('scan-result').textContent=found.length?found.map(r=>`${r.seats}→${r.seats+1}: ${r.losers.map(name).join(', ')} lose`).join(' · '):'No losses between totals 1 and 100.';});render();
})();
