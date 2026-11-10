"""六六八十分 背景音乐小样 v4:「夜上海」—— 都市、懒散、夜宵摊的气息。
D 小调,92 BPM,律动往后拖一点。萨克斯和电吉他轮流主奏;鼓几乎不用镲,换成刷子 / 边击 / 通鼓 / 木鱼 / 响指,
每段换一种律动(慵懒摇摆 → 懒散嘻哈爵士 → 波萨诺瓦),段尾通鼓过门,每一下都有一点人手的不齐。
底下一层很轻的远处城市低鸣,偶尔碗筷轻碰。全部 numpy 现场合成,不用采样。
8 小节一段 × 6 段(约 2 分钟),首尾无缝循环。

测试版 v0.7.64 起当背景音乐用(audio/bgm-night-shanghai.mp3)。重新生成:
    pip install numpy scipy
    python3 audio/make_bgm.py /tmp/bgm.wav          # 同时写出 /tmp/bgm-padded.wav
    ffmpeg -i /tmp/bgm-padded.wav -af "volume=-4.8dB" -codec:a libmp3lame -b:a 128k audio/bgm-night-shanghai.mp3
padded 版前面垫 1 秒(循环的最后 1 秒)、后面接 1 秒(循环的开头 1 秒):网页按 [1 秒, 1 秒 + 循环长度] 循环播放,
mp3 编码在文件头尾补的那一小段静音落在垫的那 1 秒里,而且不管解码器有没有裁掉它,窗口里都是首尾相接的同一段,接缝听不出来。
循环长度(采样数)改了,要同步改 80fen-test.html 里的 BGM_LOOP。volume 按 ffmpeg ebur128 量出来的响度调到约 -16 LUFS。
"""
import sys
import wave
import numpy as np
from scipy.signal import fftconvolve, butter, sosfilt, lfilter

SR = 44100
BPM = 92
BEAT = 60 / BPM
SEC_BARS = 8
BARS = SEC_BARS * 6
SWING = 0.60
LAZY = 0.018                 # 主奏、军鼓比拍子晚一点(秒):懒散
rng = np.random.default_rng(1937)

total = int(BARS * 4 * BEAT * SR)
tail = int(3.5 * SR)
L = total + tail
bus = {k: np.zeros((L, 2)) for k in ('ep', 'sax', 'gtr', 'bass', 'drum', 'amb')}


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def swing(b):
    whole = np.floor(b)
    frac = b - whole
    return whole + (SWING if abs(frac - 0.5) < 1e-6 else frac)


def add(name, beat, sig, pan=0.0, gain=1.0, late=0.0, jitter=0.006):
    t = swing(beat) * BEAT + late + rng.normal(0, jitter)
    i = max(0, int(t * SR))
    n = min(len(sig), L - i)
    if n <= 0:
        return
    lg, rg = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    bus[name][i:i + n, 0] += sig[:n] * lg * gain
    bus[name][i:i + n, 1] += sig[:n] * rg * gain


def lowpass(x, fc, order=2):
    return sosfilt(butter(order, fc, fs=SR, output='sos'), x, axis=0)


def highpass(x, fc, order=2):
    return sosfilt(butter(order, fc, btype='high', fs=SR, output='sos'), x, axis=0)


def bandpass(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], btype='band', fs=SR, output='sos'), x, axis=0)


def env(t, a, d, rel_at, rel=0.15):
    return np.minimum(1, t / a) * np.exp(-t * d) * np.clip(1 - (t - rel_at) / rel, 0, 1)


def hv(v, spread=0.12):
    """人手的轻重不一"""
    return v * (1 + rng.normal(0, spread))


# ---------- 乐器 ----------
def ep(m, dur, vel):
    f = mtof(m)
    t = np.arange(int((dur + 0.5) * SR)) / SR
    mod = np.sin(2 * np.pi * f * t) * (1.3 * np.exp(-t * 4) + 0.2)
    s = np.sin(2 * np.pi * f * t + mod) + 0.03 * np.sin(2 * np.pi * f * 14 * t) * np.exp(-t * 30)
    return s * env(t, 0.006, 0.8, dur, 0.2) * (1 + 0.07 * np.sin(2 * np.pi * 3.8 * t)) * vel


