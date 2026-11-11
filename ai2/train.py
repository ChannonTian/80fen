#!/usr/bin/env python3
"""ai2/train.py —— oracle 价值网络:局面(全明牌)→ 终局闲家总分 /5 的 41 类分布。
  python3 ai2/train.py --data <export 目录> --tag v1 --steps 20000 [--hold 9] [--hid 512,256,128]
划分:按种子,seed % 10 == hold 的整副牌进留出集(训练全程不碰)。
输出:ai2/weights/vnet-<tag>.json(fp16 base64)+ ai2/weights/vnet-<tag>.metrics.json
"""
import argparse, json, time, base64, os, sys
import numpy as np, torch, torch.nn as nn, torch.nn.functional as Fn

ap = argparse.ArgumentParser()
ap.add_argument('--data', required=True); ap.add_argument('--tag', default='v1')
ap.add_argument('--steps', type=int, default=20000); ap.add_argument('--bs', type=int, default=2048)
ap.add_argument('--lr', type=float, default=1.5e-3); ap.add_argument('--hold', type=int, default=9)
ap.add_argument('--hid', default='512,256,128'); ap.add_argument('--threads', type=int, default=4)
ap.add_argument('--wd', type=float, default=1e-6)
ap.add_argument('--val', type=int, default=8, help='seed %% 10 == val 的整副牌做早停验证集(不是留出集)')
ap.add_argument('--ls', type=float, default=1.5, help='高斯标签平滑的标准差(单位:箱 = 5 分);0 = 硬标签')
ap.add_argument('--drop', type=float, default=0.1); ap.add_argument('--eval_every', type=int, default=250)
ap.add_argument('--out', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'weights'))
a = ap.parse_args()
torch.set_num_threads(a.threads); torch.manual_seed(0); np.random.seed(0)

d = a.data.rstrip('/') + '/'
info = json.load(open(d + 'info.json'))
IDX = np.load(d + 'idx.npy', mmap_mode='r'); DEN = np.load(d + 'dense.npy', mmap_mode='r')
Y = np.load(d + 'y.npy'); META = np.load(d + 'meta.npy')
N = len(Y); NB = info['nbins']; NBIN = info['nbin']; ND = info['nd']
hold_mask = (META[:, 0] % 10) == a.hold; val_mask = (META[:, 0] % 10) == a.val
tr = np.nonzero(~hold_mask & ~val_mask)[0]; ho = np.nonzero(hold_mask)[0]; va = np.nonzero(val_mask)[0]
print(f'N={N} train={len(tr)} val={len(va)} hold={len(ho)} (seeds {len(np.unique(META[tr,0]))}/{len(np.unique(META[ho,0]))})', flush=True)
IDXm = torch.from_numpy(np.ascontiguousarray(IDX)); DENm = torch.from_numpy(np.ascontiguousarray(DEN)); Ym = torch.from_numpy(Y.astype(np.int64))

hid = [int(x) for x in a.hid.split(',')]
class Net(nn.Module):
    def __init__(s):
        super().__init__()
        s.emb = nn.EmbeddingBag(NBIN, hid[0], mode='sum'); s.dense = nn.Linear(ND, hid[0])
        s.fcs = nn.ModuleList(); prev = hid[0]
        for h in hid[1:]: s.fcs.append(nn.Linear(prev, h)); prev = h
        s.head = nn.Linear(prev, NB); s.dp = nn.Dropout(a.drop)
    def forward(s, idx, den):
        x = s.dp(Fn.relu(s.emb(idx.long()) + s.dense(den)))
        for f in s.fcs: x = s.dp(Fn.relu(f(x)))
        return s.head(x)
net = Net()
nn.init.normal_(net.emb.weight, 0.0, 0.05)   # 默认 N(0,1) 对 108 个激活求和会爆
opt = torch.optim.Adam(net.parameters(), lr=a.lr, weight_decay=a.wd)
sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=a.lr, total_steps=a.steps, pct_start=0.05, final_div_factor=50)

K = torch.arange(NB, dtype=torch.float32)
if a.ls > 0:
    SM = torch.exp(-0.5 * ((K[:, None] - K[None, :]) / a.ls) ** 2); SM = SM / SM.sum(1, keepdim=True)   # SM[y] = 平滑后的目标分布
def soft_ce(lg, y):
    if a.ls <= 0: return Fn.cross_entropy(lg, y)
    return -(SM[y] * Fn.log_softmax(lg, 1)).sum(1).mean()
centers = torch.arange(NB, dtype=torch.float32) * 5.0   # 箱 b = 总分 5b(≥200 并入 200)
def batch(ix):
    ix = torch.as_tensor(ix); return IDXm[ix], DENm[ix], Ym[ix]
@torch.no_grad()
def evaluate(ix, bs=8192):
    net.eval(); ce = 0.0; es = []
    for i in range(0, len(ix), bs):
        x, dn, y = batch(ix[i:i+bs]); lg = net(x, dn)
        ce += Fn.cross_entropy(lg, y, reduction='sum').item(); es.append((Fn.softmax(lg, 1) * centers).sum(1))
    net.train(); return ce / len(ix), torch.cat(es).numpy()

