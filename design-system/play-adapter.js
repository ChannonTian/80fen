/* 八十分 · 打牌测试页 行为适配层(play-adapter)
   来源:试验 04 覆盖脚本原样外置(相对座位/收墩呼吸/抽屉/手牌求解/手势)。
   由 uibuild/build-play.py 注回页面;改这里,别改构建产物。 */
/* =====================================================================
   80分 · UI 测试版表现层(产品逻辑沿用测试版)
   状态直读 window.__G():座位相对名/庄家标记/收墩呼吸灯/抢分进度语义色/
   中心临时通知/设计系统双层手牌及拨牌/记录抽屉(对局自绘+
   教练笔记对话流)/抢分分牌弹窗。清单见 ui/PR 描述。
   ===================================================================== */
(function(){
'use strict';
var $=function(id){return document.getElementById(id);};
var game=$('game'),hand=$('hand'),fanVp=$('fanViewport'),arena=$('arena');
if(location.hash==='#test'){game.style.display='none';return;}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function g(){return window.__G?window.__G():null;}
var LSP='80fen-put-';
var SUIT_SYM={S:'♠',H:'♥',D:'♦',C:'♣'};
var SEAT_REL=['我','下家','对家','上家'];          /* 0南我 1东下家 2北对家 3西上家 */

/* ---------- 牌 -> 文本(♠A / 大王) ---------- */
function cardCls(c){return c.suit==='X'?(c.rank===16?'jb':'js'):('s'+c.suit);}
function cardTxt(c){
  if(c.suit==='X')return {cls:c.rank===16?'jb':'js',txt:c.rank===16?'大王':'小王',joker:true};
  var r=c.rank>10?{11:'J',12:'Q',13:'K',14:'A'}[c.rank]:String(c.rank);
  return {cls:'s'+c.suit,txt:SUIT_SYM[c.suit]+r,pt:(r==='5'||r==='10'||r==='K')};
}
function txtHtml(c){
  var t=cardTxt(c);
  if(t.joker)return '<span class="tjoker">'+t.txt+'</span>';
  return '<span class="tcard '+t.cls+(t.pt?' pt':'')+'">'+t.txt+'</span>';
}
function suitOf(c){return c.suit==='X'?'J':c.suit;}
function effGroup(cardEl,G){
  var m=cardEl.className.match(/\bs([SHDC])\b/);
  var isJ=/\b(jb|js)\b/.test(cardEl.className);
  if(isJ)return 'T';
  if(!m)return '?';
  var tl=cardEl.querySelector('.tl');var rt=tl?tl.textContent.trim():'';
  var rn=({J:11,Q:12,K:13,A:14})[rt]||+rt;
  if(G){
    var trump=G.trump||{suit:G.decl&&G.decl.suit,
      rank:window.__rankOf?window.__rankOf(0):G.trumpRank};
    if(trump.suit&&m[1]===trump.suit)return 'T';
    if(rn===trump.rank)return 'T';
  }
  return m[1];
}

/* 手牌沿用设计系统的整手几何；保留本页的选牌和出牌规则事件。 */
var handPlan=null,handProgress=0,selectedBidIds=new Set();
function positionHand(){
  if(!handPlan)return;
  var W=fanVp.clientWidth;
  handPlan.rows.forEach(function(row,ri){
    var offset=Math.max(0,row.width-W)*handProgress;
    var short=game.classList.contains('wide')&&window.innerHeight<=400;
    row.cards.forEach(function(p,i){
      var c=p.card;
      c.style.width=p.w+'px';c.style.height=p.h+'px';
      c.style.left='0px';c.style.top='0px';
      c.style.transform='translateX('+(p.x-offset)+'px) translateY('+(p.y-(short?22:0)+(c.classList.contains('sel')?-(short?8:22):0))+'px) rotate('+p.angle+'deg)';
      c.style.zIndex=String((c.classList.contains('sel')?300:0)+ri*100+i+1);
      if(!c.hasAttribute('role')){
        var suit={sS:'黑桃',sH:'红桃',sD:'方块',sC:'梅花'};
        var cls=Object.keys(suit).find(function(k){return c.classList.contains(k);});
        c.setAttribute('role','button');c.tabIndex=0;
        c.setAttribute('aria-label',cls?suit[cls]+' '+c.querySelector('.tl').textContent:
          (c.classList.contains('jb')?'大王':'小王'));
        c.onkeydown=function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();c.click();}};
      }
      c.setAttribute('aria-pressed',String(c.classList.contains('sel')));
      decorateCard(c);
    });
  });
}
function layoutHand(){
  var cards=Array.prototype.slice.call(hand.children);
  var W=fanVp.clientWidth,H=fanVp.clientHeight;
  if(!cards.length){handPlan=null;selectedBidIds.clear();$('handWheel').classList.add('is-off');syncBidAction();return;}
  var G=g();
  var bidding=G&&(G.phase==='dealing'||G.phase==='finalDecl');
  if(!bidding)selectedBidIds.clear();
  cards.forEach(function(c){c.classList.toggle('sel',!!bidding&&selectedBidIds.has(+c.dataset.id));});
  var wide=game.classList.contains('wide');
  handPlan=window.Liuliu.handPlan(cards,{width:W,height:H,viewportHeight:window.innerHeight,
    wide:wide,groupKey:function(c){return effGroup(c,G);}});
  var wheel=$('handWheel'),slider=$('handPan');
  wheel.classList.toggle('is-off',!handPlan.overflow);
  slider.disabled=!handPlan.overflow;
  slider.value=Math.round(handProgress*1000);
  positionHand();
  hand.style.width=W+'px';hand.style.height=H+'px';
  var tableW=wide&&window.innerHeight<=360?43:
    (!wide&&window.innerHeight<=620?44:Math.min(wide?72:58,handPlan.cardWidth));
  game.style.setProperty('--cw',tableW+'px');
  game.style.setProperty('--step',clamp(tableW*0.32,16,25).toFixed(1)+'px');
  stampPiles();
  syncBidAction();
}
window.__toggleBidCard=function(id){
  var G=g();if(!G||!(G.phase==='dealing'||G.phase==='finalDecl'))return;
  if(!$('dealZone').querySelector('button[data-a]'))return;
  if(selectedBidIds.has(id))selectedBidIds.delete(id);
  else {if(selectedBidIds.size>=2)selectedBidIds.clear();selectedBidIds.add(id);}
  Array.prototype.forEach.call(hand.children,function(c){c.classList.toggle('sel',selectedBidIds.has(+c.dataset.id));});
  positionHand();syncBidAction();
};
$('handPan').addEventListener('input',function(){handProgress=this.value/1000;positionHand();});
function decorateCard(c){
  var r=(c.querySelector('.tl')||{}).textContent||'';
  r=r.trim();
  c.classList.toggle('two',r==='10');
  var pm=c.querySelector('.point-mark');
  if(r==='5'||r==='10'||r==='K'){
    var txt=(r==='5'?'5分':'10分');
    if(!pm){pm=document.createElement('span');pm.className='point-mark';pm.textContent=txt;c.appendChild(pm);}
    /* 值相同就一个字都不写:textContent 赋值必换文本节点,
       会在 #players 观察器(subtree)里自激成无限微任务循环,把渲染线程饿死 */
    else if(pm.textContent!==txt)pm.textContent=txt;
  }else if(pm)pm.remove();
}
/* 可见即同步排布;后台走队列;1 秒自愈(张数/首牌/布局类任一变化) */
var layoutQueued=false;
function queueLayout(){
  if(document.visibilityState==='visible'){layoutHand();return;}
  if(layoutQueued)return;layoutQueued=true;
  var done=false,run=function(){if(done)return;done=true;layoutQueued=false;layoutHand();};
  requestAnimationFrame(run);setTimeout(run,40);
}
new MutationObserver(queueLayout).observe(hand,{childList:true});
var lastN=-1,lastCls='';
setInterval(function(){
  if(document.visibilityState!=='visible')return;
  var cs=hand.children;
  if(!cs.length){lastN=0;return;}
  var cls=game.className;
  if(cs.length!==lastN||cs[0].style.transform.length<10||cls!==lastCls){
    lastN=cs.length;lastCls=cls;layoutHand();
  }
},1000);
document.addEventListener('visibilitychange',function(){
  if(document.visibilityState==='visible'){queueLayout();stampPiles();}
});
/* 桌面出牌堆:--i 级联 + 宽度 */
function stampPiles(){
  Array.prototype.forEach.call(document.querySelectorAll('#game .played'),function(p){
    var n=p.children.length;
    var cw=parseFloat(game.style.getPropertyValue('--cw'))||58;
    var step=parseFloat(game.style.getPropertyValue('--step'))||18;
    if(n>1&&(p.id==='p1'||p.id==='p3')&&!game.classList.contains('wide')){
      var center=$('trickSummary').getBoundingClientRect().width||112;
      var maxSide=(arena.clientWidth-center)/2-10;
      step=Math.max(6,Math.min(step,(maxSide-cw)/(n-1)));
    }
    p.style.setProperty('--pile-step',step+'px');
    p.style.width=n?(cw+(n-1)*step)+'px':'0px';
    Array.prototype.forEach.call(p.children,function(c,i){
      c.style.setProperty('--i',i);decorateCard(c);
    });
  });
}
new MutationObserver(function(){if(document.visibilityState==='visible')stampPiles();else setTimeout(stampPiles,60);})
  .observe($('players'),{childList:true,subtree:true});
