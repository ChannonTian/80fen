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
 *   --log-rounds   每一局记一行,写进 --log=FILE(默认 league-rounds.ndjson.gz)。
 *                  排名和申诉靠它复盘;逐墩记录量太大,不记。
 *   --log=FILE     逐局记录的去处。以 .gz 结尾就自动压缩。
 *   --plays=DIR    逐墩记录:每一对一个 <A>__<B>.ndjson.gz,写进 DIR。
 *                  一行一场,rounds[] 里一局一条,含发牌种子、底牌、扣牌和每一墩的出牌。
 *                  量是逐局记录的十几倍(一季 44 MB),排名和赛报都用不上它,
 *                  只在要把整季对局公开出去时才开。
 *   --out=FILE     结果写成 JSON,默认 league-result.json
 *   --resume       接着上次跑:断点文件里已经打完的对直接跳过
 *   --ckpt=FILE    断点文件,默认 <out>.ckpt.ndjson
 *
 * 每打完一对就往断点文件追加一行 —— 一整届联赛是几个钟头,只在最后写一次的话,
 * 中途掉一次进程就全没了。逐局记录同样一对一落盘:**每一对自成一个 gzip 成员**
 * 追加进同一个文件(多成员是合法 gzip,gunzip 会把它们连起来)。
 * 不用一条长 gzip 流,是因为流要 end() 才收尾 —— 进程被杀时整个文件都读不出来,
 * 断点就白留了。
 *
 * 为什么两两都要打:只对一个固定陪练打,优化目标会歪成「专治这一个对手」。
 * 两两对过局之后,靠一个对手的弱点吃分的选手在别人身上讨不到便宜。
 *
 * 规模是平方的:N 名选手 = C(N,2) 对。每对 30 副 ≈ 5 分钟单核,
 * 所以 17 名选手(16 人 + 陪练)= 136 对 ≈ 11 小时单核、8 核约 1.5 小时。
 */
'use strict';
const {fork}=require('child_process');
const os=require('os'), fs=require('fs'), path=require('path'), zlib=require('zlib');

const argv=process.argv.slice(2);
const opt=(k,d)=>{ const a=argv.find(x=>x.startsWith(`--${k}=`)); return a?a.slice(k.length+3):d; };
const has=k=>argv.includes(`--${k}`);
const files=argv.filter(a=>!a.startsWith('--'));

const SEEDS=+opt('seeds',30), SEED0=+opt('seed0',0);
const BUILD=process.env.BUILD||'index.html';
const OUT=opt('out','league-result.json');
const KEEP=has('log-rounds')||has('log-hands');   // --log-hands 是旧名字,留着不打断手上的脚本
const LOGF=opt('log','league-rounds.ndjson.gz');
/* 逐局记录**不进** league-result.json —— 300 副 × 3 对缩进过的 JSON 是几十兆,
 * 排行榜就没法看了。分开写成一行一局的 NDJSON,.gz 结尾自动压缩。 */
const RESUME=has('resume');
const CKPT=opt('ckpt', OUT+'.ckpt.ndjson');
const GZ=/\.gz$/.test(LOGF);
const PLAYS=opt('plays','');       // 逐墩记录的目录,空字符串 = 不记
if(PLAYS) fs.mkdirSync(PLAYS,{recursive:true});
if(KEEP && !RESUME && fs.existsSync(LOGF)) fs.unlinkSync(LOGF);
// 一对一落盘:攒好这一对的所有行,压成一个独立的 gzip 成员追加进去。
function appendRounds(text){
  if(!KEEP || !text) return;
  fs.appendFileSync(LOGF, GZ ? zlib.gzipSync(Buffer.from(text,'utf8')) : text);
}
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

/* 断点续跑:先把已完成的对读回来,再把它们从待跑清单里划掉。
 * 断点行里存的就是 takeResult 收下的那个对象(去掉逐局记录),
 * 所以吸收路径和现跑的完全一样,不存在「续跑出来的榜和一口气跑的不同」。 */
