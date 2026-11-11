/* shard(.bin)→ numpy 可直接 np.load 的 .npy(特征口径全部来自 featurize.js)。
 *   node ai2/export.js <shard 目录> <输出目录> [--permute=1] [--only=seed区间 lo-hi]
 * idx.npy   uint16 (N,108)   激活的二值特征下标(每条恰好 108 个:每张牌占一格平面)
 * dense.npy float32 (N,50)   稠密标量
 * y.npy     uint8  (N,)      终局闲家总分 /5(≥200 并入 40)
 * meta.npy  uint32 (N,4)     seed, fork, ply, flags(bit0 = 偏离那一手)
 * --permute=1:每条记录随机置换三门副花色标签(数据增广;置换由 seed/fork/ply 派生,可复现) */
'use strict';
const fs=require('fs'),path=require('path');
const F=require('./featurize.js');
function npy(file, dtype, shape, data){
  const hdr=`{'descr': '${dtype}', 'fortran_order': False, 'shape': (${shape.join(', ')}${shape.length===1?',':''}), }`;
  let h=hdr+' '.repeat(63-((10+hdr.length)%64))+'\n';
  const b=Buffer.alloc(10);b.write('\x93NUMPY',0,'latin1');b[6]=1;b[7]=0;b.writeUInt16LE(h.length,8);
  const fd=fs.openSync(file,'w'); fs.writeSync(fd,b); fs.writeSync(fd,h);
  const u8=new Uint8Array(data.buffer,data.byteOffset,data.byteLength);
  for(let o=0;o<u8.length;o+=1<<28) fs.writeSync(fd,u8,o,Math.min(1<<28,u8.length-o));
  fs.closeSync(fd);
}
function loadShards(dir){
  const files=fs.readdirSync(dir).filter(f=>f.endsWith('.bin')).sort((a,b)=>parseInt(a.slice(1))-parseInt(b.slice(1)));
  return files.map(f=>fs.readFileSync(path.join(dir,f)));
}
function exportDir(dir,out,opt){
  const bufs=loadShards(dir); let N=0; for(const b of bufs) N+=b.length/F.REC;
  const idxA=new Uint16Array(N*108), denA=new Float32Array(N*F.ND), y=new Uint8Array(N), meta=new Uint32Array(N*4);
  const idx=new Int32Array(400), dense=new Float32Array(F.ND); let i=0;
  for(const b of bufs) for(let o=0;o<b.length;o+=F.REC){
    const r=new Uint8Array(b.buffer,b.byteOffset+o,F.REC);
    const seed=new DataView(r.buffer,r.byteOffset).getUint32(120,true);
    let perm=null;
    if(opt.permute){ const x=(seed*2654435761+r[117]*40503+r[118]*9973)>>>0; // 简单哈希 → 置换
      const p=[1,2,3]; let h=x; for(let k=2;k>0;k--){ h=Math.imul(h^(h>>>15),0x2c1b3c6d)>>>0; const j=h%(k+1); [p[k],p[j]]=[p[j],p[k]]; }
      perm=r[112]===4?[0,1,2,3]:[0,...p];
      if(r[112]===4){ const q=[0,1,2,3]; for(let k=3;k>0;k--){ h=Math.imul(h^(h>>>15),0x2c1b3c6d)>>>0; const j=h%(k+1); [q[k],q[j]]=[q[j],q[k]]; } perm=q; } }
    const n=F.featuresFromRaw(r,idx,dense,perm);
    if(n!==108) throw new Error('激活特征数 '+n);
    for(let j=0;j<108;j++) idxA[i*108+j]=idx[j];
    denA.set(dense,i*F.ND); y[i]=r[116];
    meta[i*4]=seed; meta[i*4+1]=r[117]; meta[i*4+2]=r[118]; meta[i*4+3]=r[119]; i++;
  }
  fs.mkdirSync(out,{recursive:true});
  npy(path.join(out,'idx.npy'),'<u2',[N,108],idxA); npy(path.join(out,'dense.npy'),'<f4',[N,F.ND],denA);
  npy(path.join(out,'y.npy'),'|u1',[N],y); npy(path.join(out,'meta.npy'),'<u4',[N,4],meta);
  fs.writeFileSync(path.join(out,'info.json'),JSON.stringify({N,dim:F.DIM,nbin:F.NBIN_FEAT,nd:F.ND,nbins:F.NBINS,permute:!!opt.permute}));
  return N;
}
if(require.main===module){
  const opt={}; for(const x of process.argv.slice(4)){ const m=x.match(/^--(\w+)=(.*)$/); if(m) opt[m[1]]=+m[2]; }
  console.log('exported',exportDir(process.argv[2],process.argv[3],opt),'records');
}
module.exports={exportDir,npy};
