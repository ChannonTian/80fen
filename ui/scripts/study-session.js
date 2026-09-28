// A checkpoint resumes the current question; an unfinished mini-game restarts its hand.
const studyStore={
  get(key){try{return localStorage.getItem(LS+key);}catch{return null;}},
  set(key,value){try{localStorage.setItem(LS+key,value);}catch{}},
  remove(key){try{localStorage.removeItem(LS+key);}catch{}}
};
function readCheckpoint(){
  try{
    const s=JSON.parse(studyStore.get('checkpoint'));
    if(!s||s.version!==1||![s.ui,s.li,s.qi,s.wrong,s.elapsed].every(Number.isInteger))return null;
    const unit=UNITS[s.ui],lesson=unit&&unit.lessons[s.li];
    if(!lesson||!unlocked(s.ui)||s.li>doneCount(unit.key)||s.qi<0||s.qi>=lesson.qs.length||s.wrong<0||s.elapsed<0)return null;
    return s;
  }catch{return null;}
}
function saveCheckpoint(){
  if(new URLSearchParams(location.search).has('template'))return;
  if(!L||$('app').dataset.screen!=='q'||qi>=L.qs.length)return;
  studyStore.set('checkpoint',JSON.stringify({version:1,ui,li,qi,wrong,elapsed:Math.max(0,Date.now()-t0)}));
}
function pauseLesson(){
  saveCheckpoint();
  if(mini)mini.gen++;
  document.querySelectorAll('.flyer').forEach(n=>n.remove());
}
window.addEventListener('pagehide',pauseLesson);
document.addEventListener('visibilitychange',()=>{if(document.hidden)saveCheckpoint();});
// Make the existing selectable cards and seats usable with keyboards and screen readers.
function syncStudyControls(){
  ['table','hand'].forEach(id=>$(id).querySelectorAll('.card,.slot,.opt,.seatbtn').forEach(n=>{
    if(typeof n.onclick!=='function')return;
    const disabled=answered||n.classList.contains('dim')||(id==='hand'&&L&&L.qs[qi].type==='mini'&&(mini.turn!==0||mini.busy));
    if(n.tagName!=='BUTTON'){
      n.setAttribute('role','button');n.tabIndex=disabled?-1:0;
      n.onkeydown=e=>{if(!disabled&&(e.key==='Enter'||e.key===' ')){e.preventDefault();n.click();}};
    }
    n.setAttribute('aria-disabled',String(disabled));
    n.setAttribute('aria-pressed',String(n.classList.contains('sel')||n.classList.contains('selslot')));
    if(n.classList.contains('card')){
      const suit={sH:'红桃',sS:'黑桃',sD:'方块',sC:'梅花'};
      const s=Object.keys(suit).find(c=>n.classList.contains(c));
      const r=n.querySelector('.tl');
      n.setAttribute('aria-label',(s?suit[s]:'')+(r?r.textContent:n.textContent.trim())+(n.classList.contains('jb')||n.classList.contains('js')?'王':''));
    }
  }));
}
const studyObserver=new MutationObserver(syncStudyControls);
['table','hand'].forEach(id=>studyObserver.observe($(id),{childList:true,subtree:true,attributes:true,attributeFilter:['class']}));
let fitQueued=false;
new ResizeObserver(()=>{
  if(fitQueued||$('app').dataset.screen!=='q')return;
  fitQueued=true;requestAnimationFrame(()=>{fitQueued=false;fitTable();});
}).observe($('board'));
