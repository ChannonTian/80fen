"""ai3/train.py —— 阶段 1:把现引擎的出牌选择蒸馏成小策略网络(模仿学习)。
  ai3/.venv/bin/python ai3/train.py --feat ai3/out/feat --out ai3/out/net-v1 [--frac 1.0] [--epochs 12] [--seed 0]
结构:局面 SD→512→512(ReLU)得局面向量;每个候选 [局面向量, 候选特征] → 256 → 256 → 1(第一层拆成 Wa·ctx + Wb·cand,等价于拼接)。
同一决策的候选做 softmax 交叉熵,标签 = 引擎的选择。剔除被强制的甩牌 / 非法跟牌(flags bit1)。
"""
import argparse, glob, json, os, sys, time
import numpy as np, torch, torch.nn as nn, torch.nn.functional as Fn

ap = argparse.ArgumentParser()
ap.add_argument('--feat', default='ai3/out/feat'); ap.add_argument('--out', default='ai3/out/net-v1')
ap.add_argument('--frac', type=float, default=1.0); ap.add_argument('--epochs', type=int, default=12)
ap.add_argument('--seed', type=int, default=0); ap.add_argument('--lr', type=float, default=1e-3)
ap.add_argument('--patience', type=int, default=3); ap.add_argument('--rows', type=int, default=80000)
ap.add_argument('--maxb', type=int, default=2048); ap.add_argument('--h1', type=int, default=512); ap.add_argument('--h2', type=int, default=256)
ap.add_argument('--limit', type=int, default=0, help='只读前 N 个分片(调试)')
ap.add_argument('--no-export', action='store_true')
ap.add_argument('--eval-net', default='', help='只在这份特征的 test 集上评一个已导出的网络(目录),不训练')
a = ap.parse_args()
torch.manual_seed(a.seed); np.random.seed(a.seed)
dev = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')
sc = json.load(open(os.path.join(os.path.dirname(a.feat.rstrip('/')), 'feat-scales.json')))
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
mdir = merge(a.feat, a.limit)
M = np.load(os.path.join(mdir, 'M.npy'))
S = np.memmap(os.path.join(mdir, 'S.bin'), dtype=np.uint8, mode='r').reshape(-1, SD)
C = np.memmap(os.path.join(mdir, 'C.bin'), dtype=np.uint8, mode='r').reshape(-1, CD)
NC = C.shape[0]
print(f'打开 {M.shape[0]} 决策 {NC} 候选 ({time.time()-t0:.0f}s)', flush=True)
flags = M[:, 7]; bad = (flags & 2) != 0
split = M[:, 11]
seeds_train = np.unique(M[(split == 0), 0])
if a.frac < 1.0:
    keep = set(seeds_train[: int(len(seeds_train) * a.frac)].tolist())
    tr_mask = np.isin(M[:, 0], list(keep))
else:
    tr_mask = split == 0
tr = np.where(tr_mask & ~bad & (split == 0))[0]
va = np.where((split == 1) & ~bad)[0]; te = np.where((split == 2) & ~bad)[0]
print(f'train {len(tr)} (局 {len(np.unique(M[tr,0]))}) val {len(va)} test {len(te)}; 剔除 bad {bad.sum()}', flush=True)

ncand = M[:, 4].astype(np.int64); coff = M[:, 5].astype(np.int64); label = M[:, 6].astype(np.int64)
sscale = torch.tensor(sc['sscale'], device=dev); cscale = torch.tensor(sc['cscale'], device=dev)
_madv = [0]
def open_maps():
    global S, C
    S = np.memmap(os.path.join(mdir, 'S.bin'), dtype=np.uint8, mode='r').reshape(-1, SD)
    C = np.memmap(os.path.join(mdir, 'C.bin'), dtype=np.uint8, mode='r').reshape(-1, CD)
def release_pages():
    """memmap 读过的页算进进程 RSS(macOS 上 madvise 不还):周期性关掉再重新映射,页留在系统页缓存里,RSS 回落。"""
    global S, C
    S = C = None
    import gc; gc.collect()
    open_maps()

