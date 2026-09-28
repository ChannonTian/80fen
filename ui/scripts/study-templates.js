// Design review entry points. Fixtures never read/write real lesson completion.
const templateParams=new URLSearchParams(location.search),templateType=templateParams.get('template');
if(templateType){
  const fixtures=[];
  UNITS.forEach((u,unit)=>u.lessons.forEach((lesson,lessonIndex)=>lesson.qs.forEach((q,index)=>{if(q.type===templateType)fixtures.push({unit,lessonIndex,index});})));
  const variant=Math.max(0,Math.min(fixtures.length-1,Number(templateParams.get('variant'))||0)),fixture=fixtures[variant];
  if(fixture){
    ui=fixture.unit;li=fixture.lessonIndex;L=UNITS[ui].lessons[li];qi=fixture.index;TR=L.tr;t0=Date.now();show('q');render();
    $('quit').onclick=()=>location.assign('templates.html');$('quit').setAttribute('aria-label','返回题型模板');
    $('lessonPosition').textContent='模板 '+(variant+1)+' / '+fixtures.length;
    const state=templateParams.get('state')||'idle';
    if(templateType==='mini'){if(mini)mini.gen++;}
    if(state==='selected'){
      const first=$('hand').querySelector('.card:not(.dim)')||$('table').querySelector('.pickset .card,.pile .card.pick,.slot.pickable,.seatbtn[data-s],.opt');
      if(first)first.click();
      if(mini)mini.gen++;
    }
    if(state==='correct'||state==='wrong'){
      answered=true;if(mini){mini.gen++;const q=L.qs[qi],played=q.hands.map(h=>h[0]);$('table').innerHTML=trickHTML(played,q.lead,winnerOf(played,q.lead,TR),true);}
      sayFeedback(state==='correct',state==='correct'?(L.qs[qi].good||'这一手完成了。看看桌上的牌，再继续下一题。'):(L.qs[qi].bad||'再看看领出的花色，想一想这一手该怎么跟。'));
      $('btnRow').style.display='';syncStudyControls();
    }
    if(state==='waiting'){
      if(mini)mini.gen++;
      $('btnRow').style.display='none';$('verdict').textContent='对手正在出牌…';
      $('hand').querySelectorAll('.card').forEach(n=>{n.onclick=null;n.tabIndex=-1;n.setAttribute('aria-disabled','true');});
    }
    // Template navigation stays in this fixture and cannot complete a real lesson.
    $('cta').onclick=()=>{if(answered)render();else check();};
    $('doneBtn').onclick=()=>location.assign('templates.html');
    $('app').dataset.template='true';
  }else{drawMap();show('map');}
}else{setCat('idle');drawMap();show('map');}
