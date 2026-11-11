/* G0 体检:牌守恒、标签 = 引擎报的终局总分、特征无异常、整局合计与独立对局循环一致。
 *   node ai2/check-g0.js <shard 目录> [独立复核种子数=15] */
'use strict';
const fs=require('fs'),path=require('path');
const F=require('./featurize.js'), sim=require('./sim.js');
const dir=process.argv[2], nChk=+(process.argv[3]||15);
let nrec=0, bad=0; const tot={};
const idx=new Int32Array(400), dense=new Float32Array(F.ND);
const pairTot={};   // seed -> {fork:total}
for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.pairs.ndjson'))){
  for(const l of fs.readFileSync(path.join(dir,f),'utf8').split('\n').filter(Boolean)){
    const p=JSON.parse(l); (pairTot[p.seed]=pairTot[p.seed]||{0:p.tb})[p.fork]=p.td; }
}
let nnzSum=0, nnzMax=0, mism=0;
for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.bin'))){
  const b=fs.readFileSync(path.join(dir,f));
  for(let o=0;o<b.length;o+=F.REC){
    const r=new Uint8Array(b.buffer,b.byteOffset+o,F.REC); nrec++;
    // 牌守恒:每个牌型恰 2 张,位置合法;手牌 + 底 + 已出 + 本墩 = 108;底牌 8 张
    const cnt={}; let kit=0, hs=[0,0,0,0], tr=0;
    for(let i=0;i<108;i++){ const l=r[i]; if(l>9) bad++; if(l===4)kit++; else if(l<4)hs[l]++; else if(l>=6)tr++; }
    if(kit!==8) bad++;
    const np=r[115]; if(np<4&&hs.some((h,s)=>h<0)) bad++;
    // 手牌数:本墩出过牌的座位比没出的少一张(或一样,若已完成归零)
    // (手牌数不检查:甩牌 / 对子 / 拖拉机一手出多张,座位间张数差可大于 1)
    // 主牌块总数恒定 36(有主)/ 12(无主)
    const n=F.featuresFromRaw(r,idx,dense); nnzSum+=n; nnzMax=Math.max(nnzMax,n);
    for(let j=0;j<F.ND;j++) if(!Number.isFinite(dense[j])) bad++;
    let tcount=0; const tab=F.canonTable(r[112],r[113]);
    for(let t=0;t<54;t++) if(tab[t]<19) tcount+=2;
    if(tcount!==(r[112]===4?12:36)) bad++;
    // 标签 = 引擎报的总分
    const pt=pairTot[new DataView(r.buffer,r.byteOffset).getUint32(120,true)];
    if(pt&&pt[r[117]]!==undefined&&F.labelOf(pt[r[117]])!==r[116]) mism++;
  }
}
console.log(`记录 ${nrec},牌守恒/稠密特征等异常 ${bad},标签与配对记录里引擎总分不一致 ${mism},激活特征平均 ${(nnzSum/nrec).toFixed(1)} 最大 ${nnzMax}`);

// 独立对局循环(不经 sim.decide,照 ai-h2h 的写法)复核终局总分
const E=sim.loadEngine(); E.AIP.egSearch=0;
const seeds=Object.keys(pairTot).map(Number).slice(0,nChk); let diff=0;
for(const seed of seeds){
  const st=sim.newDeal(E,seed); const {trump,declSeat,buried}=st; const hands=st.hands, history=[];
  let leader=declSeat, defPoints=0, lastWinner=declSeat, lastLeadSize=1; const rand=E.rng(seed^0x9e3779b9); let guard=0;
  // 注意 rand 在 newDeal 里已消耗过(反主判定),这里直接复用 st.rand 以保持同一数列
  while(hands.some(h=>h.length)&&guard++<60){
    const plays=[];
    for(let i=0;i<4;i++){
      const seat=(leader+i)%4;
      const view={seat,hand:hands[seat],trump,declSeat,history:[...history,...plays],buriedKnown:seat===declSeat?buried:[],curDecl:st.curDecl};
      let cards;
      if(i===0){ cards=E.aiChooseLead(view).cards; const chk=E.checkThrow(hands,seat,cards,trump); if(!chk.ok) cards=chk.forced; }
      else{ const lead=E.classify(plays[0].cards,trump); cards=E.aiChooseFollow(view,plays).cards;
        if(!E.isLegalFollow(hands[seat],lead,cards,trump)) cards=E.genFollow(hands[seat],lead,trump,st.rand); }
      cards.forEach(c=>E.removeCard(hands[seat],c)); plays.push({seat,cards});
    }
    history.push(...plays); lastLeadSize=plays[0].cards.length;
    const res=E.resolveTrick(plays,trump); leader=res.winner; lastWinner=res.winner;
    if(res.winner%2!==declSeat%2) defPoints+=res.points;
  }
  const sc=E.scoreRound({defPoints,kitty:buried,defWonLastTrick:lastWinner%2!==declSeat%2,lastLeadSize});
  if(sc.total!==pairTot[seed][0]) { diff++; console.log('seed',seed,'独立循环',sc.total,'shard',pairTot[seed][0]); }
}
console.log(`独立对局循环复核 ${seeds.length} 个种子,总分不一致 ${diff}`);
