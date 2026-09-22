/* 发出去的牌谱格式,和现在的裁判还对不对得上。
 *
 *   node test/season-format.js
 *
 * 仓库根的 `FORMAT.md` 和 `replay.js` 是**发出去的契约**(两季共用一份) —— 参赛者照着它读牌谱。
 * 裁判这边 `playRound` 的逐墩结构一改,那边就静默读错:字段少了会读到 undefined,
 * 键改了名会整节消失,而 gzip 里的 NDJSON 不会有任何一处报错。
 *
 * 所以这里现跑两场、现写一份逐墩记录,再拿**参赛 repo 里那份 replay.js** 去渲染。
 * replay.js 自己每渲染一局就验三条(四家 25 张 + 底 8 张 = 108、plays 长度 == 墩数、
 * 逐墩加出来的分 == rawTotal),任何一条不成立它就在输出里打一行 `!`。
 * 我们要的就是「一行 ! 都没有」。
 *
 * 参赛 repo 不在旁边就跳过。
 */
'use strict';
const fs=require('fs'), path=require('path'), cp=require('child_process'), zlib=require('zlib');

const ROOT=path.join(__dirname,'..');
const CONTEST=path.join(ROOT,'..','80fen-contest');
const REPLAY=path.join(CONTEST,'replay.js');
const SUB=path.join(CONTEST,'submissions');

if(!fs.existsSync(REPLAY)||!fs.existsSync(SUB)){
  console.log('跳过:参赛 repo 不在旁边');
  process.exit(0);
}

let pass=0, fail=0;
const ok=(n,c,d)=>{ if(c){pass++;console.log(`  ✓ ${n}`);} else {fail++;console.log(`  ✗ ${n}${d?'  '+d:''}`);} };

const TMP=fs.mkdtempSync(path.join(require('os').tmpdir(),'season-fmt-'));
const PLAYS=path.join(TMP,'plays');
fs.mkdirSync(PLAYS,{recursive:true});

// 现跑两副牌,写一份逐墩记录
const r=cp.spawnSync('node',[path.join(ROOT,'contest','league.js'),
  path.join(SUB,'claude-opus-5'), path.join(SUB,'kimi-k3'),
  '--no-house','--seeds=2','--jobs=1','--log-rounds',
  `--log=${path.join(TMP,'rounds.ndjson.gz')}`, `--plays=${PLAYS}`,
  `--out=${path.join(TMP,'league.json')}`],{cwd:ROOT, encoding:'utf8'});
const files=fs.existsSync(PLAYS)?fs.readdirSync(PLAYS).filter(f=>f.endsWith('.gz')):[];
ok('跑出一份逐墩记录', files.length===1, (r.stderr||'').slice(-200));
if(files.length!==1){ console.log(`\n通过 ${pass} 项,失败 ${fail} 项`); process.exit(1); }
const F=path.join(PLAYS, files[0]);

// 逐墩是逐局的严格超集
{
  const rd=f=>zlib.gunzipSync(fs.readFileSync(f),{finishFlush:zlib.constants.Z_SYNC_FLUSH})
    .toString('utf8').split('\n').filter(Boolean).map(JSON.parse);
  const R=rd(path.join(TMP,'rounds.ndjson.gz')), P=rd(F);
  let bad='';
  if(R.length!==P.length) bad=`场数 ${R.length} vs ${P.length}`;
  for(let i=0;i<R.length&&!bad;i++){
    for(const k of ['a','b','seed','aTeam','winner','levels'])
      if(JSON.stringify(R[i][k])!==JSON.stringify(P[i][k])) bad=`场级字段 ${k}`;
    for(let j=0;j<R[i].rounds.length&&!bad;j++)
      for(const f in R[i].rounds[j])
        if(JSON.stringify(R[i].rounds[j][f])!==JSON.stringify(P[i].rounds[j][f])){ bad=`局级字段 ${f}`; break; }
  }
  ok('逐墩记录是逐局记录的严格超集', !bad, bad);
}

// 参赛 repo 的 replay.js 读得动,而且它自己的三条校验全过
{
  const seeds=[1,2];
  let warn=[], rounds=0;
  for(const s of seeds){
    const x=cp.spawnSync('node',[REPLAY,F,String(s),'--hands'],{encoding:'utf8',maxBuffer:1e9});
    if(x.status!==0){ warn.push(`replay.js 退出码 ${x.status}: ${(x.stderr||'').slice(0,150)}`); continue; }
    const lines=(x.stdout||'').split('\n');
    rounds+=lines.filter(l=>l.startsWith('── 第')).length;
    warn.push(...lines.filter(l=>l.trim().startsWith('!')));
  }
  ok('参赛 repo 的 replay.js 渲染无报警', warn.length===0, warn.slice(0,3).join(' / '));
  ok(`渲染出了局(${rounds} 局)`, rounds>0);
}

// FORMAT.md 里点名的字段,记录里真的都有
{
  const one=zlib.gunzipSync(fs.readFileSync(F),{finishFlush:zlib.constants.Z_SYNC_FLUSH})
    .toString('utf8').split('\n').filter(Boolean).map(JSON.parse)[0];
  const doc=fs.readFileSync(path.join(CONTEST,'FORMAT.md'),'utf8');
  const rd0=one.rounds[0];
  // FORMAT.md 的字段表里用 `反引号` 圈出来的那些局级字段
  const named=['no','declSeat','declTeam','trump','trumpRank','declStrength','rawTotal','total',
               'penalty','defendersWin','defWonLast','tricks','kittyPts','mult','before','after',
               'redeals','seed','first','kitty','buried','plays'];
  /* defLevelsUp 只有闲家上台的局才有(FORMAT.md 里写明了「守住时没有这个字段」)——
   * 拿第一局去要求它必然时灵时不灵,所以只把它算作「文档里有」,不要求出现。
   * declBy 是第二赛季起才有的一格,season1/ 那批记录里没有,同样只要求文档里写了。 */
  const optional=['defLevelsUp','declBy'];
  const missing=named.filter(k=>!(k in rd0));
  ok('FORMAT.md 点名的局级字段记录里都有', missing.length===0, missing.join('、'));
  const undocumented=Object.keys(rd0).filter(k=>!named.includes(k)&&!optional.includes(k));
  ok('记录里没有 FORMAT.md 没写的字段', undocumented.length===0, undocumented.join('、'));
  // 墩的形状
  const t=rd0.plays[0];
  ok('一墩是 {w, p:[4 家出的牌]}', typeof t.w==='number' && Array.isArray(t.p) && t.p.length===4
     && t.p.every(x=>Array.isArray(x)&&x.every(n=>Number.isInteger(n)&&n>=0&&n<108)));
  ok('FORMAT.md 写了 id 的编码规则', /id % 54/.test(doc) && /小王/.test(doc));
  ok('FORMAT.md 的字段表覆盖了所有字段',
     [...named,...optional].every(k=>doc.includes('`'+k+'`')),
     [...named,...optional].filter(k=>!doc.includes('`'+k+'`')).join('、'));
}

fs.rmSync(TMP,{recursive:true,force:true});
console.log(`\n通过 ${pass} 项,失败 ${fail} 项`);
process.exit(fail?1:0);
