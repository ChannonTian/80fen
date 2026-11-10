"""六六八十分 背景音乐播放列表(v0.7.65):和「夜上海」(make_bgm.py)同一种老上海爵士底色,另写四首,
速度、调性、律动、旋律、主奏乐器都不一样。全部 numpy + scipy 现场合成,不用采样。

    梧桐树下  G 大调  108 BPM  波萨诺瓦,长笛 / 电吉他,轻快明亮
    弄堂午后  降 E 大调 70 BPM  抒情慢板,萨克斯 / 颤音琴,很慢很松
    霓虹电车  降 B 大调 124 BPM 轻快摇摆 + walking bass,电吉他 / 萨克斯,最快最亮
    夜宵收摊  A 小调  80 BPM  懒散嘻哈爵士,颤音琴 / 萨克斯,偏暗

每首 8 小节一段 × 6 段:前奏(不吹)→ 主奏一吹主题 A → 主奏二吹主题 B → 主奏二变奏 A → 两小节一换的对答(B)→ 收尾。
和弦、旋律都写在下面的 TRACKS 里;鼓几乎不用镲(产品方:镲太吵),换成刷子点触 / 边击 / 通鼓 / 木鱼 / 响指 / 沙锤。

用法(一次生成一首,输出 <name>.wav 和 <name>-padded.wav,padded 前后各垫 1 秒首尾相接的音乐,见 make_bgm.py):
    python3 audio/make_playlist.py wutong /tmp/wutong.wav
    ffmpeg -i /tmp/wutong-padded.wav -af "volume=<调到约 -16 LUFS>dB" -codec:a libmp3lame -b:a 128k audio/bgm-wutong.mp3
曲目名:wutong / longtang / neon / yexiao。改了以后要同步 80fen-test.html 里的 BGM_LIST(循环长度)。
"""
import sys
import wave
import numpy as np
from scipy.signal import fftconvolve, butter, sosfilt, lfilter

SR = 44100


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def lowpass(x, fc, order=2):
    return sosfilt(butter(order, fc, fs=SR, output='sos'), x, axis=0)


def highpass(x, fc, order=2):
    return sosfilt(butter(order, fc, btype='high', fs=SR, output='sos'), x, axis=0)


def bandpass(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], btype='band', fs=SR, output='sos'), x, axis=0)


def env(t, a, d, rel_at, rel=0.15):
    return np.minimum(1, t / a) * np.exp(-t * d) * np.clip(1 - (t - rel_at) / rel, 0, 1)


T3 = 1 / 3

