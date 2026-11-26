"""ai3/train.py —— 阶段 1:把现引擎的出牌选择蒸馏成小策略网络(模仿学习)。
  ai3/.venv/bin/python ai3/train.py --feat ai3/out/feat80 [ai3/out/feat3 ...] --out ai3/out/net-v1 [--frac 1.0] [--epochs 12] [--seed 0]
         [--wd 1e-4] [--dropout 0] [--exclude-dagger]
--feat 可给多个目录(各自 <目录>/merged/{S.bin,C.bin,M.npy},拼起来用,全部 memmap,不进内存);按 val_loss 选最好的一轮导出;
test top-1 另报「普通局 / DAgger 局」(M 的 flags bit6 = DAgger 局里的决策,bit7 = 其中网络座位的决策)。
结构:局面 SD→512→512(ReLU)得局面向量;每个候选 [局面向量, 候选特征] → 256 → 256 → 1(第一层拆成 Wa·ctx + Wb·cand,等价于拼接)。
同一决策的候选做 softmax 交叉熵,标签 = 引擎的选择。剔除被强制的甩牌 / 非法跟牌(flags bit1)。
"""
import argparse, glob, json, os, sys, time
import numpy as np, torch, torch.nn as nn, torch.nn.functional as Fn

ap = argparse.ArgumentParser()
ap.add_argument('--feat', nargs='+', default=['ai3/out/feat']); ap.add_argument('--out', default='ai3/out/net-v1')
ap.add_argument('--frac', type=float, default=1.0); ap.add_argument('--epochs', type=int, default=12)
ap.add_argument('--seed', type=int, default=0); ap.add_argument('--lr', type=float, default=1e-3)
ap.add_argument('--patience', type=int, default=3); ap.add_argument('--rows', type=int, default=80000)
ap.add_argument('--maxb', type=int, default=2048); ap.add_argument('--h1', type=int, default=512); ap.add_argument('--h2', type=int, default=256)
ap.add_argument('--limit', type=int, default=0, help='只读前 N 个分片(调试)')
ap.add_argument('--no-export', action='store_true')
ap.add_argument('--wd', type=float, default=1e-4, help='AdamW weight decay'); ap.add_argument('--dropout', type=float, default=0.0)
ap.add_argument('--exclude-dagger', action='store_true', help='训练和验证都不用 DAgger 局(test 照旧全报)')
ap.add_argument('--eval-net', default='', help='只在这份特征的 test 集上评一个已导出的网络(目录),不训练')
a = ap.parse_args()
torch.manual_seed(a.seed); np.random.seed(a.seed)
dev = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')
sc = json.load(open(os.path.join(os.path.dirname(a.feat[0].rstrip('/')), 'feat-scales.json')))
SD, CD = sc['SD'], sc['CD']; NM = 14

import mmap, shutil, threading, queue

def merge(feat, limit=0):
    """分片 → 一份连续的 S.bin / C.bin(流式拷贝,不进内存)+ M.npy;已合并(done 标记)则跳过。"""
    mdir = os.path.join(feat, 'merged' if not limit else f'merged_l{limit}')
    if os.path.exists(os.path.join(mdir, 'done')): return mdir
    os.makedirs(mdir, exist_ok=True)
    names = sorted(f[:-5] for f in os.listdir(feat) if f.endswith('.done'))
    if limit: names = names[:limit]
    Ms = []; off = 0
    with open(os.path.join(mdir, 'S.bin'), 'wb') as fs, open(os.path.join(mdir, 'C.bin'), 'wb') as fc:
        for n in names:
            p = os.path.join(feat, n)
            m = np.fromfile(p + '.M.bin', dtype=np.int32).reshape(-1, NM).copy(); m[:, 5] += off
            nc = os.path.getsize(p + '.C.bin') // CD; off += nc
            for ext, fo in (('.S.bin', fs), ('.C.bin', fc)):
                with open(p + ext, 'rb') as fi: shutil.copyfileobj(fi, fo, 1 << 24)
            Ms.append(m)
    np.save(os.path.join(mdir, 'M.npy'), np.concatenate(Ms))
    open(os.path.join(mdir, 'done'), 'w').write('1')
    return mdir