new MutationObserver(function(){stampPiles();}).observe($('myPlay'),{childList:true});

/* ============ 布局:宽窄切换 ============ */
window.addEventListener('resize',applyLayout);
try{new ResizeObserver(function(){applyLayout();}).observe(document.documentElement);}catch(_){}
var lastW=0,lastH=0;
setInterval(function(){
  if(window.innerWidth!==lastW||window.innerHeight!==lastH){
    lastW=window.innerWidth;lastH=window.innerHeight;applyLayout();
  }
},200);
function applyLayout(){
  var w=window.innerWidth,h=window.innerHeight;
  var wide=w>=700||(w>=560&&w>h*1.2);
  game.classList.toggle('wide',wide);
  game.classList.toggle('compact',wide&&h<=720);
  document.body.classList.toggle('wide-view',wide);
  layoutHand();
}
applyLayout();

/* ============ G 状态轮询:座位/庄家/收墩/进度/阶段 ============ */
var SEAT_EL=['myPlay','playerE','playerN','playerW'];   /* seat0..3 */
var lastTrickCount=-1,lastEndedRound=-1,lastHandRound=null;
var roundHistory=[];   /* [{no, initialHands, tricks}] 已完成局快照 */
function seatHost(s){return $(SEAT_EL[s]);}
function setTrickState(winning,collect,label){
  SEAT_EL.forEach(function(id,s){
    var host=$(id),isCollect=s===collect;
    host.classList.toggle('winning',s===winning);
    host.classList.toggle('collect',isCollect);
    var badge=host.querySelector('.winner-label');
    if(isCollect){
      if(!badge){badge=document.createElement('span');badge.className='winner-label';host.appendChild(badge);}
      if(badge.textContent!==label)badge.textContent=label;
    }else if(badge)badge.remove();
  });
}
function pollG(){
  var G=g();if(!G)return;
  var handRound=roundSeq(G);
  if(lastHandRound!==handRound){lastHandRound=handRound;handProgress=0;positionHand();}
  /* 阶段类:发牌期隐藏 出牌/清选 */
  var dealing=G.phase==='dealing'||G.phase==='finalDecl';
  $('controls').classList.toggle('dealing',dealing);
  var summary=$('trickSummary'),plays=G.trick||[];
  summary.hidden=G.phase!=='play'||!!G.ended;
  if(!summary.hidden){
    var pts=plays.reduce(function(n,p){return n+countPoints(p.cards);},0);
    if($('trickPoints').textContent!==String(pts))$('trickPoints').textContent=String(pts);
    var lead=plays.length?classify(plays[0].cards,G.trump):null;
    var line=lead?(lead.suit==='T'?'主牌':SUIT_SYM[lead.suit])+' · '+
      ({single:'单张',pair:'对子',tractor:'拖拉机',throw:'甩牌'}[lead.type]||plays[0].cards.length+'张'):
      (SEAT_REL[G.leader]||'等待')+'领出';
    if($('trickLead').textContent!==line)$('trickLead').textContent=line;
  }
  /* 座位相对名 + 庄家标记 + 托管后缀 */
  for(var s=0;s<4;s++){
    var el=$('n'+s);if(!el)continue;
    var name=SEAT_REL[s]+(s===0&&G.auto?'（托管）':'');
    if(el.textContent!==name)el.textContent=name;
    var host=seatHost(s);
    if(!host)continue;
    var hasBadge=!!host.querySelector('.dealer-badge');
    if(G.declSeat===s&&!hasBadge){
      var b=document.createElement('span');b.className='dealer-badge';b.title='本局庄家';b.textContent='庄';
      host.querySelector('.player-label').appendChild(b);
    }else if(G.declSeat!==s&&hasBadge){host.querySelector('.dealer-badge').remove();}
  }
  /* 四家出齐后、牌还留在桌上的短暂等待期，直接在赢家牌上标收墩。 */
  var winning=-1,collect=-1,collectLabel='';
  if(G.phase==='play'&&!G.ended){
    if(G.trick.length>0){
      try{
        var res=window.resolveTrick?resolveTrick(G.trick,G.trump):null;
        if(res){
          if(G.trick.length===4){
            collect=res.winner;
            collectLabel=res.points?('收墩 +'+res.points+'分'):'收墩';
          }else winning=res.winner;
        }
      }catch(_){}
    }
  }
  setTrickState(winning,collect,collectLabel);
  /* 收墩闪现 */
  if(G.tricks.length!==lastTrickCount){
    lastTrickCount=G.tricks.length;
  }
  /* 局末快照(供对局记录回看已完成局) */
  if(G.ended&&G.ended.roundOver!==false){
    var no=roundSeq(G);
    if(lastEndedRound!==no){
      lastEndedRound=no;
      roundHistory.push({no:no,initialHands:snapshotHands(G),tricks:G.tricks.map(function(t){
        return {no:t.no,winner:t.winner,points:t.points,gotPts:t.gotPts,
          plays:t.plays.map(function(p){return {seat:p.seat,cards:p.cards.map(cardTxt)};})};
      })});
    }
  }else{lastEndedRound=-1;}
  /* 抢分进度:语义色 + 数值 */
  var sc=G.defPoints||0;
  $('scoreNow').textContent=sc;
  $('scoreFill').style.width=clamp(sc/80*100,0,100)+'%';
  var chip=$('scoreChip');
  chip.classList.toggle('danger',G.declSeat>=0&&G.declSeat%2===0);
  chip.classList.toggle('success',G.declSeat>=0&&G.declSeat%2===1);
  /* 将牌/级数 */
  if(G.trump){
    $('trumpChip').innerHTML='<span class="suit">'+(G.trump.suit?SUIT_SYM[G.trump.suit]:'无将')+'</span>'+(G.trump.suit?' ':'')+G.trump.rank;
  }else if(G.decl){
    $('trumpChip').textContent=(G.decl.suit?SUIT_SYM[G.decl.suit]:'无将')+' 抢亮中';
  }else $('trumpChip').textContent='抢亮中';
  /* 阶段性中心通知 */
  if(G.phase==='finalDecl')centerPersist('亮主 · 最后机会(跳过=不翻)','info');
  else if(G.phase==='lowrebel')centerPersist('低分/少主 · 可造反重发','info');
  else if(G.phase==='redealing')centerPersist('重新发牌…','info');
  else if(G.phase==='kitty')centerPersist(null);
  else centerPersist(null);
  /* 托管时收起顶部长说明(产品 phaseHint 已隐藏,这里只是兜底) */
}
function roundSeq(G){var st=(G.start||{});return (st.round!=null?st.round:0)+1;}
function snapshotHands(G){
  if(!G.initialHands)return null;
  return G.initialHands.map(function(h){return h.map(cardTxt);});
}
setInterval(pollG,300);pollG();

