/* 联赛 —— 所有选手两两对过局,出积分榜。
 *
 *   node contest/league.js <选手1> <选手2> ... [选项]
 *
 * 选手可以是一个 .js,也可以是一个目录(入口 index.js)—— 他们要装下自己写的引擎。
 * 陪练(contest/ai-baseline.js)默认作为一名选手加进去,和别人一样打,`--no-house` 去掉。
 *
 * 选项:
 *   --seeds=30     每一对跑多少副牌(每副打两场,交换阵营)。默认 30
 *   --jobs=N       并行进程数,默认按 CPU 核数
 *   --eg           给自家陪练开收官蒙特卡洛(慢 4 倍)
 *   --log-hands    把每一手牌都记下来(数据量很大,只在要复盘某一对时开)
 *   --out=FILE     结果写成 JSON,默认 league-result.json
 *
 * 为什么两两都要打:只对一个固定陪练打,优化目标会歪成「专治这一个对手」。
 * 两两对过局之后,靠一个对手的弱点吃分的选手在别人身上讨不到便宜。
 *
 * 规模是平方的:N 名选手 = C(N,2) 对。每对 30 副 ≈ 5 分钟单核,
 * 所以 17 名选手(16 人 + 陪练)= 136 对 ≈ 11 小时单核、8 核约 1.5 小时。
 */
'use strict';
const {fork}=require('child_process');
const os=require('os'), fs=require('fs'), path=require('path');

const argv=process.argv.slice(2);
const opt=(k,d)=>{ const a=argv.find(x=>x.startsWith(`--${k}=`)); return a?a.slice(k.length+3):d; };
const has=k=>argv.includes(`--${k}`);
const files=argv.filter(a=>!a.startsWith('--'));

const SEEDS=+opt('seeds',30), SEED0=+opt('seed0',0);
const BUILD=process.env.BUILD||'index.html';
const OUT=opt('out','league-result.json');
const JOBS=Math.max(1, +opt('jobs', Math.max(1, os.cpus().length-1)));

const players=files.map((p,i)=>({id:path.basename(p).replace(/\.js$/,''), path:p, idx:i}));
const HOUSE='contest/ai-baseline.js';
if(!has('no-house') && !players.some(p=>p.path===HOUSE))
  players.push({id:'陪练', path:HOUSE, idx:players.length});
if(players.length<2){
  console.error('至少要两名选手。用法: node contest/league.js <选手1> <选手2> ... [--seeds=30]');
  process.exit(1);
}

// 所有对
const pairs=[];
for(let i=0;i<players.length;i++) for(let j=i+1;j<players.length;j++) pairs.push([i,j]);

console.log(`\n联赛:${players.length} 名选手,${pairs.length} 对,每对 ${SEEDS} 副牌 × 交换阵营`);
console.log(`选手:${players.map(p=>p.id).join('、')}`);
console.log(`并行 ${JOBS} 进程,引擎 ${BUILD}\n`);

// 每名选手的累计
const T=players.map(p=>({id:p.id, w:0, l:0, d:0, rounds:0,
  lvl:[], pts:[], vioCount:0, vioPts:0, vioApplied:0, vioBy:{}, ms:0, crashed:0, opp:{}}));

let done=0, next=0;
const t0=Date.now();
const results=[];

function takeResult(r){
  if(r.err){ console.error(`  ! ${r.a} vs ${r.b}:${r.err}`); done++; return; }
  results.push(r);
  const ia=players.findIndex(p=>p.id===r.a), ib=players.findIndex(p=>p.id===r.b);
  const A=T[ia], B=T[ib];
  A.w+=r.winA; A.l+=r.winB; A.d+=r.draw;
  B.w+=r.winB; B.l+=r.winA; B.d+=r.draw;
  A.rounds+=r.rounds; B.rounds+=r.rounds;
  A.crashed+=r.crashed; B.crashed+=r.crashed;
  for(const x of r.pairL){ A.lvl.push(x); B.lvl.push(-x); }
  for(const x of r.pairP){ A.pts.push(x); B.pts.push(-x); }
  const mv=(dst,v)=>{ dst.vioCount+=v.count; dst.vioPts+=v.pts; dst.vioApplied+=v.applied; dst.ms+=v.ms;
    for(const k in v.by) dst.vioBy[k]=(dst.vioBy[k]||0)+v.by[k]; };
  mv(A,r.vio.a); mv(B,r.vio.b);
  A.opp[r.b]=`${r.winA}-${r.winB}`; B.opp[r.a]=`${r.winB}-${r.winA}`;
  done++;
  const el=(Date.now()-t0)/1000;
  process.stderr.write(`\r  ${done}/${pairs.length} 对  ${el.toFixed(0)}s  ` +
    `预计还剩 ${(el/done*(pairs.length-done)/60).toFixed(1)} 分钟      `);
}