def upright(m, dur, vel):
    f = mtof(m)
    t = np.arange(int((dur + 0.15) * SR)) / SR
    s = np.sin(2 * np.pi * f * t) + 0.45 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t * 7) \
        + 0.2 * np.sin(2 * np.pi * 3 * f * t) * np.exp(-t * 12)
    thump = bandpass(rng.standard_normal(len(t)), 80, 400) * np.exp(-t * 60) * 0.3
    return np.tanh(1.4 * (s + thump)) * env(t, 0.004, 1.8, dur, 0.06) * vel


def guitar(m, dur, vel):
    """箱琴电吉他:Karplus-Strong 拨弦,拨片噪声先过低通,出来再收高频"""
    f = mtof(m)
    n = int((dur + 0.6) * SR)
    N = int(round(SR / f - 0.5))
    exc = lowpass(rng.uniform(-1, 1, N * 2), 2400)
    x = np.zeros(n)
    x[:len(exc)] = exc
    a = np.zeros(N + 2)
    a[0], a[N], a[N + 1] = 1, -0.4985, -0.4985
    y = lfilter([1.0], a, x)
    t = np.arange(n) / SR
    y *= np.clip(1 - (t - dur) / 0.15, 0, 1)
    y = lowpass(y, 3000)
    return y / (np.max(np.abs(y)) + 1e-9) * vel


def sax(m, dur, vel):
    """合成次中音萨克斯:带限锯齿 + 起音滑音 + 迟到的颤音 + 气声 + 两个共振峰;长音尾巴往下「懒懒地」落一点"""
    f0 = mtof(m)
    n = int((dur + 0.12) * SR)
    t = np.arange(n) / SR
    scoop = -0.04 * np.exp(-t * 22)
    vib = 0.007 * np.sin(2 * np.pi * 4.8 * t) * np.clip((t - 0.22) / 0.3, 0, 1)
    fall = -0.02 * np.clip((t - dur + 0.12) / 0.12, 0, 1) if dur > 0.6 else 0
    f = f0 * (1 + scoop + vib + fall)
    ph = 2 * np.pi * np.cumsum(f) / SR
    amp = np.minimum(1, t / 0.04) * np.clip(1 - (t - dur) / 0.09, 0, 1) * (1 - 0.18 * np.minimum(1, t / max(dur, 0.2)))
    bright = 0.5 + 0.45 * amp
    s = np.zeros(n)
    for k in range(1, 24):
        if f0 * k > 6500:
            break
        s += np.sin(k * ph) / k * bright ** (k - 1)
    s = (s + bandpass(rng.standard_normal(n), 1500, 5000) * 0.05) * amp
    body = bandpass(s, 280, 1000) + bandpass(s, 1100, 2400) * 0.5 + lowpass(s, 4000) * 0.22
    return np.tanh(1.6 * body) * vel


# 鼓:几乎不用镲
def kick(vel):
    t = np.arange(int(0.4 * SR)) / SR
    fr = 48 + 55 * np.exp(-t * 25)
    return np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-t * 8) * vel


def brush_tap(vel):
    t = np.arange(int(0.18 * SR)) / SR
    return bandpass(rng.standard_normal(len(t)), 700, 4000) * np.minimum(1, t / 0.004) * np.exp(-t * 22) * vel


def brush_swish(vel, beats=1.0):
    t = np.arange(int(beats * BEAT * SR)) / SR
    shape = np.sin(np.pi * np.clip(t / (beats * BEAT), 0, 1)) ** 1.5
    return bandpass(rng.standard_normal(len(t)), 600, 3500) * shape * vel


def rim(vel):
    t = np.arange(int(0.15 * SR)) / SR
    s = bandpass(rng.standard_normal(len(t)), 1000, 3500) * np.exp(-t * 45) * 0.5 + 0.5 * np.sin(2 * np.pi * 760 * t) * np.exp(-t * 55)
    return s * vel


def tom(f0, vel):
    t = np.arange(int(0.6 * SR)) / SR
    fr = f0 * (1 + 0.3 * np.exp(-t * 20))
    s = np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-t * 6) + bandpass(rng.standard_normal(len(t)), 200, 1500) * np.exp(-t * 40) * 0.2
    return s * vel


def woodblock(f0, vel):
    """木鱼:两个短促的共振,带一点东方味"""
    t = np.arange(int(0.2 * SR)) / SR
    s = np.sin(2 * np.pi * f0 * t) * np.exp(-t * 35) + 0.4 * np.sin(2 * np.pi * f0 * 2.7 * t) * np.exp(-t * 60)
    return s * np.minimum(1, t / 0.0008) * vel


