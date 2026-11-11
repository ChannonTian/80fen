/* G2 汇总:node ai2/report-g2.js <eval ndjson ...> [--json=out.json]
 * 对每个预测器 (h / vt / vw),在 {全部, 领出, 跟牌} × {剩牌桶} 里报:
 *   n、准确率(只算真实结局有差的对;预测相等记 0.5)、
 *   「按预测改走 dev」的平均实现收益(口径:净升几级;分数)±SE —— 预测 dev 更好才走 dev,否则留在 base(收益 0),
 *   以及「在各预测器各自排序的前 10% / 25% 里改走 dev」的平均实现收益(匹配改判比例的公平比较)。 */
'use strict';
const fs=require('fs');
const files=process.argv.slice(2).filter(x=>!x.startsWith('--')); const jf=(process.argv.find(x=>x.startsWith('--json='))||'').slice(7);
const R=[]; for(const f of files) for(const l of fs.readFileSync(f,'utf8').split('\n').filter(Boolean)) R.push(JSON.parse(l));
const BK=[['25-19',19,25],['18-13',13,18],['12-7',7,12],['6-1',1,6]];
const bucket=r=>{ for(const [n,lo,hi] of BK) if(r.nh>=lo&&r.nh<=hi) return n; return '?'; };
const PRED={
  h:  {u:r=>r.sd-r.sb, p:r=>r.sd-r.sb},
  vt: {u:r=>r.vtD-r.vtB, p:r=>r.vtpD-r.vtpB},
  vw: {u:r=>r.vwD-r.vwB, p:r=>r.vwpD-r.vwpB},
};
const mean=a=>a.reduce((x,y)=>x+y,0)/(a.length||1);
const se=a=>{ if(a.length<2) return 0; const m=mean(a); return Math.sqrt(a.reduce((x,y)=>x+(y-m)*(y-m),0)/(a.length-1)/a.length); };
const f=(m,s,d=3)=>`${m>=0?'+':''}${m.toFixed(d)}±${s.toFixed(d)}`;
function evalSet(rs,pk,unit){
  const g=r=>unit==='u'?r.ud-r.ub:r.pd-r.pb;                 // 实现的 dev−base
  const pr=PRED[pk][unit];
  const ok=rs.filter(r=>Number.isFinite(pr(r))&&Number.isFinite(g(r)));
  if(!ok.length) return null;
  const diff=ok.filter(r=>g(r)!==0);
  const acc=diff.length?mean(diff.map(r=>{ const p=pr(r); return p===0?0.5:((p>0)===(g(r)>0)?1:0); })):NaN;
  const accSE=diff.length?Math.sqrt(acc*(1-acc)/diff.length):0;
  const follow=ok.map(r=>pr(r)>0?g(r):0);
  const sorted=ok.slice().sort((x,y)=>pr(y)-pr(x));
  const top=q=>{ const k=Math.max(1,Math.round(q*sorted.length)); return sorted.slice(0,k).map(r=>g(r)); };
  return {n:ok.length,nd:diff.length,acc,accSE,gain:mean(follow),gainSE:se(follow),frac:mean(ok.map(r=>pr(r)>0?1:0)),
          t10:mean(top(0.1)),t10se:se(top(0.1)),t25:mean(top(0.25)),t25se:se(top(0.25))};
}
const out={};
for(const unit of ['u','p']){
  console.log(`\n===== 口径:${unit==='u'?'净升几级(含 0.008×分)':'本队得分'} =====`);
  for(const split of ['全部','领出','跟牌']){
    const sub=R.filter(r=>split==='全部'||(split==='领出')===!!r.lead);
    for(const bk of ['全桶',...BK.map(b=>b[0])]){
      const rs=sub.filter(r=>bk==='全桶'||bucket(r)===bk);
      if(rs.length<20) continue;
      const line=[`${split.padEnd(3)} ${bk.padEnd(6)} n=${String(rs.length).padStart(5)}`];
      for(const pk of ['h','vt','vw']){
        const e=evalSet(rs,pk,unit); out[`${unit}|${split}|${bk}|${pk}`]=e;
        line.push(e?`${pk}: acc ${(100*e.acc).toFixed(1)}±${(100*e.accSE).toFixed(1)}% 走dev${(100*e.frac).toFixed(0)}% 收益 ${f(e.gain,e.gainSE)} 前10% ${f(e.t10,e.t10se)} 前25% ${f(e.t25,e.t25se)}`:`${pk}: -`);
      }
      console.log(line.join('\n    '));
    }
  }
}
if(jf) fs.writeFileSync(jf,JSON.stringify(out,null,1));
