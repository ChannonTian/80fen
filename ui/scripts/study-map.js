function catSuit(){return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10 3 3l6 4a13 13 0 0 1 6 0l6-4-1 7c5 12-21 12-16 0Z" fill="currentColor"/></svg>';}
function drawMap(){
  const total=UNITS.reduce((n,u)=>n+u.lessons.length,0);
  const finished=UNITS.reduce((n,u)=>n+Math.min(doneCount(u.key),u.lessons.length),0);
  const active=UNITS.findIndex((u,i)=>unlocked(i)&&doneCount(u.key)<u.lessons.length);
  const saved=readCheckpoint(),goUnit=saved?saved.ui:active,goLesson=saved?saved.li:active<0?0:doneCount(UNITS[active].key);
  const next=goUnit>=0?UNITS[goUnit].lessons[goLesson]:null;
  const percent=Math.round(finished/total*100);
  let html=`<div class="course-home"><header class="course-intro"><div class="coach-progress"><div class="progress-ring" role="progressbar" aria-label="课程完成进度" aria-valuenow="${finished}" aria-valuemin="0" aria-valuemax="${total}"><svg viewBox="0 0 88 88" aria-hidden="true"><circle class="ring-track" cx="44" cy="44" r="40"/><circle class="ring-value" cx="44" cy="44" r="40" pathLength="100" stroke-dasharray="${percent} 100"/></svg><span class="leo-avatar" role="img" aria-label="六六"></span></div><div><span class="eyebrow">六六陪你学牌</span><h1>${finished?'手里又多了点本领':'从一手牌开始'}</h1><p>已完成 <b>${finished}</b> / ${total} 课</p></div></div><div class="continue-row"><button class="btn" id="continueCourse">${next?'继续课程':'去打牌'}</button></div></header><div class="course-decks">`;
  UNITS.forEach((U,u)=>{
    const dn=Math.min(doneCount(U.key),U.lessons.length),open=unlocked(u),chosen=open?Math.min(dn,U.lessons.length-1):0;
    html+=`<details class="course-deck ${open?'available':'locked-unit'}" ${open?'open':''} data-deck="${u}" aria-labelledby="unit-${u}"><summary><div><small>${U.part}</small><h2 id="unit-${u}">${U.name.split(' · ')[1]||U.name}</h2></div><span class="deck-progress">${dn} / ${U.lessons.length}<i aria-hidden="true">⌄</i></span></summary><div class="lesson-fan" role="group" aria-label="${U.name}" style="--count:${U.lessons.length}">`;
    U.lessons.forEach((lesson,i)=>{
      const done=open&&i<dn,current=open&&i===dn,available=done||current,t=i-(U.lessons.length-1)/2;
      html+=`<div class="course-card ${done?'face':'back'} ${current?'current':''} ${available?'':'locked'} ${i===chosen?'previewed':''}" data-unit="${u}" data-lesson="${i}" style="--i:${i};--angle:${t*4}deg;--arc:${t*t*1.7}px"><span class="course-art"><span class="course-corner"><b>${i+1}</b>${catSuit()}</span>${done?'<span class="course-check" aria-hidden="true">✓</span>':`<span class="back-cat">${catSuit()}</span>`}<span class="course-stamp">${done?'已完成':current?'当前课程':'待解锁'}</span></span><button class="course-select" aria-pressed="${i===chosen}" aria-label="选择第 ${i+1} 课，${lesson.name}，${done?'已完成':current?'待学习':'未解锁'}"></button><button class="course-action" aria-label="${available?(done?'复习':'开始')+'：'+lesson.name:'未解锁：'+lesson.name}" ${available?'':'aria-disabled="true"'}>${available?(done?'复习':'开始'):'🔒'}</button></div>`;

    });
    html+=`</div><div class="lesson-preview" aria-live="polite" aria-atomic="true"><div><h3></h3><p></p></div></div></details>`;
  });
  html+=`</div><a class="template-link" href="templates.html">题型设计模板 ↗</a></div><nav class="study-bottom-nav" aria-label="模式"><a href="index.html"><span aria-hidden="true">♧</span>打牌</a><a href="learn.html" aria-current="page"><span class="nav-cat">${catSuit()}</span>学牌</a></nav>`;
  $('map').innerHTML=html;
  $('continueCourse').onclick=()=>next?start(goUnit,goLesson):location.assign('index.html');
  function preview(b){
    const u=+b.dataset.unit,i=+b.dataset.lesson,U=UNITS[u],lesson=U.lessons[i],dn=doneCount(U.key),open=unlocked(u),done=open&&i<dn,available=open&&i<=dn;
    const deck=b.closest('.course-deck');
    deck.querySelectorAll('.course-card').forEach(c=>{c.classList.toggle('previewed',c===b);c.querySelector('.course-select').setAttribute('aria-pressed',String(c===b));});
    deck.querySelector('h3').textContent=lesson.name;
    deck.querySelector('.lesson-preview p').textContent=(done?'已完成 · 可以复习':available?'待学习':'完成前面的课程后解锁')+' · '+lesson.mins+' 分钟';

  }
  $('map').querySelectorAll('.course-card').forEach(b=>{
    b.querySelector('.course-select').onclick=()=>preview(b);
    b.querySelector('.course-select').onfocus=()=>preview(b);
    b.onpointerenter=e=>{if(e.pointerType==='mouse')preview(b);};
    b.querySelector('.course-action').onclick=()=>{const u=+b.dataset.unit,i=+b.dataset.lesson;if(unlocked(u)&&i<=doneCount(UNITS[u].key))start(u,i);else preview(b);};

  });
  $('map').querySelectorAll('.course-card.previewed').forEach(preview);
}