/* #status spans 镜像:级数 */
new MutationObserver(function(){
  var spans=$('status').querySelectorAll('span');
  if(spans.length>=6&&spans[4]){
    var m=spans[4].textContent.match(/你们[:：]?\s*(\S+)\s*对方[:：]?\s*(\S+)/);
    if(m)$('levelChip').textContent='级数 我'+m[1]+' · 对'+m[2];
  }
  /* 不翻→跳过 */
  var sd=$('btnSkipDecl');
  if(sd&&!sd.hidden&&sd.textContent.indexOf('跳过')<0)sd.textContent='跳过';
}).observe($('status'),{childList:true});

/* 错牌提示 → 中心通知 */
new MutationObserver(function(){
  var t=$('msg').textContent||'';
  if(/^(本墩|暂|发牌|等待|对手)/.test(t))return;   /* 常驻状态行,不是错误 */
  if(/^(不合法|非法)/.test(t))centerFlash(t.replace(/^不合法[:：]?/,'出法不对：'),'err',2600);
  else if(/^(请先选牌|领出必须|甩牌失败)/.test(t))centerFlash(t,'err',2200);
}).observe($('msg'),{childList:true});

/* ============ 中心通知 ============ */
var ctEl=$('centerToast'),ctTimer=null,ctPersist='';
function centerShow(text,kind){
  ctEl.textContent=text;ctEl.className='center-toast show '+(kind||'info');ctEl.setAttribute('aria-hidden','false');
}
function centerHide(){ctEl.className='center-toast';ctEl.textContent='';ctEl.setAttribute('aria-hidden','true');}
function centerFlash(text,kind,ms){
  clearTimeout(ctTimer);
  centerShow(text,kind);
  ctTimer=setTimeout(function(){ctPersist?centerShow(ctPersist,'info'):centerHide();},ms||2000);
}
function centerPersist(text,kind){
  var want=text?text+'\u0000'+(kind||'info'):'';
  if(want===ctPersist)return;
  ctPersist=want;
  if(text&&!ctTimer)centerShow(text,kind||'info');
  else if(!text){clearTimeout(ctTimer);centerHide();}
}

