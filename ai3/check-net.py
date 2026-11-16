"""自检 2 的 PyTorch 一侧:随机取 N 个决策,用 CPU float32 算候选分数,写进 <net>/check.json,由 check-net.js 对比。
  ai3/.venv/bin/python ai3/check-net.py --feat ai3/out/feat --net ai3/out/net-v1 --n 1200"""
import argparse, json, os, numpy as np, torch
ap = argparse.ArgumentParser(); ap.add_argument('--feat'); ap.add_argument('--net'); ap.add_argument('--n', type=int, default=1200)
a = ap.parse_args()
man = json.load(open(os.path.join(a.net, 'manifest.json'))); SD, CD, h1, h2 = man['SD'], man['CD'], man['h1'], man['h2']
sc = json.load(open(os.path.join(os.path.dirname(a.feat.rstrip('/')), 'feat-scales.json')))
raw = np.fromfile(os.path.join(a.net, 'weights.f32'), dtype=np.float32)
T = {t['name']: torch.from_numpy(raw[t['offset']:t['offset'] + t['n']].reshape(t['shape']).copy()) for t in man['tensors']}
ss = torch.tensor(sc['sscale']); cs = torch.tensor(sc['cscale'])
def fwd(x, c):
    h = torch.relu(x @ T['e1.weight'].T + T['e1.bias']); ctx = torch.relu(h @ T['e2.weight'].T + T['e2.bias'])
    z = torch.relu((ctx @ T['wa.weight'].T + T['wa.bias'])[None, :] + c @ T['wb.weight'].T)
    z = torch.relu(z @ T['c2.weight'].T + T['c2.bias'])
    return (z @ T['o.weight'].T + T['o.bias']).squeeze(-1)
rng = np.random.default_rng(1); names = sorted(f[:-5] for f in os.listdir(a.feat) if f.endswith('.done'))
out = []
for k in range(a.n):
    nm = names[rng.integers(len(names))]; p = os.path.join(a.feat, nm)
    M = np.fromfile(p + '.M.bin', dtype=np.int32).reshape(-1, 14); i = int(rng.integers(M.shape[0]))
    S = np.fromfile(p + '.S.bin', dtype=np.uint8, count=SD, offset=i * SD)
    n, off = int(M[i, 4]), int(M[i, 5])
    C = np.fromfile(p + '.C.bin', dtype=np.uint8, count=n * CD, offset=off * CD).reshape(n, CD)
    s = fwd(torch.from_numpy(S.astype(np.float32)) * ss, torch.from_numpy(C.astype(np.float32)) * cs).tolist()
    out.append({'chunk': nm, 'i': i, 'scores': s})
json.dump(out, open(os.path.join(a.net, 'check.json'), 'w'))
print('写入', len(out))
