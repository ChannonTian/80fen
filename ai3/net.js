/* ai3/net.js —— 策略网络的无依赖前向(Float32)。权重目录:manifest.json + weights.f32(train.py 导出)。
 *   const net=Net.load('ai3/out/net-v1');
 *   net.scores(S,C,nc,out)   S:演员特征行 Uint8Array(SD);C:nc 个候选特征行拼接 Uint8Array(nc*CD);out:Float32Array(>=nc)
 * 结构:ctx=ReLU(e2·ReLU(e1·x));每个候选 h=ReLU(wa·ctx+wb·c);h=ReLU(c2·h);分=o·h。输入行按稀疏累加(行里大多是 0)。 */
'use strict';
const fs=require('fs'), path=require('path');
const F=require('./feat.js');
class Net{
  constructor(man,buf){
    const T={}; for(const t of man.tensors) T[t.name]=buf.subarray(t.offset,t.offset+t.n);
    this.SD=man.SD; this.CD=man.CD; this.h1=man.h1; this.h2=man.h2;
    const {SD,CD,h1,h2}=this;
    if(SD!==F.SD||CD!==F.CD) throw new Error('特征维数与 feat.js 不一致');
    // e1:torch (h1,SD) → 转成 (SD,h1) 方便按输入列累加;wb:(h2,CD) → (CD,h2)
    this.e1T=new Float32Array(SD*h1); for(let o=0;o<h1;o++) for(let i=0;i<SD;i++) this.e1T[i*h1+o]=T['e1.weight'][o*SD+i];
    this.e1b=T['e1.bias']; this.e2=T['e2.weight']; this.e2b=T['e2.bias'];
    this.wa=T['wa.weight']; this.wab=T['wa.bias'];
    this.wbT=new Float32Array(CD*h2); for(let o=0;o<h2;o++) for(let i=0;i<CD;i++) this.wbT[i*h2+o]=T['wb.weight'][o*CD+i];
    const tr=(W,o,i)=>{ const r=new Float32Array(o*i); for(let a=0;a<o;a++) for(let b=0;b<i;b++) r[b*o+a]=W[a*i+b]; return r; };
    this.e2T=tr(T['e2.weight'],h1,h1); this.waT=tr(T['wa.weight'],h2,h1); this.c2T=tr(T['c2.weight'],h2,h2);
    this.c2=T['c2.weight']; this.c2b=T['c2.bias']; this.ow=T['o.weight']; this.ob=T['o.bias'][0];
    this.a1=new Float32Array(h1); this.ctx=new Float32Array(h1); this.a=new Float32Array(h2);
    this.h=new Float32Array(h2); this.h3=new Float32Array(h2);
    this.ss=F.SSCALE; this.cs=F.CSCALE;
  }
  static load(dir){
    const man=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
    const raw=fs.readFileSync(path.join(dir,'weights.f32'));
    const buf=new Float32Array(raw.buffer,raw.byteOffset,raw.length>>2);
    return new Net(man,buf);
  }
  /* 一个决策的 nc 个候选分数。全部「输入主序」:对每个非零输入把权重列(连续)累加进输出,ReLU 后为 0 的激活整列跳过。 */
  scores(S,C,nc,out){
    const {SD,CD,h1,h2,e1T,e1b,e2T,e2b,waT,wab,wbT,c2T,c2b,ow,ob,a1,ctx,a,h,h3,ss,cs}=this;
    a1.set(e1b);
    for(let i=0;i<SD;i++){ const v=S[i]; if(v===0) continue; const x=v*ss[i], o=i*h1; for(let k=0;k<h1;k++) a1[k]+=x*e1T[o+k]; }
    ctx.set(e2b);
    for(let i=0;i<h1;i++){ const x=a1[i]; if(x<=0) continue; const o=i*h1; for(let k=0;k<h1;k++) ctx[k]+=x*e2T[o+k]; }
    a.set(wab);
    for(let i=0;i<h1;i++){ const x=ctx[i]; if(x<=0) continue; const o=i*h2; for(let k=0;k<h2;k++) a[k]+=x*waT[o+k]; }
    for(let j=0;j<nc;j++){
      h.set(a); const base=j*CD;
      for(let i=0;i<CD;i++){ const v=C[base+i]; if(v===0) continue; const x=v*cs[i], o=i*h2; for(let k=0;k<h2;k++) h[k]+=x*wbT[o+k]; }
      h3.set(c2b);
      for(let i=0;i<h2;i++){ const x=h[i]; if(x<=0) continue; const o=i*h2; for(let k=0;k<h2;k++) h3[k]+=x*c2T[o+k]; }
      let sc=ob; for(let k=0;k<h2;k++){ const y=h3[k]; if(y>0) sc+=ow[k]*y; }
      out[j]=sc;
    }
    return out;
  }
}
module.exports=Net;