function feed(w){
  if(next>=pairs.length){ w.kill(); return; }
  const [i,j]=pairs[next++];
  w.send({a:players[i], b:players[j], seeds:SEEDS, seed0:SEED0, build:BUILD,
          eg:has('eg'), keepHands:has('log-hands')});
}

const workers=[];
for(let k=0;k<Math.min(JOBS,pairs.length);k++){
  const w=fork(path.join(__dirname,'pair-worker.js'));
  workers.push(w);
  w.on('message', r=>{ takeResult(r); feed(w); finish(); });
  w.on('exit', ()=>finish());
  feed(w);
}

let reported=false;
function finish(){
  if(reported || done<pairs.length) return;
  reported=true;
  workers.forEach(w=>{ try{ w.kill(); }catch(e){} });
  process.stderr.write('\r' + ' '.repeat(70) + '\r');
  report();
  process.exit(0);
}

function stat(a){ if(!a.length) return {m:0,se:0,n:0};
  const n=a.length, m=a.reduce((x,y)=>x+y,0)/n;
  const sd=Math.sqrt(a.reduce((x,y)=>x+(y-m)*(y-m),0)/n);
  return {m, se:sd/Math.sqrt(n), n}; }

function report(){
  const rows=T.map(t=>{
    const L=stat(t.lvl), P=stat(t.pts);
    const games=t.w+t.l+t.d;
    return {...t, games, rate:games?t.w/games:0, lvl:L, pts:P,
            finePerRound: t.rounds?t.vioApplied/t.rounds:0};
  }).sort((a,b)=> b.rate-a.rate || b.lvl.m-a.lvl.m);

  console.log(`\n═══ 积分榜(${((Date.now()-t0)/60000).toFixed(1)} 分钟)═══\n`);
  const pad=(s,n)=>String(s)+' '.repeat(Math.max(0,n-[...String(s)].reduce((a,c)=>a+(c.charCodeAt(0)>127?2:1),0)));
  console.log(pad('名次',6)+pad('选手',18)+pad('胜-负',10)+pad('胜率',8)+
              pad('净胜级/场',16)+pad('每局净分',11)+pad('罚分/局',10)+pad('违规',8));
  console.log('─'.repeat(88));
  rows.forEach((r,i)=>{
    console.log(pad(i+1,6)+pad(r.id,18)+pad(`${r.w}-${r.l}${r.d?'-'+r.d:''}`,10)+
      pad((100*r.rate).toFixed(1)+'%',8)+
      pad(`${r.lvl.m>=0?'+':''}${r.lvl.m.toFixed(2)} ±${r.lvl.se.toFixed(2)}`,16)+
      pad(`${r.pts.m>=0?'+':''}${(r.pts.m/2).toFixed(2)}`,11)+
      pad(r.finePerRound.toFixed(2),10)+
      pad(r.vioCount||'—',8));
  });

  const dirty=rows.filter(r=>r.vioCount>0);
  if(dirty.length){
    console.log('\n违规明细(出非法牌按「裁判替出几张 × 5 分」罚,罚分记给对方队,每局封顶在输光):');
    const SOFT=['onDeal:压不过当前亮主'];
    for(const r of dirty){
      const hard={}, soft={};
      for(const k in r.vioBy) (SOFT.includes(k)?soft:hard)[k]=r.vioBy[k];
      console.log(`  ${r.id}:${r.vioCount} 次,实际罚掉 ${r.vioApplied} 分`+
                  `(名义 ${r.vioPts})  ${JSON.stringify(hard)}`);
      if(Object.keys(soft).length)
        console.log(`      (不计违规、不罚分:${JSON.stringify(soft)})`);
    }
  }
  const crashed=rows.filter(r=>r.crashed>0);
  if(crashed.length)
    console.log('\n场次崩溃:' + crashed.map(r=>`${r.id} ${r.crashed}`).join('、'));

  console.log('\n对战表(行 vs 列,胜-负):');
  const w=Math.max(...rows.map(r=>[...r.id].reduce((a,c)=>a+(c.charCodeAt(0)>127?2:1),0)))+2;
  console.log(pad('',w)+rows.map(r=>pad(r.id,w)).join(''));
  for(const r of rows)
    console.log(pad(r.id,w)+rows.map(c=>pad(r.id===c.id?'—':(r.opp[c.id]||'?'),w)).join(''));

  fs.writeFileSync(OUT, JSON.stringify({players:players.map(p=>p.id), seeds:SEEDS,
    build:BUILD, table:rows.map(r=>({id:r.id,w:r.w,l:r.l,d:r.d,rate:r.rate,
      lvl:r.lvl,pts:r.pts,vioCount:r.vioCount,vioPts:r.vioPts,vioApplied:r.vioApplied,vioBy:r.vioBy,
      rounds:r.rounds,opp:r.opp})), pairs:results}, null, 2));
  console.log(`\n→ ${OUT}(含每一对的完整数据${has('log-hands')?'与逐手记录':''})\n`);
}
