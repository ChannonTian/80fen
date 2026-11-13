/* ai2/vnet.js —— 价值网络前向(无依赖,Node 与浏览器同一份)。
 * 输入稀疏二值特征(第一层按下标累加权重行)+ 稠密标量;输出 41 类(终局闲家总分/5)的概率。
 *   const m=Vnet.load(JSON.parse(text));      // 权重为 fp16 base64
 *   const p=Vnet.predictRaw(m, rawRecord);    // Float32Array(41),需要同目录的 featurize.js
 * 浏览器里先加载 featurize.js 再加载本文件(都挂到 window.AI2),Node 里 require。 */
(function(root){
'use strict';
const F = (typeof require!=='undefined'&&typeof module!=='undefined') ? require('./featurize.js') : root.AI2.featurize;

function b64bytes(s){
  if(typeof Buffer!=='undefined') return new Uint8Array(Buffer.from(s,'base64'));
  const bin=atob(s), u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i); return u;
}
function halfToFloat(h){
  const s=(h&0x8000)?-1:1, e=(h>>10)&31, f=h&1023;
  if(e===0) return s*Math.pow(2,-14)*(f/1024);
  if(e===31) return f?NaN:s*Infinity;
  return s*Math.pow(2,e-15)*(1+f/1024);
}
function f16(s){
  const u=b64bytes(s), n=u.length>>1, out=new Float32Array(n);
  const lut=f16.lut||(f16.lut=(()=>{ const t=new Float32Array(65536); for(let i=0;i<65536;i++) t[i]=halfToFloat(i); return t; })());
  for(let i=0;i<n;i++) out[i]=lut[u[2*i]|(u[2*i+1]<<8)];
  return out;
}
function load(j){
  // 存盘布局:emb 是 (dim_bin, h0) 行主序(torch EmbeddingBag.weight),dense_w 是 (h0, nd),层权重是 (out, in)
  const h0=j.hid[0], nb=j.dim_bin, nd=j.nd;
  const emb=f16(j.emb);                             // [nb][h0]
  const dw=f16(j.dense_w);                          // [h0][nd] → 转成 [nd][h0] 方便按列累加
  const dwT=new Float32Array(nd*h0); for(let o=0;o<h0;o++) for(let k=0;k<nd;k++) dwT[k*h0+o]=dw[o*nd+k];
  const layers=j.layers.map(L=>({w:f16(L.w),b:f16(L.b),out:L.out,inn:L.in}));
  const last=j.hid[j.hid.length-1];
  return {h0,nb,nd,emb,dwT,b0:f16(j.b0),layers,headW:f16(j.head_w),headB:f16(j.head_b),nbins:j.nbins,last,
          centers:Float32Array.from(j.centers),_a:new Float32Array(h0),_b:null,_ws:null};
}
/* idx:激活的二值特征下标(长度 n);dense:Float32Array(nd);out:Float32Array(nbins) 概率 */
function forward(m, idx, n, dense, out){
  const {h0,emb,dwT,nd}=m;
  let a=m._a; a.set(m.b0);
  for(let t=0;t<n;t++){ const o=idx[t]*h0; for(let k=0;k<h0;k++) a[k]+=emb[o+k]; }
  for(let j=0;j<nd;j++){ const v=dense[j]; if(v===0) continue; const o=j*h0; for(let k=0;k<h0;k++) a[k]+=v*dwT[o+k]; }
  for(let k=0;k<h0;k++) if(a[k]<0) a[k]=0;
  let x=a;
  if(!m._ws) m._ws=m.layers.map(L=>new Float32Array(L.out));
  for(let li=0;li<m.layers.length;li++){
    const L=m.layers[li], y=m._ws[li], w=L.w, inn=L.inn;
    for(let o=0;o<L.out;o++){ let s=L.b[o]; const ro=o*inn; for(let k=0;k<inn;k++) s+=w[ro+k]*x[k]; y[o]=s>0?s:0; }
    x=y;
  }
  const nb=m.nbins; let mx=-1e30;
  for(let o=0;o<nb;o++){ let s=m.headB[o]; const ro=o*m.last; for(let k=0;k<m.last;k++) s+=m.headW[ro+k]*x[k]; out[o]=s; if(s>mx) mx=s; }
  let z=0; for(let o=0;o<nb;o++){ out[o]=Math.exp(out[o]-mx); z+=out[o]; }
  for(let o=0;o<nb;o++) out[o]/=z;
  return out;
}
const _idx=new Int32Array(400), _den=new Float32Array(F.ND);
function predictRaw(m, raw, out){
  const n=F.featuresFromRaw(raw,_idx,_den);
  return forward(m,_idx,n,_den,out||new Float32Array(m.nbins));
}
const API={load,forward,predictRaw};
if(typeof module!=='undefined'&&module.exports) module.exports=API; else { root.AI2=root.AI2||{}; root.AI2.vnet=API; }
})(typeof window!=='undefined'?window:globalThis);
