/* Presentation-only adapter. Course content and answer evaluation remain in the source lesson. */
function relativeCopy(text){return String(text||'').replace(/你坐\s*<b>南<\/b>\s*边/g,'你在牌桌下方').replace(/[东南西北](?=<\/b>)/g,s=>({'东':'下家','西':'上家','北':'对家','南':'你'}[s])).replace(/南北/g,'你和对家').replace(/东西/g,'上家和下家').replace(/北家|北边/g,'对家').replace(/东家|东边/g,'下家').replace(/西家|西边/g,'上家').replace(/南家|南边/g,'你这边');}
function surfaceTrick(played,lead,winner,showPt,opt={}){
  const P=(played||[null,null,null,null]).map(asArr);
  const points=countPoints(P.filter(Boolean).flat());
  const cells=[2,3,1,0].map(s=>{
    const cards=P[s]||[],team=s%2===0?'队友':'对手';
    const cls=[opt.pick?'pickable':'',opt.selSeat===s?'selslot':'',opt.okSeat===s?'okslot':'',opt.noSeat===s?'noslot':'',winner===s?'winning':''].join(' ');
    return `<div class="slot ${cls}" data-seat="${s}"><div class="who ${winner===s?'win':''}">${SEAT[s]}${s?` · ${opt.teamTag?(s%2===0?'我方':'对方'):team}`:''}</div>${cards.length?`<div class="cards ${cards.length>1?'ov':''}">${cards.map(c=>cardHTML(c,'played',showPt,TR)).join('')}</div>`:''}</div>`;
  }).join('');
  return `<div class="trickWrap"><div class="trick learning-table">${cells}<div class="tcenter"><span>${lead!=null?SEAT[lead]+'领出':'学习牌桌'}</span><b>本墩 ${points} 分</b></div></div></div>`;
}
trickHTML=surfaceTrick;
function fanStudyHand(){
  const cards=[...$('hand').querySelectorAll('.card')],n=cards.length;
  $('hand').style.setProperty('--fan-count',Math.max(1,n));
  cards.forEach((c,i)=>{const t=n<2?0:(i-(n-1)/2)/((n-1)/2);c.style.setProperty('--fan-i',i);c.style.setProperty('--fan-angle',(t*Math.min(18,n*2.4))+'deg');c.style.setProperty('--fan-arc',(t*t*10)+'px');});
}
function decorateStudy(){
  if(!L)return;
  const q=L.qs[qi],pickCards=q.type==='multi'||q.type==='cardpick';
  $('app').dataset.surface=['ladder','discard'].includes(q.type)||(q.type==='numpick'&&!q.cards)?'focused':'table';
  $('app').dataset.hasHand=String(pickCards||['trickpick','playset','discard','mini'].includes(q.type));
  if(pickCards&&!answered)renderRecognition(q);
  if(q.type==='discard'){renderKitty(q);if(!answered){$('task').textContent='完成 8 张底牌';$('bub').innerHTML=q.n===3?'8 张底牌中，已固定扣下 <b>5 张</b>。再从手牌选 <b>3 张</b>，留意能否断门，以及带走的分数。':`已固定扣下 <b>${8-q.n} 张</b>，还需选 <b>${q.n} 张</b>。`+relativeCopy(q.prompt);}}
  if(q.type==='numpick'&&q.cards&&!$('table').querySelector('.learning-table')){
    const board=document.createElement('div');board.className='learning-table number-table';
    const pile=$('table').querySelector('.pile'),chips=$('table').querySelector('.chips');if(pile)board.append(pile);if(chips)board.append(chips);$('table').append(board);
  }
  if(q.type==='seat'){$('table').querySelector('.seatmap')?.classList.add('learning-table');const names={2:'对家',3:'上家',1:'下家'};$('table').querySelectorAll('.seatbtn[data-s]').forEach(b=>{b.firstChild.textContent=names[b.dataset.s];});const me=$('table').querySelector('.seatbtn.me');if(me){me.firstChild.textContent='你';me.querySelector('small').textContent='自己';}}
  $('bub').innerHTML=relativeCopy($('bub').innerHTML);
  $('table').querySelectorAll('.openrow>b').forEach(n=>{n.textContent=relativeCopy(n.textContent).replace(/^北(?=\s|$)/,'对家').replace(/^东(?=\s|$)/,'下家').replace(/^西(?=\s|$)/,'上家');});
  fanStudyHand();
}
function renderRecognition(q){
  const picked=q.type==='multi'?selMulti:(sel?[sel]:[]),tr=q.noTrumpTag?'hide':TR;
  $('table').innerHTML=rowsHTML(q)+`<div class="learning-table recognition-table"><div class="recognition-caption">${picked.length?'已选 '+picked.length+' 张 · 点牌可收回':'把符合条件的牌选到桌上'}</div><div class="picked-cards pile">${q.cards.filter(c=>picked.includes(c.id)).map(c=>cardHTML(c,'pick sel',q.showPt,tr)).join('')}</div></div>`;
  $('hand').innerHTML=q.cards.filter(c=>!picked.includes(c.id)).map(c=>cardHTML(c,'pick',q.showPt,tr)).join('');
  $('app').querySelectorAll('#hand .card,#table .picked-cards .card').forEach(n=>n.onclick=()=>{
    if(answered)return;const id=n.dataset.id;
    if(q.type==='cardpick')sel=sel===id?null:id;
    else{const i=selMulti.indexOf(id);if(i<0)selMulti.push(id);else selMulti.splice(i,1);}
    $('cta').disabled=q.type==='multi'?!selMulti.length:!sel;
    renderRecognition(q);fanStudyHand();
  });
}
function renderKitty(q){
  const fixed=8-q.n,chosen=selMulti.map(id=>q.hand.find(c=>c.id===id));
  $('table').innerHTML=rowsHTML(q)+`<section class="kitty-display"><div class="kitty-heading"><strong>底牌 ${fixed+chosen.length} / 8</strong><span>${answered?'本次扣入 '+countPoints(chosen)+' 分':(chosen.length===q.n?'已选满，可点牌调整':'已固定 '+fixed+' 张，还差 '+(q.n-chosen.length)+' 张')}</span></div><div class="eight-kitty">${Array.from({length:fixed},(_,i)=>`<div class="kitty-fixed" aria-label="已固定扣下的底牌 ${i+1}"><span>✓</span><small>已扣</small></div>`).join('')}${Array.from({length:q.n},(_,i)=>chosen[i]?cardHTML(chosen[i],answered?'':'pick sel',true,TR):'<div class="kitty-empty" aria-label="待扣底牌">＋</div>').join('')}</div></section>`;
  if(answered)return;
  $('hand').innerHTML=q.hand.filter(c=>!selMulti.includes(c.id)).map(c=>cardHTML(c,'pick',q.showPt,TR)).join('');
  $('app').querySelectorAll('#hand .card,#table .eight-kitty .card').forEach(n=>n.onclick=()=>{
    if(answered)return;const id=n.dataset.id,i=selMulti.indexOf(id);
    if(i>=0)selMulti.splice(i,1);else if(selMulti.length<q.n)selMulti.push(id);
    $('cta').disabled=selMulti.length!==q.n;$('cta').textContent=selMulti.length===q.n?'确认这 8 张底牌':`已扣 ${fixed+selMulti.length} / 8 张`;
    renderKitty(q);fanStudyHand();
  });
  $('cta').textContent=selMulti.length===q.n?'确认这 8 张底牌':`已扣 ${fixed+selMulti.length} / 8 张`;
}
drawThrow=function(q){
  const pick=q.type==='forcedpick',attempt=throwCards(q),count=Math.max(...q.hands.map(h=>h.length));
  const evidence=[2,3,1].map(s=>`<div class="evidence-hand" data-seat="${s}"><span>${SEAT[s]} · ${s===2?'队友':'对手'}</span><div class="evidence-cards">${Array.from({length:count-q.hands[s].length},()=>'<div class="evidence-back" aria-label="与本题判断无关的手牌牌背"></div>').join('')}${q.hands[s].map(c=>cardHTML(c,'',false,TR)).join('')}</div></div>`).join('');
  $('table').innerHTML=`<div class="learning-table throw-table">${evidence}<div class="throw-center">${pick?'<span>甩牌失败<br>点选必须打出的牌</span>':`<div class="chips">${q.opts.map((o,i)=>`<button class="opt" data-i="${i}">${o}</button>`).join('')}</div>`}</div><div class="attempted-play"><span>你尝试甩出</span><div class="cards ov ${pick?'pickset':''}">${attempt.map(c=>cardHTML(c,pick?'played pick':'played',true,TR)).join('')}</div></div></div>`;
  if(pick){$('hand').innerHTML='';$('table').querySelectorAll('.pickset .card').forEach(n=>n.onclick=()=>{if(answered)return;const i=selMulti.indexOf(n.dataset.id);if(i<0)selMulti.push(n.dataset.id);else selMulti.splice(i,1);n.classList.toggle('sel',i<0);$('cta').disabled=!selMulti.length;});}
  else $('table').querySelectorAll('.opt').forEach(b=>b.onclick=()=>{if(answered)return;$('table').querySelectorAll('.opt').forEach(x=>x.classList.remove('sel'));b.classList.add('sel');sel=+b.dataset.i;$('cta').disabled=false;});
};
const sourceRender=render,sourceDrawPlay=drawPlay,sourceCheck=check,sourcePaintMini=paintMini,sourceFeedback=sayFeedback;
render=function(){sourceRender();decorateStudy();};
drawPlay=function(q,handOnly){sourceDrawPlay(q,handOnly);fanStudyHand();};
check=function(){sourceCheck();decorateStudy();};
paintMini=function(){sourcePaintMini();decorateStudy();};
sayFeedback=function(ok,text){sourceFeedback(ok,relativeCopy(text));};
