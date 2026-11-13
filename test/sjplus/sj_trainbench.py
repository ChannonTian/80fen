"""量 ShengJi+ 的训练命令在这台机器上每小时能跑多少局 —— 只跑几分钟,不是真训。

  python -I test/sjplus/sj_trainbench.py --repo <shengji_plus 仓库> --workdir <仓库外的临时目录> [--seconds 240] [--actors 6]

跑的就是它 README 的那条「目前最好」的训练命令(TrainLoop.train,--discount 0.95 --epsilon 0.015 --games 2000
--enable-combos --combo-penalty 0.01,6 个采样进程 + 主进程学习),从随机权重起;到时间就杀掉。
计数方式:主进程每学完一批(一个采样进程交来的 10 局)记一个时间戳;掐掉第一批之前的启动时间。
产物(几分钟的权重)留在 --workdir 里,只能拿来试管线,没有任何棋力。
"""
import argparse
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))

if os.environ.get('SJ_TRAINBENCH_CHILD'):
    # ---- 子进程(也是它 spawn 出来的采样进程重新 import 的 __main__):垫片要在顶层做 ----
    sys.path.insert(0, HERE)
    import sj_common as sj
    sj.setup_repo(os.environ['SJ_REPO'])
    if __name__ == '__main__':
        import TrainLoop
        from agents.Agent import SJAgent
        from agents.DMCAgent import DMCAgent
        from env.utils import Stage
        log = open(os.environ['SJ_BENCH_LOG'], 'a')
        orig = DMCAgent.learn_from_samples if 'learn_from_samples' in DMCAgent.__dict__ else SJAgent.learn_from_samples

        def patched(self, samples, stage):
            r = orig(self, samples, stage)
            if stage == Stage.main_stage:            # 一批的四个阶段里它最后学打牌 → 这一批(10 局)学完
                log.write(f'{time.time()} {len(samples)}\n')
                log.flush()
            return r
        DMCAgent.learn_from_samples = patched
        TrainLoop.train('dmc', games=2000, model_folder=os.environ['SJ_MODEL_DIR'], eval_only=False, eval_size=300,
                        discount=0.95, epsilon=0.015, combos=True, combo_penalty=0.01, tau=0.1,
                        actor_process_count=int(os.environ['SJ_ACTORS']))
else:
    def main():
        ap = argparse.ArgumentParser()
        ap.add_argument('--repo', required=True)
        ap.add_argument('--workdir', required=True, help='放临时权重和日志;要在我们的仓库外面')
        ap.add_argument('--seconds', type=int, default=240)
        ap.add_argument('--actors', type=int, default=6, help='采样进程数(它的默认是 6)')
        ap.add_argument('--threads', type=int, default=1, help='每个进程的 torch 线程数;0 = 不管(它的原样。核数不多于进程数时会互相抢,慢一个量级)')
        args = ap.parse_args()
        repo = os.path.abspath(args.repo)
        work = os.path.abspath(args.workdir)
        model_dir = os.path.join(work, 'trainbench-model')
        os.makedirs(model_dir, exist_ok=True)
        log = os.path.join(work, 'trainbench.log')
        open(log, 'w').close()
        env = dict(os.environ, SJ_TRAINBENCH_CHILD='1', SJ_REPO=repo, SJ_MODEL_DIR=model_dir, SJ_BENCH_LOG=log, SJ_ACTORS=str(args.actors))
        if args.threads:
            env.update(OMP_NUM_THREADS=str(args.threads), MKL_NUM_THREADS=str(args.threads))
        # cwd 必须是它的仓库:TrainLoop.train 里有相对路径 'networks/Models.py'
        p = subprocess.Popen([sys.executable, '-I', os.path.abspath(__file__)], cwd=repo, env=env,
                             stdout=open(os.path.join(work, 'trainbench.out'), 'w'), stderr=subprocess.STDOUT, start_new_session=True)
        t0 = time.time()
        try:
            while time.time() - t0 < args.seconds and p.poll() is None:
                time.sleep(2)
        finally:
            import signal
            try:
                os.killpg(p.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        rows = [l.split() for l in open(log) if l.strip()]
        ts = [float(r[0]) for r in rows]
        if len(ts) < 3:
            print(f'{args.seconds} 秒内只学完 {len(ts)} 批(每批 10 局),量不出速度(--threads {args.threads});看 {work}/trainbench.out')
            sys.exit(1)
        games = 10 * (len(ts) - 1)
        span = ts[-1] - ts[0]
        samples = sum(int(r[1]) for r in rows[1:]) / (len(ts) - 1)
        print(f'ShengJi+ 训练命令({args.actors} 个采样进程 + 学习,每进程 {args.threads or "默认"} 线程,{os.cpu_count()} 核,{"CUDA" if _cuda() else "CPU"}):'
              f'{span:.0f} 秒学完 {games} 局 = {games / span * 3600:.0f} 局/小时(启动到第一批用了 {ts[0] - t0:.0f} 秒,不计);每批 {samples:.0f} 条打牌样本')
        print(f'  按这个速度,它那 118 万局要 {1180000 / (games / span * 3600) / 24:.0f} 天')

    def _cuda():
        try:
            import torch
            return torch.cuda.is_available()
        except Exception:  # noqa: BLE001
            return False

    if __name__ == '__main__':
        main()