def snap(vel):
    t = np.arange(int(0.12 * SR)) / SR
    return bandpass(rng.standard_normal(len(t)), 1300, 3200) * np.exp(-t * 55) * vel


def shaker(vel):
    t = np.arange(int(0.08 * SR)) / SR
    return bandpass(rng.standard_normal(len(t)), 2500, 5500) * np.minimum(1, t / 0.012) * np.exp(-t * 45) * vel


def clink(vel):
    """碗筷轻碰(瓷器):几个不成倍数的高泛音,很快消失"""
    t = np.arange(int(0.5 * SR)) / SR
    s = sum(a * np.sin(2 * np.pi * fr * t) * np.exp(-t * d) for fr, a, d in ((2380, 1, 9), (3610, .5, 14), (5230, .25, 20)))
    return s * np.minimum(1, t / 0.0005) * vel


# ---------- 和声 ----------
CH = {
    'Dm9': (38, [53, 57, 60, 64]), 'G13': (43, [53, 57, 59, 64]), 'Cmaj9': (36, [52, 55, 59, 62]),
    'Fmaj9': (41, [52, 55, 57, 60]), 'Em7b5': (40, [55, 58, 62, 64]), 'A7b9': (45, [55, 58, 61, 64]),
    'Gm9': (43, [53, 57, 58, 62]), 'A7alt': (45, [55, 58, 61, 65]), 'Bbmaj9': (46, [50, 53, 57, 60]),
    'A7b13': (45, [55, 57, 61, 65]), 'Dm6': (38, [53, 57, 59, 62]), 'C13': (36, [52, 57, 58, 62]),
}
HA = [['Dm9'], ['G13'], ['Cmaj9'], ['Fmaj9'], ['Em7b5'], ['A7b9'], ['Dm9'], ['Gm9', 'A7alt']]
HB = [['Bbmaj9'], ['A7b13'], ['Dm9'], ['Dm6'], ['Gm9'], ['C13'], ['Fmaj9'], ['Em7b5', 'A7b9']]

# ---------- 旋律(实际音高;三连音用 1/3 拍)----------
T3 = 1 / 3
SAX_A = [
    [(.5, 62, .5), (1, 65, .5), (1.5, 69, 2)],
    [(0, 71, .5), (.5, 69, .5), (1, 64, 2.5)],
    [(0, 67, 1), (1.5, 72, .5), (2, 71, 1.5), (3.5, 69, .5)],
    [(0, 64, 3), (3.5, 62, .5)],
    [(0, 67, 1), (1, 70, 1), (2, 74, 1.5), (3.5, 72, .5)],
    [(0, 70, 1), (1, 69, .5), (1.5, 67, .5), (2, 61, 2)],
    [(0, 62, .5), (.5, 64, .5), (1, 65, .5), (1.5, 69, .5), (2, 72, 1), (3, 69, 1)],
    [(0, 70, 1.5), (1.5, 67, .5), (2, 65, 1), (3, 61, 1)],
]
SAX_A2 = [
    [(0, 69, T3), (T3, 72, T3), (2 * T3, 74, T3), (1, 77, 1.5), (3, 74, 1)],
    [(0, 76, 1), (1, 74, .5), (1.5, 71, .5), (2, 67, 2)],
    [(0, 64, .5), (.5, 67, .5), (1, 71, .5), (1.5, 74, .5), (2, 76, 1.5), (3.5, 74, .5)],
    [(0, 72, 2), (2, 69, 1), (3, 67, 1)],
    [(0, 70, 1.5), (1.5, 67, .5), (2, 62, 1), (3, 64, 1)],
    [(0, 65, .5), (.5, 64, .5), (1, 61, 1), (2, 58, 1), (3, 57, 1)],
    [(0, 62, 2.5), (3, 65, .5), (3.5, 69, .5)],
    [(0, 74, 1), (1, 70, 1), (2, 69, 1), (3, 67, 1)],
]
GTR_B = [
    [(0, 69, .5), (.5, 72, .5), (1, 74, .5), (1.5, 77, 1), (3, 76, .5), (3.5, 74, .5)],
    [(0, 73, 1.5), (1.5, 70, .5), (2, 65, 1), (3, 67, 1)],
    [(0, 69, .5), (.5, 65, .5), (1, 62, .5), (1.5, 64, .5), (2, 65, 1.5), (3.5, 67, .5)],
    [(0, 71, 2), (2.5, 69, .5), (3, 65, 1)],
    [(0, 70, .5), (.5, 74, .5), (1, 77, .5), (1.5, 81, 1), (3, 79, .5), (3.5, 77, .5)],
    [(0, 76, 1), (1, 74, .5), (1.5, 70, .5), (2, 69, 2)],
    [(0, 72, .5), (.5, 76, .5), (1, 79, .5), (1.5, 76, .5), (2, 77, .5), (2.5, 72, .5), (3, 69, 1)],
    [(0, 67, .5), (.5, 70, .5), (1, 74, 1), (2, 73, .5), (2.5, 70, .5), (3, 69, 1)],
]
# 两小节一换的对答:吉他 1-2、5-6 小节,萨克斯 3-4、7-8 小节
GTR_T = [
    [(0, 77, T3), (T3, 74, T3), (2 * T3, 69, T3), (1, 72, 1), (2, 70, .5), (2.5, 69, .5), (3, 65, 1)],
    [(0, 64, .5), (.5, 65, .5), (1, 69, .5), (1.5, 73, 1.5), (3, 76, 1)],
    None, None,
    [(0, 74, 1), (1, 77, .5), (1.5, 74, .5), (2, 70, 2)],
    [(0, 72, .5), (.5, 70, .5), (1, 67, .5), (1.5, 64, 1.5), (3, 67, 1)],
    None, None,
]
SAX_T = [
    None, None,
    [(0, 62, 1), (1, 65, .5), (1.5, 69, 1.5), (3, 72, 1)],
    [(0, 71, 1.5), (1.5, 69, .5), (2, 65, 2)],
    None, None,
    [(0, 64, 1), (1, 67, .5), (1.5, 69, .5), (2, 72, 2)],
    [(0, 70, 1), (1, 67, 1), (2, 64, .5), (2.5, 61, 1.5)],
]
OUT_SAX = [SAX_A[0], SAX_A[1], None, None, None, None, None, None]
OUT_GTR = [None, None, None, [(1, 69, 1), (2, 64, 2)], None, None, [(0, 62, .5), (1, 65, .5), (2, 69, 2)], None]

