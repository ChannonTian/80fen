const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const F=require('../dist/fan.js');
// This fixture exercises controller handlers and rules, not rendered browser layout.
function setup(){
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id)){
      const classes=new Set(),events={},props={};
      elements.set(id,{innerHTML:'',textContent:'',value:'50',disabled:false,hidden:false,open:false,scrollTop:0,clientWidth:390,clientHeight:260,dataset:{},events,
        style:{setProperty:(k,v)=>props[k]=v,getPropertyValue:k=>props[k]||'0deg'},
        classList:{add:(...cs)=>cs.forEach(c=>classes.add(c)),remove:(...cs)=>cs.forEach(c=>classes.delete(c)),contains:c=>classes.has(c),toggle:(c,force)=>{const add=force??!classes.has(c);add?classes.add(c):classes.delete(c);}},
        setAttribute(){},addEventListener:(name,fn)=>events[name]=fn,setPointerCapture(){},focus(){},close(){this.open=false;},showModal(){this.open=true;},
        getBoundingClientRect:()=>id==='arena'?{left:0,right:390,top:70,bottom:410,width:390,height:340}:{left:0,right:390,top:464,bottom:724,width:390,height:260},
        firstElementChild:{textContent:''}});
    }
    return elements.get(id);
  };
  const document={body:element('body'),getElementById:element,querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){}};
  const window={innerWidth:390,innerHeight:844,addEventListener(){}};
  const context=vm.createContext({document,window,location:{href:'http://localhost/',search:'',origin:'http://localhost'},history:{replaceState(){}},parent:{},URL,URLSearchParams,console,ResizeObserver:class{observe(){}},requestAnimationFrame:f=>f(),setTimeout:()=>1,clearTimeout(){}});
  for(const file of ['engine.js','fan.js','table.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../dist',file),'utf8'),context,{filename:file});
  const run=source=>vm.runInContext(source,context);
  const pointer=(type,id,x,y)=>{
    const b=element('card'+id);b.dataset={card:String(id),row:'1'};b.closest=()=>b;
    element('fanViewport').events[type]({button:0,pointerId:1,clientX:x,clientY:y,target:b,preventDefault(){}});
  };
  return{run,element,pointer,window};
}
test('25 and 33 cards stay in two fans with unique IDs; main and counter suits lose no cards',()=>{
  const {run}=setup();
  for(const scene of ['follow','lead','bury','declare','counter']){
    run(`loadScene('${scene}')`);
    assert.equal(run('rowCards.length'),2);
    assert.equal(run('rowCards.flat().length'),scene==='bury'?33:25);
    assert.equal(run('new Set(rowCards.flat().map(c=>c.id)).size'),scene==='bury'?33:25);
    assert.equal(run('rowCards.every(r=>r.length<=17)'),true);
  }
});
test('same cards independently selected; sort and full hand preserve selection',()=>{
  const {run,element}=setup();
  run("toggle(hand.find(c=>c.suit==='D'&&c.rank===10).id)");
  element('sort').onclick();run("openOverview(); $('sheet').close()");
  assert.equal(run('selected.size'),1);
  assert.equal(element('tapPlay').disabled,true);
  run('toggle([...selected][0])');assert.equal(run('selected.size'),0);
});
test('valid selected pair can be dragged onto the table; points depend on actual cards',()=>{
  for(const [r,score,points] of [[10,95,40],[8,75,20]]){
    const {run,element,pointer}=setup();
    run(`hand.filter(c=>c.suit==='D'&&c.rank===${r}).forEach(c=>toggle(c.id))`);
    const id=run('[...selected][0]');pointer('pointerdown',id,180,600);pointer('pointermove',id,180,350);
    assert.equal(element('dragGhost').hidden,false);
    pointer('pointerup',id,180,350);
    assert.equal(run('completed'),true);assert.equal(run('score'),score);assert.equal(run('hand.length'),23);
    assert.match(element('instruction').textContent,new RegExp('\\+'+points+' 分'));
  }
});
test('drop outside returns cards; illegal pair cannot play; pointer cancellation restores snapshot',()=>{
  const {run,pointer}=setup();
  run("hand.filter(c=>c.suit==='D'&&c.rank===10).forEach(c=>toggle(c.id))");
  let id=run('[...selected][0]');pointer('pointerdown',id,180,600);pointer('pointermove',id,500,300);pointer('pointerup',id,500,300);
  assert.equal(run('completed'),false);assert.equal(run('selected.size'),2);assert.equal(run('hand.length'),25);
  run("selected.clear(); [hand.find(c=>c.suit==='D'&&c.rank===10),hand.find(c=>c.suit==='D'&&c.rank===8)].forEach(c=>toggle(c.id))");
  id=run('[...selected][0]');pointer('pointerdown',id,180,600);pointer('pointermove',id,180,300);pointer('pointerup',id,180,300);
  assert.equal(run('completed'),false);assert.equal(run('hand.length'),25);
  run('selected.clear()');pointer('pointerdown',id,180,600);pointer('pointermove',id,180,300);assert.equal(run('selected.size'),1);
  pointer('pointercancel',id,180,300);assert.equal(run('selected.size'),0);assert.equal(run('completed'),false);
});
test('horizontal scrub does not submit; a tap only toggles selection',()=>{
  const {run,pointer}=setup();const id=run("hand.find(c=>c.suit==='D'&&c.rank===10).id");
  pointer('pointerdown',id,160,600);pointer('pointerup',id,160,600);
  assert.equal(run('selected.size'),1);assert.equal(run('completed'),false);
  pointer('pointerdown',id,160,600);pointer('pointermove',id,230,602);pointer('pointerup',id,230,602);
  assert.equal(run('hand.length'),25);assert.equal(run('completed'),false);
});
test('tractor works; wrong-suit or unpaired follow is rejected',()=>{
  const {run}=setup();
  run("hand.filter(c=>c.suit==='S').slice(0,2).forEach(c=>toggle(c.id)); submit()");assert.equal(run('completed'),false);
  run("loadScene('lead');hand.filter(c=>c.suit==='S'&&[11,12].includes(c.rank)).forEach(c=>toggle(c.id))");
  assert.equal(run("E.classify(chosen(),trump).type"),'tractor');run('submit()');assert.equal(run('hand.length'),21);
});
test('bury requires exactly eight and makes the actual buried cards viewable',()=>{
  const {run,element}=setup();run("loadScene('bury');hand.slice(0,7).forEach(c=>toggle(c.id))");
  assert.equal(element('buryConfirm').disabled,true);run('submit()');assert.equal(run('hand.length'),33);
  run("toggle(hand.find(c=>c.suit==='C').id);openOverview()");assert.equal(element('sheetSubmit').disabled,false);
  run('toggle(hand.find(c=>!selected.has(c.id)).id)');assert.equal(run('legality().ok'),false);
  run('toggle([...selected].at(-1))');const buried=run('JSON.stringify(chosen().map(c=>c.id))');run('submit()');
  assert.equal(run('hand.length'),25);assert.equal(run('JSON.stringify(kittyCards.map(c=>c.id))'),buried);assert.equal(element('kitty').disabled,false);
});
test('declaration, reinforcement and counter-declaration follow engine permissions',()=>{
  const {run,element}=setup();run("loadScene('declare')");assert.equal(element('declare').disabled,false);assert.equal(element('reinforce').disabled,true);
  run("bid('declare')");assert.equal(run('declaration.strength'),1);assert.equal(element('reinforce').disabled,false);assert.equal(element('counter').disabled,true);
  run("bid('counter')");assert.equal(run('declaration.strength'),1);
  run("bid('reinforce')");assert.equal(run('declaration.strength'),2);assert.equal(run('hand.length'),25);
  run("loadScene('counter')");assert.equal(run('trump.suit'),'S');assert.equal(element('counter').disabled,false);
  run("bid('counter')");assert.equal(run('declaration.seat'),0);assert.equal(run('trump.suit'),'H');assert.equal(run('declaration.strength'),2);assert.equal(run('rowCards.flat().length'),25);
});
test('geometry preserves a readable exposed edge and recoverable horizontal bounds at phone widths',()=>{
  const cards=Array.from({length:33},(_,i)=>({id:i,suit:'D',rank:2+Math.floor(i/2)}));
  const rows=F.split(cards);assert.equal(rows.flat().length,33);assert.ok(rows.every(r=>r.length<=17));
  for(const [w,h] of [[320,210],[375,218],[390,261],[430,274]])for(let row=0;row<2;row++){
    const l=F.layout(rows[row],w,h,row);
    assert.ok(l.cards.slice(1).every((c,i)=>c.x-l.cards[i].x>=22.99));
    assert.ok(l.cards[0].x>=17);assert.ok(l.cards.at(-1).x+l.cardWidth<=l.width-17);
    assert.ok(l.cards.every(c=>c.y+c.height<=h+1));
  }
  assert.equal(F.intent(40,2),'scrub');assert.equal(F.intent(3,-30),'drag');assert.equal(F.intent(2,2),'pending');
});


