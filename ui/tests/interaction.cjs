const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
// Minimal output sink: test the actual controller state and engine, not layout or browser events.
function setup(){
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',className:'',disabled:false,hidden:false,open:false,scrollTop:0,
      setAttribute(){},addEventListener(){},focus(){},close(){this.open=false;},showModal(){this.open=true;}});
    return elements.get(id);
  };
  const document={getElementById:element,querySelectorAll:()=>[],addEventListener(){}};
  const window={addEventListener(){}};
  const context=vm.createContext({document,window,location:{search:'',origin:'http://localhost'},parent:{},URLSearchParams,console});
  for(const file of ['engine.js','table.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../dist',file),'utf8'),context,{filename:file});
  return{run:source=>vm.runInContext(source,context),element};
}
test('identical cards have separate IDs; selection persists through suit changes and overview',()=>{
  const {run,element}=setup();
  assert.equal(run('hand.length'),25);
  assert.equal(run('new Set(hand.map(c=>c.id)).size'),25);
  run("toggle(hand.find(c=>c.suit==='D'&&c.rank===10).id)");
  assert.equal(run('selected.size'),1);
  run("switchSuit('T'); openOverview(); $('sheet').close(); switchSuit('D')");
  assert.equal(run('selected.size'),1);
  assert.equal(element('submit').disabled,true);
  run('toggle([...selected][0])');
  assert.equal(run('selected.size'),0);
});
test('wrong suit, unpaired follow and excess selection cannot submit',()=>{
  const {run}=setup();
  for(const expression of ["hand.filter(c=>c.suit==='S').slice(0,2)","[hand.find(c=>c.suit==='D'&&c.rank===10),hand.find(c=>c.suit==='D'&&c.rank===8)]","hand.filter(c=>c.suit==='D').slice(0,3)"]){
    run(`selected.clear(); ${expression}.forEach(c=>toggle(c.id))`);
    assert.equal(run('legality().ok'),false);
    run('submit()');
    assert.equal(run('hand.length'),25);
    assert.equal(run('completed'),false);
  }
});
test('scoring depends on which pair was actually played; duplicate submit is harmless',()=>{
  for(const [r,expected,points] of [[10,95,40],[8,75,20]]){
    const {run,element}=setup();
    run(`hand.filter(c=>c.suit==='D'&&c.rank===${r}).forEach(c=>toggle(c.id))`);
    assert.equal(run('legality().ok'),true);
    run('submit()');
    assert.equal(run('score'),expected);
    assert.equal(run('hand.length'),23);
    assert.equal(run('selected.size'),0);
    assert.equal(run('completed'),true);
    assert.match(element('selectionStatus').innerHTML,new RegExp('\\+'+points+' 分'));
    // Once complete the same button restarts, never appends a fifth play.
    run('submit()');
    assert.equal(run('plays.length'),3);
    assert.equal(run('score'),55);
    assert.equal(run('hand.length'),25);
  }
});
test('four selected cards form a legal tractor and leave 21 cards',()=>{
  const {run}=setup();
  run("loadScene('lead'); hand.filter(c=>c.suit==='S'&&[11,12].includes(c.rank)).forEach(c=>toggle(c.id))");
  assert.equal(run('selected.size'),4);
  assert.equal(run('legality().ok'),true);
  assert.equal(run("E.classify(chosen(),trump).type"),'tractor');
  run('submit()');
  assert.equal(run('hand.length'),21);
  assert.equal(run('plays[0].cards.length'),4);
});
test('bury requires exactly eight, preserves cross-suit picks, and removes only selected IDs',()=>{
  const {run,element}=setup();
  run("loadScene('bury'); hand.slice(0,7).forEach(c=>toggle(c.id)); switchSuit('C')");
  assert.equal(run('hand.length'),33);
  assert.equal(run('legality().ok'),false);
  run("toggle(hand.find(c=>c.suit==='C').id); openOverview()");
  assert.equal(run('selected.size'),8);
  assert.equal(element('backToTable').disabled,false);
  run('toggle(hand.find(c=>!selected.has(c.id)).id)');
  assert.equal(run('legality().ok'),false);
  run('toggle([...selected].at(-1))');
  const remaining=run('JSON.stringify(hand.filter(c=>!selected.has(c.id)).map(c=>c.id))');
  run('submit()');
  assert.equal(run('hand.length'),25);
  assert.equal(run('resultCards.length'),8);
  assert.equal(run('JSON.stringify(hand.map(c=>c.id))'),remaining);
  assert.equal(element('sheet').open,false);
});
test('each effective suit stays sorted; malformed scenario falls back to follow',()=>{
  const {run}=setup();
  run("loadScene('bury')");
  assert.equal(run('groups().every(g=>g.cards.every((c,i)=>!i||E.ordIdx(g.cards[i-1],trump)>=E.ordIdx(c,trump)))'),true);
  run("loadScene('bogus')");
  assert.equal(run('scene'),'follow');
  assert.equal(run('hand.length'),25);
});
