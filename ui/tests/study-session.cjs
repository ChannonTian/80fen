const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function setup(){
  const storage=new Map(),events={},elements={app:{dataset:{screen:'q'}},board:{},table:{},hand:{}};
  const context=vm.createContext({
    LS:'test-',URLSearchParams,location:{search:''},UNITS:[{key:'u1',lessons:[{qs:[{},{}]},{qs:[{}]}]},{key:'u2',lessons:[{qs:[{}]}]}],
    ui:0,li:0,qi:1,wrong:2,t0:Date.now()-2000,L:{qs:[{},{}]},mini:{gen:1},
    $:id=>elements[id],document:{addEventListener:(n,fn)=>events[n]=fn,querySelectorAll:()=>[]},
    window:{addEventListener:(n,fn)=>events[n]=fn},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    MutationObserver:class{observe(){}},ResizeObserver:class{observe(){}},requestAnimationFrame:fn=>fn(),fitTable(){}
  });
  const run=s=>vm.runInContext(s,context);
  run(fs.readFileSync(require.resolve('../scripts/study-session.js'),'utf8'));
  run("const doneCount=k=>Number(studyStore.get(k)||0);const unlocked=u=>u===0||doneCount('u1')>=2;");
  return {run,storage,events,elements};
}
test('lesson pause saves current question and invalidates in-flight AI callbacks',()=>{
  const {run}=setup();run('pauseLesson()');
  assert.equal(run('mini.gen'),2);assert.equal(run('readCheckpoint().qi'),1);
  assert.equal(run('readCheckpoint().wrong'),2);assert.ok(run('readCheckpoint().elapsed')>=2000);
});
test('checkpoint ignores corrupt, obsolete, locked or out-of-range saved lessons',()=>{
  const {run,storage}=setup();
  for(const patch of [{version:2},{ui:-1},{ui:1},{li:1},{qi:2},{qi:-1},{wrong:-1},{elapsed:-1},{qi:0.2}]){
    storage.set('test-checkpoint',JSON.stringify({version:1,ui:0,li:0,qi:0,wrong:0,elapsed:0,...patch}));
    assert.equal(run('readCheckpoint()'),null);
  }
  storage.set('test-checkpoint','{broken');assert.equal(run('readCheckpoint()'),null);
});
test('storage refusal does not prevent lessons from running; completed lessons leave no checkpoint',()=>{
  const {run,storage}=setup();run('saveCheckpoint();studyStore.remove("checkpoint");qi=2;saveCheckpoint();');
  assert.equal(storage.size,0);
  run('localStorage.getItem=localStorage.setItem=localStorage.removeItem=()=>{throw Error("blocked")};qi=0;pauseLesson();studyStore.remove("checkpoint");');
  assert.equal(run('readCheckpoint()'),null);
});
test('leaving an inactive course does not overwrite its checkpoint',()=>{
  const {run,elements,events,storage}=setup();run('saveCheckpoint()');
  const before=storage.get('test-checkpoint');elements.app.dataset.screen='map';run('qi=0');events.pagehide();
  assert.equal(storage.get('test-checkpoint'),before);
});
test('design templates never overwrite a saved lesson checkpoint',()=>{
  const {run,storage}=setup();run('saveCheckpoint()');const before=storage.get('test-checkpoint');
  run("location.search='?template=trickpick&state=selected';qi=0;pauseLesson()");
  assert.equal(storage.get('test-checkpoint'),before);
});