class Net(nn.Module):
    def __init__(s, h1, h2):
        super().__init__()
        s.e1 = nn.Linear(SD, h1); s.e2 = nn.Linear(h1, h1)
        s.wa = nn.Linear(h1, h2); s.wb = nn.Linear(CD, h2, bias=False)
        s.c2 = nn.Linear(h2, h2); s.o = nn.Linear(h2, 1)
    def forward(s, x, c, mask):           # x (B,SD) float 已乘 scale;c (B,Cm,CD);mask (B,Cm)
        ctx = Fn.relu(s.e2(Fn.relu(s.e1(x))))
        h = Fn.relu(s.wa(ctx)[:, None, :] + s.wb(c))
        h = Fn.relu(s.c2(h))
        return s.o(h).squeeze(-1).masked_fill(~mask, -1e9)

if a.eval_net:
    man = json.load(open(os.path.join(a.eval_net, 'manifest.json'))); a.h1, a.h2 = man['h1'], man['h2']
net = Net(a.h1, a.h2).to(dev)
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
        n = ncand[sub]
        key = n + (np.random.rand(len(sub)) * 0.9 if shuffle else 0)
        order = sub[np.argsort(key, kind='stable')]; ns = ncand[order]
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
    n = ncand[b]; cm = int(n.max()); ar = np.arange(cm)
    mask = ar[None, :] < n[:, None]
    ix = np.minimum(coff[b][:, None] + ar[None, :], NC - 1)
    return np.ascontiguousarray(S[b]), np.ascontiguousarray(C[ix]), mask, label[b]

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
opt = torch.optim.AdamW(net.parameters(), lr=a.lr, weight_decay=1e-4)
nb = len(batches(tr, True)) if len(tr) else 1; total_steps = max(1, a.epochs * nb)
sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=a.lr, total_steps=total_steps, pct_start=0.05)
va2 = va[ncand[va] >= 2]; te2 = te[ncand[te] >= 2]
best = -1; bad_ep = 0; os.makedirs(a.out, exist_ok=True); ck = os.path.join(a.out, 'best.pt')
for ep in range(a.epochs):
    t1 = time.time(); tl = 0.0; k = 0
    for b, x, c, mask, y in loader(batches(tr, True)):
        loss = Fn.cross_entropy(net(x, c, mask), y)
        opt.zero_grad(set_to_none=True); loss.backward(); opt.step()
        if sched.last_epoch < total_steps - 1: sched.step()
        tl += loss.item(); k += 1
    v1, vl = evaluate(va2)
    print(f'epoch {ep+1} train_loss {tl/k:.4f} val_top1(n>=2) {v1:.4f} val_loss {vl:.4f} ({time.time()-t1:.0f}s)', flush=True)
    if v1 > best: best = v1; bad_ep = 0; torch.save(net.state_dict(), ck)
    else:
        bad_ep += 1
        if bad_ep >= a.patience: print('早停'); break
if not a.eval_net: net.load_state_dict(torch.load(ck))

# ---- test 报告 ----
t1, tl_, tb, th = evaluate(te2, detail=True)
res = {'frac': a.frac, 'params': nparam, 'val_top1': best, 'test_top1': float(t1), 'test_loss': float(tl_), 'n_test': int(len(te2)),
       'n_test_trivial(n=1)': int((ncand[te] < 2).sum())}
isl = M[tb, 3] == 1; hn = M[tb, 9]; nc = ncand[tb]
def rep(mask):
    return [float(th[mask].mean()) if mask.any() else None, int(mask.sum())]
res['lead'] = rep(isl); res['follow'] = rep(~isl)
res['hand>12(无搜索)'] = rep(hn > 12); res['hand<=12(有搜索)'] = rep(hn <= 12)
res['lead&hand>12'] = rep(isl & (hn > 12)); res['follow&hand>12'] = rep(~isl & (hn > 12))
res['lead&hand<=12'] = rep(isl & (hn <= 12)); res['follow&hand<=12'] = rep(~isl & (hn <= 12))
for lo, hi in [(2, 2), (3, 4), (5, 9), (10, 24), (25, 99), (100, 99999)]:
    res[f'cand {lo}-{hi}'] = rep((nc >= lo) & (nc <= hi))
searched = (M[tb, 7] & 4) != 0
res['engine_searched'] = rep(searched); res['engine_not_searched'] = rep(~searched)
res['label_missing_from_cands(bit0)'] = rep((M[tb, 7] & 1) != 0)
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