# 每段:(和声, 律动, 贝斯, 萨克斯, 吉他)
SECTIONS = [
    (HA, 'lazy', 'two', None, None),          # 前奏
    (HA, 'lazy', 'two', SAX_A, None),         # 萨克斯主题
    (HB, 'hop', 'walk', None, GTR_B),         # 吉他
    (HA, 'bossa', 'bossa', SAX_A2, None),     # 萨克斯变奏(波萨诺瓦)
    (HB, 'hop', 'walk', SAX_T, GTR_T),        # 两小节一换的对答
    (HA, 'lazy', 'two', OUT_SAX, OUT_GTR),    # 收尾,接回前奏
]


def near(root, prev):
    c = [root + 12 * k for k in range(-2, 3) if 28 <= root + 12 * k <= 50]
    return min(c, key=lambda m: abs(m - prev))


prev_b = 38
for bar in range(BARS):
    b0 = bar * 4
    sec, k = divmod(bar, SEC_BARS)
    harm, groove, bassmode, saxl, gtrl = SECTIONS[sec]
    chords = harm[k]
    nxt = harm[(k + 1) % SEC_BARS][0] if k < SEC_BARS - 1 else SECTIONS[(sec + 1) % 6][0][0][0]
    last = k == SEC_BARS - 1
    span = 4 / len(chords)
    # ---- 电钢琴:每段一种弹法 ----
    for ci, c in enumerate(chords):
        cb = b0 + ci * span
        v = CH[c][1]
        if groove == 'lazy':        # 长长按住,第 4 拍后半偶尔提前抢下一个和弦
            for j, m in enumerate(v):
                add('ep', cb + j * 0.02, ep(m, span * BEAT * 0.95, hv(0.22, .06)), pan=-0.3 + 0.12 * j, jitter=0.003)
        elif groove == 'hop':       # 短促,第 1 拍和第 2 拍后半
            for j, m in enumerate(v):
                add('ep', cb + j * 0.012, ep(m, 0.5, hv(0.20, .06)), pan=-0.3 + 0.12 * j, jitter=0.003)
                if span == 4:
                    add('ep', cb + 1.5 + j * 0.012, ep(m, 1.1, hv(0.15, .06)), pan=-0.3 + 0.12 * j, jitter=0.003)
        else:                       # 波萨:切分的小和弦
            for bt, d, vv in ((0, .4, .18), (1.5, .4, .15), (3, .9, .17)) if span == 4 else ((0, .4, .18), (1.5, .4, .14)):
                for j, m in enumerate(v):
                    add('ep', cb + bt + j * 0.01, ep(m, d, hv(vv, .06)), pan=-0.3 + 0.12 * j, jitter=0.003)
    if groove == 'lazy' and k % 4 == 3:
        for j, m in enumerate(CH[nxt][1][1:]):
            add('ep', b0 + 3.5, ep(m, 0.4, 0.10), pan=-0.2 + 0.12 * j)
    # ---- 贝斯 ----
    roots = [CH[c][0] for c in chords]
    rn = CH[nxt][0]
    if bassmode == 'two':           # 慢悠悠的二拍:根音、五度,段尾半音接下一段
        r = near(roots[0], prev_b)
        line = [(0, r, 1.8), (2, r + 7 if len(roots) == 1 else near(roots[1], r), 1.6)]
        if k % 2 == 1:
            line.append((3.5, near(rn, r) + 1, 0.4))
    elif bassmode == 'walk':
        r1 = near(roots[0], prev_b)
        if len(roots) == 1:
            sc = [r1, r1 + (3 if CH[chords[0]][1][0] % 12 != (r1 + 4) % 12 else 4), r1 + 7, near(rn, r1 + 7) + rng.choice([-1, 1])]
        else:
            r2 = near(roots[1], r1)
            sc = [r1, r2 + 1, r2, near(rn, r2) - 1]
        line = [(i, m, 0.9) for i, m in enumerate(sc)]
    else:                           # 波萨:根音(附点)- 五度 - 根音
        r = near(roots[0], prev_b)
        line = [(0, r, 1.4), (1.5, r + 7, .4), (2, r + 7 if len(roots) == 1 else near(roots[1], r), 1.4), (3.5, r, .4)]
    for bt, m, d in line:
        add('bass', b0 + bt, upright(m, d * BEAT, hv(0.55, .08)), jitter=0.004)
    prev_b = line[-1][1]
    # ---- 鼓 ----
    if groove == 'lazy':
        add('drum', b0, kick(hv(0.45)))
        add('drum', b0 + 2, kick(hv(0.30)))
        for bt in (1, 3):
            add('drum', b0 + bt, brush_tap(hv(0.22)), pan=-0.1, late=LAZY)
        # 原来这里有刷子在鼓面上画圈的「沙——沙——」(brush_swish),合成出来像扫地(产品方),去掉;
        # 改成摇摆反拍上几下很轻的刷子点触,留住律动
        for bt in (0.5, 1.5, 2.5, 3.5):
            if rng.random() < 0.6:
                add('drum', b0 + bt, brush_tap(hv(0.06, .3)), pan=0.15, late=LAZY)
        if k % 2 == 1:
            add('drum', b0 + 3.5, rim(hv(0.12)), pan=-0.15)
        if k in (2, 6):
            add('drum', b0 + 3.5, woodblock(820, hv(0.10)), pan=0.35)
    elif groove == 'hop':
        add('drum', b0, kick(hv(0.55)))
        add('drum', b0 + 1.5, kick(hv(0.35)))
        if k % 2 == 0:
            add('drum', b0 + 2.5, kick(hv(0.30)))
        for bt in (1, 3):
            add('drum', b0 + bt, snap(hv(0.30)), pan=0.15, late=LAZY + 0.01)
            add('drum', b0 + bt, brush_tap(hv(0.15)), pan=-0.1, late=LAZY)
        for bt in (0.5, 1.5, 2.5, 3.5):
            if rng.random() < 0.55:
                add('drum', b0 + bt, shaker(hv(0.06, .3)), pan=0.4)
        if k % 4 == 1:
            add('drum', b0 + 3.5, woodblock(1050, hv(0.09)), pan=0.35)
            add('drum', b0 + 3.75, woodblock(820, hv(0.07)), pan=0.35)
    else:                           # 波萨:边击的切分 + 底鼓「咚——咚」
        for bt in (0, 1.5, 3) if bar % 2 == 0 else (1, 2.5):
            add('drum', b0 + bt, rim(hv(0.16)), pan=-0.15)
        for bt in (0, 1.5, 2, 3.5):
            add('drum', b0 + bt, kick(hv(0.30 if bt in (0, 2) else 0.18)))
        for bt in np.arange(0, 4, 0.5):
            add('drum', b0 + bt, shaker(hv(0.035 if bt % 1 else 0.05, .25)), pan=0.4)
    if last:                        # 段尾通鼓过门(每段不一样)
        pat = [((2, 196), (2.5, 165), (3, 131), (3.5, 110)), ((3, 165), (3.33, 131), (3.67, 110)),
               ((2.5, 131), (3, 165), (3.5, 110))][sec % 3]
        for bt, f in pat:
            add('drum', b0 + bt, tom(f, hv(0.25)), pan=(f - 150) / 200)
    # ---- 主奏 ----
    for who, lines in (('sax', saxl), ('gtr', gtrl)):
        if lines and lines[k]:
            for bt, m, d in lines[k]:
                if who == 'sax':
                    add('sax', b0 + bt, sax(m, d * BEAT * 0.93, hv(0.30, .07)), pan=-0.08, late=LAZY, jitter=0.008)
                else:
                    add('gtr', b0 + bt, guitar(m, d * BEAT, hv(0.34, .08)), pan=0.25, late=LAZY * 0.6, jitter=0.006)