/* ============ 指针手势(修复:仅在拖拽/横扫开始时才捕获指针) ============ */
var loupe=$('loupe'),ghost=$('dragGhost'),dropCue=$('dropCue');
var gest=null;
fanVp.addEventListener('pointerdown',function(e){
  var card=e.target.closest?e.target.closest('.card'):null;if(!card)return;
  gest={id:e.pointerId,card:card,x0:e.clientX,y0:e.clientY,mode:'pending',scroll0:handProgress,
         wasSel:card.classList.contains('sel')};
  gest.hold=setTimeout(function(){
    if(gest&&gest.mode==='pending'){gest.mode='peek';showLoupe(gest.card,e.clientX,e.clientY);}
  },180);
});
// 起点常贴近手牌区上沿；在进入 drag 模式前指针就可能离开容器。
document.addEventListener('pointermove',function(e){
  if(!gest||e.pointerId!==gest.id)return;
  var dx=e.clientX-gest.x0,dy=e.clientY-gest.y0;
  if(gest.mode==='peek'&&Math.abs(dx)+Math.abs(dy)>10){hideLoupe();gest.mode='pending';}
  if(gest.mode==='pending'){
    var shallow=gest.wasSel;
    var isDrag=dy<-(shallow?12:20)&&-dy>Math.abs(dx)*(shallow?.3:.35);
    if(isDrag){
      clearTimeout(gest.hold);hideLoupe();gest.mode='drag';
      try{fanVp.setPointerCapture(e.pointerId);}catch(_){}
      buildGhost();
    }
    else if(Math.abs(dx)>28&&Math.abs(dy)<10 || Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy)*3){
      clearTimeout(gest.hold);hideLoupe();gest.mode='scrub';
      try{fanVp.setPointerCapture(e.pointerId);}catch(_){}
    }
    else return;
  }
  if(gest.mode==='scrub'&&handPlan&&handPlan.overflow){
    var max=Math.max.apply(null,handPlan.rows.map(function(r){return Math.max(0,r.width-fanVp.clientWidth);}));
    handProgress=clamp(gest.scroll0-dx/Math.max(1,max),0,1);
    $('handPan').value=Math.round(handProgress*1000);
    positionHand();
  }
  if(gest.mode==='drag'){
    moveGhost(e.clientX,e.clientY);
    var a=arena.getBoundingClientRect();
    var inside=e.clientX>a.left&&e.clientX<a.right&&e.clientY>a.top&&e.clientY<a.bottom;
    arena.classList.toggle('drag-over',inside);
    arena.classList.toggle('drag-ready',!inside);
  }
});
function endGesture(e,cancelled){
  if(!gest||e.pointerId!==gest.id)return;
  clearTimeout(gest.hold);hideLoupe();hideGhost();
  arena.classList.remove('drag-ready','drag-over');
  var G=gest;gest=null;
  if(cancelled)return;
  if(G.mode==='drag'){
    var a=arena.getBoundingClientRect();
    var inside=e.clientX>a.left&&e.clientX<a.right&&e.clientY>a.top&&e.clientY<a.bottom;
    if(inside)commitDrag(G);
    suppressClick();
  }else if(G.mode==='scrub')suppressClick();
}
document.addEventListener('pointerup',function(e){endGesture(e,false);});
document.addEventListener('pointercancel',function(e){endGesture(e,true);});
var clickSuppressed=0;
function suppressClick(){clickSuppressed=Date.now();}
hand.addEventListener('click',function(e){
  if(Date.now()-clickSuppressed<350){e.stopPropagation();e.preventDefault();}
},true);
function showLoupe(card,x,y){
  loupe.innerHTML=card.outerHTML;
  loupe.querySelector('.card').style.cssText='position:fixed;transform:none!important;width:91px;height:134px;margin:0';
  loupe.hidden=false;
  loupe.style.left=clamp(x-46,8,window.innerWidth-100)+'px';
  loupe.style.top=clamp(y-150,8,window.innerHeight-146)+'px';
}
function hideLoupe(){loupe.hidden=true;}
function draggedSet(G){
  var set=[G.card];
  if(G.wasSel)Array.prototype.forEach.call(hand.querySelectorAll('.card.sel'),function(c){if(c!==G.card)set.push(c);});
  return set;
}
function buildGhost(){
  var set=draggedSet(gest);
  ghost.innerHTML=set.slice(0,6).map(function(c,i){
    return c.outerHTML.replace('class="card','style="position:static;transform:rotate('+(i*4)+'deg)!important;margin-left:'+(i?'-32px':'0')+'" class="card');
  }).join('')+'<span class="drag-count">'+set.length+'</span>';
  ghost.hidden=false;
}
function moveGhost(x,y){
  ghost.style.left=clamp(x-70,4,window.innerWidth-150)+'px';
  ghost.style.top=clamp(y-120,4,window.innerHeight-160)+'px';
}
function hideGhost(){ghost.hidden=true;}
function bidTarget(set){
  var dz=$('dealZone');
  var state=g(),cards=state&&set.map(function(el){return state.hands[0].find(function(c){return String(c.id)===el.dataset.id;});});
  if(!cards||!cards.length||cards.some(function(c){return !c;}))return null;
  var level=window.__rankOf?window.__rankOf(0):state.trumpRank;
  var btns=Array.prototype.slice.call(dz.querySelectorAll('button[data-a]'));
  var suit=cards[0].suit;
  if(cards.length===1&&cards[0].rank===level){
    return btns.find(function(b){return b.dataset.a==='d'&&b.dataset.s===suit&&b.dataset.st==='1';})||null;
  }
  if(cards.length===2&&cards[0].rank===cards[1].rank&&cards[0].suit===cards[1].suit){
    var st=suit==='X'?(cards[0].rank===16?'4':'3'):'2';
    if(suit==='X'||cards[0].rank===level){
      var target=btns.find(function(b){return b.dataset.a==='d'&&b.dataset.s===(suit==='X'?'':suit)&&b.dataset.st===st;});
      if(!target&&suit!=='X'&&state.decl&&state.decl.suit===suit)
        target=btns.find(function(b){return b.dataset.a==='re';});
      return target||null;
    }
  }
  return null;
}
function syncBidAction(){
  var action=$('bidAction'),G=g(),dz=$('dealZone');
  var bidding=G&&(G.phase==='dealing'||G.phase==='finalDecl');
  var btns=Array.prototype.slice.call(dz.querySelectorAll('button[data-a]'));
  action.hidden=!bidding||!btns.length;
  if(action.hidden)return;
  var chosen=Array.prototype.filter.call(hand.children,function(c){return selectedBidIds.has(+c.dataset.id);});
  var target=bidTarget(chosen),label=G.decl?'反主':'亮主';
  action.textContent=btns.length===1?btns[0].textContent:
    target?(target.dataset.a==='re'?'加固':label+' '+(target.dataset.s?SUIT_SYM[target.dataset.s]:'无将')+
      (target.dataset.st==='2'?'对':'')):'选牌'+label;
  action.setAttribute('aria-label',btns.length===1?action.textContent:
    target?action.textContent:'点选对应的手牌后'+label);
}
new MutationObserver(syncBidAction).observe($('dealZone'),{childList:true});
$('bidAction').onclick=function(){
  var btns=Array.prototype.slice.call($('dealZone').querySelectorAll('button[data-a]'));
  var chosen=Array.prototype.filter.call(hand.children,function(c){return selectedBidIds.has(+c.dataset.id);});
  var target=btns.length===1?btns[0]:bidTarget(chosen);
  if(target){target.click();selectedBidIds.clear();syncBidAction();}
  else centerFlash('先点选要亮出的级数牌或王对，也可以直接拖到牌桌','err',2300);
};
function commitDrag(G){
  var set=draggedSet(G);
  if($('dealZone').querySelector('button[data-a]')){
    var target=bidTarget(set);
    if(target)target.click();
    else centerFlash('这组牌不能亮主，请选级数牌或王对','err',2200);
    return;
  }
  set.forEach(function(c){if(!c.classList.contains('sel'))c.click();});
  if(!$('btnPlay').disabled)$('btnPlay').click();
}
function suitChar(el){var m=el.className.match(/\bs([SHDC])\b/);return m?m[1]:'';}

