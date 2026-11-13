"""把下载的 ShengJi+ 权重包安全地解开(下载物当不可信数据)。

  python -I test/sjplus/unpack_ckpt.py --zip <1180000.zip> --out <仓库外的空目录> [--repo <shengji_plus 仓库>]

只取用得着的东西:
  · *.pt(四个网络的 state_dict)→ 原样解出,之后一律用 torch.load(weights_only=True) 读;
  · command.txt(它记下的训练命令)、Models.py(训练时网络结构的副本)→ 当**文本**解出、改名加 .txt,只看不执行;
  · 其余(state.pkl / stats.pkl 是 pickle,反序列化等于执行代码)→ 不解。
路径带 .. 或绝对路径的条目、解开后超过上限的包 → 直接拒绝。
最后打印 main.pt 所在目录(--ckpt 用它),并把包里的 Models.py 和仓库里的 networks/Models.py 比一下。
"""
import argparse
import hashlib
import os
import sys
import zipfile

MAX_TOTAL = 2 * 1024 ** 3


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--zip', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--repo')
    args = ap.parse_args()
    h = hashlib.sha256()
    with open(args.zip, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    print(f'权重包 {os.path.getsize(args.zip)} 字节,sha256 {h.hexdigest()}')
    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)
    main_dir = None
    with zipfile.ZipFile(args.zip) as z:
        infos = z.infolist()
        if sum(i.file_size for i in infos) > MAX_TOTAL:
            sys.exit('解开后超过 2 GB,不像权重包,停')
        for i in infos:
            name = i.filename
            if i.is_dir() or name.startswith('__MACOSX/'):
                continue
            norm = os.path.normpath(name)
            if os.path.isabs(name) or norm.startswith('..') or '\\' in name:
                sys.exit(f'包里有越界路径 {name!r},停')
            base = os.path.basename(norm)
            if base.endswith('.pt'):
                dst = os.path.join(out, norm)
            elif base in ('command.txt', 'Models.py'):
                dst = os.path.join(out, norm + ('' if base.endswith('.txt') else '.txt'))
            else:
                print(f'  不解:{name}({i.file_size} 字节)')
                continue
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with z.open(i) as src, open(dst, 'wb') as f:
                f.write(src.read())
            print(f'  解出:{name} → {os.path.relpath(dst, out)}({i.file_size} 字节)')
            if base == 'main.pt':
                main_dir = os.path.dirname(dst)
    if not main_dir:
        sys.exit('包里没有 main.pt,停')
    missing = [n for n in ('declare.pt', 'kitty.pt', 'chaodi.pt') if not os.path.isfile(os.path.join(main_dir, n))]
    if missing:
        print(f'  注意:缺 {missing}(只影响「在它自己环境里验权重」那一步;对局只用 main.pt)')
    cmd = os.path.join(main_dir, 'command.txt')
    if os.path.isfile(cmd):
        text = open(cmd, encoding='utf8', errors='replace').read().strip()
        print(f'  训练命令:{text[:400]}')
        if '--static-encoding' in text:
            print('  注意:是 --static-encoding 练的 —— 适配层只做了动态编码,先停下来说明')
    mp = os.path.join(main_dir, 'Models.py.txt')
    if args.repo and os.path.isfile(mp):
        a = open(mp, encoding='utf8', errors='replace').read()
        b = open(os.path.join(args.repo, 'networks', 'Models.py'), encoding='utf8').read()
        print('  包里的 Models.py 与仓库的 networks/Models.py:' + ('相同' if a == b else '**不同** —— 以仓库的为准去读权重;读不进(strict)再看差在哪'))
    with open(os.path.join(out, 'MAIN_DIR'), 'w') as f:
        f.write(main_dir + '\n')
    print(f'main.pt 所在目录:{main_dir}')


if __name__ == '__main__':
    main()