# ---------- 夜宵摊的气息:远处城市低鸣 + 偶尔碗筷轻碰 ----------
# 低鸣在频域里做(循环卷积),本身首尾相接;只铺在 [0, total),不进尾巴,接缝处不会跳、也不会叠出两层
spec = np.fft.rfft(rng.standard_normal(total))
fq = np.fft.rfftfreq(total, 1 / SR)
shape = np.where(fq > 25, 1 / np.maximum(fq, 25), 0) / (1 + (fq / 260) ** 8)
hum = np.fft.irfft(spec * shape, n=total)
hum *= 0.004 / (np.sqrt(np.mean(hum ** 2)) + 1e-12)
bus['amb'][:total, 0] += hum
bus['amb'][:total, 1] += np.roll(hum, 1500)
for bar in (13, 29, 42):
    add('amb', bar * 4 + rng.uniform(0, 3), clink(0.045), pan=rng.uniform(-0.6, 0.6), jitter=0)

# ---------- 混音 ----------
ir_t = np.arange(int(2.2 * SR)) / SR
ir = rng.standard_normal((len(ir_t), 2)) * np.exp(-ir_t * 2.9)[:, None]
ir = lowpass(ir, 4500)
ir /= np.sqrt((ir ** 2).sum(axis=0))


def reverb(x, wet):
    y = np.stack([fftconvolve(x[:, c], ir[:, c])[:len(x)] for c in range(2)], axis=1)
    return x + wet * y


