"""在 ShengJi+ **自己的环境**里验权重(它的规则、它的发牌、亮主 / 扣底 / 炒地都由它自己的网络做)。

  python -I test/sjplus/sj_eval.py --repo <shengji_plus 仓库> --ckpt <含 main.pt 的目录> --opp random    --games 300
  python -I test/sjplus/sj_eval.py --repo ...                 --ckpt ...                 --opp strategic --games 300
  python -I test/sjplus/sj_eval.py --repo ... --ckpt ... --selfplay 20        # 只量速度:一局自对弈、一次决策、一次前向

等价于它 README 的 `python TrainLoop.py --model-folder X --eval-only --eval-size N [--eval-agent strategic]`
(同一个 Simulation、同样的默认开关:炒地开、甩牌关;ShengJi+ 坐 N / S,对手坐 E / W),不直接跑它那条命令的原因:
  · 它读权重用 torch.load 的默认方式,还 pickle.load 目录里的 state.pkl / stats.pkl、import 目录里的 Models.py ——
    下载物当不可信数据,这三样都不做:这里只用 weights_only=True 读四个 .pt,网络结构用仓库里的 networks/Models.py;
  · 它到处写死 .cuda(),没有 N 卡的机器(包括 Mac)直接跑会挂。
读数对照:README 说对随机出牌「Level Rate 97.7%」= 下面的「级数占比」。
"""
import argparse
import json
import multiprocessing as mp
import os
import random
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import torch

import sj_common as sj


def make_agent(R, ckpt, static_encoding=False):
    from agents.DMCAgent import DMCAgent
    M = R['Models']
    dev = 'cuda' if torch.cuda.is_available() else 'cpu'
    main_sd = sj.load_state(os.path.join(ckpt, 'main.pt'))
    in_f = main_sd['fc1.weight'].shape[1]
    assert in_f in (sj.MAIN_IN_PLAIN, sj.MAIN_IN_ORACLE), f'main.pt 的 fc1 输入宽度 {in_f} 和仓库里的网络对不上'
    use_oracle = in_f == sj.MAIN_IN_ORACLE
    agent = DMCAgent(ckpt, use_oracle=use_oracle, dynamic_encoding=not static_encoding)
    for name, cls, module in (('declare', M.DeclarationModel, agent.declare_module),
                              ('kitty', M.KittyModel, agent.kitty_module),
                              ('chaodi', M.ChaodiModel, agent.chaodi_module)):
        m = cls()
        m.load_state_dict(sj.load_state(os.path.join(ckpt, name + '.pt')), strict=True)
        module.load_model(m.to(dev))
    mm = M.MainModel(use_oracle=use_oracle)
    mm.load_state_dict(main_sd, strict=True)
    agent.main_module.load_model(mm.to(dev))
    return agent, use_oracle