const doneKey=new Set();
const key=(a,b)=>a+'\u0000'+b;
const {playsName}=require('./pair-worker.js');
// 这一对的逐墩记录在不在、场数对不对得上。工人是先写 .part 再 rename,
// 所以能读出来的就是完整的;这里只需要数一数行数。
function playsOK(r){
  if(!PLAYS) return true;
  const f=path.join(PLAYS, playsName(r.a,r.b));
  if(!fs.existsSync(f)) return false;
  try{
    const txt=zlib.gunzipSync(fs.readFileSync(f)).toString('utf8');
    return txt.split('\n').filter(l=>l.trim()).length === r.winA+r.winB+r.draw;
  }catch(e){ return false; }
}
// 不是续跑就把旧断点清掉 —— 留着的话下次 --resume 会把上一届的对当成本届已完成
if(!RESUME && fs.existsSync(CKPT)) fs.unlinkSync(CKPT);
if(RESUME && fs.existsSync(CKPT)){
  let cand=[];
  for(const line of fs.readFileSync(CKPT,'utf8').split('\n')){
    if(!line.trim()) continue;
    let r; try{ r=JSON.parse(line); }catch(e){ continue; }   // 最后一行可能被截断
    if(!players.some(p=>p.id===r.a) || !players.some(p=>p.id===r.b)) continue;
    if(cand.some(x=>x.a===r.a&&x.b===r.b)) continue;
    cand.push(r);
  }
  /* 逐局记录是「先写记录、后写断点」,被杀时两边可能对不齐:
   *   记录有、断点没有 → 续跑会把这一对再打一遍,记录出现两份
   *   断点有、记录没有 → 这一对的逐局记录永远缺一块,而且没人会发现
   * 所以这里以**两边都有**为准,把记录按断点重写一遍,并把记录里缺的那些对
   * 从断点里划掉、重新跑。 */
  if(KEEP && fs.existsSync(LOGF)){
    let txt='';
    try{
      const raw=fs.readFileSync(LOGF);
      // Z_SYNC_FLUSH:最后一个 gzip 成员被截断时也把能解的都解出来,不整个抛
      txt=GZ ? zlib.gunzipSync(raw,{finishFlush:zlib.constants.Z_SYNC_FLUSH}).toString('utf8')
             : raw.toString('utf8');
    }catch(e){ txt=''; }
    const byPair=new Map();
    for(const line of txt.split('\n')){
      if(!line.trim()) continue;
      let o; try{ o=JSON.parse(line); }catch(e){ continue; }
      const k=key(o.a,o.b);
      (byPair.get(k)||byPair.set(k,[]).get(k)).push(line);
    }
    /* 只有「这一对的场数对得上」才算记录完整 —— 光看有没有会把写了一半的那一对
     * 当成好的收下,之后谁也发现不了它少了几十场。 */
    const before=cand.length;
    cand=cand.filter(r=>(byPair.get(key(r.a,r.b))||[]).length===r.winA+r.winB+r.draw);
    if(cand.length<before)
      console.log(`断点里有 ${before-cand.length} 对的逐局记录不全(场数对不上),这几对重跑`);
    const out=cand.map(r=>byPair.get(key(r.a,r.b)).join('\n')).join('\n');
    fs.writeFileSync(LOGF, GZ ? zlib.gzipSync(Buffer.from(out?out+'\n':'','utf8'))
                              : (out?out+'\n':''));
  }
  {
    const before=cand.length;
    cand=cand.filter(playsOK);
    if(cand.length<before)
      console.log(`断点里有 ${before-cand.length} 对的逐墩记录缺失或不全,这几对重跑`);
  }
  for(const r of cand){ doneKey.add(key(r.a,r.b)); absorb(r); }
  fs.writeFileSync(CKPT, cand.map(r=>JSON.stringify(r)).join('\n')+(cand.length?'\n':''));
}
const todo=pairs.filter(([i,j])=>!doneKey.has(key(players[i].id,players[j].id)));
if(RESUME) console.log(`断点 ${CKPT}:已完成 ${doneKey.size} 对,本次跑 ${todo.length} 对\n`);

function takeResult(r){
  if(r.err){ console.error(`  ! ${r.a} vs ${r.b}:${r.err}`); done++; return; }
  if(r.log && r.log.length){
    appendRounds(r.log.map(m=>JSON.stringify({a:r.a, b:r.b, seed:m.seed, aTeam:m.aTeam,
      winner:m.winner, levels:m.levels, rounds:m.rounds})).join('\n')+'\n');
  }
  delete r.log;
  absorb(r);
  fs.appendFileSync(CKPT, JSON.stringify(r)+'\n');
  done++;
  const el=(Date.now()-t0)/1000;
  process.stderr.write(`\r  ${done}/${todo.length} 对  ${el.toFixed(0)}s  ` +
    `预计还剩 ${(el/done*(todo.length-done)/60).toFixed(1)} 分钟      `);
}

function absorb(r){
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
}

function feed(w){
  if(next>=todo.length){ w.kill(); return; }
  const [i,j]=todo[next++];
  w.send({a:players[i], b:players[j], seeds:SEEDS, seed0:SEED0, build:BUILD,
          eg:has('eg'), keepHands:KEEP, keepPlays:PLAYS||null});
}

const workers=[];
for(let k=0;k<Math.min(JOBS,todo.length);k++){
  const w=fork(path.join(__dirname,'pair-worker.js'));
  workers.push(w);
  w.on('message', r=>{ takeResult(r); feed(w); finish(); });
  w.on('exit', ()=>finish());
  feed(w);
}
if(!todo.length) setImmediate(finish);

let reported=false;
function finish(){
  if(reported || done<todo.length) return;
  reported=true;
  workers.forEach(w=>{ try{ w.kill(); }catch(e){} });
  process.stderr.write('\r' + ' '.repeat(70) + '\r');
  report();
  if(KEEP) console.log(`→ ${LOGF}(${results.reduce((a,r)=>a+r.rounds,0)} 局逐局记录,一行一场)`);
  if(PLAYS) console.log(`→ ${PLAYS}/(逐墩记录,${results.filter(r=>r.playsFile).length} 对各一个文件)`);
  if(KEEP||PLAYS) console.log('');
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
    build:BUILD, jobs:JOBS, eg:has('eg'),
    table:rows.map(r=>({id:r.id,w:r.w,l:r.l,d:r.d,rate:r.rate,ms:r.ms,
      lvl:r.lvl,pts:r.pts,vioCount:r.vioCount,vioPts:r.vioPts,vioApplied:r.vioApplied,vioBy:r.vioBy,
      rounds:r.rounds,opp:r.opp})), pairs:results}, null, 2));
  console.log(`\n→ ${OUT}(积分榜与每一对的汇总)`);
}