t0 = time.time()
mdirs = [merge(f, a.limit) for f in a.feat]
NSRC = len(mdirs)
# 把每个来源的 M.npy 分块抽成紧凑列(M 本身 8 万局就 300 MB,24 万局近 1 GB,不整份留在内存里)
cols = {k: [] for k in ('seed', 'lead', 'ncand', 'coff', 'label', 'flags', 'hn', 'split', 'src')}
rowoff = []; NCs = []; off = 0
for si, md in enumerate(mdirs):
    Mm = np.load(os.path.join(md, 'M.npy'), mmap_mode='r'); n = Mm.shape[0]; rowoff.append(off); off += n
    for lo in range(0, n, 2_000_000):
        blk = np.asarray(Mm[lo:lo + 2_000_000])
        cols['seed'].append(blk[:, 0].astype(np.int32)); cols['lead'].append(blk[:, 3].astype(np.uint8))
        cols['ncand'].append(blk[:, 4].astype(np.int16)); cols['coff'].append(blk[:, 5].astype(np.int32))
        cols['label'].append(blk[:, 6].astype(np.int16)); cols['flags'].append(blk[:, 7].astype(np.uint8))
        cols['hn'].append(blk[:, 9].astype(np.uint8)); cols['split'].append(blk[:, 11].astype(np.uint8))
        cols['src'].append(np.full(len(blk), si, np.uint8))
    del Mm
    NCs.append(os.path.getsize(os.path.join(md, 'C.bin')) // CD)
cols = {k: np.concatenate(v) for k, v in cols.items()}
seedA, leadA, ncand, coff, label, flags, hnA, split, srcA = (cols[k] for k in ('seed', 'lead', 'ncand', 'coff', 'label', 'flags', 'hn', 'split', 'src'))
NTOT = len(seedA)
def open_maps():
    global S, C
    S = [np.memmap(os.path.join(md, 'S.bin'), dtype=np.uint8, mode='r').reshape(-1, SD) for md in mdirs]
    C = [np.memmap(os.path.join(md, 'C.bin'), dtype=np.uint8, mode='r').reshape(-1, CD) for md in mdirs]
open_maps()
print(f'打开 {len(mdirs)} 份特征:{NTOT} 决策 {sum(NCs)} 候选 ({time.time()-t0:.0f}s)', flush=True)
bad = (flags & 2) != 0; dagg = (flags & 64) != 0; dagnet = (flags & 128) != 0
seeds_train = np.unique(seedA[split == 0])
if a.frac < 1.0:
    keep = seeds_train[: int(len(seeds_train) * a.frac)]
    lut = np.zeros(int(seedA.max()) + 1, bool); lut[keep] = True
    tr_mask = lut[seedA] & (split == 0)
else:
    tr_mask = split == 0
okmask = ~bad & ~dagg if a.exclude_dagger else ~bad
tr = np.where(tr_mask & okmask)[0].astype(np.int32)
va = np.where((split == 1) & okmask)[0].astype(np.int32); te = np.where((split == 2) & ~bad)[0].astype(np.int32)
print(f'train {len(tr)} (局 {len(np.unique(seedA[tr]))};其中 DAgger 局决策 {int(dagg[tr].sum())}) val {len(va)} test {len(te)}; 剔除 bad {bad.sum()}', flush=True)
del tr_mask, okmask

sscale = torch.tensor(sc['sscale'], device=dev); cscale = torch.tensor(sc['cscale'], device=dev)
def release_pages():
    """memmap 读过的页算进进程 RSS(macOS 上 madvise 不还):周期性关掉再重新映射,页留在系统页缓存里,RSS 回落。"""
    global S, C
    S = C = None
    import gc; gc.collect()
    open_maps()

class Net(nn.Module):
    def __init__(s, h1, h2, p=0.0):
        super().__init__()
        s.dr = nn.Dropout(p)
        s.e1 = nn.Linear(SD, h1); s.e2 = nn.Linear(h1, h1)
        s.wa = nn.Linear(h1, h2); s.wb = nn.Linear(CD, h2, bias=False)
        s.c2 = nn.Linear(h2, h2); s.o = nn.Linear(h2, 1)
    def forward(s, x, c, mask):           # x (B,SD) float 已乘 scale;c (B,Cm,CD);mask (B,Cm)
        ctx = s.dr(Fn.relu(s.e2(s.dr(Fn.relu(s.e1(x))))))
        h = s.dr(Fn.relu(s.wa(ctx)[:, None, :] + s.wb(c)))
        h = s.dr(Fn.relu(s.c2(h)))
        return s.o(h).squeeze(-1).masked_fill(~mask, -1e9)

if a.eval_net:
    man = json.load(open(os.path.join(a.eval_net, 'manifest.json'))); a.h1, a.h2 = man['h1'], man['h2']
net = Net(a.h1, a.h2, a.dropout).to(dev)
if a.eval_net:
    raw = np.fromfile(os.path.join(a.eval_net, 'weights.f32'), dtype=np.float32)
    net.load_state_dict({t['name']: torch.from_numpy(raw[t['offset']:t['offset'] + t['n']].reshape(t['shape']).copy()) for t in man['tensors']})
nparam = sum(p.numel() for p in net.parameters()); print('参数量', nparam, flush=True)

def batches(idx, shuffle, block=100000):
    """按文件顺序切成大块(每块 ~block 个决策),块内再按候选数分组成批:每个批的下标都落在同一块里,磁盘 / 页缓存读取就近;
    训练时块序随机、块内随机,评测时固定顺序。"""
    out = []
    starts = list(range(0, len(idx), block))
    if shuffle: np.random.shuffle(starts)
    for st0 in starts:
        sub = idx[st0:st0 + block]
        n = ncand[sub].astype(np.int64)
        key = n + (np.random.rand(len(sub)) * 0.9 if shuffle else 0)
        order = sub[np.argsort(key, kind='stable')]; ns = ncand[order].astype(np.int64)
        bl = []; i = 0; N = len(order)
        while i < N:
            lo, hi = i + 1, min(N, i + a.maxb)          # 二分:最大的 j,使 (j-i)*ns[j-1] <= rows
            while lo < hi:
                mid = (lo + hi + 1) // 2
                if (mid - i) * ns[mid - 1] <= a.rows: lo = mid
                else: hi = mid - 1
            bl.append(np.sort(order[i:lo])); i = lo
        if shuffle: np.random.shuffle(bl)
        out.extend(bl)
    return out

def fetch_np(b):
    n = ncand[b].astype(np.int64); cm = int(n.max()); ar = np.arange(cm)
    mask = ar[None, :] < n[:, None]
    sb = srcA[b]; s0 = int(sb[0])
    if (sb == s0).all():                      # 绝大多数批落在同一份特征里
        ix = np.minimum(coff[b][:, None] + ar[None, :], NCs[s0] - 1)
        return np.ascontiguousarray(S[s0][b - rowoff[s0]]), np.ascontiguousarray(C[s0][ix]), mask, label[b].astype(np.int64)
    x = np.empty((len(b), SD), np.uint8); c = np.zeros((len(b), cm, CD), np.uint8)
    for s_ in np.unique(sb):
        sel = np.where(sb == s_)[0]; bs = b[sel]
        x[sel] = S[s_][bs - rowoff[s_]]
        c[sel] = C[s_][np.minimum(coff[bs][:, None] + ar[None, :], NCs[s_] - 1)]
    return x, c, mask, label[b].astype(np.int64)

def loader(bl, depth=4):
    """后台线程在 CPU 上按下标 gather 下一批,主线程只管搬到 mps 算。"""
    q = queue.Queue(depth)
    def work():
        for k, b in enumerate(bl):
            q.put((b, fetch_np(b)))
            if k % 40 == 39: release_pages()
        q.put(None)
    th = threading.Thread(target=work, daemon=True); th.start()
    while True:
        it = q.get()
        if it is None: break
        b, (x, c, m, y) = it
        yield (b, torch.from_numpy(x).to(dev).float() * sscale, torch.from_numpy(c).to(dev).float() * cscale,
               torch.from_numpy(m).to(dev), torch.from_numpy(y).to(dev))
    release_pages()

@torch.no_grad()
def evaluate(idx, detail=False):
    net.eval(); tot = 0; hit = 0; loss = 0.0
    rows = []
    for b, x, c, mask, y in loader(batches(idx, False)):
        lg = net(x, c, mask)
        loss += Fn.cross_entropy(lg, y, reduction='sum').item()
        pred = lg.argmax(1)
        h = (pred == y).cpu().numpy(); hit += h.sum(); tot += len(b)
        if detail: rows.append((b, h))
    net.train()
    if not detail: return hit / max(tot, 1), loss / max(tot, 1)
    allb = np.concatenate([r[0] for r in rows]); allh = np.concatenate([r[1] for r in rows])
    return hit / max(tot, 1), loss / max(tot, 1), allb, allh

if a.eval_net: a.epochs = 0
opt = torch.optim.AdamW(net.parameters(), lr=a.lr, weight_decay=a.wd)
nb = len(batches(tr, True)) if len(tr) else 1; total_steps = max(1, a.epochs * nb)
sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=a.lr, total_steps=total_steps, pct_start=0.05)
va2 = va[ncand[va] >= 2]; te2 = te[ncand[te] >= 2]
best = 1e9; best_top1 = 0.0; best_ep = 0; bad_ep = 0; os.makedirs(a.out, exist_ok=True); ck = os.path.join(a.out, 'best.pt')
for ep in range(a.epochs):
    t1 = time.time(); tl = 0.0; k = 0
    for b, x, c, mask, y in loader(batches(tr, True)):
        loss = Fn.cross_entropy(net(x, c, mask), y)
        opt.zero_grad(set_to_none=True); loss.backward(); opt.step()
        if sched.last_epoch < total_steps - 1: sched.step()
        tl += loss.item(); k += 1
    v1, vl = evaluate(va2)
    print(f'epoch {ep+1} train_loss {tl/k:.4f} val_top1(n>=2) {v1:.4f} val_loss {vl:.4f} ({time.time()-t1:.0f}s)', flush=True)
    if vl < best: best = vl; best_top1 = v1; best_ep = ep + 1; bad_ep = 0; torch.save(net.state_dict(), ck)
    else:
        bad_ep += 1
        if bad_ep >= a.patience: print('早停'); break
