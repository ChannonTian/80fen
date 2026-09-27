function drawMap(){
  const total=UNITS.reduce((n,u)=>n+u.lessons.length,0);
  const finished=UNITS.reduce((n,u)=>n+Math.min(doneCount(u.key),u.lessons.length),0);
  const active=UNITS.findIndex((u,i)=>unlocked(i)&&doneCount(u.key)<u.lessons.length);
  const next=active>=0?UNITS[active].lessons[doneCount(UNITS[active].key)]:null;
  let html=`<header class="study-nav"><a class="study-brand" href="index.html">80<span>分</span></a><nav class="mode-nav" aria-label="模式"><a href="index.html">打牌</a><span aria-current="page">学一手</span></nav><span class="study-total">已学 ${finished} / ${total} 课</span></header>
    <div class="study-content"><section class="study-welcome"><span class="leo-avatar" role="img" aria-label="六六"></span><div><span class="eyebrow">六六的牌桌小课</span><h1>一起学打牌</h1><p>先看牌，再动手。每次只练一个本领。</p></div></section>`;
  if(next) html+=`<section class="next-lesson"><div class="next-top"><span>${finished?'接着练':'从这里开始'}</span><span>约 ${next.mins} 分钟</span></div><h2>${next.name}</h2><p>${UNITS[active].name} · 第 ${doneCount(UNITS[active].key)+1} 课</p><button class="btn" data-go="${active}">${finished?'继续这门课':'和六六练一手'} <span aria-hidden="true">→</span></button></section>`;
  else html+=`<section class="next-lesson"><h2>这些本领，你都练过了。</h2><p>可以复习下面的课程，也可以去牌桌试一手。</p><a class="learn-link" href="index.html">去打牌 →</a></section>`;
  html+='<div class="course-heading"><h2>你的牌技手册</h2><span>一步一步来</span></div><div class="course-list">';
  UNITS.forEach((U,u)=>{
    const dn=Math.min(doneCount(U.key),U.lessons.length),open=unlocked(u),full=dn===U.lessons.length;
    html+=`<details class="course-unit ${open?'':'locked'}" ${open&&!full?'open':''}><summary><span class="unit-number">${String(u+1).padStart(2,'0')}</span><span class="unit-title"><small>${U.part}</small><strong>${U.name.split(' · ')[1]}</strong></span><span class="unit-progress">${open?dn+' / '+U.lessons.length:'未解锁'}</span><span class="unit-chevron" aria-hidden="true">⌄</span></summary><div class="lesson-list">`;
    U.lessons.forEach((lesson,i)=>{
      const done=open&&i<dn,current=open&&i===dn,available=done||current;
      html+=`<button class="lesson-row ${current?'current':''} ${done?'completed':''}" data-unit="${u}" data-lesson="${i}" ${available?'':'disabled'} ${current?'aria-current="step"':''}><span class="lesson-card">${done?'✓':lesson.rank}</span><span class="lesson-title"><strong>${lesson.name}</strong><small>${done?'已学 · 可以再练':current?'现在可以开始':'完成前一课解锁'}</small></span><span class="lesson-meta">${lesson.mins} 分钟 ${available?'↗':''}</span></button>`;
    });
    html+='</div></details>';
  });
  html+='</div></div>';
  $('map').innerHTML=html;
  $('map').querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>{const u=+b.dataset.go;start(u,doneCount(UNITS[u].key));});
  $('map').querySelectorAll('[data-lesson]').forEach(b=>b.onclick=()=>{const u=+b.dataset.unit,i=+b.dataset.lesson;if(unlocked(u)&&i<=doneCount(UNITS[u].key))start(u,i);});
}
