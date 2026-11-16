/* ai3/featurize.js —— 用内核回放牌谱,每个决策点写出定宽二进制分片(Python np.fromfile / memmap 直接读)。
 *   node ai3/featurize.js --par --workers=8 [--rec=ai3/out/rec] [--out=ai3/out/feat]     (每个牌谱块一个分片;有 .done 的跳过)
 * 分片 <out>/<块名>.{S,O,C,M}.bin + .json:
 *   S: n×SD  u8 演员局面特征      O: n×OD u8 全知特征(与 S 同下标)   C: nc×CD u8 候选特征(按决策顺序拼接)
 *   M: n×NM  int32 元数据,字段见 MF   json: 本块覆盖率统计
 * 划分:按种子(整局)90/5/5:split 0 train / 1 val / 2 test。
 * 候选:领出 enumLeads(mode 2);跟牌 enumFollows(cap 256),超了 enumFollowsReduced。引擎想出的牌不在候选里就补到最后(bit0)。
 * 被强制的甩牌(引擎想出的与实际不同)/ 引擎想出非法跟牌:bit1,训练和评测都剔掉。 */
'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process');
const K=require('./kernel.js'), F=require('./feat.js'), {replayGame,readRecs}=require('./replay.js');
const arg=(k,d)=>{ const a=process.argv.find(x=>x.startsWith('--'+k+'=')); return a?a.slice(k.length+3):d; };
const REC=arg('rec',path.join(__dirname,'out','rec')), OUT=arg('out',path.join(__dirname,'out','feat'));
const NM=14;
const MF=['seed','play','seat','isLead','nCand','candOff','label','flags','engNC','handN','level','split','tricks','nPlaysInTrick'];
/* flags: bit0 label 原本不在候选里(已补)  bit1 剔除(强制 / 非法)  bit2 引擎这手走了搜索  bit3 跟牌全枚举超 cap(降级)
 *        bit4 引擎想出的是甩牌(领出)  bit5 候选数超 NCMAX 被截 */
const splitOf=seed=>{ const u=K.makeRng(seed*31+5)(); return u<0.9?0:u<0.95?1:2; };