if not a.eval_net: net.load_state_dict(torch.load(ck))

# ---- test 报告 ----
t1, tl_, tb, th = evaluate(te2, detail=True)
res = {'frac': a.frac, 'params': nparam, 'val_loss': best, 'val_top1': best_top1, 'best_epoch': best_ep, 'wd': a.wd, 'dropout': a.dropout, 'feat': a.feat, 'exclude_dagger': a.exclude_dagger, 'test_top1': float(t1), 'test_loss': float(tl_), 'n_test': int(len(te2)),
       'n_test_trivial(n=1)': int((ncand[te] < 2).sum())}
isl = leadA[tb] == 1; hn = hnA[tb]; nc = ncand[tb].astype(np.int64); fl = flags[tb]
def rep(mask):
    return [float(th[mask].mean()) if mask.any() else None, int(mask.sum())]
res['lead'] = rep(isl); res['follow'] = rep(~isl)
res['hand>12(无搜索)'] = rep(hn > 12); res['hand<=12(有搜索)'] = rep(hn <= 12)
res['lead&hand>12'] = rep(isl & (hn > 12)); res['follow&hand>12'] = rep(~isl & (hn > 12))
res['lead&hand<=12'] = rep(isl & (hn <= 12)); res['follow&hand<=12'] = rep(~isl & (hn <= 12))
for lo, hi in [(2, 2), (3, 4), (5, 9), (10, 24), (25, 99), (100, 99999)]:
    res[f'cand {lo}-{hi}'] = rep((nc >= lo) & (nc <= hi))
