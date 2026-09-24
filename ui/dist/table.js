'use strict';
const E=window.TableEngine, $=id=>document.getElementById(id);
const trump={suit:'H',rank:5}, glyph={H:'♥',S:'♠',D:'♦',C:'♣',X:'王'}, names={H:'红桃',S:'黑桃',D:'方块',C:'梅花',X:'王'};
let hand=[], selected=new Set(), scene='follow', completed=false, plays=[], lastPlays=[], score=55, serial=0, message='', moved=false;
const rank=r=>({11:'J',12:'Q',13:'K',14:'A',15:'小王',16:'大王'}[r]||String(r));
const label=c=>c.suit==='X'?rank(c.rank):names[c.suit]+rank(c.rank);
const color=c=>c.suit==='H'||c.suit==='X'&&c.rank===16?'red':c.suit==='D'?'blue':c.suit==='C'?'club':'';
const card=(s,r)=>({suit:s,rank:r,id:serial++});
function makeHand(){
 return [...[16,15].map(r=>card('X',r)),card('H',5),card('S',5),card('D',5),...[14,13,11,9].map(r=>card('H',r)),...[14,13,12,11,9,6].map(r=>card('S',r)),...[10,10,8,8,7,3].map(r=>card('D',r)),...[14,13,9,4].map(r=>card('C',r))];
}
function loadScene(next){
 if(!['follow','lead','bury'].includes(next))return;
 scene=next;serial=0;hand=makeHand();selected.clear();completed=false;score=55;message='';lastPlays=[];
 if(scene==='lead') { hand=hand.map(c=>c.suit==='S'&&c.rank===13?{...c,rank:12}:c.suit==='S'&&c.rank===9?{...c,rank:11}:c); }
 if(scene==='bury')hand.push(...[card('H',10),card('H',8),card('S',3),card('S',4),card('D',2),card('D',4),card('C',2),card('C',3)]);
 plays=scene==='follow'?[{seat:1,cards:[card('D',9),card('D',9)]},{seat:2,cards:[card('D',13),card('D',13)]},{seat:3,cards:[card('D',12),card('D',12)]}]:[];
 $('sheet').close();render();
}
function tableCards(cards){return cards.map(c=>`<div class="table-card ${color(c)}" aria-label="${label(c)}"><span>${rank(c.rank)}</span><span class="suit">${glyph[c.suit]}</span></div>`).join('');}
function cardButton(c){
 const s=selected.has(c.id),off=scene==='follow'&&!completed&&E.effSuit(c,trump)!=='D';
 return `<button class="card ${color(c)} ${c.suit==='X'?'joker':''} ${s?'selected':''} ${off?'off-suit':''}" data-card="${c.id}" aria-label="${label(c)}，第${c.id+1}张${s?'，已选':''}" aria-pressed="${s}"><span class="rank">${c.suit==='X'?(c.rank===16?'大王':'小王'):rank(c.rank)}</span><span class="suit">${c.suit==='X'?'JOKER':glyph[c.suit]}</span><span class="corner" aria-hidden="true">${c.suit==='X'?'✦':glyph[c.suit]}</span></button>`;
}
function groups(){return ['T','S','D','C'].map(s=>({s,cards:hand.filter(c=>E.effSuit(c,trump)===s)}));}
function renderHand(){
 const scrolls=new Map([...document.querySelectorAll('.rail')].map(n=>[n.dataset.suit,n.scrollLeft]));
 $('hand').innerHTML=groups().map(({s,cards})=>`<div class="suit-row"><div class="group-label ${s==='T'?'trumps':''}"><b>${s==='T'?'主':glyph[s]}</b><small>${cards.length}</small></div><div class="rail" data-suit="${s}" tabindex="0" role="group" aria-label="${s==='T'?'主牌':names[s]} ${cards.length}张，长门可左右滑动">${cards.length?cards.map(cardButton).join(''):'<span style="font-size:12px;color:#789381">已断门</span>'}</div></div>`).join('');
 document.querySelectorAll('.rail').forEach(n=>n.scrollLeft=scrolls.get(n.dataset.suit)||0);
 $('handCount').textContent=hand.length;
}
function chosen(){return hand.filter(c=>selected.has(c.id));}
function legality(){
 const cards=chosen();if(completed)return {ok:true,text:'继续尝试其他局面'};
 if(scene==='bury')return {ok:cards.length===8,text:cards.length>8?'多选了 '+(cards.length-8)+' 张，点牌取消':`已选 ${cards.length} / 8 张 · 底分 ${E.countPoints(cards)}`};
 if(!cards.length)return {ok:false,text:scene==='follow'?'点选手牌，确认后出牌':'可试试选中 ♠J♠J 和 ♠Q♠Q'};
 if(scene==='follow'){
  if(cards.length!==2)return {ok:false,text:`需要出 2 张，当前选了 ${cards.length} 张`};
  const legal=E.isLegalFollow(hand,E.classify(plays[0].cards,trump),cards,trump);
  return {ok:legal,text:legal?`已选 ${cards.map(label).join(' ')} · ${E.countPoints(cards)} 分`:'必须跟方块，有对子时必须出对子'};
 }
 const shape=E.classify(cards,trump);
 if(!shape)return {ok:false,text:'领出的牌必须属于同一有效花色'};
 if(shape.type==='throw')return {ok:false,text:'本局面先试单张、对子或拖拉机'};
 return {ok:true,text:`${shape.type==='tractor'?'拖拉机':shape.type==='pair'?'对子':'单张'} · ${cards.length} 张 · ${E.countPoints(cards)} 分`};
}
function updateSelection(){
 document.querySelectorAll('[data-card]').forEach(b=>{const s=selected.has(Number(b.dataset.card));b.classList.toggle('selected',s);b.setAttribute('aria-pressed',String(s));const c=hand.find(c=>c.id===Number(b.dataset.card));if(c)b.setAttribute('aria-label',label(c)+'，第'+(c.id+1)+'张'+(s?'，已选':''));});
 const v=legality();$('selectionLine').textContent=message||v.text;$('selectionLine').className='selection-line'+(selected.size?(v.ok?' good':' error'):'');
 $('clear').disabled=!selected.size||completed;$('submit').disabled=!v.ok;
 $('submitLabel').textContent=completed?'再试一个局面':scene==='bury'?`确认扣底 ${selected.size}/8`:v.ok?`出牌 · ${selected.size} 张`:scene==='follow'?'选择 2 张牌':'选牌后出牌';
 const badge=$('sheetSelection');if(badge)badge.textContent=`已选 ${selected.size} 张`;
}
function render(){
 document.querySelector('.east .avatar').classList.toggle('dealer',scene!=='bury');
 document.querySelector('.east .avatar i').hidden=scene==='bury';
 $('role').textContent=scene==='bury'?'我方守庄':'我方攻分';$('score').textContent=scene==='bury'?'0':score;$('scoreFill').style.width=(scene==='bury'?0:Math.min(100,score/80*100))+'%';
 $('scoreGoal').innerHTML=scene==='bury'?'守在<b>80 分</b>以下':score>=80?'我方<b>已上台</b>继续争分':`再拿<b>${80-score} 分</b>上台`;
 for(const [p,id] of [[1,'eastCards'],[2,'northCards'],[3,'westCards'],[0,'southCards']])$(id).innerHTML=tableCards(plays.find(x=>x.seat===p)?.cards||[]);
 $('northCount').textContent=scene==='follow'?'23 张':'25 张';$('westCount').textContent=scene==='follow'?'23 张':'25 张';$('eastCount').textContent=scene==='follow'?'23 张 · 首攻':'25 张';
 $('winnerTag').hidden=scene!=='follow';$('winnerTag').textContent=completed?'收墩':'暂大';
 $('trickPoints').innerHTML=`<span>本墩</span><b>${E.countPoints(plays.flatMap(p=>p.cards))}</b><span>分</span>`;
 $('turnBadge').textContent=completed?(scene==='bury'?'扣底完成':scene==='lead'?'已领出':'对家收墩'):scene==='bury'?'你是庄家':'轮到你了';
 $('instruction').textContent=completed?(scene==='bury'?'8 张底牌已扣好':scene==='lead'?'拖拉机与对子，一次整组出':'对家拿下这一墩'):scene==='bury'?'选 8 张牌，放入底牌':scene==='lead'?'轮到你领出':'跟出一对方块';
 $('context').textContent=completed?(scene==='bury'?'手牌回到 25 张 · 可重置继续试':scene==='lead'?'原型停在出牌结果 · 可重置继续试':`本墩得 ${E.countPoints(plays.flatMap(p=>p.cards))} 分 · 我方累计 ${score} 分`):scene==='bury'?'各门可左右滑动 · 选好后统一确认':scene==='lead'?'试试黑桃 J 对 + Q 对，组成拖拉机':'对家 K 对暂大 · 本墩你最后出';
 $('decisionIcon').textContent=scene==='bury'?'▧':scene==='lead'?'♠':'♦';renderHand();updateSelection();
}
function toggle(id){if(completed)return;message='';selected.has(id)?selected.delete(id):selected.add(id);updateSelection();}
document.addEventListener('pointerdown',e=>{if(!e.target.closest('[data-card]'))return;moved=false;const x=e.clientX,y=e.clientY;const move=ev=>{if(Math.hypot(ev.clientX-x,ev.clientY-y)>9)moved=true;};const end=()=>{document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',end);document.removeEventListener('pointercancel',end);};document.addEventListener('pointermove',move,{passive:true});document.addEventListener('pointerup',end,{once:true});document.addEventListener('pointercancel',end,{once:true});});
document.addEventListener('click',e=>{const b=e.target.closest('[data-card]');if(b){if(!moved||e.detail===0)toggle(Number(b.dataset.card));moved=false;}});
$('clear').onclick=()=>{selected.clear();message='';updateSelection();};
$('submit').onclick=()=>{
 if(completed){openMenu();return;}if(!legality().ok)return;
 const cards=chosen();lastPlays=structuredClone(plays);
 if(scene==='bury'){message=`扣底完成 · 共 ${E.countPoints(cards)} 分`;}else{
  plays.push({seat:0,cards});lastPlays=structuredClone(plays);
  if(scene==='follow'){const result=E.resolveTrick(plays,trump);if(result.winner%2===0)score+=result.points;}
 }
 hand=hand.filter(c=>!selected.has(c.id));selected.clear();completed=true;render();$('southCards').classList.add('new-play');
};
function openSheet(title,html){$('sheetTitle').textContent=title;$('sheetBody').innerHTML=html;if(!$('sheet').open)$('sheet').showModal();}
function openMenu(){openSheet('换一个局面',`<p class="sheet-copy">竖屏牌桌 · 交互原型<small>固定局面，用来试手感；尚未接入完整对局。</small></p><button class="menu-option" data-load="follow">跟对子<small>25 张手牌 · 给对家送分</small></button><button class="menu-option" data-load="lead">出拖拉机<small>整组选择 · 统一确认</small></button><button class="menu-option" data-load="bury">拿底扣底<small>33 张手牌 · 任意选 8 张</small></button>`);}
$('menu').onclick=openMenu;$('reset').onclick=()=>loadScene(scene);$('closeSheet').onclick=()=>$('sheet').close();
$('sheet').addEventListener('click',e=>{if(e.target===$('sheet')){const r=$('sheet').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('sheet').close();}const b=e.target.closest('[data-load]');if(b)loadScene(b.dataset.load);});
$('help').onclick=()=>openSheet('这一手怎么出',`<div class="sheet-copy">${scene==='bury'?'拿底后有 33 张牌。选择任意 8 张扣底，点确认后才会移走；点已选牌可以取消。底牌可以含分，但最后一墩被攻方拿下时，会按规则计入攻分。':scene==='lead'?'这局打 5，红桃为主。王、所有 5 和红桃都算主牌。你可以领出一张、对子或同门连续的对子。试试 ♠J♠J + ♠Q♠Q。此原型暂不演示甩牌裁决。':'下家领出 ♦9♦9。你手里有方块对子，必须跟一对方块。对家 ♦K♦K 已领先，你是末手，♦10♦10 的 20 分可以随这一墩一起交给对家。'}<small>点击只选牌，不会自动出牌。所有动作都在底部确认。</small></div>`);
$('history').onclick=()=>openSheet(lastPlays.length?'刚才这一墩':'本墩出牌',`<div class="sheet-copy">${(lastPlays.length?lastPlays:plays).map(p=>`<p>${['你','下家','对家','上家'][p.seat]}：${p.cards.map(label).join(' ')}</p>`).join('')||'当前还没有出牌。'}<small>原型只记录当前演示局面。</small></div>`);
$('expand').onclick=()=>{openSheet('展开手牌',groups().map(({s,cards})=>`<div class="sheet-subtitle">${s==='T'?'主牌':names[s]} · ${cards.length} 张</div><div class="all-grid">${cards.map(cardButton).join('')}</div>`).join('')+'<div class="sheet-confirm"><span id="sheetSelection">已选 '+selected.size+' 张</span><button id="backToTable">回到牌桌</button></div>');$('backToTable').onclick=()=>$('sheet').close();};
window.addEventListener('message',e=>{if(e.origin===location.origin&&e.source===parent&&e.data?.type==='scene')loadScene(e.data.scene);});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('sheet').open){selected.clear();updateSelection();}if(e.key==='Enter'&&!$('sheet').open&&e.target===document.body&&legality().ok)$('submit').click();});
loadScene(new URLSearchParams(location.search).get('scene')||'follow');