mixes = {
    'ep': reverb(highpass(lowpass(bus['ep'], 5500), 120), 0.40),
    'sax': reverb(highpass(bus['sax'], 120), 0.50),
    'gtr': reverb(highpass(bus['gtr'], 120), 0.42),
    'bass': lowpass(bus['bass'], 1100),
    'drum': reverb(lowpass(bus['drum'], 6500, 4), 0.25),
    'amb': reverb(bus['amb'], 0.6),
}
gains = {'ep': 1.0, 'sax': 0.6, 'gtr': 1.8, 'bass': 0.75, 'drum': 0.95, 'amb': 1.0}
mix = sum(mixes[k] * gains[k] for k in mixes)
mix = highpass(lowpass(mix, 9000), 35)


def db(x):
    return 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)


seg = lambda a, b: slice(int(a * 4 * BEAT * SR), int(b * 4 * BEAT * SR))
print(' '.join(f'{k} {db(mixes[k][sl] * gains[k]):.1f}' for k, sl in
               (('ep', seg(8, 16)), ('sax', seg(8, 16)), ('gtr', seg(16, 24)), ('bass', seg(8, 16)), ('drum', seg(8, 40)), ('amb', seg(0, 48)))))

out = mix[:total].copy()
out[:tail] += mix[total:total + tail]
out = np.tanh(out * 1.1) / np.tanh(1.1)
out *= 0.89 / np.max(np.abs(out))
pcm = (out * 32767).astype('<i2')
with wave.open(sys.argv[1], 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(pcm.tobytes())
pad = np.concatenate([pcm[-SR:], pcm, pcm[:SR]])          # 前后各垫 1 秒(见文件头)
with wave.open(sys.argv[1].replace('.wav', '-padded.wav'), 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(pad.tobytes())
print(f'循环长度 {len(pcm)} 个采样')
print(f'{BARS} 小节,{total / SR:.1f} 秒')
