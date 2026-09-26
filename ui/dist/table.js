'use strict';
const E=window.TableEngine,F=window.FanUI,$=id=>document.getElementById(id);
const trump={suit:'H',rank:5},glyph={T:'主',H:'♥',S:'♠',D:'♦',C:'♣',X:'✦'},names={T:'主牌',H:'红桃',S:'黑桃',D:'方块',C:'梅花',X:'王'};
let hand=[],selected=new Set(),scene='follow',completed=false,plays=[],score=55,serial=0,resultCards=[],kittyCards=[],declaration=null,descending=true;
let layoutMode=['auto','wide','portrait'].includes(new URLSearchParams(location.search).get('layout'))?new URLSearchParams(location.search).get('layout'):'auto';
let wideLayout=false;
let layouts=[],rowCards=[],gesture=null,toastTimer,framePending=false,sheetMode='';
const card=(s,r)=>({suit:s,rank:r,id:serial++});
const rank=r=>({11:'J',12:'Q',13:'K',14:'A',15:'小王',16:'大王'}[r]||String(r));
const label=c=>c.suit==='X'?rank(c.rank):names[c.suit]+rank(c.rank);
const shortLabel=c=>c.suit==='X'?rank(c.rank):glyph[c.suit]+rank(c.rank);
const color=c=>'suit-'+c.suit+(c.suit==='X'&&c.rank===16?' red':'');
const chosen=()=>hand.filter(c=>selected.has(c.id));
const isBidding=()=>scene==='declare'||scene==='counter';
const groups=()=>['T','S','H','D','C'].filter(s=>s!==trump.suit).map(s=>({s,cards:hand.filter(c=>E.effSuit(c,trump)===s).sort((a,b)=>(descending?1:-1)*(E.ordIdx(b,trump)-E.ordIdx(a,trump))||a.suit.localeCompare(b.suit)||a.id-b.id)}));
function makeHand(){return [...[16,15].map(r=>card('X',r)),card('H',5),card('S',5),card('D',5),...[14,13,11,9].map(r=>card('H',r)),...[14,13,12,11,9,6].map(r=>card('S',r)),...[10,10,8,8,7,3].map(r=>card('D',r)),...[14,13,9,4].map(r=>card('C',r))];}
function loadScene(next){
  if(!['follow','lead','bury','declare','counter'].includes(next))next='follow';
  stopGesture(true);scene=next;serial=0;hand=makeHand();selected.clear();completed=false;score=55;resultCards=[];kittyCards=[];descending=true;declaration=null;trump.suit='H';
  if(scene==='lead')hand=hand.map(c=>c.suit==='S'&&c.rank===13?{...c,rank:12}:c.suit==='S'&&c.rank===9?{...c,rank:11}:c);
  if(scene==='bury'){
    kittyCards=[card('H',10),card('H',8),card('S',3),card('S',4),card('D',2),card('D',4),card('C',2),card('C',3)];
    hand.push(...kittyCards);
  }
  if(isBidding()){
    trump.suit=null;
    hand=hand.map(c=>c.suit==='S'&&c.rank===6?{...c,suit:'H',rank:5}:c.suit==='C'&&c.rank===4?{...c,suit:'S',rank:5}:c.suit==='X'&&c.rank===16?{...c,rank:15}:c);
    if(scene==='counter'){declaration={seat:1,suit:'S',strength:1};trump.suit='S';}
  }
  plays=scene==='follow'?[{seat:1,cards:[card('D',9),card('D',9)]},{seat:2,cards:[card('D',13),card('D',13)]},{seat:3,cards:[card('D',12),card('D',12)]}]:[];
  $('pan').value='50';$('sheet').close();render();
}
function face(c){
  return `<span class="index${c.rank===10?' two':''}"><span class="rank-value">${c.suit==='X'?(c.rank===16?'大':'小'):rank(c.rank)}</span><i>${c.suit==='X'?'王':glyph[c.suit]}</i></span><span class="bottom-index" aria-hidden="true">${c.suit==='X'?'✦':rank(c.rank)+'<br>'+glyph[c.suit]}</span>${E.cardPoints(c)?`<span class="point-mark">${E.cardPoints(c)}</span>`:''}`;
}
function cardMarkup(c,classes='',attributes=''){
  return `<button class="playing-card ${color(c)} ${c.suit==='X'?'joker':''} ${classes} ${selected.has(c.id)?'selected':''}" data-card="${c.id}" aria-label="${label(c)}，第${c.id+1}张" aria-pressed="${selected.has(c.id)}" ${completed?'disabled':''} ${attributes}>${face(c)}</button>`;
}
function pile(cards){return `<div class="played-hand" style="width:calc(var(--table-card-w,58px) + ${Math.max(0,cards.length-1)} * var(--pile-step,23px))">${cards.map((c,i)=>`<div class="playing-card ${color(c)} ${c.suit==='X'?'joker':''}" style="--i:${i}" aria-label="${label(c)}">${face(c)}</div>`).join('')}</div>`;}
function syncLayout(){
  const width=window.innerWidth||390,height=window.innerHeight||844;
  wideLayout=F.isWide(width,height,layoutMode);
  $('game').classList.toggle('wide',wideLayout);
  $('game').classList.toggle('compact',wideLayout&&height<=520);
  document.body.classList.toggle('wide-view',wideLayout);
  return{width,height};
}
function setLayout(mode){
  if(!['auto','wide','portrait'].includes(mode))return;
  stopGesture(true);layoutMode=mode;
  const url=new URL(location.href);url.searchParams.set('layout',mode);history.replaceState(null,'',url);
  $('sheet').close();renderHand();
  if(mode==='wide'&&!wideLayout)toast('横过手机，即可展开横屏牌桌');
}
function renderHand(){
  const viewport=syncLayout(),width=$('fanViewport').clientWidth||390,height=$('handArea').clientHeight||260;
  const sorted=groups().flatMap(g=>g.cards);
  if(wideLayout){
    const plan=F.widePlan(sorted,width,viewport.height);rowCards=plan.rows;layouts=plan.layouts;
    $('game').style.setProperty('--hand-height',plan.height+'px');
    $('game').classList.toggle('two-fans',plan.twoRows);
  }else{
    rowCards=F.split(sorted);layouts=rowCards.map((cards,row)=>F.layout(cards,width,height,row));
  }
  $('fan0').setAttribute('aria-label',rowCards[1].length?'上层手牌':'扇形手牌');
  rowCards.forEach((cards,row)=>{
    const l=layouts[row];$('fan'+row).style.width=l.width+'px';
    $('fan'+row).innerHTML=cards.map((c,i)=>{const p=l.cards[i];const off=scene==='follow'&&!completed&&E.effSuit(c,trump)!=='D';return cardMarkup(c,'hand-card'+(off?' off-suit':''),`data-row="${row}" data-index="${i}" style="left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;--angle:${p.angle}deg;z-index:${row*40+i};transform:translateY(${selected.has(c.id)?-24:0}px) rotate(${p.angle}deg)"`);}).join('');
  });
  $('handCount').textContent=hand.length+' 张';
  const overflow=layouts.some(l=>l.width>width+1);
  $('handWheel').classList.toggle('no-overflow',!overflow);
  $('pan').disabled=!overflow;$('panHint').textContent=overflow?'左右拨牌':'已全部展开';
  panHand();updateSelection();
}
function panHand(){const width=$('fanViewport').clientWidth||390;layouts.forEach((l,i)=>$('fan'+i).style.transform=`translateX(${-Math.max(0,l.width-width)*Number($('pan').value)/100}px)`);}
function legality(){
  const cards=chosen();
  if(completed)return{ok:true,text:scene==='bury'?`扣底完成 · ${E.countPoints(kittyCards)} 分`:scene==='follow'?`对家收墩 · +${E.countPoints(plays.flatMap(p=>p.cards))} 分`:'这手牌已领出'};
  if(isBidding())return{ok:false,text:declaration?`${declaration.seat===0?'你':'下家'}${declaration.strength===2?'加固':'亮主'} ${glyph[declaration.suit]||'无主'} · 打 5`:'发牌阶段 · 可以亮主'};
  if(scene==='bury')return{ok:cards.length===8,text:cards.length>8?`多选 ${cards.length-8} 张，请取消`:`选 ${cards.length} / 8 张 · 底分 ${E.countPoints(cards)}`};
  if(!cards.length)return{ok:false,text:scene==='follow'?'跟出一对方块':'轮到你领出'};
  if(scene==='follow'){
    if(cards.length!==2)return{ok:false,text:`需跟 2 张 · 已选 ${cards.length} 张`};
    if(!E.isLegalFollow(hand,E.classify(plays[0].cards,trump),cards,trump))return{ok:false,text:'有方块对子，必须跟对子'};
  }else{
    const shape=E.classify(cards,trump);
    if(!shape||shape.type==='throw')return{ok:false,text:'请选择同门单张、对子或拖拉机'};
  }
  return{ok:true,text:cards.length<=4?cards.map(shortLabel).join(' '):`已选 ${cards.length} 张 · ${E.countPoints(cards)} 分`};
}
function updateSelection(){
  document.querySelectorAll('[data-card]').forEach(b=>{
    const id=Number(b.dataset.card),s=selected.has(id);b.classList.toggle('selected',s);b.setAttribute('aria-pressed',String(s));
    if(b.classList.contains('hand-card'))b.style.transform=`translateY(${s?-24:0}px) rotate(${b.style.getPropertyValue('--angle')})`;
  });
  const v=legality();$('instruction').textContent=v.text;
  $('context').textContent=layoutMode==='wide'&&!wideLayout?'横过手机或加宽窗口，展开横屏':completed?'点击「再试一手」重新开始':isBidding()?'':scene==='bury'?'点选后在底部埋底':selected.size?'拖到牌桌，松手出牌':'点牌选中 · 按住滑动可看清';
  $('tapPlay').hidden=isBidding()||scene==='bury'||!selected.size&&!completed;
  $('tapPlay').disabled=!v.ok;$('tapPlay').textContent=completed?'再试一手':`出牌 ${selected.size} 张`;
  $('clear').disabled=$('clearAll').disabled=!selected.size||completed;
  $('buryConfirm').disabled=!v.ok;$('buryConfirm').textContent=completed?'再试扣底':`埋底 ${selected.size}/8`;
  $('sheetSelection').textContent=v.text;$('sheetSubmit').disabled=!v.ok;
  $('sheetSubmit').textContent=completed?'再试一手':scene==='bury'?`埋底 ${selected.size}/8`:`出牌 ${selected.size} 张`;
}
function render(){
  $('arena').classList.toggle('finished',completed);
  $('game').classList.toggle('is-bidding',isBidding());
  $('trumpStatus').innerHTML=isBidding()&&!declaration?'待亮主 <em>打 5</em>':`<i class="${color({suit:trump.suit,rank:5})}">${glyph[trump.suit]||'♛'}</i>${trump.suit?names[trump.suit]+'主':'无主'}<em>打 5</em>`;
  $('role').textContent=scene==='bury'?'我方守庄':isBidding()?'发牌阶段':'我方攻分';
  const points=scene==='bury'||isBidding()?0:score;
  $('score').textContent=points;$('scoreFill').style.width=Math.min(100,points/80*100)+'%';$('scoreTrack').setAttribute('aria-valuenow',String(Math.min(80,points)));
  const winner=plays.length?E.resolveTrick(plays,trump).winner:-1;
  $('players').innerHTML=[{seat:2,pos:'north',name:'对家'},{seat:3,pos:'west',name:'上家'},{seat:1,pos:'east',name:'下家'}].map(p=>{
    const cards=plays.find(x=>x.seat===p.seat)?.cards||[],win=winner===p.seat;
    return `<div class="player ${p.pos} ${win?'winner':''}"><div class="player-label"><i class="seat-dot"></i><span>${p.name}</span><small>${scene==='follow'?'23':'25'} 张${p.seat===1&&!isBidding()&&scene!=='bury'?' · 庄':''}</small></div>${cards.length?pile(cards):'<div class="empty-opponent" aria-label="未出牌"></div>'}${win?`<span class="winner-label">${completed?'收墩':'暂大'}</span>`:''}</div>`;
  }).join('');
  $('tablePoints').hidden=isBidding()||scene==='bury';$('trickPoints').textContent=E.countPoints(plays.flatMap(p=>p.cards));
  $('myPlay').innerHTML=completed&&scene!=='bury'?pile(resultCards):'';
  $('declarationPile').innerHTML=isBidding()&&declaration?pile(declarationCards())+`<p>${declaration.seat===0?'你':'下家'}已${declaration.strength===2?'亮对':'亮主'}</p>`:scene==='bury'?'<p>庄家拿底 · 选 8 张扣下</p>':'';
  $('bidActions').hidden=!isBidding();$('tableEdge').classList.toggle('bidding',isBidding());
  $('declare').disabled=!!declaration;$('reinforce').disabled=!E.canReinforce2(declaration,0,hand,5,false);$('counter').disabled=!canCounter();
  $('kitty').disabled=scene!=='bury';$('buryConfirm').hidden=scene!=='bury';$('sort').hidden=$('expand').hidden=scene==='bury';$('sort').textContent='理牌 '+(descending?'↓':'↑');
  renderHand();
}
function declarationCards(){
  if(!declaration)return[];
  if(declaration.seat!==0)return[{suit:declaration.suit,rank:5,id:-1}];
  return hand.filter(c=>declaration.suit?c.suit===declaration.suit&&c.rank===5:c.rank===(declaration.strength===4?16:15)).slice(0,declaration.strength===1?1:2);
}
function canCounter(){const cards=hand.filter(c=>c.suit==='H'&&c.rank===5).slice(0,2),next=E.declarationOf(cards,5);return !!next&&!!declaration&&E.canOverride(declaration,next,0);}
function bid(action){
  if(!isBidding())return;
  let cards=hand.filter(c=>c.suit==='H'&&c.rank===5).slice(0,action==='declare'?1:2),next=E.declarationOf(cards,5);
  if(!next)return;
  if(action==='declare'&&declaration||action==='reinforce'&&!E.canReinforce2(declaration,0,hand,5,false)||action==='counter'&&!canCounter())return;
  declaration={...next,seat:0};trump.suit=next.suit;selected.clear();render();toast(action==='reinforce'?'♥ 5 对加固成功':action==='counter'?'反主成功 · 红桃为主':'已亮 ♥ 5，可以加固');
}
function toggle(id){if(completed||!hand.some(c=>c.id===id))return;selected.has(id)?selected.delete(id):selected.add(id);updateSelection();}
function submit(){
  if(completed){loadScene(scene);return;}
  if(!legality().ok||isBidding())return false;
  resultCards=chosen();
  if(scene==='bury')kittyCards=[...resultCards];
  else plays.push({seat:0,cards:[...resultCards]});
  if(scene==='follow'){const result=E.resolveTrick(plays,trump);if(result.winner%2===0)score+=result.points;}
  hand=hand.filter(c=>!selected.has(c.id));selected.clear();completed=true;$('sheet').close();render();
  $('myPlay').classList.remove('pulse');requestAnimationFrame(()=>$('myPlay').classList.add('pulse'));
  toast(scene==='bury'?'8 张底牌已扣好':scene==='follow'?`对家收墩，拿下 ${E.countPoints(plays.flatMap(p=>p.cards))} 分`:'已领出');return true;
}
function toast(text){clearTimeout(toastTimer);$('liveMessage').textContent=text;$('liveMessage').classList.add('visible');toastTimer=setTimeout(()=>$('liveMessage').classList.remove('visible'),2200);}
function previewCard(id,x,y){
  const c=hand.find(c=>c.id===id);if(!c)return;
  $('loupe').innerHTML=`<div class="playing-card ${color(c)} ${c.suit==='X'?'joker':''}">${face(c)}</div>`;
  const game=$('game').getBoundingClientRect();$('loupe').style.left=Math.max(game.left+8,Math.min(game.right-99,x-45))+'px';$('loupe').style.top=Math.max(80,y-158)+'px';$('loupe').hidden=false;
  document.querySelectorAll('.hand-card.peek').forEach(b=>b.classList.remove('peek'));
  document.querySelector(`.hand-card[data-card="${id}"]`)?.classList.add('peek');
}
function scrubId(x,row){
  const l=layouts[row],cards=rowCards[row];if(!cards?.length)return null;
  const rect=$('fanViewport').getBoundingClientRect(),offset=Math.max(0,l.width-rect.width)*Number($('pan').value)/100;
  const local=x-rect.left+offset,step=l.cards.length>1?l.cards[1].x-l.cards[0].x:0;
  const index=step?Math.max(0,Math.min(cards.length-1,Math.floor((local-l.cards[0].x)/step))):0;
  return cards[index].id;
}
function startDrag(){
  if(!gesture)return;
  if(!selected.has(gesture.card))selected.add(gesture.card);
  gesture.mode='drag';$('loupe').hidden=true;updateSelection();
  const cards=chosen(),visible=cards.slice(0,6);
  $('dragGhost').innerHTML=visible.map((c,i)=>`<div class="playing-card ${color(c)} ${c.suit==='X'?'joker':''}" style="--i:${i}">${face(c)}</div>`).join('')+`<span class="drag-count">${cards.length} 张</span>`;
  $('dragGhost').hidden=false;
}
function moveDrag(x,y){
  const width=70+(Math.min(6,selected.size)-1)*26;
  $('dragGhost').style.left=(x-width/2)+'px';$('dragGhost').style.top=(y-76)+'px';
  const valid=legality().ok,over=F.contains($('arena').getBoundingClientRect(),x,y);
  $('arena').classList.toggle('drag-ready',valid);$('arena').classList.toggle('drag-over',valid&&over);$('arena').classList.toggle('drag-invalid',!valid);
  $('dropCue').firstElementChild.textContent=valid?(over?'松手出牌':'拖到牌桌出牌'):legality().text;
}
function stopGesture(restore=false){
  if(gesture&&restore){selected=new Set(gesture.before);}
  gesture=null;$('loupe').hidden=true;$('dragGhost').hidden=true;
  $('arena').classList.remove('drag-ready','drag-over','drag-invalid');
  document.querySelectorAll('.hand-card.peek').forEach(b=>b.classList.remove('peek'));
}
$('fanViewport').addEventListener('pointerdown',e=>{
  if(gesture||completed||e.button!==0)return;
  const b=e.target.closest('.hand-card');if(!b)return;
  gesture={pointer:e.pointerId,startX:e.clientX,startY:e.clientY,row:Number(b.dataset.row),card:Number(b.dataset.card),before:[...selected],mode:'pending'};
  $('fanViewport').setPointerCapture(e.pointerId);e.preventDefault();previewCard(gesture.card,e.clientX,e.clientY);
});
$('fanViewport').addEventListener('pointermove',e=>{
  if(!gesture||gesture.pointer!==e.pointerId)return;
  const dx=e.clientX-gesture.startX,dy=e.clientY-gesture.startY;
  if(gesture.mode!=='drag'){
    const intent=F.intent(dx,dy);
    if(intent==='drag'&&!isBidding()&&scene!=='bury')startDrag();
    else if(intent==='scrub'){
      gesture.mode='scrub';gesture.card=scrubId(e.clientX,gesture.row);previewCard(gesture.card,e.clientX,e.clientY);
      // At an overflow edge, let the same continuous scrub reveal the remaining cards.
      const rect=$('fanViewport').getBoundingClientRect();
      if(!$('pan').disabled&&(e.clientX<rect.left+20||e.clientX>rect.right-20)){
        $('pan').value=String(Math.max(0,Math.min(100,Number($('pan').value)+(e.clientX<rect.left+20?-2:2))));panHand();
      }
    }
  }
  if(gesture.mode==='drag')moveDrag(e.clientX,e.clientY);
});
$('fanViewport').addEventListener('pointerup',e=>{
  if(!gesture||gesture.pointer!==e.pointerId)return;
  const g=gesture,drag=g.mode==='drag',inside=F.contains($('arena').getBoundingClientRect(),e.clientX,e.clientY),valid=legality().ok;
  stopGesture();
  if(drag){if(inside&&valid)submit();else{updateSelection();toast(inside?legality().text:'已收回手牌，选择保留');}}
  else if(Math.abs(e.clientY-g.startY)<65)toggle(g.card);
});
$('fanViewport').addEventListener('pointercancel',()=>{stopGesture(true);updateSelection();});
$('fanViewport').addEventListener('lostpointercapture',()=>{if(gesture){stopGesture(true);updateSelection();}});
window.addEventListener('blur',()=>{if(gesture){stopGesture(true);updateSelection();}});
function openSheet(title,html,mode='menu'){
  stopGesture(true);sheetMode=mode;$('sheetTitle').textContent=title;$('sheetBody').innerHTML=html;$('sheetFooter').hidden=mode!=='overview';
  if(!$('sheet').open)$('sheet').showModal();$('sheetBody').scrollTop=0;updateSelection();
}
function openOverview(){openSheet(`手牌 · ${hand.length} 张`,groups().map(({s,cards})=>`<h3 class="overview-title">${s==='T'?'主牌':glyph[s]+' '+names[s]}<span>${cards.length} 张</span></h3><div class="card-grid">${cards.map(c=>cardMarkup(c)).join('')}</div>`).join(''),'overview');}
function openMenu(){
  openSheet('牌局菜单',`<p class="layout-label">牌桌布局</p><div class="layout-options">${[['auto','自动适配'],['wide','横屏大屏'],['portrait','竖屏对照']].map(([mode,title])=>`<button data-layout="${mode}" aria-pressed="${mode===layoutMode}">${title}</button>`).join('')}</div><button class="menu-option" data-load="follow">跟对子<small>25 张手牌 · 对家暂大 · 拖牌出手</small></button><button class="menu-option" data-load="lead">出拖拉机<small>试着选中 ♠J 对与 ♠Q 对</small></button><button class="menu-option" data-load="bury">拿底扣底<small>33 张手牌 · 底部确认埋底</small></button><button class="menu-option" data-load="declare">亮主与加固<small>先亮 ♥5，再用 ♥5 对加固</small></button><button class="menu-option" data-load="counter">抢按反主<small>下家已亮 ♠5，你可以用 ♥5 对反主</small></button><button class="menu-option" id="history">看本墩出牌</button><button class="menu-option" id="help">操作说明</button><p class="sheet-copy"><small>交互原型：固定局面，尚未接入完整对局。</small></p><a class="sheet-link" href="lab.html">屏幕尺寸实验室 ↗</a>`);
  $('history').onclick=()=>openSheet('本墩',`${completed?`<p class="result-note">${legality().text}</p>`:''}${plays.map(p=>`<div class="history-entry"><b>${['你','下家 · 首攻','对家','上家'][p.seat]}</b>${p.cards.map(shortLabel).join('　')}</div>`).join('')||'<p class="sheet-copy">还没有出牌。</p>'}`);
  $('help').onclick=()=>openSheet('拿牌、看牌、出牌',`<p class="sheet-copy">点一下选牌，选中的牌会升起；再点取消。按住花字左右滑动，会放大当前牌，松手选中它。</p><p class="sheet-copy">从选中的牌向上拖，整组牌会跟着手指走。进入桌面的高亮区域后松手才出牌；拖回来或拖到桌外，都会保留选择。</p><p class="sheet-copy">需要看两侧的牌，可左右拨动手牌下方的滑块。底部「展牌」可展开完整牌面选牌；桌边也有点击出牌入口。</p><p class="sheet-copy">主牌排在最前，同门按大小相邻。菜单可切换 33 张扣底与抢主阶段。亮主、加固和反主只在对应阶段开放。</p>`);
}
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-card]');if(b&&(!b.classList.contains('hand-card')||e.detail===0))toggle(Number(b.dataset.card));
  const l=e.target.closest('[data-load]');if(l)loadScene(l.dataset.load);
  const mode=e.target.closest('[data-layout]');if(mode)setLayout(mode.dataset.layout);
});
$('pan').oninput=panHand;$('clear').onclick=$('clearAll').onclick=()=>{selected.clear();updateSelection();};
$('tapPlay').onclick=$('buryConfirm').onclick=$('sheetSubmit').onclick=submit;
$('menu').onclick=openMenu;$('expand').onclick=openOverview;$('closeSheet').onclick=()=>$('sheet').close();
$('sort').onclick=()=>{descending=!descending;renderHand();$('sort').textContent='理牌 '+(descending?'↓':'↑');toast(descending?'每门从大到小':'每门从小到大');};
$('kitty').onclick=()=>{if(scene!=='bury')return;openSheet(completed?'已埋底牌':'拿到的 8 张底牌',`<p class="sheet-copy">${completed?'你是庄家，可以查看已扣下的底牌。':'这些底牌已经加入手牌。选满 8 张，再在底部埋底。'}</p><div class="card-grid">${kittyCards.map(c=>`<div class="playing-card ${color(c)} ${c.suit==='X'?'joker':''}">${face(c)}</div>`).join('')}</div>`);};
$('declare').onclick=()=>bid('declare');$('reinforce').onclick=()=>bid('reinforce');$('counter').onclick=()=>bid('counter');
window.addEventListener('message',e=>{if(e.origin===location.origin&&e.source===parent&&e.data?.type==='scene')loadScene(e.data.scene);});
function scheduleLayout(){if(framePending)return;framePending=true;requestAnimationFrame(()=>{framePending=false;if(gesture)stopGesture(true);renderHand();});}
new ResizeObserver(scheduleLayout).observe($('handArea'));
window.addEventListener('resize',scheduleLayout);
loadScene(new URLSearchParams(location.search).get('scene')||'follow');
