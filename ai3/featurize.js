/* ai3/featurize.js —— 用内核回放牌谱,每个决策点写出定宽二进制特征,**直接写成训练用的合并格式**。
 *   node ai3/featurize.js --par --workers=8 --rec=ai3/out/rec[,另一个牌谱目录...] --out=ai3/out/feat3 [--omni] [--limit=N 块]
 * 输出 <out>/merged/:
 *   S.bin  n×SD u8 演员局面特征      C.bin  nc×CD u8 候选特征(按决策顺序拼接)
 *   M.npy  n×NM int32 元数据(numpy 格式,头 128 字节占位、收尾时回写)   O.bin 全知特征(只有 --omni 才写)
 *   stats.json 覆盖率等统计   progress.json 断点   done 完成标记
 * 做法:每个牌谱块一个子进程算出 <out>/tmp/ 下的小块(几 MB),父进程按块名顺序追加进 merged 并立刻删掉小块,
 *   磁盘峰值 ≈ 最终大小 + 几百 MB。断点续跑:同命令重跑(progress.json 记已并入的块与各文件字节数,多出的尾巴会被截掉)。
 *   牌谱目录里后来多出的块,重跑会接在后面追加(done 标记会先撤掉)。
 * M 字段见 MF。划分:按种子(整局)90/5/5:split 0 train / 1 val / 2 test。
 * 候选:领出 enumLeads(mode 2);跟牌 enumFollows(cap 256),超了 enumFollowsReduced。标签不在候选里就补到最后(bit0)。
 * DAgger 局(牌谱有 dg 字段):标签 = 引擎在网络所处局面上的选择(见 gen-records.js);flags bit6 = DAgger 局里的决策,bit7 = 其中网络座位的决策。 */
'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process');
const K=require('./kernel.js'), F=require('./feat.js'), {replayGame,playInfo}=require('./replay.js');
const arg=(k,d)=>{ const a=process.argv.find(x=>x.startsWith('--'+k+'=')); return a?a.slice(k.length+3):d; };
const RECS=arg('rec',path.join(__dirname,'out','rec')).split(','), OUT=arg('out',path.join(__dirname,'out','feat'));
const OMNI=process.argv.includes('--omni');
const NM=14, HDR=128;
const MF=['seed','play','seat','isLead','nCand','candOff','label','flags','engNC','handN','level','split','tricks','nPlaysInTrick'];
/* flags: bit0 label 原本不在候选里(已补)  bit1 剔除(强制 / 非法 / 标签被强制)  bit2 引擎这手走了搜索  bit3 跟牌全枚举超 cap(降级)
 *        bit4 引擎想出的是甩牌(领出)  bit5 候选数超 NCMAX 被截  bit6 DAgger 局里的决策  bit7 其中网络座位的决策 */
const splitOf=seed=>{ const u=K.makeRng(seed*31+5)(); return u<0.9?0:u<0.95?1:2; };
const TMP=path.join(OUT,'tmp'), MG=path.join(OUT,'merged');