/* ============ 抢分分牌弹窗 ============ */
function openScore(){
  var G=g();if(!G)return;
  var body=$('scoreBody');
  var total=G.defPoints||0;
  var html='<div class="sc-total">闲家已抢 '+total+' / 80 分</div>';
  var rows=(G.tricks||[]).filter(function(t){return t.gotPts&&t.points>0;});
  if(!rows.length)html+='<div class="sc-empty">还没有抢到分牌</div>';
  rows.forEach(function(t){
    var cards=t.plays.reduce(function(a,p){return a.concat(p.cards);},[]).filter(function(c){return cardPointsOf(c)>0;});
    html+='<div class="sc-trick"><span>第'+t.no+'墩</span><span class="tcards">'+
      cards.map(function(c){var x=cardTxt(c);return '<span class="tcard '+x.cls+'">'+x.txt+'</span>';}).join(' ')+
      '</span><span style="margin-left:auto;color:var(--tx2)">+'+t.points+'分</span></div>';
  });
  body.innerHTML=html;
  $('scoreModal').hidden=false;
}
function cardPointsOf(c){
  if(c.suit==='X')return 0;
  return c.rank===5?5:(c.rank===10||c.rank===13)?10:0;
}
$('scoreChip').onclick=openScore;
$('scoreClose').onclick=function(){$('scoreModal').hidden=true;};
$('scoreModal').addEventListener('click',function(e){if(e.target===this)this.hidden=true;});

