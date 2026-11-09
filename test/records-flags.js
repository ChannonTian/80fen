/* 玩家标记的那几手(flags,v0.7.48 起):逐条还原局面,用当前引擎在几组开关下各重算一遍 —— 「新版能不能解决玩家标的问题」。
 *   node test/records-flags.js <牌谱.jsonl> [html=80fen-test.html] [--since=v0.7.60] [--id=前缀]
 *   CFG='{"名字":{AIP 覆盖},…}'  另加几组开关对照(默认只有「当前默认」和「旧 followFix 0」)
 * 收官搜索按界面打开(egSearch 用默认值)。 */
'use strict';
const fs=require('fs'),vm=require('vm'),path=require('path');
const args=process.argv.slice(2);
const recFile=args[0], html=args.find(a=>a.endsWith('.html'))||path.join(__dirname,'..','80fen-test.html');
const opt=k=>{const a=args.find(x=>x.startsWith('--'+k+'='));return a?a.split('=')[1]:null;};
const src=[...fs.readFileSync(html,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])[0];
const c={module:{exports:{}},console,Math,Object,Array,Set,Map,JSON,String,Number};c.globalThis=c; vm.createContext(c); vm.runInContext(src,c);
const E=c.module.exports, AIP0={...E.AIP};
const CFG=Object.assign({'当前默认':{},'旧(followFix 0)':{followFix:0}},process.env.CFG?JSON.parse(process.env.CFG):{});
const vnum=s=>{const m=String(s||'').match(/v(\d+)\.(\d+)\.(\d+)/);return m?(+m[1])*1e6+(+m[2])*1e3+(+m[3]):0;};
const since=opt('since'), idp=opt('id');
const recs=fs.readFileSync(recFile,'utf8').split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l);}catch(e){return null;}})
  .filter(r=>r&&r.flags&&r.flags.length&&r.initialHands&&(!since||vnum(r.version)>=vnum(since))&&(!idp||String(r.id).startsWith(idp)));
const NAME=['南','东','北','西'], SU={S:'♠',H:'♥',D:'♦',C:'♣',X:''};
const nm=x=>x.suit==='X'?(x.rank===16?'大王':'小王'):SU[x.suit]+({11:'J',12:'Q',13:'K',14:'A'}[x.rank]||x.rank);
const ns=cs=>cs.map(nm).join(' ');
for(const rec of recs){
  let uid=0; const parse=s=>({suit:s[0],rank:+s.slice(1),id:'r'+(uid++)});
  const hands=rec.initialHands.map(h=>h.map(parse)), buried=rec.buried.map(parse), trump=rec.trump, D=rec.declSeat;
  const take=(seat,code)=>{const h=hands[seat];const i=h.findIndex(x=>x.suit+x.rank===code);return h.splice(i,1)[0];};
  console.log(`\n==== ${String(rec.id).slice(0,8)} ${rec.version||''}  ${NAME[D]}坐庄  主 ${trump.suit?SU[trump.suit]:'无'} 打 ${trump.rank}  人坐 ${NAME[rec.human]}  闲家得分 ${rec.defPoints}`);
  const history=[];
  rec.tricks.forEach((t,ti)=>{
    const plays=[];
    t.plays.forEach((p,i)=>{
      const seat=p.seat, fl=rec.flags.find(f=>f.t===ti&&f.seat===seat);
      if(fl){
        const view=()=>({seat,hand:hands[seat].slice(),trump,declSeat:D,history:history.slice().concat(plays),buriedKnown:seat===D?buried:[]});
        console.log(`\n  第 ${ti+1} 墩 · ${NAME[seat]}${seat===D?'(庄)':seat%2===D%2?'(庄帮)':'(闲)'}${seat===rec.human?'[人]':''}  🚩 ${fl.note||'(没写理由)'}`);
        console.log(`    桌上:${plays.length?plays.map(q=>NAME[q.seat]+' '+ns(q.cards)).join(' · '):'(他领出)'}`);
        console.log(`    手牌:${ns(hands[seat].slice().sort((a,b)=>E.ordIdx(b,trump)-E.ordIdx(a,trump)))}`);
        console.log(`    实际出:${p.cards.map(code=>nm(parse(code))).join(' ')}`);
        for(const [k,ov] of Object.entries(CFG)){
          Object.assign(E.AIP,AIP0,ov);
          let r; try{ r=i===0?E.aiChooseLead(view()):E.aiChooseFollow(view(),plays); }catch(e){ r={cards:[],reason:'出错 '+e.message}; }
          console.log(`    ${k.padEnd(14)} → ${ns(r.cards).padEnd(10)} ${r.reason||''}`);
        }
        Object.assign(E.AIP,AIP0);
      }
      plays.push({seat,cards:p.cards.map(code=>take(seat,code))});
    });
    history.push(...plays);
  });
}
