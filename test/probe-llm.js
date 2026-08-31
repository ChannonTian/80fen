/* 千问(通义)接入教练模式的可行性探针 —— 只量,不改任何 build。
 *
 *   QWEN_KEY=sk-... node test/probe-llm.js [html=80fen-test.html] [模型,逗号分隔] [题数=6]
 *
 * 先量三件事,顺序不能颠倒 —— 前一件不过,后面全部白做:
 *
 *   ① CORS   浏览器能不能直连?不能的话,「单文件、纯前端」那两条硬约束就要重新谈
 *   ② 模型   这把 key 到底放行哪些(token-plan 是套餐 key,未必给全)
 *   ③ 三个率 改建议率 / 编事实率 / 延迟 —— 选模型看这三个数,不看感觉
 *
 * 题目不是编的:用引擎真打几局,随机截下「轮到你跟牌」的真实局面,
 * 把评分器已经算好的证据喂给模型,只让它讲解。
 * 它敢改建议、敢编牌面事实,这里都会记一笔。
 *
 * 背景与设计:NOTES/llm-coach-plan.md
 */
const fs=require('fs'),vm=require('vm');

const HTML=process.argv[2]||'80fen-test.html';
const MODELS=(process.argv[3]||'qwen-plus,qwen-max,qwen-turbo').split(',').map(s=>s.trim()).filter(Boolean);
const N=+process.argv[4]||6;
const KEY=process.env.QWEN_KEY;
const BASE=(process.env.QWEN_BASE||'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1').replace(/\/$/,'');
const ORIGIN=process.env.QWEN_ORIGIN||'https://channontian.github.io';

if(!KEY&&!process.argv.includes('--dump')){
  console.error('缺 QWEN_KEY。用法:QWEN_KEY=sk-... node test/probe-llm.js');
  console.error('(只想看喂给模型的证据包长什么样:加 --dump,不需要 key)');
  process.exit(2);
}

