(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.RainLedger=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const DEMO='day,rain_mm,demand_l\n1,12,30\n2,0,30\n3,0,30\n4,0,30\n5,25,30\n6,0,30\n7,0,30\n';
function parseCSV(text){
 if(typeof text!=='string'||text.length>100000)throw new RangeError('Use a CSV under 100,000 characters.');
 const rows=[];let row=[],field='',quoted=false,closed=false;
 const finishField=()=>{row.push(field);field='';closed=false;};
 const finishRow=()=>{finishField();if(row.some(s=>s.trim()!==''))rows.push(row);row=[];};
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}
  if(c==='"'){if(field||closed)throw new Error('Quote must begin a field.');quoted=true;}
  else if(c===',')finishField();
  else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;finishRow();}
  else{if(closed)throw new Error('Unexpected text after closing quote.');field+=c;}
 }
 if(quoted)throw new Error('A quoted field is not closed.');
 if(field||row.length||closed)finishRow();
 return rows;
}
function read(text){
 const cells=parseCSV(text);if(cells.length<2)throw new Error('Add a header and at least one day of observations.');
 const header=cells.shift().map(x=>x.trim()),indexes=['day','rain_mm','demand_l'].map(x=>header.indexOf(x));
 if(indexes.some(x=>x<0)||new Set(header).size!==header.length)throw new Error('CSV needs day,rain_mm,demand_l headers without duplicates.');
 if(cells.length>3650)throw new RangeError('Use at most 3,650 daily rows.');
 return cells.map((r,i)=>{const values=indexes.map(j=>r[j]);const rain=Number(values[1]),demand=Number(values[2]);
  if(r.length!==header.length||values.some(v=>v===undefined||!v.trim())||![rain,demand].every(n=>Number.isFinite(n)&&n>=0&&n<=1e9))throw new Error('Row '+(i+2)+': use a day label and finite nonnegative rain/demand (up to 1 billion).');
  return[values[0],rain,demand];});
}
function run(rows,capacity,area=10,efficiency=.8,initial=0){
 if(![capacity,area,efficiency,initial].every(Number.isFinite)||capacity<0||area<0||efficiency<0||efficiency>1||initial<0||initial>capacity)throw new RangeError('Use nonnegative capacity/area, efficiency 0–1 and initial storage within capacity.');
 if(!Array.isArray(rows)||!rows.length)throw new Error('At least one daily row required.');
 let stored=initial;
 return rows.map(([day,rain,demand])=>{if(![rain,demand].every(n=>Number.isFinite(n)&&n>=0))throw new Error('Daily amounts must be finite and nonnegative.');
  const incoming=rain*area*efficiency,spill=Math.max(0,stored+incoming-capacity),available=Math.min(capacity,stored+incoming),served=Math.min(demand,available);stored=available-served;
  return{day,incoming,served,shortage:demand-served,spill,stored};});
}
function totals(rows){return rows.reduce((a,r)=>{for(const k of ['incoming','served','shortage','spill'])a[k]+=r[k];return a;},{incoming:0,served:0,shortage:0,spill:0});}
function csv(rows){const cell=v=>/[",\n\r]/.test(String(v))?'"'+String(v).replace(/"/g,'""')+'"':String(v);return[['day','harvest_l','served_l','shortage_l','spill_l','stored_l'],...rows.map(r=>[r.day,r.incoming,r.served,r.shortage,r.spill,r.stored])].map(r=>r.map(cell).join(',')).join('\n')+'\n';}
return{DEMO,parseCSV,read,run,totals,csv};
});