function worker(chunk,recDir){
  const zlib=require('zlib');
  const txt=zlib.gunzipSync(fs.readFileSync(path.join(recDir,chunk+'.jsonl.gz'))).toString('utf8');
  const recs=txt.split('\n').filter(Boolean).map(JSON.parse);
  const BUF=new Uint8Array(1<<16);
  const rng=K.makeRng(12345);
  const NCMAX=1024;
  const Sx=[],Ox=[],Mx=[],Cx=[]; let nC=0;
  const stat={games:0,badGames:0,dagGames:0,dec:0,cands:0,leadN:0,leadCov:0,followN:0,followCov:0,throwN:0,throwCov:0,
    followOver:0,followOverN:0,followOverCov:0,leadOver:0,forced:0,illegal:0,truncated:0,searched:0,maxCand:0,
    dgNetN:0,dgNetCov:0,dgNetLeadN:0,dgNetLeadCov:0,dgNetFollowN:0,dgNetFollowCov:0,dgNetAgree:0,dgNetBad:0,dgEngN:0,dgEngCov:0};
  for(const rec of recs){
    const chk=replayGame(rec);
    if(!chk.ok){ stat.badGames++; continue; }
    stat.games++;
    const dag=rec.dg!==undefined; if(dag) stat.dagGames++;
    const split=splitOf(rec.s);
    replayGame(rec,(st,pi,play,isLead)=>{
      const seat=st.cur, q=playInfo(play), want=q.label, eg=q.eg, engNC=q.nc;
      let n, flags=0;
      if(isLead){ n=K.enumLeads(st,BUF,2); if(n<0){ n=K.enumLeads(st,BUF,0); stat.leadOver++; if(n<0) n=0; } }
      else { n=K.enumFollows(st,BUF,256); if(n<0){ n=K.enumFollowsReduced(st,BUF,256,rng); flags|=8; stat.followOver++; } }
      // 找标签
      let label=-1;
      for(let i=0;i<n;i++){ const p0=K.pos[i], L=BUF[p0]; if(L!==want.length) continue;
        let eq=true; for(let k=0;k<L;k++) if(BUF[p0+1+k]!==want[k]){ eq=false; break; }
        if(eq){ label=i; break; } }
      let isThrow=false;
      if(isLead){ const cl=K.util.classifyT(want,st.ts,st.tr); isThrow=!!cl&&cl.kind===3; if(isThrow) flags|=16; }
      const bad=q.labelBad;                   // 强制 / 非法(DAgger 网络座位:标签本身被强制)
      if(bad){ flags|=2; if(isLead) stat.forced++; else stat.illegal++; }
      if(eg) flags|=4;
      if(dag){ flags|=64; if(q.isNet) flags|=128; }
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
        if(dag){
          if(q.isNet){ stat.dgNetN++; if(!(flags&1)) stat.dgNetCov++; if(q.label.join()===q.cho.join()) stat.dgNetAgree++;
            if(isLead){ stat.dgNetLeadN++; if(!(flags&1)) stat.dgNetLeadCov++; } else { stat.dgNetFollowN++; if(!(flags&1)) stat.dgNetFollowCov++; } }
          else { stat.dgEngN++; if(!(flags&1)) stat.dgEngCov++; }
        }
      } else if(dag&&q.isNet) stat.dgNetBad++;
      // 候选过多:保留标签 + 随机子集
      let order=null;
      if(n>NCMAX){
        flags|=32; stat.truncated++;
        const idx=[]; for(let i=0;i<n;i++) if(i!==label) idx.push(i);
        for(let i=idx.length-1;i>0;i--){ const j=(rng()*(i+1))|0; const x=idx[i]; idx[i]=idx[j]; idx[j]=x; }
        order=[label,...idx.slice(0,NCMAX-1)]; label=0; n=NCMAX;
      }
      stat.dec++; stat.cands+=n; if(n>stat.maxCand) stat.maxCand=n; if(eg) stat.searched++;
      const S=new Uint8Array(F.SD);
      F.stateFeat(st,seat,S,0); Sx.push(S);
      if(OMNI){ const O=new Uint8Array(F.OD); F.omniFeat(st,seat,O,0); Ox.push(O); }
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
  fs.mkdirSync(TMP,{recursive:true});
  const base=path.join(TMP,chunk);
  fs.writeFileSync(base+'.S.bin',cat(Sx,F.SD));
  if(OMNI) fs.writeFileSync(base+'.O.bin',cat(Ox,F.OD));
  fs.writeFileSync(base+'.C.bin',Buffer.concat(Cx.map(a=>Buffer.from(a.buffer,a.byteOffset,a.length))));
  { const o=Buffer.alloc(Mx.length*NM*4); Mx.forEach((m,i)=>Buffer.from(m.buffer).copy(o,i*NM*4)); fs.writeFileSync(base+'.M.bin',o); }
  fs.writeFileSync(base+'.json',JSON.stringify({stat,nDec:Mx.length,nC}));
  fs.writeFileSync(base+'.done','1');
}

function npyHeader(rows){
  let h=`{'descr': '<i4', 'fortran_order': False, 'shape': (${rows}, ${NM}), }`;
  const len=HDR-10; h=h.padEnd(len-1,' ')+'\n';
  const b=Buffer.alloc(HDR); b.write('\x93NUMPY',0,'latin1'); b[6]=1; b[7]=0; b.writeUInt16LE(len,8); b.write(h,10,'latin1'); return b;
}

function parent(){
  const W=+arg('workers',8), LOOK=+arg('lookahead',3*W), LIMIT=+arg('limit',0);
  fs.mkdirSync(TMP,{recursive:true}); fs.mkdirSync(MG,{recursive:true});
  const where={};
  for(const d of RECS) for(const f of fs.readdirSync(d)) if(f.endsWith('.done')) where[f.slice(0,-5)]=d;
  let all=Object.keys(where).sort(); if(LIMIT) all=all.slice(0,LIMIT);
  const P=path.join(MG,'progress.json');
  let prog=fs.existsSync(P)?JSON.parse(fs.readFileSync(P,'utf8')):{names:[],S:0,C:0,M:0,O:0,rows:0,cands:0,stat:{}};
  const ex=n=>fs.existsSync(path.join(MG,n));
  if(!prog.names.length&&ex('done')&&!ex('stats.json')){ console.error(MG+' 里有别的程序合并出来的特征(train.py 的 merged),不碰;换个 --out'); process.exit(2); }
  if(!prog.names.length){ for(const n of ['S.bin','C.bin','O.bin','M.npy','done','stats.json']) if(ex(n)) fs.unlinkSync(path.join(MG,n)); }  // 没有进度:重新开始(只会碰自己输出目录里的文件)
  if(ex('done')){ fs.unlinkSync(path.join(MG,'done')); }
  const mp=path.join(MG,'M.npy');
  if(!prog.names.length){ fs.writeFileSync(mp,npyHeader(0)); fs.writeFileSync(path.join(MG,'S.bin'),''); fs.writeFileSync(path.join(MG,'C.bin'),''); if(OMNI) fs.writeFileSync(path.join(MG,'O.bin'),''); }
  else { fs.truncateSync(path.join(MG,'S.bin'),prog.S); fs.truncateSync(path.join(MG,'C.bin'),prog.C); fs.truncateSync(mp,HDR+prog.rows*NM*4);
         if(OMNI) fs.truncateSync(path.join(MG,'O.bin'),prog.O); }
  const merged=new Set(prog.names);
  for(const f of fs.readdirSync(TMP)){ const n=f.split('.')[0]; if(merged.has(n)) fs.unlinkSync(path.join(TMP,f)); }  // 已并入但没来得及删的小块
  const todo=all.filter(n=>!merged.has(n));
  console.log(`待处理 ${todo.length} 块(已并入 ${prog.names.length}),输出 ${MG}${OMNI?'(含 O)':''}`);
  const t0=Date.now(); let nextSpawn=0, nextMerge=0, running=0, failed=false;
  const fdS=fs.openSync(path.join(MG,'S.bin'),'a'), fdC=fs.openSync(path.join(MG,'C.bin'),'a'), fdM=fs.openSync(mp,'r+');
  const fdO=OMNI?fs.openSync(path.join(MG,'O.bin'),'a'):-1;
  const addStat=(t,s)=>{ for(const k in s){ if(k==='maxCand') t[k]=Math.max(t[k]||0,s[k]); else t[k]=(t[k]||0)+s[k]; } };
  const writeProg=()=>{ fs.writeFileSync(P+'.tmp',JSON.stringify(prog)); fs.renameSync(P+'.tmp',P); };
  const tryMerge=()=>{
    while(nextMerge<todo.length&&fs.existsSync(path.join(TMP,todo[nextMerge]+'.done'))){
      const n=todo[nextMerge], b=path.join(TMP,n);
      const info=JSON.parse(fs.readFileSync(b+'.json','utf8'));
      const m0=fs.readFileSync(b+'.M.bin'), mi=new Int32Array(m0.length>>2); Buffer.from(mi.buffer).set(m0);
      for(let i=0;i<info.nDec;i++) mi[i*NM+5]+=prog.cands;
      fs.writeSync(fdM,Buffer.from(mi.buffer),0,mi.byteLength,HDR+prog.rows*NM*4);
      const s=fs.readFileSync(b+'.S.bin'); fs.writeSync(fdS,s); const c=fs.readFileSync(b+'.C.bin'); fs.writeSync(fdC,c);
      if(OMNI){ const o=fs.readFileSync(b+'.O.bin'); fs.writeSync(fdO,o); prog.O+=o.length; }
      prog.S+=s.length; prog.C+=c.length; prog.rows+=info.nDec; prog.cands+=info.nC; prog.M=prog.rows*NM*4; prog.names.push(n); addStat(prog.stat,info.stat);
      fs.fsyncSync(fdS); fs.fsyncSync(fdC); fs.fsyncSync(fdM); if(OMNI) fs.fsyncSync(fdO);
      writeProg();
      for(const e of ['.S.bin','.C.bin','.M.bin','.json','.done','.O.bin']) try{ fs.unlinkSync(b+e); }catch(_){}
      nextMerge++;
      if(nextMerge%20===0||nextMerge===todo.length) console.log(`${nextMerge}/${todo.length} 块并入 ${((Date.now()-t0)/1000).toFixed(0)}s`);
    }
  };
  const finish=()=>{
    fs.writeSync(fdM,npyHeader(prog.rows),0,HDR,0);
    fs.closeSync(fdS); fs.closeSync(fdC); fs.closeSync(fdM); if(OMNI) fs.closeSync(fdO);
    fs.writeFileSync(path.join(MG,'stats.json'),JSON.stringify({stat:prog.stat,rows:prog.rows,cands:prog.cands,NM,MF,SD:F.SD,OD:F.OD,CD:F.CD,omni:OMNI,chunks:prog.names.length}));
    fs.writeFileSync(path.join(MG,'done'),'1');
    try{ for(const f of fs.readdirSync(TMP)) fs.unlinkSync(path.join(TMP,f)); fs.rmdirSync(TMP); }catch(_){}   // 被打断的子进程留下的半截小块
    console.log(`完成:${prog.rows} 决策 ${prog.cands} 候选 ${prog.names.length} 块 ${((Date.now()-t0)/1000).toFixed(0)}s`);
  };
  const next=()=>{
    tryMerge();
    while(!failed&&running<W&&nextSpawn<todo.length&&nextSpawn<nextMerge+LOOK){
      const c=todo[nextSpawn++];
      if(fs.existsSync(path.join(TMP,c+'.done'))) continue;      // 上次已算好还没并入
      running++;
      const p=cp.spawn(process.execPath,[__filename,`--chunk=${c}`,`--rec=${where[c]}`,`--out=${OUT}`,...(OMNI?['--omni']:[])],{stdio:['ignore','ignore','inherit']});
      p.on('exit',code=>{ running--; if(code){ failed=true; console.error('子进程失败',c,code); } next(); });
    }
    if(!failed&&running===0&&nextMerge>=todo.length&&!next.fin){ next.fin=true; finish(); }
    if(failed&&running===0) process.exit(1);
  };
  next();
}

if(arg('chunk',null)) worker(arg('chunk'),RECS[0]); else parent();