# ======================= 曲目 =======================
TRACKS = {
    'wutong': dict(
        title='梧桐树下', bpm=108, swing=0.52, lazy=0.006, seed=1925, leads=('flute', 'gtr'), amb=0.5, clinks=0,
        grooves=['bossa', 'bossa', 'bossa2', 'bossa', 'bossa2', 'bossa'], bass=['bossa'] * 6, comp=['bossa'] * 6,
        CH={'Gmaj9': (43, [59, 62, 66, 69]), 'Em9': (40, [55, 59, 62, 66]), 'Am9': (45, [55, 59, 60, 64]),
            'D13': (38, [54, 59, 60, 64]), 'Bm7': (47, [54, 57, 59, 62]), 'E7b9': (40, [56, 59, 62, 65]),
            'Cmaj9': (36, [52, 55, 59, 62]), 'Cm6': (36, [51, 55, 57, 60]), 'E7': (40, [56, 59, 62, 64])},
        HA=[['Gmaj9'], ['Em9'], ['Am9'], ['D13'], ['Bm7'], ['E7b9'], ['Am9', 'D13'], ['Gmaj9']],
        HB=[['Cmaj9'], ['Cm6'], ['Bm7'], ['E7'], ['Am9'], ['D13'], ['Gmaj9', 'E7'], ['Am9', 'D13']],
        A=[[(0, 74, 1), (1, 78, .5), (1.5, 81, 1.5), (3, 79, 1)],
           [(0, 78, 1.5), (1.5, 76, .5), (2, 71, 2)],
           [(0, 72, .5), (.5, 76, .5), (1, 79, 1), (2, 83, 1.5), (3.5, 81, .5)],
           [(0, 78, 2), (2, 76, 1), (3, 74, 1)],
           [(0, 74, 1), (1, 78, 1), (2, 81, 1.5), (3.5, 78, .5)],
           [(0, 77, 1.5), (1.5, 76, .5), (2, 74, 1), (3, 80, 1)],
           [(0, 81, 1), (1, 79, 1), (2, 78, 1), (3, 76, 1)],
           [(0, 74, 1), (1, 79, 2.5)]],
        B=[[(0, 71, 1), (1, 74, .5), (1.5, 76, 1), (2.5, 79, .5), (3, 76, 1)],
           [(0, 75, 1.5), (1.5, 72, .5), (2, 69, 1), (3, 67, 1)],
           [(0, 66, .5), (.5, 69, .5), (1, 74, 1), (2, 73, .5), (2.5, 71, 1.5)],
           [(0, 68, 1), (1, 71, .5), (1.5, 74, .5), (2, 76, 1.5), (3.5, 74, .5)],
           [(0, 72, 1.5), (1.5, 71, .5), (2, 67, 1), (3, 64, 1)],
           [(0, 66, 1), (1, 69, 1), (2, 71, 1), (3, 72, 1)],
           [(0, 71, 1), (1, 74, 1), (2, 68, 1), (3, 71, 1)],
           [(0, 72, 1), (1, 69, 1), (2, 66, 1), (3, 62, 1)]]),
    'longtang': dict(
        title='弄堂午后', bpm=70, swing=0.62, lazy=0.025, seed=1949, leads=('sax', 'vibes'), amb=1.0, clinks=2,
        grooves=['ballad'] * 6, bass=['ballad', 'ballad', 'two', 'ballad', 'two', 'ballad'], comp=['ballad'] * 6,
        CH={'Ebmaj9': (39, [55, 58, 62, 65]), 'Cm9': (36, [51, 55, 58, 62]), 'Fm9': (41, [56, 60, 63, 67]),
            'Bb13': (46, [56, 60, 62, 67]), 'Gm7': (43, [53, 55, 58, 62]), 'C7b9': (36, [58, 61, 64, 67]),
            'Abmaj9': (44, [55, 58, 60, 63]), 'Db9': (37, [53, 56, 59, 63])},
        HA=[['Ebmaj9'], ['Cm9'], ['Fm9'], ['Bb13'], ['Gm7'], ['C7b9'], ['Fm9', 'Bb13'], ['Ebmaj9']],
        HB=[['Abmaj9'], ['Db9'], ['Gm7'], ['C7b9'], ['Fm9'], ['Bb13'], ['Ebmaj9', 'C7b9'], ['Fm9', 'Bb13']],
        A=[[(0, 70, 1), (1, 74, 2.5), (3.5, 72, .5)],
           [(0, 70, 3), (3, 67, 1)],
           [(0, 68, 1.5), (1.5, 72, .5), (2, 75, 1.5), (3.5, 74, .5)],
           [(0, 74, 2), (2, 72, 1), (3, 67, 1)],
           [(0, 70, 1.5), (1.5, 67, .5), (2, 65, 2)],
           [(0, 64, 1), (1, 67, 1), (2, 70, 1), (3, 73, 1)],
           [(0, 72, 1.5), (1.5, 68, .5), (2, 67, 2)],
           [(0, 70, 3), (3, 67, 1)]],
        B=[[(0, 72, 1), (1, 75, 1), (2, 79, 1.5), (3.5, 77, .5)],
           [(0, 75, 2), (2, 77, 1), (3, 80, 1)],
           [(0, 82, 1.5), (1.5, 79, .5), (2, 77, 2)],
           [(0, 76, 1), (1, 79, 1), (2, 82, 1), (3, 85, 1)],
           [(0, 84, 2), (2, 80, 1), (3, 79, 1)],
           [(0, 77, 1.5), (1.5, 79, .5), (2, 74, 2)],
           [(0, 75, 1), (1, 74, 1), (2, 73, 1), (3, 72, 1)],
           [(0, 68, 1), (1, 72, 1), (2, 74, 2)]]),
    'neon': dict(
        title='霓虹电车', bpm=124, swing=0.64, lazy=0.004, seed=1931, leads=('gtr', 'sax'), amb=0.4, clinks=0,
        grooves=['swing', 'swing', 'swing', 'hop', 'swing', 'swing'], bass=['walk'] * 6, comp=['charleston'] * 6,
        CH={'Bbmaj7': (46, [57, 60, 62, 65]), 'G7b9': (43, [53, 56, 59, 62]), 'Cm9': (36, [51, 55, 58, 62]),
            'F13': (41, [51, 55, 57, 62]), 'Dm7': (38, [53, 57, 60, 62]), 'Fm9': (41, [56, 60, 63, 67]),
            'Bb13': (46, [56, 60, 62, 67]), 'Ebmaj9': (39, [55, 58, 62, 65]), 'Ab9': (44, [54, 58, 60, 63]),
            'D9': (38, [54, 57, 60, 64]), 'G9': (43, [53, 57, 59, 62]), 'C9': (36, [52, 55, 58, 62]),
            'F9': (41, [51, 55, 57, 60])},
        HA=[['Bbmaj7', 'G7b9'], ['Cm9', 'F13'], ['Dm7', 'G7b9'], ['Cm9', 'F13'],
            ['Fm9', 'Bb13'], ['Ebmaj9', 'Ab9'], ['Dm7', 'G7b9'], ['Cm9', 'F13']],
        HB=[['D9'], ['D9'], ['G9'], ['G9'], ['C9'], ['C9'], ['F9'], ['F9']],
        A=[[(0, 70, .5), (.5, 74, .5), (1, 77, .5), (1.5, 81, .5), (2, 80, .5), (2.5, 77, .5), (3, 74, .5), (3.5, 71, .5)],
           [(0, 72, 1), (1, 75, .5), (1.5, 79, .5), (2, 74, 1), (3, 69, 1)],
           [(0, 72, .5), (.5, 69, .5), (1, 65, .5), (1.5, 69, .5), (2, 71, .5), (2.5, 74, .5), (3, 77, .5), (3.5, 80, .5)],
           [(0, 79, 1.5), (1.5, 75, .5), (2, 74, 1), (3, 72, 1)],
           [(0, 68, .5), (.5, 72, .5), (1, 75, .5), (1.5, 79, .5), (2, 80, 1), (3, 79, 1)],
           [(0, 74, 1), (1, 70, 1), (2, 72, .5), (2.5, 75, .5), (3, 78, 1)],
           [(0, 77, .5), (.5, 74, .5), (1, 72, .5), (1.5, 69, .5), (2, 71, 1), (3, 68, 1)],
           [(0, 67, .5), (.5, 70, .5), (1, 74, .5), (1.5, 75, .5), (2, 74, .5), (2.5, 72, .5), (3, 69, 1)]],
        B=[[(0, 66, 1), (1, 69, 1), (2, 72, 1.5), (3.5, 76, .5)],
           [(0, 74, 1), (1, 72, 1), (2, 69, 2)],
           [(0, 71, 1), (1, 74, 1), (2, 77, 1.5), (3.5, 79, .5)],
           [(0, 77, 1), (1, 74, 1), (2, 71, 1), (3, 69, 1)],
           [(0, 70, 1), (1, 72, 1), (2, 76, 1.5), (3.5, 74, .5)],
           [(0, 72, 2), (2, 70, 1), (3, 67, 1)],
           [(0, 69, 1), (1, 72, 1), (2, 75, 1), (3, 77, 1)],
           [(0, 79, 1.5), (1.5, 77, .5), (2, 75, 1), (3, 72, 1)]]),
    'yexiao': dict(
        title='夜宵收摊', bpm=80, swing=0.60, lazy=0.02, seed=1990, leads=('vibes', 'sax'), amb=1.2, clinks=4,
        grooves=['lazy', 'hop', 'hop', 'lazy', 'hop', 'lazy'], bass=['two', 'two', 'walk', 'two', 'walk', 'two'],
        comp=['lazy', 'hop', 'hop', 'lazy', 'hop', 'lazy'],
        CH={'Am9': (45, [55, 59, 60, 64]), 'D9': (38, [54, 57, 60, 64]), 'Fmaj9': (41, [52, 55, 57, 60]),
            'E7#9': (40, [56, 59, 62, 67]), 'Dm9': (38, [53, 57, 60, 64]), 'G13': (43, [53, 57, 59, 64]),
            'Cmaj9': (36, [52, 55, 59, 62]), 'Bm7b5': (47, [53, 57, 59, 62]), 'E7b9': (40, [56, 59, 62, 65])},
        HA=[['Am9'], ['D9'], ['Fmaj9'], ['E7#9'], ['Am9'], ['D9'], ['Fmaj9'], ['E7#9']],
        HB=[['Dm9'], ['G13'], ['Cmaj9'], ['Fmaj9'], ['Bm7b5'], ['E7b9'], ['Am9'], ['E7#9']],
        A=[[(0, 76, 1), (1, 79, .5), (1.5, 83, 1.5), (3, 81, 1)],
           [(0, 78, 1.5), (1.5, 76, .5), (2, 72, 2)],
           [(0, 72, .5), (.5, 76, .5), (1, 79, 1), (2, 81, 1), (3, 76, 1)],
           [(0, 79, 1.5), (1.5, 80, .5), (2, 74, 2)],
           [(0, 72, 1), (1, 76, 1), (2, 83, 1.5), (3.5, 84, .5)],
           [(0, 81, 1), (1, 78, 1), (2, 76, 1), (3, 72, 1)],
           [(0, 76, 2), (2, 77, 1), (3, 79, 1)],
           [(0, 80, 2), (2, 79, 1), (3, 76, 1)]],
        B=[[(0, 65, 1), (1, 69, 1), (2, 72, 1.5), (3.5, 74, .5)],
           [(0, 71, 1.5), (1.5, 69, .5), (2, 64, 2)],
           [(0, 67, 1), (1, 71, 1), (2, 74, 1.5), (3.5, 72, .5)],
           [(0, 69, 2), (2, 67, 1), (3, 64, 1)],
           [(0, 62, 1), (1, 65, 1), (2, 69, 1.5), (3.5, 71, .5)],
           [(0, 68, 1.5), (1.5, 65, .5), (2, 62, 2)],
           [(0, 64, 1), (1, 67, 1), (2, 71, 1), (3, 72, 1)],
           [(0, 71, 1), (1, 68, 1), (2, 67, 1), (3, 64, 1)]]),
}
# 各主奏乐器舒服的音区(主题写在哪个八度都行,吹的时候挪到这个范围的中间)
RANGE = {'sax': (55, 76), 'gtr': (60, 80), 'flute': (72, 91), 'vibes': (67, 88)}