def shard(job):
    (idx, a, games) = job
    torch.set_num_threads(1)
    R = sj.setup_repo(a['repo'])
    from Simulation import Simulation
    from agents.RandomAgent import RandomAgent
    from agents.StrategicAgent import StrategicAgent
    import logging
    logging.getLogger().setLevel(logging.ERROR)
    random.seed(a['seed'] * 1000 + idx)
    torch.manual_seed(0)
    agent, use_oracle = make_agent(R, a['ckpt'], a['static'])
    t0 = time.perf_counter()
    if a['selfplay']:
        sim = Simulation(player1=agent, player2=None, enable_chaodi=not a['no_chaodi'], enable_combos=True,
                         discount=0.95, epsilon=0.015, combo_penalty=0.01)
        n_dec = 0
        for _ in range(games):
            with torch.no_grad():
                while sim.step()[0]:
                    pass
            n_dec += len(sim.main_history)
            sim.reset()
        return {'games': games, 'wall': time.perf_counter() - t0, 'main_decisions': n_dec, 'use_oracle': use_oracle}
    opp = RandomAgent('random') if a['opp'] == 'random' else StrategicAgent('strategic')
    sim = Simulation(player1=agent, player2=opp, enable_chaodi=not a['no_chaodi'], enable_combos=a['combos'], eval=True)
    for _ in range(games):
        with torch.no_grad():
            while sim.step()[0]:
                pass
        sim.reset()
    return {'games': games, 'wall': time.perf_counter() - t0, 'win': sim.win_counts, 'lv': sim.level_counts,
            'opp_pts': sim.opposition_points, 'inf': [sum(sim.inference_times), len(sim.inference_times)], 'use_oracle': use_oracle}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', required=True)
    ap.add_argument('--ckpt', required=True)
    ap.add_argument('--opp', choices=['random', 'strategic'], default='random')
    ap.add_argument('--games', type=int, default=300)
    ap.add_argument('--procs', type=int, default=max(1, min(8, (os.cpu_count() or 2))))
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--enable-combos', action='store_true', help='它 README 的评测命令不带这个开关(默认不甩牌)')
    ap.add_argument('--disable-chaodi', action='store_true')
    ap.add_argument('--static-encoding', action='store_true', help='权重若是 --static-encoding 练的才加;默认(动态编码)对不上 README 读数时试它')
    ap.add_argument('--json', help='把读数另存成 JSON(run-local.sh 用它判门槛)')
    ap.add_argument('--selfplay', type=int, default=0, help='只量速度:跑这么多局训练口径的自对弈(四家都是网络、带甩牌、带探索)')
    args = ap.parse_args()
    a = {'repo': os.path.abspath(args.repo), 'ckpt': os.path.abspath(args.ckpt), 'opp': args.opp, 'seed': args.seed,
         'combos': args.enable_combos, 'no_chaodi': args.disable_chaodi, 'static': args.static_encoding, 'selfplay': bool(args.selfplay)}
    total = args.selfplay or args.games
    procs = 1 if args.selfplay else min(args.procs, total)
    jobs = [(i, a, total // procs + (1 if i < total % procs else 0)) for i in range(procs)]
    t0 = time.perf_counter()
    if procs == 1:
        res = [shard(jobs[0])]
    else:
        with mp.get_context('spawn').Pool(procs) as pool:
            res = pool.map(shard, jobs)
    wall = time.perf_counter() - t0
    if args.selfplay:
        r = res[0]
        print(f"训练口径自对弈(单进程、单线程、{'带' if r['use_oracle'] else '不带'} oracle):{r['games']} 局用 {r['wall']:.1f} 秒 = {r['wall'] / r['games']:.2f} 秒/局;"
              f"每局 {r['main_decisions'] / r['games']:.0f} 条打牌样本")
        R = sj.setup_repo(a['repo'])
        model, uo = sj.load_main_model(a['ckpt'])
        torch.set_num_threads(1)
        w = model.fc1.in_features - 256
        for b in (1, 32):
            x, h = torch.zeros((b, w)), torch.zeros((b, 15, 436))
            with torch.no_grad():
                for _ in range(20):
                    model(x, h)
                t = time.perf_counter()
                for _ in range(200):
                    model(x, h)
            print(f'  主网络一次前向(batch={b},CPU 单线程):{(time.perf_counter() - t) / 200 * 1000:.2f} ms;参数 {sum(p.numel() for p in model.parameters())} 个')
        return
    win = [sum(r['win'][i] for r in res) for i in (0, 1)]
    lv = [sum(r['lv'][i] for r in res) for i in (0, 1)]
    pts = [[p for r in res for p in r['opp_pts'][i]] for i in (0, 1)]
    inf_t, inf_n = sum(r['inf'][0] for r in res), sum(r['inf'][1] for r in res)
    n = sum(win)
    avg = lambda v: sum(v) / len(v) if v else float('nan')  # noqa: E731
    print(f"ShengJi+(N/S)在它自己的环境里对 {args.opp}(E/W):{n} 局,炒地{'关' if args.disable_chaodi else '开'}、甩牌{'开' if args.enable_combos else '关'}、"
          f"{'静态' if args.static_encoding else '动态'}编码、{'带' if res[0]['use_oracle'] else '不带'} oracle")
    print(f'  Win counts: {win}   level counts: {lv}')
    print(f'  胜率 {100 * win[0] / n:.1f}%   级数占比(README 的 Level Rate){100 * lv[0] / max(1, sum(lv)):.1f}%')
    print(f'  对手坐庄时 ShengJi+ 平均抓分 {avg(pts[0]):.1f};ShengJi+ 坐庄时对手平均抓分 {avg(pts[1]):.1f}')
    if args.json:
        with open(args.json, 'w') as f:
            json.dump({'opp': args.opp, 'games': n, 'win': win, 'lv': lv, 'win_rate': win[0] / n, 'level_rate': lv[0] / max(1, sum(lv))}, f)
    print(f'  每次打牌决策 {1000 * inf_t / max(1, inf_n):.1f} ms(它的写法:每个候选单独前向一次);{wall:.0f} 秒,{procs} 个进程,{n / wall:.2f} 局/秒')


if __name__ == '__main__':
    main()