if(process.argv.includes('--par')){
  fs.mkdirSync(OUT,{recursive:true});
  const W=+arg('workers',8);
  const chunks=fs.readdirSync(REC).filter(f=>f.endsWith('.done')).map(f=>f.replace('.done','')).sort()
    .filter(c=>!fs.existsSync(path.join(OUT,c+'.done')));
  let running=0,done=0; const t0=Date.now(), tot=chunks.length;
  const next=()=>{ while(running<W&&chunks.length){
    const c=chunks.shift(); running++;
    const p=cp.spawn(process.execPath,[__filename,`--chunk=${c}`,`--rec=${REC}`,`--out=${OUT}`],{stdio:['ignore','ignore','inherit']});
    p.on('exit',()=>{ running--; done++; if(done%10===0||done===tot) console.log(`${done}/${tot} 块 ${((Date.now()-t0)/1000).toFixed(0)}s`); next(); }); } };
  console.log('待处理',tot,'块'); next();
} else {
  const chunk=arg('chunk',null);
  fs.mkdirSync(OUT,{recursive:true});
  const zlib=require('zlib');
  const txt=zlib.gunzipSync(fs.readFileSync(path.join(REC,chunk+'.jsonl.gz'))).toString('utf8');
  const recs=txt.split('\n').filter(Boolean).map(JSON.parse);
  const BUF=new Uint8Array(1<<16);
  const rng=K.makeRng(12345);
  const NCMAX=1024;
  const Sx=[],Ox=[],Mx=[],Cx=[]; let nC=0;
  const stat={games:0,badGames:0,dec:0,cands:0,leadN:0,leadCov:0,followN:0,followCov:0,throwN:0,throwCov:0,
    followOver:0,followOverN:0,followOverCov:0,leadOver:0,forced:0,illegal:0,truncated:0,searched:0,maxCand:0};
  for(const rec of recs){
    const chk=replayGame(rec);
    if(!chk.ok){ stat.badGames++; continue; }
    stat.games++;
    const split=splitOf(rec.s);
    replayGame(rec,(st,pi,play,isLead)=>{
      const seat=st.cur, [,want,act,eg,engNC]=play;
      let n, flags=0;
      if(isLead){ n=K.enumLeads(st,BUF,2); if(n<0){ n=K.enumLeads(st,BUF,0); stat.leadOver++; if(n<0) n=0; } }
      else { n=K.enumFollows(st,BUF,256); if(n<0){ n=K.enumFollowsReduced(st,BUF,256,rng); flags|=8; stat.followOver++; } }
      // 找标签
      const wk=want.join(',');
      let label=-1;
      for(let i=0;i<n;i++){ const p0=K.pos[i], L=BUF[p0]; if(L!==want.length) continue;
        let eq=true; for(let k=0;k<L;k++) if(BUF[p0+1+k]!==want[k]){ eq=false; break; }
        if(eq){ label=i; break; } }
      let isThrow=false;
      if(isLead){ const cl=K.util.classifyT(want,st.ts,st.tr); isThrow=!!cl&&cl.kind===3; if(isThrow) flags|=16; }
      const bad=!!act;                       // 强制 / 非法
      if(bad){ flags|=2; if(isLead) stat.forced++; else stat.illegal++; }
      if(eg) flags|=4;
      if(label<0){
        flags|=1;
        // 补进去
        let end=n?K.pos[n-1]+BUF[K.pos[n-1]]+1:0;
        K.pos[n]=end; BUF[end]=want.length; for(let k=0;k<want.length;k++) BUF[end+1+k]=want[k];
        label=n; n++;
      }
      if(!bad){
        if(isLead){ stat.leadN++; if(!(flags&1)) stat.leadCov++; if(isThrow){ stat.throwN++; if(!(flags&1)) stat.throwCov++; } }
        else { stat.followN++; if(!(flags&1)) stat.followCov++; if(flags&8){ stat.followOverN++; if(!(flags&1)) stat.followOverCov++; } }
      }
      // 候选过多:保留标签 + 随机子集
      let order=null;
      if(n>NCMAX){
        flags|=32; stat.truncated++;
        const idx=[]; for(let i=0;i<n;i++) if(i!==label) idx.push(i);
        for(let i=idx.length-1;i>0;i--){ const j=(rng()*(i+1))|0; const x=idx[i]; idx[i]=idx[j]; idx[j]=x; }
        order=[label,...idx.slice(0,NCMAX-1)]; label=0; n=NCMAX;
      }
      stat.dec++; stat.cands+=n; if(n>stat.maxCand) stat.maxCand=n; if(eg) stat.searched++;
      const S=new Uint8Array(F.SD), O=new Uint8Array(F.OD);
      F.stateFeat(st,seat,S,0); F.omniFeat(st,seat,O,0);
      Sx.push(S); Ox.push(O);
      const ctx=F.decisionCtx(st,seat);
      const Cb=new Uint8Array(n*F.CD);
      for(let i=0;i<n;i++) F.candFeat(ctx,BUF,K.pos[order?order[i]:i],Cb,i*F.CD);
      Cx.push(Cb);
      const M=new Int32Array(NM);
      M[0]=rec.s; M[1]=pi; M[2]=seat; M[3]=isLead?1:0; M[4]=n; M[5]=nC; M[6]=label; M[7]=flags; M[8]=engNC; M[9]=st.hn[seat];
      M[10]=rec.lv; M[11]=split; M[12]=st.tricks; M[13]=st.nPlays;
      Mx.push(M); nC+=n;
    });
  }
  const cat=(arrs,len)=>{ const o=Buffer.alloc(arrs.length*len); let p=0; for(const a of arrs){ o.set(a,p); p+=a.length; } return o; };
  const base=path.join(OUT,chunk);
  fs.writeFileSync(base+'.S.bin',cat(Sx,F.SD)); fs.writeFileSync(base+'.O.bin',cat(Ox,F.OD));
  fs.writeFileSync(base+'.C.bin',Buffer.concat(Cx.map(a=>Buffer.from(a.buffer,a.byteOffset,a.length))));
  { const o=Buffer.alloc(Mx.length*NM*4); Mx.forEach((m,i)=>Buffer.from(m.buffer).copy(o,i*NM*4)); fs.writeFileSync(base+'.M.bin',o); }
  fs.writeFileSync(base+'.json',JSON.stringify({stat,NM,MF,SD:F.SD,OD:F.OD,CD:F.CD}));
  fs.writeFileSync(base+'.done','1');
}