/* ============ 记录抽屉 ============ */
function openSide(){document.body.classList.add('drawer-open');if(activeMyTab==='log')renderLog();}
function closeSide(){document.body.classList.remove('drawer-open');}
$('recordsBtn').onclick=function(){document.body.classList.contains('drawer-open')?closeSide():openSide();};
$('sideClose').onclick=closeSide;
document.body.addEventListener('click',function(e){
  if(e.target===document.body&&document.body.classList.contains('drawer-open'))closeSide();
});
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'&&document.body.classList.contains('drawer-open'))closeSide();
});
var productHint=$('btnHint').onclick;
$('btnHint').onclick=function(e){
  if(productHint)productHint.call(this,e);
  if(!this.disabled){activeMyTab='coach';openSide();syncTabOn('coach');}
};
var activeMyTab='log';
var logRoundSel='cur',logMode='trick',lastLogHtml='';
$('tabs').querySelectorAll('button').forEach(function(b){
  if(b.dataset.tab==='coach'){
    /* 教练页交给产品渲染:产品在页面加载时已给这个按钮绑好 onclick
       (activeTab='coach' → renderPanel → renderCoachTab,quiz 按钮也由产品绑定)。
       这里只叠一层:记账 + 高亮 + 没开局时产品的 renderCoachTab 会因 G 为空抛错,给它兜底。 */
    b.addEventListener('click',function(){
      activeMyTab='coach';
      $('tabs').querySelectorAll('button').forEach(function(x){x.classList.toggle('on',x===b);});
      if(!g())setTimeout(coachPlaceholder,0);
    });
    return;
  }
  if(b.dataset.tab==='mem'){
    /* 记牌表同样归产品渲染(onclick 在页面加载时已绑好)。
       产品的 renderMemTab 直接读 G.phase,没开局会抛错 —— 这里兜底成提示文案。 */
    b.addEventListener('click',function(){
      activeMyTab='mem';
      $('tabs').querySelectorAll('button').forEach(function(x){x.classList.toggle('on',x===b);});
      if(!g())setTimeout(memPlaceholder,0);
    });
    return;
  }
  b.onclick=function(){
    activeMyTab=b.dataset.tab;
    $('tabs').querySelectorAll('button').forEach(function(x){x.classList.toggle('on',x===b);});
    if(activeMyTab==='log')renderLog();
  };
});
/* #panel 渲染后:log → 整体替换为自绘;coach → 叠加笔记区 + 过滤 */
function syncTabOn(tab){
  $('tabs').querySelectorAll('button').forEach(function(x){x.classList.toggle('on',x.dataset.tab===tab);});
}
new MutationObserver(function(){
  if(!document.body.classList.contains('drawer-open'))return;
  if(activeMyTab==='log'){renderLog();syncTabOn('log');return;}
  if(activeMyTab==='mem')return;   /* 记牌表整页归产品,观察器不碰它 */
  /* coach:产品内容 + 笔记追加 */
  ensureCoachWrap($('panel'));
}).observe($('panel'),{childList:true});
function ensureCoachWrap(panel){
  if(!panel||panel.querySelector('.chat-notes-wrap'))return;
  var notes=[];try{notes=JSON.parse(localStorage.getItem(LSP+'notes')||'[]');}catch(_){}
  var wrap=document.createElement('div');wrap.className='chat-notes-wrap';
  wrap.innerHTML='<div class="chat-input">'+
    '<input id="chatNoteInput" placeholder="记一笔…（进入教练·笔记后可见）">'+
    '<button id="chatNoteSend">存笔记</button></div>'+
    '<div class="chat-notes-list">'+notes.slice().reverse().map(function(n){
      return '<div class="chat-note"><span class="cno">第'+n.r+'局笔记</span>'+esc(n.t)+'</div>';
    }).join('')+'</div>';
  panel.appendChild(wrap);
  $('chatNoteSend').onclick=function(){
    var v=$('chatNoteInput').value.trim();if(!v)return;
    $('noteInput').value=v;$('noteSend').click();
    $('chatNoteInput').value='';
  };
}
function memPlaceholder(){
  var panel=$('panel');
  if(!panel||activeMyTab!=='mem')return;
  panel.innerHTML='<div style="opacity:.62;padding:10px 2px;line-height:1.7">'+
    '开打后这里显示在外大牌统计:先自己心算,再点开验证。</div>';
}
function coachPlaceholder(){
  var panel=$('panel');
  if(!panel||activeMyTab!=='coach')return;
  panel.innerHTML='<div class="coach-empty" style="opacity:.62;padding:10px 2px;line-height:1.7">'+
    '开局后这里就是对话流:轮到你时点「问六六」,出现大失误会自动提醒,局终自动复盘关键回合。<br>'+
    '笔记随时可以记,存在本机。</div>';
  ensureCoachWrap(panel);
}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');}
$('onlyNotes').onchange=function(){$('panel').classList.toggle('notes-hidden',this.checked);$('panel').classList.toggle('coach-hidden',!this.checked&&false);applyFilter();};
$('onlyCoach').onchange=applyFilter;
function applyFilter(){
  var onlyN=$('onlyNotes').checked,onlyC=$('onlyCoach').checked;
  var panel=$('panel');
  panel.classList.toggle('notes-hidden',onlyC);   /* 只看教练 → 藏笔记 */
  panel.classList.toggle('coach-hidden',onlyN);   /* 只看笔记 → 藏教练 */
}
/* ---------- 对局记录(自绘) ---------- */
function renderLog(){
  var panel=$('panel');
  var G=g();
  var rounds=[];
  roundHistory.forEach(function(r){rounds.push(r);});
  if(G&&!G.ended)rounds.push({no:roundSeq(G),initialHands:snapshotHands(G),live:true,
    tricks:(G.tricks||[]).map(function(t){return {no:t.no,winner:t.winner,points:t.points,gotPts:t.gotPts,
      plays:t.plays.map(function(p){return {seat:p.seat,cards:p.cards.map(cardTxt)};})};}),
    cur:(G.trick||[]).map(function(p){return {seat:p.seat,cards:p.cards.map(cardTxt)};})});
  var cur=rounds[rounds.length-1]||{tricks:[],cur:[]};
  if(logRoundSel!=='cur'){
    var f=rounds.filter(function(r){return '第'+r.no+'局'===logRoundSel;});
    if(f.length)cur=f[0];
  }
  var html='<div class="log-controls">'+
    '<select id="logRound">'+rounds.map(function(r){
      return '<option'+(('第'+r.no+'局')===logRoundSel?' selected':'')+' value="第'+r.no+'局">第'+r.no+'局'+(r.live?'(进行中)':'')+'</option>';
    }).join('')+'</select>'+
    '<select id="logMode"><option value="trick"'+(logMode==='trick'?' selected':'')+'>按墩</option>'+
    '<option value="suit"'+(logMode==='suit'?' selected':'')+'>按门</option></select></div>';
  if(!cur.live&&cur.initialHands){
    html+='<details class="init-hands"><summary>初始手牌(本局已完成,可回看)</summary>'+
      cur.initialHands.map(function(h,s){
        return '<div class="ih-row"><span class="ih-who">'+SEAT_REL[s]+'</span>'+
          h.map(function(x){return '<span class="tcard '+x.cls+'">'+x.txt+'</span>';}).join(' ')+'</div>';
      }).join('')+'</details>';
  }
  if(logMode==='trick'){
    cur.tricks.forEach(function(t){
      html+=trickLine(t);
    });
    if(cur.cur&&cur.cur.length){
      html+=trickLine({no:(cur.tricks.length||0)+1,winner:-1,points:0,gotPts:false,plays:cur.cur,live:true});
    }
  }else{
    var bySuit={};
    function push(pl){pl.forEach(function(p){p.cards.forEach(function(x){
      var k=x.joker?'J':(SUIT_SYM[G&&G.trump&&G.trump.suit]===x.txt[0]?'T':x.txt[0]);
      (bySuit[k]=bySuit[k]||[]).push(x);});});}
    cur.tricks.forEach(function(t){push(t.plays);});
    if(cur.cur)push(cur.cur);
    var order=['T','♠','♥','♦','♣','J'];
    var names={'T':'主牌','♠':'黑桃','♥':'红桃','♦':'方块','♣':'梅花','J':'王'};
    order.forEach(function(k){
      if(!bySuit[k]||!bySuit[k].length)return;
      html+='<div class="suit-row"><span class="sg-label">'+names[k]+'</span>'+
        bySuit[k].map(function(x){return '<span class="tcard '+x.cls+(x.pt?' pt':'')+'">'+x.txt+'</span>';}).join(' ')+'</div>';
    });
  }
  /* 自我幂等:#panel 观察器会在自己渲染后再触发一次;
     内容没变且面板还是我们的日志(首节点 .log-controls)就不重写,免得观察器自旋 */
  var mine=panel.firstElementChild&&panel.firstElementChild.className==='log-controls';
  if(!(mine&&html===lastLogHtml)){panel.innerHTML=html;lastLogHtml=html;}
  var rs=$('logRound'),ms=$('logMode');
  rs.onchange=function(){logRoundSel=this.value==='第'+((g()&&roundSeq(g()))+'局')?'cur':this.value;renderLog();};
  ms.onchange=function(){logMode=this.value;renderLog();};
  var body=document.querySelector('.records-body');
  if(logMode==='trick')body.scrollTop=body.scrollHeight;   /* 最新墩在底部 */
}
function trickLine(t){
  var ours=t.winner>=0&&t.winner%2===0;
  var cards=t.plays.map(function(p){
    return p.cards.map(function(x){return '<span class="tcard '+x.cls+(x.pt?' pt':'')+'">'+x.txt+'</span>';}).join('');
  }).join(' ');
  return '<div class="trick-line'+(ours?' win':'')+'"><span class="tno">'+(t.live?'进行':'第'+t.no+'墩')+'</span>'+
    '<span class="tcards">'+(cards||'—')+'</span>'+
    (t.winner>=0?'<span class="tsum">'+SEAT_REL[t.winner]+'收'+(t.points?' +'+t.points+'分':'')+'</span>':'')+'</div>';
}