def cards_left(ix):   # 手牌最多的那家还剩几张
    return (DEN[ix][:, 7:11].max(1) * 25).round().astype(int)
BUCKETS = [('25-19', 19, 25), ('18-13', 13, 18), ('12-7', 7, 12), ('6-1', 1, 6)]
def mae_by_bucket(ix, pred):
    cl = cards_left(ix); S = Y[ix] * 5.0; out = {}
    for nm, lo, hi in BUCKETS:
        m = (cl >= lo) & (cl <= hi); out[nm] = {'n': int(m.sum()), 'mae': float(np.abs(pred[m] - S[m]).mean())}
    out['all'] = {'n': len(ix), 'mae': float(np.abs(pred - S).mean())}; return out

t0 = time.time(); step = 0; run = 0.0; best_ce = 1e9; best_step = 0; best_sd = None
while step < a.steps:
    perm = np.random.permutation(tr)
    for i in range(0, len(perm) - a.bs + 1, a.bs):
        x, dn, y = batch(np.sort(perm[i:i+a.bs]))
        loss = soft_ce(net(x, dn), y); opt.zero_grad(); loss.backward(); opt.step(); sched.step()
        run = 0.98 * run + 0.02 * loss.item() if step else loss.item(); step += 1
        if step % 500 == 0: print(f'step {step} loss {run:.4f} {time.time()-t0:.0f}s', flush=True)
        if step % a.eval_every == 0 or step == a.steps:
            ce, _ = evaluate(va[::2]); print(f'  val CE {ce:.4f}', flush=True)
            if ce < best_ce: best_ce = ce; best_step = step; best_sd = {k: v.clone() for k, v in net.state_dict().items()}
        if step >= a.steps: break
train_sec = time.time() - t0
net.load_state_dict(best_sd); print('best val step', best_step, best_ce)
ce, ev = evaluate(ho)
S_ho = Y[ho] * 5.0
res = {'tag': a.tag, 'N': int(N), 'train': int(len(tr)), 'hold': int(len(ho)), 'steps': a.steps, 'train_sec': train_sec,
       'hold_ce': ce, 'best_step': best_step, 'val_ce': best_ce, 'ls': a.ls, 'drop': a.drop, 'net_mae': mae_by_bucket(ho, ev)}
# 基线 (a):闲家已得分 + 50% × 场上还没落袋的分(手牌 + 底牌 + 本墩台面)
dn = DEN[ho]; rem = (dn[:, 1] + dn[:, 2]) * 100 + dn[:, 3] * 40 + dn[:, 4] * 40
base_a = np.minimum(dn[:, 0] * 100 + 0.5 * rem, 200)
res['base_a_mae'] = mae_by_bucket(ho, base_a)
# 基线 (b):同样特征上的线性模型(Adam 训几个 epoch,MSE on S/100)
lin_e = nn.EmbeddingBag(NBIN, 1, mode='sum'); lin_d = nn.Linear(ND, 1)
nn.init.zeros_(lin_e.weight); nn.init.zeros_(lin_d.weight); nn.init.constant_(lin_d.bias, 0.8)
lopt = torch.optim.Adam(list(lin_e.parameters()) + list(lin_d.parameters()), lr=3e-3)
for ep in range(3):
    perm = np.random.permutation(tr)
    for i in range(0, min(len(perm), 2_000_000) - 4096 + 1, 4096):
        x, dn_, y = batch(np.sort(perm[i:i+4096]))
        p = lin_e(x.long()).squeeze(1) + lin_d(dn_).squeeze(1)
        l = Fn.mse_loss(p, y.float() * 5 / 100); lopt.zero_grad(); l.backward(); lopt.step()
with torch.no_grad():
    pl = []
    for i in range(0, len(ho), 8192):
        x, dn_, y = batch(ho[i:i+8192]); pl.append((lin_e(x.long()).squeeze(1) + lin_d(dn_).squeeze(1)) * 100)
res['base_b_linear_mae'] = mae_by_bucket(ho, torch.cat(pl).clamp(0, 200).numpy())
print(json.dumps(res, ensure_ascii=False, indent=1))

# ---- 存权重:fp16 base64 ----
os.makedirs(a.out, exist_ok=True)
def b64(t): return base64.b64encode(t.detach().cpu().numpy().astype('<f2').tobytes()).decode()
W = {'format': 'vnet-v1', 'dim_bin': NBIN, 'nd': ND, 'nbins': NB, 'hid': hid,
     'emb': b64(net.emb.weight), 'dense_w': b64(net.dense.weight), 'b0': b64(net.dense.bias),
     'layers': [{'w': b64(f.weight), 'b': b64(f.bias), 'out': f.out_features, 'in': f.in_features} for f in net.fcs],
     'head_w': b64(net.head.weight), 'head_b': b64(net.head.bias), 'centers': [float(c) for c in centers.tolist()]}
json.dump(W, open(f'{a.out}/vnet-{a.tag}.json', 'w'))
json.dump(res, open(f'{a.out}/vnet-{a.tag}.metrics.json', 'w'), ensure_ascii=False, indent=1)
print('saved', f'{a.out}/vnet-{a.tag}.json', os.path.getsize(f'{a.out}/vnet-{a.tag}.json') / 1e6, 'MB')
