"""ShengJi+ 常驻进程:一行 JSON 进(局面 + 候选),一行 JSON 出(分数最高的候选下标)。

  python -I sj_server.py --repo <shengji_plus 仓库> --ckpt <含 main.pt 的目录> [--dom ours|theirs] [--threads 1]

由 match.js 起;协议见 sj_common.build_obs 的注释。出错时回 {"id":..,"error":..},Node 端直接中止,不带病续打。
"""
import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import torch

import sj_common as sj


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', required=True)
    ap.add_argument('--ckpt', required=True)
    ap.add_argument('--dom', choices=['ours', 'theirs'], default='ours',
                    help='「这手出了是不是暂时最大」那一位用谁的裁判:ours = 我们引擎(默认,牌局按我们的规则打);theirs = 它自己的 round_winner')
    ap.add_argument('--threads', type=int, default=1)
    ap.add_argument('--no-check', action='store_true', help='跳过逐项断言(只为量速度)')
    args = ap.parse_args()
    torch.set_num_threads(args.threads)
    sj.setup_repo(args.repo)
    model, use_oracle = sj.load_main_model(args.ckpt)
    out = sys.stdout
    out.write(json.dumps({'ready': True, 'use_oracle': use_oracle, 'torch': torch.__version__,
                          'params': sum(p.numel() for p in model.parameters())}) + '\n')
    out.flush()
    n_dec = n_cand = n_mis = 0
    t_enc = t_fwd = 0.0
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        msg = json.loads(line)
        if msg.get('cmd') == 'stats':
            out.write(json.dumps({'decisions': n_dec, 'cands': n_cand, 'domMismatch': n_mis,
                                  'encMs': 1000 * t_enc / max(1, n_dec), 'fwdMs': 1000 * t_fwd / max(1, n_dec)}) + '\n')
            out.flush()
            continue
        try:
            t0 = time.perf_counter()
            obs = sj.build_obs(msg)
            if not args.no_check:
                sj.check_msg(msg, obs)
            cands = [sj.cardset(c) for c in msg['cands']]
            x, hist, mis = sj.encode(obs, cands, use_oracle, wins=msg['wins'] if args.dom == 'ours' else None)
            t1 = time.perf_counter()
            with torch.no_grad():
                q = model(x, hist).squeeze(1)
            t2 = time.perf_counter()
            best = int(torch.argmax(q).item())
            n_dec += 1
            n_cand += len(cands)
            n_mis += mis
            t_enc += t1 - t0
            t_fwd += t2 - t1
            out.write(json.dumps({'id': msg.get('id'), 'best': best, 'q': [round(v, 4) for v in q.tolist()]}) + '\n')
        except Exception as e:  # noqa: BLE001 —— 任何错都要原样报回去
            out.write(json.dumps({'id': msg.get('id'), 'error': f'{type(e).__name__}: {e}'}) + '\n')
        out.flush()


if __name__ == '__main__':
    main()