/* ============ 菜单 ============ */
var sheet=$('sheet');
function openSheet(title,bodyHtml){
  $('sheetTitle').textContent=title;$('sheetBody').innerHTML=bodyHtml;
  if(!sheet.open)sheet.showModal();
}
$('closeSheet').onclick=function(){sheet.close();};
$('menuBtn').onclick=function(){
  openSheet('菜单',
    '<button class="menu-option" id="mSet">⚙ 设置<small>规则 · 节奏 · 教练 · 声音</small></button>'+
    '<button class="menu-option" id="mRec">☰≡ 记录与教练<small>对局 · 教练 · 笔记</small></button>'+
    '<button class="menu-option" id="mScore">🪙 抢分分牌<small>本局闲家抢到的分牌</small></button>'+
    '<a class="menu-option" href="80fen-learn-ui-test.html">🧁 去学牌<small>六六陪你从一手牌开始</small></a>');
  $('mSet').onclick=function(){sheet.close();window.__openSet();};
  $('mRec').onclick=function(){sheet.close();openSide();};
  $('mScore').onclick=function(){sheet.close();openScore();};
};

/* ============ 开始画面(六六封面) ============ */
var startDone=false,oc=$('overlayContent');
function applyStartScreen(){
  if(startDone||!oc||!oc.firstChild)return;
  if(oc.textContent.indexOf('80分(上海规则)')<0)return;
  startDone=true;
  oc.innerHTML=
    '<div class="leo-start">'+
      '<span class="leo-avatar" role="img" aria-label="六六教练"></span>'+
      '<div style="text-align:left">'+
        '<div class="leo-start-title">80分<small>上海规则</small></div>'+
        '<div class="leo-start-sub">六六陪你打牌 · 启发式 AI 队友与对手 · 教练模式</div>'+
      '</div>'+
    '</div>'+
    '<div style="margin-top:12px"><button onclick="window.__start()">开始游戏</button>'+
    '<button class="minor" style="margin-left:10px" onclick="window.__openSet()">⚙ 设置</button></div>';
}
new MutationObserver(applyStartScreen).observe(oc,{childList:true});
applyStartScreen();
})();