searched = (fl & 4) != 0
res['normal_games'] = rep((fl & 64) == 0); res['dagger_games'] = rep((fl & 64) != 0)
res['dagger_netseat'] = rep((fl & 128) != 0); res['dagger_engineseat'] = rep(((fl & 64) != 0) & ((fl & 128) == 0))
res['engine_searched'] = rep(searched); res['engine_not_searched'] = rep(~searched)
res['label_missing_from_cands(bit0)'] = rep((fl & 1) != 0)
print(json.dumps(res, ensure_ascii=False, indent=1))
os.makedirs(a.out, exist_ok=True)
json.dump(res, open(os.path.join(a.out, 'metrics.json'), 'w'), ensure_ascii=False, indent=1)

if not a.no_export and not a.eval_net:
    sd = {k: v.detach().cpu().numpy().astype(np.float32) for k, v in net.state_dict().items()}
    order = ['e1.weight', 'e1.bias', 'e2.weight', 'e2.bias', 'wa.weight', 'wa.bias', 'wb.weight', 'c2.weight', 'c2.bias', 'o.weight', 'o.bias']
    man = {'SD': SD, 'CD': CD, 'h1': a.h1, 'h2': a.h2, 'tensors': []}; off = 0; buf = bytearray()
    for k in order:
        arr = np.ascontiguousarray(sd[k]); man['tensors'].append({'name': k, 'shape': list(arr.shape), 'offset': off, 'n': int(arr.size)})
        buf += arr.tobytes(); off += arr.size
    open(os.path.join(a.out, 'weights.f32'), 'wb').write(bytes(buf))
    json.dump(man, open(os.path.join(a.out, 'manifest.json'), 'w'), indent=1)
    print('已导出', a.out)
