(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MoireMail=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const PALETTES={oxide:{a:'#214951',b:'#b55541',paper:'#f8f0dc',name:'Iron + oxide'},indigo:{a:'#343b69',b:'#bd913d',paper:'#f7f1de',name:'Indigo + gold'},ink:{a:'#263d3c',b:'#263d3c',paper:'#f3efdf',name:'One ink'}};
function wavelength(spacing,angle){if(!Number.isFinite(spacing)||spacing<=0||!Number.isFinite(angle)||Math.abs(angle)>90)throw new RangeError('Positive finite spacing; angle between -90 and 90 degrees required.');return angle===0?Infinity:spacing/(2*Math.sin(Math.abs(angle)*Math.PI/360));}
function normalize(angle){if(!Number.isFinite(angle))throw new RangeError('Finite angle required.');return((angle+180)%360+360)%360-180;}
function dragAngle(startAngle,pointerStart,pointerNow){return Math.max(-45,Math.min(45,startAngle+normalize(pointerNow-pointerStart)));}
function svg({spacing=9,angle=4,palette='oxide'}={}){
 const beat=wavelength(spacing,angle),p=PALETTES[palette];if(!p)throw new RangeError('Unknown ink palette.');if(spacing<3||spacing>40)throw new RangeError('Spacing must be 3..40 units.');
 const beatLabel=Number.isFinite(beat)?beat.toFixed(1)+' units':'infinite / aligned';
 let lines='';for(let y=-900;y<=1500;y+=spacing)lines+=`<path d="M-900 ${y.toFixed(3)}H1800"/>`;
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 600" role="img" aria-labelledby="printTitle printDesc"><title id="printTitle">Moire Mail — ${angle.toFixed(1)} degrees</title><desc id="printDesc">Two clipped families of straight lines create a large interference pattern. Spacing ${spacing}; ideal beat ${beatLabel}.</desc><defs><clipPath id="printField"><rect x="35" y="83" width="830" height="434"/></clipPath></defs><rect width="900" height="600" fill="${p.paper}"/><g fill="#294541" font-family="monospace"><text x="35" y="39" font-size="13" letter-spacing="2">MOIRE MAIL / A POSTCARD IN TWO INKS</text><text x="865" y="39" text-anchor="end" font-size="11">NO. 012</text></g><path d="M35 59H865M35 540H865" stroke="#a3a997" stroke-width=".7"/><g clip-path="url(#printField)" fill="none" stroke-width="1.2"><g stroke="${p.a}">${lines}</g><g stroke="${p.b}" transform="rotate(${angle} 450 300)">${lines}</g></g><g fill="#294541" font-family="monospace" font-size="11"><text x="35" y="570">${angle.toFixed(1)}° / ${spacing} UNITS BETWEEN LINES</text><text x="865" y="570" text-anchor="end">IDEAL BEAT: ${beatLabel}</text></g></svg>`;
}
return{PALETTES,wavelength,normalize,dragAngle,svg};
});