def render(name):
    T = TRACKS[name]
    rng = np.random.default_rng(T['seed'])
    BEAT = 60 / T['bpm']
    SEC = 8
    BARS = SEC * 6
    total = int(BARS * 4 * BEAT * SR)
    tail = int(3.5 * SR)
    L = total + tail
    bus = {k: np.zeros((L, 2)) for k in ('ep', 'lead1', 'lead2', 'bass', 'drum', 'amb')}
    CH = T['CH']

    def swing(b):
        whole = np.floor(b)
        frac = b - whole
        return whole + (T['swing'] if abs(frac - 0.5) < 1e-6 else frac)

    def add(bn, beat, sig, pan=0.0, late=0.0, jitter=0.006):
        t = swing(beat) * BEAT + late + rng.normal(0, jitter)
        i = max(0, int(t * SR))
        n = min(len(sig), L - i)
        if n <= 0:
            return
        lg, rg = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        bus[bn][i:i + n, 0] += sig[:n] * lg
        bus[bn][i:i + n, 1] += sig[:n] * rg

    def hv(v, s=0.12):
        return v * (1 + rng.normal(0, s))

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

    def gtr(m, dur, vel):
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
        y = lowpass(y * np.clip(1 - (t - dur) / 0.15, 0, 1), 3000)
        return y / (np.max(np.abs(y)) + 1e-9) * vel * 1.7

    def sax(m, dur, vel):
        f0 = mtof(m)
        n = int((dur + 0.12) * SR)
        t = np.arange(n) / SR
        fall = -0.02 * np.clip((t - dur + 0.12) / 0.12, 0, 1) if dur > 0.6 else 0
        f = f0 * (1 - 0.04 * np.exp(-t * 22) + 0.007 * np.sin(2 * np.pi * 4.8 * t) * np.clip((t - 0.22) / 0.3, 0, 1) + fall)
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
        return np.tanh(1.6 * body) * vel * 0.6

    def flute(m, dur, vel):
        """长笛:近乎正弦,一点二次谐波,气声明显,颤音"""
        f0 = mtof(m)
        n = int((dur + 0.15) * SR)
        t = np.arange(n) / SR
        f = f0 * (1 + 0.006 * np.sin(2 * np.pi * 5.0 * t) * np.clip((t - 0.15) / 0.25, 0, 1))
        ph = 2 * np.pi * np.cumsum(f) / SR
        amp = np.minimum(1, t / 0.05) * np.clip(1 - (t - dur) / 0.1, 0, 1)
        s = np.sin(ph) + 0.18 * np.sin(2 * ph) + 0.05 * np.sin(3 * ph)
        breath = bandpass(rng.standard_normal(n), 2000, 6000) * (0.06 + 0.12 * np.exp(-t * 20))
        return lowpass((s + breath) * amp, 5000) * vel * 0.75

    def vibes(m, dur, vel):
        """颤音琴:基音 + 4 倍、10 倍泛音,马达颤音,余音长"""
        f = mtof(m)
        t = np.arange(int(max(dur + 1.2, 2.2) * SR)) / SR
        s = np.sin(2 * np.pi * f * t) * np.exp(-t * 1.1) + 0.25 * np.sin(2 * np.pi * f * 4 * t) * np.exp(-t * 6) \
            + 0.06 * np.sin(2 * np.pi * f * 10 * t) * np.exp(-t * 18)
        trem = 1 - 0.25 * (0.5 + 0.5 * np.sin(2 * np.pi * 5.5 * t))
        return s * trem * np.minimum(1, t / 0.002) * np.clip(1 - (t - dur - 0.8) / 0.4, 0, 1) * vel * 0.9

    INST = {'sax': sax, 'gtr': gtr, 'flute': flute, 'vibes': vibes}

    def kick(vel):
        t = np.arange(int(0.4 * SR)) / SR
        return np.sin(2 * np.pi * np.cumsum(48 + 55 * np.exp(-t * 25)) / SR) * np.exp(-t * 8) * vel

    def brush_tap(vel):
        t = np.arange(int(0.18 * SR)) / SR
        return bandpass(rng.standard_normal(len(t)), 700, 4000) * np.minimum(1, t / 0.004) * np.exp(-t * 22) * vel

    def rim(vel):
        t = np.arange(int(0.15 * SR)) / SR
        return (bandpass(rng.standard_normal(len(t)), 1000, 3500) * np.exp(-t * 45) * 0.5
                + 0.5 * np.sin(2 * np.pi * 760 * t) * np.exp(-t * 55)) * vel

    def tom(f0, vel):
        t = np.arange(int(0.6 * SR)) / SR
        return (np.sin(2 * np.pi * np.cumsum(f0 * (1 + 0.3 * np.exp(-t * 20))) / SR) * np.exp(-t * 6)
                + bandpass(rng.standard_normal(len(t)), 200, 1500) * np.exp(-t * 40) * 0.2) * vel

    def woodblock(f0, vel):
        t = np.arange(int(0.2 * SR)) / SR
        return (np.sin(2 * np.pi * f0 * t) * np.exp(-t * 35) + 0.4 * np.sin(2 * np.pi * f0 * 2.7 * t) * np.exp(-t * 60)) \
            * np.minimum(1, t / 0.0008) * vel

    def snap(vel):
        t = np.arange(int(0.12 * SR)) / SR
        return bandpass(rng.standard_normal(len(t)), 1300, 3200) * np.exp(-t * 55) * vel

    def shaker(vel):
        t = np.arange(int(0.08 * SR)) / SR
        return bandpass(rng.standard_normal(len(t)), 2500, 5500) * np.minimum(1, t / 0.012) * np.exp(-t * 45) * vel

    def clink(vel):
        t = np.arange(int(0.5 * SR)) / SR
        s = sum(a * np.sin(2 * np.pi * fr * t) * np.exp(-t * d) for fr, a, d in ((2380, 1, 9), (3610, .5, 14), (5230, .25, 20)))
        return s * np.minimum(1, t / 0.0005) * vel

    # ---------- 旋律放到乐器的音区 ----------
    def fit(lines, inst):
        ms = [m for bar in lines if bar for (_, m, _) in bar]
        lo, hi = RANGE[inst]
        mid = (lo + hi) / 2
        sh = 12 * round((mid - (min(ms) + max(ms)) / 2) / 12)
        return [[(b, m + sh, d) for (b, m, d) in bar] if bar else bar for bar in lines]

    def vary(lines, harm):
        """变奏:长音拆成「长 + 和弦音」,有的音提前半拍(切分),乐句更活"""
        out = []
        for k, bar in enumerate(lines):
            nb = []
            for (b, m, d) in bar:
                if d >= 1.5 and rng.random() < 0.6:
                    tones = [t for t in CH[harm[k][-1 if b >= 2 and len(harm[k]) > 1 else 0]][1]]
                    cand = [t + 12 * o for t in tones for o in range(-1, 4)]
                    nm = min(cand, key=lambda c: abs(c - m) if c != m else 99)
                    nb += [(b, m, d - 0.5), (b + d - 0.5, nm, 0.5)]
                elif b >= 1 and b % 1 == 0 and rng.random() < 0.3:
                    nb.append((b - 0.5, m, d + 0.5))
                else:
                    nb.append((b, m, d))
            out.append(nb)
        return out

    l1, l2 = T['leads']
    A, B = T['A'], T['B']
    sections = [
        (T['HA'], None, None),
        (T['HA'], fit(A, l1), None),
        (T['HB'], None, fit(B, l2)),
        (T['HA'], None, vary(fit(A, l2), T['HA'])),
        (T['HB'], fit([B[i] if i in (2, 3, 6, 7) else [] for i in range(8)], l1),
         fit([B[i] if i in (0, 1, 4, 5) else [] for i in range(8)], l2)),
        (T['HA'], fit([A[0], A[1]] + [[]] * 6, l1), fit([[]] * 6 + [A[6], []], l2)),
    ]

    def near(root, prev):
        c = [root + 12 * k for k in range(-2, 3) if 28 <= root + 12 * k <= 50]
        return min(c, key=lambda m: abs(m - prev))

    lazy = T['lazy']
    prev_b = CH[T['HA'][0][0]][0]
    for bar in range(BARS):
        b0 = bar * 4
        sec, k = divmod(bar, SEC)
        harm, line1, line2 = sections[sec]
        groove, bassmode, comp = T['grooves'][sec], T['bass'][sec], T['comp'][sec]
        chords = harm[k]
        nxt = harm[k + 1][0] if k < SEC - 1 else sections[(sec + 1) % 6][0][0][0]
        span = 4 / len(chords)
        # ---- 电钢琴 ----
        for ci, c in enumerate(chords):
            cb = b0 + ci * span
            v = CH[c][1]
            if comp == 'lazy':
                for j, m in enumerate(v):
                    add('ep', cb + j * 0.02, ep(m, span * BEAT * 0.95, hv(0.22, .06)), pan=-0.3 + 0.12 * j, jitter=0.003)
            elif comp == 'ballad':        # 慢慢琶音一个个按下去,按住
                for j, m in enumerate(v):
                    add('ep', cb + j * 0.09, ep(m, span * BEAT * 0.98, hv(0.20, .06)), pan=-0.3 + 0.12 * j, jitter=0.004)
                if span == 4 and rng.random() < 0.5:
                    add('ep', cb + 2.5, ep(v[-1] + 12, 1.2 * BEAT, 0.08), pan=0.2)
            elif comp in ('hop', 'charleston'):
                for j, m in enumerate(v):
                    add('ep', cb + j * 0.012, ep(m, 0.45, hv(0.20, .06)), pan=-0.3 + 0.12 * j, jitter=0.003)
                    add('ep', cb + (1.5 if span == 4 else 1.5) + j * 0.012, ep(m, 0.9 if span == 4 else 0.35, hv(0.14, .06)),
                        pan=-0.3 + 0.12 * j, jitter=0.003)
            else:                         # 波萨
                pat = ((0, .4, .18), (1.5, .4, .15), (3, .9, .17)) if span == 4 else ((0, .4, .18), (1.5, .4, .14))
                for bt, d, vv in pat:
                    for j, m in enumerate(v):
                        add('ep', cb + bt + j * 0.01, ep(m, d, hv(vv, .06)), pan=-0.3 + 0.12 * j, jitter=0.003)
        # ---- 贝斯 ----
        roots = [CH[c][0] for c in chords]
        rn = CH[nxt][0]
        if bassmode in ('two', 'ballad'):
            r = near(roots[0], prev_b)
            if bassmode == 'ballad':
                line = [(0, r, 2.8)] + ([(3, near(roots[1], r), 0.9)] if len(roots) > 1 else [(3, r + 7, 0.9)] if rng.random() < .5 else [])
                if len(roots) > 1:
                    line = [(0, r, 1.8), (2, near(roots[1], r), 1.8)]
            else:
                line = [(0, r, 1.8), (2, r + 7 if len(roots) == 1 else near(roots[1], r), 1.6)]
                if k % 2 == 1:
                    line.append((3.5, near(rn, r) + 1, 0.4))
        elif bassmode == 'walk':
            r1 = near(roots[0], prev_b)
            if len(roots) == 1:
                third = r1 + (3 if 'm' in chords[0].replace('maj', '') else 4)
                sc = [r1, third, r1 + 7, near(rn, r1 + 7) + rng.choice([-1, 1])]
            else:
                r2 = near(roots[1], r1)
                sc = [r1, r2 + 1, r2, near(rn, r2) - 1]
            line = [(i, m, 0.9) for i, m in enumerate(sc)]
        else:
            r = near(roots[0], prev_b)
            r2 = r + 7 if len(roots) == 1 else near(roots[1], r)
            line = [(0, r, 1.4), (1.5, r + 7, .4), (2, r2, 1.4), (3.5, r, .4)]
        for bt, m, d in line:
            add('bass', b0 + bt, upright(m, d * BEAT, hv(0.55, .08)), jitter=0.004)
        prev_b = line[-1][1]
        # ---- 鼓(几乎不用镲)----
        if groove == 'lazy':
            add('drum', b0, kick(hv(0.45)))
            add('drum', b0 + 2, kick(hv(0.30)))
            for bt in (1, 3):
                add('drum', b0 + bt, brush_tap(hv(0.22)), pan=-0.1, late=lazy)
            for bt in (0.5, 1.5, 2.5, 3.5):
                if rng.random() < 0.6:
                    add('drum', b0 + bt, brush_tap(hv(0.06, .3)), pan=0.15, late=lazy)
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
                add('drum', b0 + bt, snap(hv(0.30)), pan=0.15, late=lazy + 0.01)
                add('drum', b0 + bt, brush_tap(hv(0.15)), pan=-0.1, late=lazy)
            for bt in (0.5, 1.5, 2.5, 3.5):
                if rng.random() < 0.55:
                    add('drum', b0 + bt, shaker(hv(0.06, .3)), pan=0.4)
            if k % 4 == 1:
                add('drum', b0 + 3.5, woodblock(1050, hv(0.09)), pan=0.35)
                add('drum', b0 + 3.75, woodblock(820, hv(0.07)), pan=0.35)
        elif groove == 'swing':           # 轻快摇摆:没有镲,边击 2、4,刷子点出摇摆八分,底鼓轻轻每拍
            for bt in range(4):
                add('drum', b0 + bt, kick(hv(0.20)))
            for bt in (1, 3):
                add('drum', b0 + bt, rim(hv(0.20)), pan=-0.15, late=lazy)
            for bt in (0, 1, 1.5, 2, 3, 3.5):
                add('drum', b0 + bt, brush_tap(hv(0.10 if bt % 1 == 0 else 0.07, .2)), pan=0.2)
            if k % 4 == 3:
                add('drum', b0 + 2.5, snap(hv(0.18)), pan=0.3)
        elif groove == 'ballad':          # 慢板:很稀,刷子点 2、4,底鼓 1,偶尔通鼓
            add('drum', b0, kick(hv(0.30)))
            for bt in (1, 3):
                add('drum', b0 + bt, brush_tap(hv(0.16)), pan=-0.1, late=lazy)
            if rng.random() < 0.5:
                add('drum', b0 + 2.5, brush_tap(hv(0.05)), pan=0.2)
            if k in (3, 7) and rng.random() < 0.7:
                add('drum', b0 + 3.5, tom(110, hv(0.14)), pan=-0.2)
        else:                             # 波萨(bossa)/ 波萨轻(bossa2:少一点)
            light = groove == 'bossa2'
            for bt in ((0, 1.5, 3) if bar % 2 == 0 else (1, 2.5)):
                add('drum', b0 + bt, rim(hv(0.13 if light else 0.16)), pan=-0.15)
            for bt in (0, 1.5, 2, 3.5):
                add('drum', b0 + bt, kick(hv(0.28 if bt in (0, 2) else 0.16)))
            if not light:
                for bt in np.arange(0, 4, 0.5):
                    add('drum', b0 + bt, shaker(hv(0.035 if bt % 1 else 0.05, .25)), pan=0.4)
            elif k % 2 == 1:
                add('drum', b0 + 3.5, woodblock(980, hv(0.08)), pan=0.35)
        if k == SEC - 1:                  # 段尾通鼓过门
            pat = [((2, 196), (2.5, 165), (3, 131), (3.5, 110)), ((3, 165), (3.33, 131), (3.67, 110)),
                   ((2.5, 131), (3, 165), (3.5, 110))][sec % 3]
            for bt, f in pat:
                add('drum', b0 + bt, tom(f, hv(0.22)), pan=(f - 150) / 200)
        # ---- 主奏 ----
        for bn, inst, lines in (('lead1', l1, line1), ('lead2', l2, line2)):
            if lines and lines[k]:
                fn = INST[inst]
                for bt, m, d in lines[k]:
                    add(bn, b0 + bt, fn(m, d * BEAT * (0.93 if inst in ('sax', 'flute') else 1.0), hv(0.32, .07)),
                        pan=-0.1 if bn == 'lead1' else 0.2, late=lazy, jitter=0.007)

    # ---------- 远处城市低鸣(循环卷积,首尾相接)+ 偶尔碗筷轻碰 ----------
    spec = np.fft.rfft(rng.standard_normal(total))
    fq = np.fft.rfftfreq(total, 1 / SR)
    hum = np.fft.irfft(spec * np.where(fq > 25, 1 / np.maximum(fq, 25), 0) / (1 + (fq / 260) ** 8), n=total)
    hum *= 0.004 * T['amb'] / (np.sqrt(np.mean(hum ** 2)) + 1e-12)
    bus['amb'][:total, 0] += hum
    bus['amb'][:total, 1] += np.roll(hum, 1500)
    for _ in range(T['clinks']):
        add('amb', rng.uniform(4, BARS * 4 - 8), clink(0.045), pan=rng.uniform(-0.6, 0.6), jitter=0)

    # ---------- 混音 ----------
    ir_t = np.arange(int(2.2 * SR)) / SR
    ir = lowpass(rng.standard_normal((len(ir_t), 2)) * np.exp(-ir_t * 2.9)[:, None], 4500)
    ir /= np.sqrt((ir ** 2).sum(axis=0))

    def reverb(x, wet):
        return x + wet * np.stack([fftconvolve(x[:, c], ir[:, c])[:len(x)] for c in range(2)], axis=1)

    rev = {'sax': .5, 'gtr': .42, 'flute': .45, 'vibes': .5}
    mixes = {'ep': reverb(highpass(lowpass(bus['ep'], 5500), 120), 0.40),
             'lead1': reverb(highpass(bus['lead1'], 120), rev[l1]),
             'lead2': reverb(highpass(bus['lead2'], 120), rev[l2]),
             'bass': lowpass(bus['bass'], 1100) * 0.75,
             'drum': reverb(lowpass(bus['drum'], 6500, 4), 0.25) * 0.95,
             'amb': reverb(bus['amb'], 0.6)}

    def db(x):
        return 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)

    seg = lambda a, b: slice(int(a * 4 * BEAT * SR), int(b * 4 * BEAT * SR))
    lv = {'lead1': db(mixes['lead1'][seg(8, 16)]), 'lead2': db(mixes['lead2'][seg(16, 24)]), 'ep': db(mixes['ep'][seg(8, 16)])}
    # 主奏都对齐到比电钢琴高 0.5dB 左右
    for kk in ('lead1', 'lead2'):
        mixes[kk] *= 10 ** ((lv['ep'] + 0.5 - lv[kk]) / 20)
    mix = highpass(lowpass(sum(mixes.values()), 9000), 35)
    print(T['title'], ' '.join(f'{kk} {db(mixes[kk][seg(8, 40)]):.1f}' for kk in mixes))

    out = mix[:total].copy()
    out[:tail] += mix[total:total + tail]
    out = np.tanh(out * 1.1) / np.tanh(1.1)
    out *= 0.89 / np.max(np.abs(out))
    return (out * 32767).astype('<i2'), total


if __name__ == '__main__':
    name, path = sys.argv[1], sys.argv[2]
    pcm, total = render(name)
    for p, data in ((path, pcm), (path.replace('.wav', '-padded.wav'), np.concatenate([pcm[-SR:], pcm, pcm[:SR]]))):
        with wave.open(p, 'wb') as w:
            w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
            w.writeframes(data.tobytes())
    print(f'{TRACKS[name]["title"]}:循环长度 {total} 个采样,{total / SR:.1f} 秒')