function load(f){
  const b=[...fs.readFileSync(f,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  const ctx={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};
  ctx.globalThis=ctx; vm.createContext(ctx); vm.runInContext(b[0],ctx);
  return ctx.module.exports;
}
const E=load(HTML);

/* ---- 牌名:和界面 miniName 同一种写法,模型输出要照抄它 ---- */
const SYM={S:'♠',H:'♥',C:'♣',D:'♦'};
const nm=c=>c.suit==='X'?(c.rank===16?'大王':'小王')
  :SYM[c.suit]+(c.rank>10?{11:'J',12:'Q',13:'K',14:'A'}[c.rank]:c.rank);
const dsc=cs=>cs.map(nm).join('+');
const SEAT=['南','西','北','东'];

/* ============================================================
 * ① CORS —— 这一步是分岔口,不是可选项
 * ============================================================ */
async function probeCORS(){
  console.log('=== ① CORS 预检(浏览器能不能直连)===');
  let r;
  try{
    r=await fetch(`${BASE}/chat/completions`,{method:'OPTIONS',headers:{
      'Origin':ORIGIN,
      'Access-Control-Request-Method':'POST',
      'Access-Control-Request-Headers':'authorization,content-type'}});
  }catch(e){ console.log(`  预检发不出去:${e.message}\n`); return null; }
  const allow=r.headers.get('access-control-allow-origin');
  const hdrs=r.headers.get('access-control-allow-headers');
  console.log(`  HTTP ${r.status}`);
  console.log(`  Access-Control-Allow-Origin : ${allow||'(无)'}`);
  console.log(`  Access-Control-Allow-Headers: ${hdrs||'(无)'}`);
  const ok=!!allow&&(allow==='*'||allow===ORIGIN)&&/authorization/i.test(hdrs||'');
  console.log(ok
    ? '  → 可以浏览器直连。BYOK 方案成立,九条硬约束一条不破。\n'
    : '  → 不能直连:要么自建代理(破约束 2「无服务端」),要么这条路走不通。\n'+
      '     ⚠️ 但先排除本机:② 若也是 403 且报 allowlist / proxy,那是你的出网策略挡的,不是厂商没开 CORS。\n');
  return ok;
}

/* ============================================================
 * ② 这把 key 放行哪些模型
 * ============================================================ */
async function probeModels(){
  console.log('=== ② 模型清单 ===');
  try{
    const r=await fetch(`${BASE}/models`,{headers:{Authorization:`Bearer ${KEY}`}});
    const t=await r.text();
    if(!r.ok){ console.log(`  HTTP ${r.status}:${t.slice(0,300)}\n`); return []; }
    const ids=(JSON.parse(t).data||[]).map(m=>m.id).sort();
    console.log(`  ${ids.length} 个:`);
    ids.forEach(i=>console.log('    '+i));
    console.log('');
    return ids;
  }catch(e){ console.log(`  取不到:${e.message}\n`); return []; }
}

/* ============================================================
 * 题库:引擎真打,随机截「轮到你跟牌」的局面
 * ============================================================ */
function positions(n){
  const out=[]; const want=new Set();
  for(let i=0;i<n;i++) want.add(3+i*2);            // 第 3、5、7… 墩各取一题
  for(let s=1;out.length<n&&s<400;s++){
    const seed=s*7919;
    const {first}=E.cutForFirst(seed);
    const {hands,kitty}=E.dealRound(seed,first);
    let best=null,declSeat=-1;
    for(let q=0;q<4;q++){ const o=E.declOptions(hands[q],E.RULES.levelStart)[0];
      if(o&&(!best||o.strength>best.strength)){best=o;declSeat=q;} }
    const rand=E.rng(seed^0x9e3779b9);
    let trump;
    if(!best){ trump={suit:null,rank:E.RULES.levelStart}; declSeat=first; }
    else trump={suit:best.suit,rank:E.RULES.levelStart};
    hands[declSeat].push(...kitty);
    const buried=E.aiDiscard(hands[declSeat],trump);
    buried.forEach(c=>E.removeCard(hands[declSeat],c));
    const history=[]; let leader=declSeat,tricks=0;
    while(hands.some(h=>h.length)&&out.length<n){
      const plays=[];
      for(let i=0;i<4;i++){
        const seat=(leader+i)%4;
        const view={seat,hand:hands[seat],trump,declSeat,
                    history:[...history,...plays],
                    buriedKnown:seat===declSeat?buried:[]};
        let cards;
        if(i===0){
          const adv=E.aiChooseLead(view); cards=adv.cards;
          const chk=E.checkThrow(hands,seat,cards,trump);
          if(!chk.ok) cards=chk.forced;
        }else{
          const lead=E.classify(plays[0].cards,trump);
          const adv=E.aiChooseFollow(view,plays); cards=adv.cards;
          if(!E.isLegalFollow(hands[seat],lead,cards,trump)) cards=E.genFollow(hands[seat],lead,trump,rand);
          // 只收「有得选」的题:候选不止一个,才谈得上讲解
          else if(want.has(tricks+1)&&adv.cands&&adv.cands.length>=2){
            want.delete(tricks+1);
            out.push({seed,no:tricks+1,view:{...view,hand:view.hand.slice(),history:view.history.slice()},
                      plays:plays.map(p=>({seat:p.seat,cards:p.cards.slice()})),adv});
          }
        }
        cards.forEach(c=>E.removeCard(hands[seat],c));
        plays.push({seat,cards});
      }
      history.push(...plays);
      leader=E.resolveTrick(plays,trump).winner;
      if(++tricks>60) break;
    }
  }
  return out;
}

/* ============================================================
 * 证据包 —— 这就是接口契约本身(见 NOTES/llm-coach-plan.md §5)
 * 原则:凡是引擎能算的都算完再喂。模型只负责把它讲成人话,一个数都不许自己推。
 * ============================================================ */
function evidence(p){
  const {view,plays,adv}=p, t=view.trump;
  // adv.ctx 是刻意收窄的七个字段(见 index.html「const ctx={…}」),
  // 剩下的按界面 askCoach 的原样从 view 重算 —— 约束 4:只用 viewFor 给的东西。
  const X=adv.ctx, lead=E.classify(plays[0].cards,t), mem=E.makeMemory(view);
  const sn=lead.suit==='T'?'主':SYM[lead.suit];
  const hasLeadSuit=view.hand.some(c=>E.effSuit(c,t)===lead.suit);
  // 「位次」是引擎内部序号,喂给模型只会被编成别的东西 —— 换成牌名和张数。
  // 「比我最大的还大的有几张」这一问就是界面 quiz 考的那一问,口径完全一致。
  const mx=E.maxUnseenIdx(mem,lead.suit,t);
  let topUnseen=null;
  for(const uk in mem.unseen){ if(mem.unseen[uk]<=0) continue;
    const c=E.keyToCard(uk);
    if(E.effSuit(c,t)===lead.suit&&E.ordIdx(c,t)===mx) topUnseen=nm(c); }
  const myBest=Math.max(-1,...view.hand.filter(c=>E.effSuit(c,t)===lead.suit).map(c=>E.ordIdx(c,t)));
  let nAbove=0, nSuit=0;
  for(const uk in mem.unseen){ if(mem.unseen[uk]<=0) continue;
    const c=E.keyToCard(uk); if(E.effSuit(c,t)!==lead.suit) continue;
    nSuit+=mem.unseen[uk];
    if(E.ordIdx(c,t)>myBest) nAbove+=mem.unseen[uk]; }
  const isDecl=view.declSeat>=0&&view.declSeat%2===view.seat%2;
  return {
    局面:{主:t.suit?SYM[t.suit]+t.rank:`无主(打${t.rank})`,
          我:`${SEAT[view.seat]}${isDecl?'(庄家方)':'(闲家方)'}`,
          第几墩:p.no},
    我的手牌:view.hand.map(nm),
    本墩已出:plays.map(x=>`${SEAT[x.seat]} ${dsc(x.cards)}`),
    义务:`跟 ${lead.cards.length} 张;有${sn}必须跟,门内有对必对`,
    我有这门吗:hasLeadSuit,
    台面分:X.ptsTable,
    当前最大:{谁:SEAT[X.curSeat],
              是队友:X.partnerWinning,
              稳不稳:X.partnerWinning?(X.curBoss?'稳赢,在外已无更大':'只是暂大,后手还有对手'):'对手暂大'},
    我是末家:X.isLast,
    这门在外:{还剩几张:nSuit, 最大的是:topUnseen||'已出尽',
             比我手里最大的还大的有几张:hasLeadSuit?nAbove:'(我没这门)'},
    候选:(adv.cands||[]).map(c=>({牌:c.cards.map(nm),分:+c.score.toFixed(0),理由:c.reason})),
    首选:adv.cards.map(nm)
  };
}

const SYS=`你是「80分」(上海规则,升级/拖拉机)的教练解说。
牌已经由评分器选定,你不做决策,只把它的理由讲成人话。

三条铁律,违反任何一条这次输出作废:
1. 建议原样照抄 evidence.首选,一张不多一张不少,绝不改成别的牌。
2. 事实只能用 evidence 里给的。还剩几张、台面几分、谁暂大 —— evidence 没写就不要说。
3. 不猜某一家手里有什么。evidence 的「在外」指所有还没露面的牌,不是某一家的手牌。

输出:两三句中文口语。先说这一手在干什么、为什么是现在,再说不这么打会亏在哪。
不超过 120 字,不用 markdown,不列点,不复述 evidence 的字段名。
最后另起一行,只写一行:
建议:<照抄 evidence.首选,多张用 + 连>`;

/* ---- 事实体检:只查「说的和牌面对不对得上」,不评价棋力 ---- */
function factCheck(text,p){
  const {view,plays,adv}=p, t=view.trump, X=adv.ctx;
  const lead=E.classify(plays[0].cards,t), mem=E.makeMemory(view);
  const bad=[];
  const hasLeadSuit=view.hand.some(c=>E.effSuit(c,t)===lead.suit);
  const isTrumpPlay=adv.cards.every(c=>E.effSuit(c,t)==='T');
  if(/断门|没有这门|这门断了|已经断/.test(text)&&hasLeadSuit) bad.push('说断门,其实手里有这门');
  if(/最后一手|我是末家|最后出牌/.test(text)&&!X.isLast) bad.push('说末家,其实后面还有人');
  if(/毙/.test(text)&&!/被毙|会被|怕被/.test(text)&&!(isTrumpPlay&&lead.suit!=='T')) bad.push('说毙,出的不是主(或本来就领主)');
  if(/队友/.test(text)&&/稳赢|赢定|已经拿下|保住了/.test(text)&&!(X.partnerWinning&&X.curBoss)) bad.push('说队友稳赢,其实不稳');
  const m=text.match(/台面[^。,;]{0,4}?(\d+)\s*分/);
  if(m&&+m[1]!==X.ptsTable) bad.push(`说台面 ${m[1]} 分,实际 ${X.ptsTable} 分`);
  const k=text.match(/在外[^。,;]{0,6}?(\d+)\s*张/);
  if(k){ let n=0; for(const uk in mem.unseen){ if(mem.unseen[uk]<=0) continue;
      const c=E.keyToCard(uk); if(E.effSuit(c,t)===lead.suit) n+=mem.unseen[uk]; }
    if(+k[1]!==n) bad.push(`说这门在外 ${k[1]} 张,实际 ${n} 张`); }
  return bad;
}

/* ---- 一次调用:流式,量首字延迟 ---- */
async function ask(model,ev){
  const body={model,stream:true,stream_options:{include_usage:true},
    temperature:0.3,max_tokens:400,
    messages:[{role:'system',content:SYS},
              {role:'user',content:JSON.stringify(ev,null,1)}]};
  // qwen3 系带思考档;讲解这件事的推理已经由评分器做完,思考纯属浪费延迟
  if(/^qwen3/.test(model)) body.enable_thinking=false;
  const t0=Date.now(); let ttft=0,text='',usage=null;
  const r=await fetch(`${BASE}/chat/completions`,{method:'POST',
    headers:{Authorization:`Bearer ${KEY}`,'Content-Type':'application/json'},
    body:JSON.stringify(body)});
  if(!r.ok) return {err:`HTTP ${r.status} ${(await r.text()).slice(0,200)}`};
  const dec=new TextDecoder(); let buf='';
  for await(const chunk of r.body){
    buf+=dec.decode(chunk,{stream:true});
    let i;
    while((i=buf.indexOf('\n'))>=0){
      const line=buf.slice(0,i).trim(); buf=buf.slice(i+1);
      if(!line.startsWith('data:')) continue;
      const d=line.slice(5).trim();
      if(d==='[DONE]') continue;
      let j; try{ j=JSON.parse(d); }catch(e){ continue; }
      if(j.usage) usage=j.usage;
      const c=j.choices&&j.choices[0]&&j.choices[0].delta&&j.choices[0].delta.content;
      if(c){ if(!ttft) ttft=Date.now()-t0; text+=c; }
    }
  }
  return {text:text.trim(),ttft,total:Date.now()-t0,usage};
}

/* ============================================================
 * ③ 跑分
 * ============================================================ */
async function probeQuality(models,qs){
  console.log(`=== ③ 三个率(${qs.length} 题 × ${models.length} 个模型)===\n`);
  const rows=[];
  for(const model of models){
    const st={model,n:0,drift:0,lie:0,err:0,ttft:[],total:[],inTok:0,outTok:0};
    for(const p of qs){
      const ev=evidence(p);
      let r; try{ r=await ask(model,ev); }catch(e){ r={err:e.message}; }
      if(r.err){ st.err++; console.log(`  [${model}] 第${p.no}墩 调用失败:${r.err}`); continue; }
      st.n++; st.ttft.push(r.ttft); st.total.push(r.total);
      if(r.usage){ st.inTok+=r.usage.prompt_tokens||0; st.outTok+=r.usage.completion_tokens||0; }
      // 改建议率:最后一行的牌必须逐字等于评分器的首选
      const line=(r.text.match(/建议[::]\s*(.+)\s*$/m)||[])[1]||'';
      const said=line.trim().split(/[+＋、\s]+/).filter(Boolean).sort().join('+');
      const want=ev.首选.slice().sort().join('+');
      const drift=said!==want; if(drift) st.drift++;
      const lies=factCheck(r.text,p); if(lies.length) st.lie++;
      console.log(`  [${model}] 第${p.no}墩 首选 ${ev.首选.join('+')} | ${r.ttft}ms/${r.total}ms`+
                  `${drift?`  ⚠️改建议→「${line.trim()}」`:''}${lies.length?`  ⚠️编事实:${lies.join(';')}`:''}`);
      console.log('    '+r.text.replace(/\n/g,'\n    '));
    }
    rows.push(st); console.log('');
  }
  const pct=(a,b)=>b?((100*a/b).toFixed(0)+'%').padStart(7):'      -';
  const p50=a=>a.length?String(a.slice().sort((x,y)=>x-y)[Math.floor(a.length/2)]).padStart(8):'       -';
  const p90=a=>a.length?String(a.slice().sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor(a.length*0.9))]).padStart(8):'       -';
  console.log('---- 汇总(改建议率与编事实率必须是 0,不是「低就行」)----');
  console.log('模型'.padEnd(24)+'成功'.padStart(6)+'改建议'.padStart(8)+'编事实'.padStart(8)+
              '首字p50'.padStart(9)+'全文p90'.padStart(9)+'入/出token'.padStart(14));
  for(const s of rows) console.log(s.model.padEnd(24)+`${s.n}/${s.n+s.err}`.padStart(6)+
    pct(s.drift,s.n)+pct(s.lie,s.n)+p50(s.ttft)+p90(s.total)+
    `${s.n?Math.round(s.inTok/s.n):0}/${s.n?Math.round(s.outTok/s.n):0}`.padStart(14));
  console.log('\n注:两个率都只查「说的对不对」,查不出「说得对但没用」。原文在上面,得人读。');
}

/* --dump:只打印证据包,不发一次请求。看接口契约长什么样、改 prompt 时用 */
if(process.argv.includes('--dump')){
  for(const p of positions(N)){
    console.log(`---- 种子 ${p.seed} 第${p.no}墩 ----`);
    console.log(JSON.stringify(evidence(p),null,1));
  }
  console.log('\n---- system prompt ----\n'+SYS);
  process.exit(0);
}

(async()=>{
  console.log(`探针:${HTML} → ${BASE}\n`);
  await probeCORS();
  const ids=await probeModels();
  const use=MODELS.filter(m=>!ids.length||ids.includes(m));
  const skip=MODELS.filter(m=>ids.length&&!ids.includes(m));
  if(skip.length) console.log(`(跳过这把 key 没放行的:${skip.join('、')})\n`);
  if(!use.length){ console.log('没有可用模型,停。'); return; }
  const qs=positions(N);
  console.log(`题库:${qs.length} 道真实跟牌局面(种子 ${qs.map(q=>q.seed).join('、')})\n`);
  await probeQuality(use,qs);
})();
