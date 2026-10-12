# 用顏色分的東西（狀態徽章、標籤）：不用讀字，量那一格裡「有顏色的像素」的中位數就好。
# 幾百格裡只有三四種顏色，一眼就分得出來；徽章上的字再放大用看的確認一次（種類少，看得準）。
import numpy as np
from . import grid, img


def badge(stem, ri, si, min_sat=40):
    """回傳 dict(rgb, width) 或 None。min_sat：最大通道減最小通道超過多少才算有顏色（灰階的字不算）。"""
    d = grid.cells()[stem]; r = d['rows'][ri]; x0, x1 = d['segs'][si]
    reg = img.load(stem)[r['y0']:r['y1'] + 1, x0:x1 + 1].astype(int)
    sat = (reg.max(axis=2) - reg.min(axis=2)) > min_sat
    if not sat.any(): return None
    b, g, rr = np.median(reg[sat], axis=0)
    xs = np.where(sat.any(axis=0))[0]
    return dict(rgb=(int(rr), int(g), int(b)), width=int(xs[-1] - xs[0] + 1))


def classify(si, palette, max_dist=60):
    """palette：{名稱: (r, g, b)}。回傳 {(stem, ri): dict(label, rgb, width, dist)}。
    離每一種顏色都太遠的標成 '?' —— 寧可留一個問號，不要硬塞進最近的那一類。
    si 可以是數字或 stem → 數字的函式。先不給 palette 跑一次 colors() 看有哪幾群，再回來定。"""
    out = {}
    for stem in grid.stems():
        s = si(stem) if callable(si) else si
        if s is None: continue
        for ri in grid.rows_of(stem):
            b = badge(stem, ri, s)
            if b is None: out[(stem, ri)] = dict(label=None, rgb=None, width=0, dist=None); continue
            name, dist = min(((n, float(np.abs(np.array(c) - np.array(b['rgb'])).max())) for n, c in palette.items()), key=lambda x: x[1])
            out[(stem, ri)] = dict(label=name if dist <= max_dist else '?', rgb=b['rgb'], width=b['width'], dist=dist)
    return out


def colors(si, round_to=16):
    """這一欄出現過哪幾種顏色、各幾格（顏色量化到 round_to 的倍數，方便看有幾群）。"""
    import collections
    c = collections.Counter()
    for stem in grid.stems():
        s = si(stem) if callable(si) else si
        if s is None: continue
        for ri in grid.rows_of(stem):
            b = badge(stem, ri, s)
            if b: c[(tuple(int(v) // round_to * round_to for v in b['rgb']), b['width'])] += 1
    return c