test('wide plan fits 25 cards on a phone and 33 on tablet/desktop without shrinking exposed edges',()=>{
  const cards=Array.from({length:33},(_,id)=>({id,suit:'S',rank:2+Math.floor(id/2)}));
  for(const [width,height,count,expectedTwo] of [[568,320,25,false],[750,390,25,false],[844,390,33,false],[768,1024,33,true],[1024,768,33,false],[1320,900,33,false]]){
    const plan=F.widePlan(cards.slice(0,count),width,height);
    assert.equal(plan.twoRows,expectedTwo);assert.equal(plan.rows.flat().length,count);
    assert.equal(new Set(plan.rows.flat().map(c=>c.id)).size,count);
    for(const l of plan.layouts){
      assert.ok(l.cards.every(c=>c.y+c.height<=plan.height));
      assert.ok(l.cards.slice(1).every((c,i)=>c.x-l.cards[i].x>=23.99));
    }
    if(width>=1024||count===25&&width>=750)assert.ok(plan.layouts.every(l=>l.width<=width+.01));
    if(height===320)assert.ok(plan.height+42+50+90<=320);
  }
  assert.equal(F.isWide(390,844,'auto'),false);
  assert.equal(F.isWide(844,390,'auto'),true);
  assert.equal(F.isWide(768,1024,'auto'),true);
  assert.equal(F.isWide(1440,900,'portrait'),false);
  assert.equal(F.isWide(390,844,'wide'),false);
});
test('rotation and layout switching retain selection and trick state',()=>{
  const {run,element,window}=setup();
  run("hand.filter(c=>c.suit==='D'&&c.rank===10).forEach(c=>toggle(c.id))");
  window.innerWidth=844;window.innerHeight=390;element('fanViewport').clientWidth=844;
  run('renderHand()');assert.equal(run('wideLayout'),true);assert.equal(run('rowCards[1].length'),0);assert.equal(run('selected.size'),2);assert.equal(run('plays.length'),3);
  run("setLayout('portrait')");assert.equal(run('wideLayout'),false);assert.equal(run('selected.size'),2);
  run("setLayout('auto');submit()");assert.equal(run('score'),95);assert.equal(run('hand.length'),23);
  window.innerWidth=390;window.innerHeight=844;element('fanViewport').clientWidth=390;
  run('renderHand()');assert.equal(run('wideLayout'),false);assert.equal(run('completed'),true);assert.equal(run('score'),95);
});
