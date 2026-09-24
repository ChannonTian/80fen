'use strict';
const E=window.TableEngine, $=id=>document.getElementById(id);
const trump={suit:'H',rank:5};
const glyph={T:'主',H:'♥',S:'♠',D:'♦',C:'♣',X:'王'};
const names={T:'主牌',H:'红桃',S:'黑桃',D:'方块',C:'梅花',X:'王'};
let hand=[], selected=new Set(), scene='follow', activeSuit='D', completed=false, plays=[], score=55, serial=0, sheetMode='', resultCards=[];
const rank=r=>({11:'J',12:'Q',13:'K',14:'A',15:'小王',16:'大王'}[r]||String(r));
const label=c=>c.suit==='X'?rank(c.rank):names[c.suit]+rank(c.rank);
const shortLabel=c=>c.suit==='X'?rank(c.rank):glyph[c.suit]+rank(c.rank);
const color=c=>c.suit==='H'||c.suit==='X'&&c.rank===16?'red':c.suit==='D'?'blue':c.suit==='C'?'club':'';
const card=(s,r)=>({suit:s,rank:r,id:serial++});
const chosen=()=>hand.filter(c=>selected.has(c.id));
const groups=()=>['T','S','D','C'].map(s=>({s,cards:hand.filter(c=>E.effSuit(c,trump)===s).sort((a,b)=>E.ordIdx(b,trump)-E.ordIdx(a,trump)||a.id-b.id)}));
function makeHand(){return [...[16,15].map(r=>card('X',r)),card('H',5),card('S',5),card('D',5),...[14,13,11,9].map(r=>card('H',r)),...[14,13,12,11,9,6].map(r=>card('S',r)),...[10,10,8,8,7,3].map(r=>card('D',r)),...[14,13,9,4].map(r=>card('C',r))];}
function loadScene(next){
  if(!['follow','lead','bury'].includes(next))next='follow';
  scene=next;serial=0;hand=makeHand();selected.clear();completed=false;score=55;resultCards=[];
  activeSuit=scene==='follow'?'D':scene==='lead'?'S':'T';
  if(scene==='lead')hand=hand.map(c=>c.suit==='S'&&c.rank===13?{...c,rank:12}:c.suit==='S'&&c.rank===9?{...c,rank:11}:c);
  if(scene==='bury')hand.push(...[card('H',10),card('H',8),card('S',3),card('S',4),card('D',2),card('D',4),card('C',2),card('C',3)]);
  plays=scene==='follow'?[{seat:1,cards:[card('D',9),card('D',9)]},{seat:2,cards:[card('D',13),card('D',13)]},{seat:3,cards:[card('D',12),card('D',12)]}]:[];
  $('sheet').close();render();
}
function cardButton(c){
  const s=selected.has(c.id),off=scene==='follow'&&!completed&&E.effSuit(c,trump)!=='D';
  return `<button class="card ${color(c)} ${c.suit==='X'?'joker':''} ${s?'selected':''} ${off?'off-suit':''}" data-card="${c.id}" aria-label="${label(c)}，第${c.id+1}张${off?'，本墩应跟方块':''}" aria-pressed="${s}" ${completed?'disabled':''}><span class="rank">${rank(c.rank)}</span><span class="suit">${c.suit==='X'?'✦':glyph[c.suit]}</span><span class="corner" aria-hidden="true">${c.suit==='X'?'✦':glyph[c.suit]}</span></button>`;
}
function renderHand(){
  $('suitTabs').innerHTML=groups().map(({s,cards})=>`<button class="suit-tab" role="tab" id="tab-${s}" data-suit="${s}" aria-selected="${s===activeSuit}" aria-controls="handScroll" tabindex="${s===activeSuit?0:-1}" aria-label="${names[s]}，${cards.length}张"><span class="tab-suit ${s==='D'?'blue':s==='C'?'club':''}">${glyph[s]}</span><span class="tab-count">${cards.length}</span><span class="selected-dot" data-badge="${s}" hidden></span></button>`).join('');
  const cards=groups().find(g=>g.s===activeSuit).cards;
  $('hand').innerHTML=cards.map(cardButton).join('');
  $('handScroll').setAttribute('aria-labelledby','tab-'+activeSuit);
  $('handCount').textContent=hand.length;
  $('handEnd').textContent=completed?'本次演示结束，点击下方再试一手。':!cards.length?'这一门已没有手牌。':scene==='follow'&&activeSuit!=='D'?'这门先留着，这一墩需要跟方块。':`${names[activeSuit]} ${cards.length} 张 · 点牌选中，再点取消`;
  updateSelection();
}
function legality(){
  const cards=chosen();
  if(completed)return{ok:true,text:scene==='follow'?`对家收墩 +${E.countPoints(plays.flatMap(p=>p.cards))} 分 · 我方 ${score} 分`:scene==='bury'?`扣底 ${E.countPoints(resultCards)} 分 · 剩 25 张手牌`:`已领出 ${resultCards.map(shortLabel).join(' ')}`};
  if(scene==='bury')return{ok:cards.length===8,text:cards.length>8?`多选了 ${cards.length-8} 张，点已选牌取消`:`已选 ${cards.length} / 8 张`,tail:`底分 ${E.countPoints(cards)}`};
  if(!cards.length)return{ok:false,text:scene==='follow'?'请选择一对方块':'请选择单张、对子或拖拉机'};
  if(scene==='follow'){
    if(cards.length!==2)return{ok:false,text:`需出 2 张 · 已选 ${cards.length} 张`};
    if(!E.isLegalFollow(hand,E.classify(plays[0].cards,trump),cards,trump))return{ok:false,text:'有方块对子，必须跟一对方块'};
    return{ok:true,text:cards.map(shortLabel).join('　'),tail:`${E.countPoints(cards)} 分`};
  }
  const shape=E.classify(cards,trump);
  if(!shape)return{ok:false,text:'领出的牌需要属于同一门'};
  if(shape.type==='throw')return{ok:false,text:'本次演示请选单张、对子或拖拉机'};
  return{ok:true,text:cards.map(shortLabel).join(' '),tail:shape.type==='tractor'?'拖拉机':shape.type==='pair'?'对子':'单张'};
}
function updateSelection(){
  document.querySelectorAll('[data-card]').forEach(b=>{const s=selected.has(Number(b.dataset.card));b.classList.toggle('selected',s);b.setAttribute('aria-pressed',String(s));});
  document.querySelectorAll('[data-badge]').forEach(b=>{const count=chosen().filter(c=>E.effSuit(c,trump)===b.dataset.badge).length;b.hidden=!count;b.textContent=count;});
  const v=legality();
  $('selectionStatus').className='selection-status'+(selected.size?(v.ok?' good':' error'):'');
  $('selectionStatus').innerHTML=`<span class="selected-list">${v.text}</span>${v.tail?`<span class="status-tail">${v.tail}</span>`:''}`;
  $('clear').disabled=!selected.size||completed;
  $('submit').disabled=!v.ok;
  const text=completed?'再试一手':scene==='bury'?`确认扣底 ${selected.size} / 8`:selected.size?`出牌 · ${selected.size} 张`:scene==='follow'?'选 2 张牌出牌':'选牌后出牌';
  $('submitLabel').textContent=text;
  $('sheetSelection').textContent=v.ok?`已选 ${selected.size} 张${v.tail?' · '+v.tail:''}`:v.text;
  $('clearAll').disabled=!selected.size||completed;
  $('backToTable').textContent=text;
  $('backToTable').disabled=!v.ok;
}
function render(){
  $('role').textContent=scene==='bury'?'我方守庄':'我方攻分';
  $('score').textContent=scene==='bury'?'0':score;
  $('trickPoints').textContent=E.countPoints(plays.flatMap(p=>p.cards));
  $('trick').innerHTML=[{seat:1,name:'下家',note:scene==='follow'?'先出':scene==='bury'?'对手':'庄家'},{seat:2,name:'对家',note:scene==='follow'?(completed?'收墩':'暂大'):'队友'},{seat:3,name:'上家',note:scene==='follow'?'已跟':'对手'}].map(p=>{
    const cards=plays.find(x=>x.seat===p.seat)?.cards||[];
    return `<div class="opponent ${p.seat===2&&scene==='follow'?'winning':''}"><div class="opponent-label"><b>${p.name}</b><span>${p.note}</span></div><div class="played-cards">${cards.length?cards.map(c=>`<div class="mini-card ${color(c)}" aria-label="${label(c)}">${rank(c.rank)}<i>${glyph[c.suit]}</i></div>`).join(''):`<span class="empty-play">${scene==='bury'?'等待扣底':'等待你出牌'}</span>`}</div></div>`;
  }).join('');
  $('instruction').textContent=completed?(scene==='bury'?'底牌扣好了':scene==='follow'?'对家拿下这一墩':'已领出这手牌'):scene==='follow'?'跟一对方块':scene==='lead'?'你来领出':'选 8 张扣底';
  $('context').textContent=completed?'演示完成 · 可再试一手':scene==='follow'?'轮到你 · 对家暂大':scene==='lead'?'♠ J 对 + Q 对可以组成拖拉机':'33 张手牌 · 随时切换花色';
  renderHand();
}
function toggle(id){if(completed||!hand.some(c=>c.id===id))return;selected.has(id)?selected.delete(id):selected.add(id);updateSelection();}
function switchSuit(s,focus=false){if(!['T','S','D','C'].includes(s))return;activeSuit=s;renderHand();$('handScroll').scrollTop=0;if(focus)$('tab-'+s).focus();}
function submit(){
  if(completed){loadScene(scene);return;}
  if(!legality().ok)return;
  resultCards=chosen();
  if(scene!=='bury')plays.push({seat:0,cards:resultCards});
  if(scene==='follow'){const result=E.resolveTrick(plays,trump);if(result.winner%2===0)score+=result.points;}
  hand=hand.filter(c=>!selected.has(c.id));selected.clear();completed=true;$('sheet').close();render();
}
function openSheet(title,html,mode='menu'){
  sheetMode=mode;$('sheetTitle').textContent=title;$('sheetBody').innerHTML=html;$('sheetFooter').hidden=mode!=='overview';
  if(!$('sheet').open)$('sheet').showModal();$('sheetBody').scrollTop=0;updateSelection();
}
function openMenu(){
  openSheet('换个局面试试',`<p class="sheet-copy">80 分 · 竖屏交互实验<small>固定局面，验证选牌和出牌手感；尚未接入完整对局。</small></p><button class="menu-option" data-load="follow">跟对子<small>对家 K 对领先，选一对方块跟出</small></button><button class="menu-option" data-load="lead">出拖拉机<small>选中黑桃 J 对和 Q 对，整组领出</small></button><button class="menu-option" data-load="bury">拿底扣底<small>33 张牌，跨花色选择 8 张底牌</small></button><button class="menu-option" id="help">怎么操作<small>查看主牌、花色和选牌说明</small></button><a class="sheet-link" href="lab.html">打开屏幕尺寸实验室 ↗</a>`);
  $('help').onclick=()=>openSheet('怎么操作',`<p class="sheet-copy">点牌选中，再点取消。切换花色不会丢失已选牌，花色按钮右上角会显示已选数量。只有确认出牌，牌才会离手。</p><p class="sheet-copy">红桃是主花色，这局打 5。大小王、所有 5 和红桃都归在「主」里。</p><p class="sheet-copy">想看完整的 25 或 33 张牌，点「全手牌」。那里同样可以选牌和确认。短屏上手牌区可上下滚动，底部按钮始终留在原位。</p>`);
}
function openOverview(){openSheet(`全手牌 · ${hand.length} 张`,groups().map(({s,cards})=>`<h3 class="overview-title">${s==='T'?'主牌':glyph[s]+' '+names[s]}<span>${cards.length} 张</span></h3><div class="card-grid">${cards.map(cardButton).join('')}</div>`).join(''),'overview');}
$('suitTabs').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const suits=['T','S','D','C'],i=suits.indexOf(activeSuit);switchSuit(e.key==='Home'?'T':e.key==='End'?'C':suits[(i+(e.key==='ArrowRight'?1:3))%4],true);});
document.addEventListener('click',e=>{const c=e.target.closest('[data-card]');if(c)toggle(Number(c.dataset.card));const s=e.target.closest('[data-suit]');if(s)switchSuit(s.dataset.suit);const l=e.target.closest('[data-load]');if(l)loadScene(l.dataset.load);});
$('clear').onclick=$('clearAll').onclick=()=>{selected.clear();updateSelection();};
$('submit').onclick=submit;$('backToTable').onclick=submit;$('menu').onclick=openMenu;$('overview').onclick=openOverview;$('closeSheet').onclick=()=>$('sheet').close();
$('history').onclick=()=>openSheet('本墩出牌',`${completed?`<div class="success-card"><strong>${scene==='follow'?`对家收墩 · +${E.countPoints(plays.flatMap(p=>p.cards))} 分`:scene==='bury'?'扣底完成':'你已领出'}</strong>${resultCards.map(shortLabel).join('　')}</div>`:''}${plays.map(p=>`<div class="history-entry"><b>${['你','下家 · 首攻','对家','上家'][p.seat]}</b>${p.cards.map(shortLabel).join('　')}</div>`).join('')||'<p class="sheet-copy">还没有出牌。</p>'}`);
window.addEventListener('message',e=>{if(e.origin===location.origin&&e.source===parent&&e.data?.type==='scene')loadScene(e.data.scene);});
loadScene(new URLSearchParams(location.search).get('scene')||'follow');
