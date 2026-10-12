# 把每張截圖切成 (列, 欄) 的格子，取出每一格的像素小塊（背景減像素，正值＝比背景暗）。
#
# 假設：列與列之間有一條橫的分隔線（或至少一條比背景暗的像素）、同一欄的字靠左對齊。
# 沒有分隔線的表格要改 bands()（例如用固定的列距，或用整條空白的像素列切）。
import os, pickle
import numpy as np
from . import img
from .conf import P, wpath

_allc = None


def norm_patch(patch, bg):
    """斑馬紋的灰底列：字是黑的、底是灰的，等比例放大回白底。
    （驗證過：同一個字串在灰底列與白底列的小塊，差的就是 bg/255 這個比例。）"""
    return np.round(patch.astype(np.float32) * 255.0 / float(bg)).astype(np.float32)


def trim(p, th=None):
    """裁到有墨的範圍。門檻要跟合成那一側一樣（conf 的 ink_th）—— 門檻高的那一側會把很淡的
    邊緣像素裁掉，兩邊的寬度就差一欄，而誤差會被算在整格上。"""
    th = P['ink_th'] if th is None else th
    ink = np.abs(p).max(axis=2) > th
    if not ink.any():
        return None
    ys = np.where(ink.any(axis=1))[0]; xs = np.where(ink.any(axis=0))[0]
    return p[ys[0]:ys[-1] + 1, xs[0]:xs[-1] + 1]


def bands(a, line_th=None):
    """回傳每一列的 (y0, y1)。分隔線＝整條像素的中位數比白色暗 line_th 以上。"""
    line_th = P['line_th'] if line_th is None else line_th
    g = 255 - a.astype(np.float32).mean(axis=2)
    line = np.median(g, axis=1) >= line_th
    out = []; s = None; h = len(line)
    for y in range(h + 1):
        isl = (y == h) or line[y]
        if not isl and s is None: s = y
        if isl and s is not None:
            out.append((s, y - 1)); s = None
    return out


def analyze(a):
    """rows：每一列的範圍、背景色、墨跡；segs：每一欄的 x 範圍（所有列的墨跡疊起來，空 col_gap 以上就斷開）。"""
    a = a.astype(np.int16); h, w, _ = a.shape
    rows = []; inkmask = np.zeros((h, w), bool)
    for y0, y1 in bands(a):
        band = a[y0:y1 + 1]
        bg = np.median(band.reshape(-1, 3), axis=0).astype(np.int16)   # 每一列自己的背景（斑馬紋）
        diff = bg[None, None, :] - band
        ink = np.abs(diff).max(axis=2) > P['ink_th']
        inkmask[y0:y1 + 1] = ink
        rows.append(dict(y0=y0, y1=y1, bg=bg, diff=diff, ink=ink))
    colink = inkmask.sum(axis=0) > 0
    segs = []; s = None; last = -99
    for x in range(w):
        if colink[x]:
            if s is None: s = x
            elif x - last > P['col_gap']: segs.append((s, last)); s = x
            last = x
    if s is not None: segs.append((s, last))
    return a, rows, segs


def build(paths):
    """切全部的圖，存成 cells.pkl。key 是 stem（檔名不含副檔名），順序就是 paths 的順序。"""
    global _allc
    img.register(paths)
    allc = {}
    for stem in dict.fromkeys(os.path.splitext(os.path.basename(p))[0] for p in paths):
        a, rows, segs = analyze(img.load(stem))
        cells = {}
        for ri, r in enumerate(rows):
            for si, (x0, x1) in enumerate(segs):
                ink = r['ink'][:, x0:x1 + 1]
                if not ink.any(): continue
                ys = np.where(ink.any(axis=1))[0]; xs = np.where(ink.any(axis=0))[0]
                cells[(ri, si)] = dict(dy=int(ys[0]), dy1=int(ys[-1]), dx=int(xs[0]), dx1=int(xs[-1]),
                                       patch=r['diff'][ys[0]:ys[-1] + 1, x0 + xs[0]:x0 + xs[-1] + 1].copy())
        allc[stem] = dict(rows=[dict(y0=r['y0'], y1=r['y1'], bg=r['bg']) for r in rows], segs=segs, cells=cells, path=img._paths[stem])
    pickle.dump(allc, open(wpath('cells.pkl'), 'wb'))
    _allc = allc
    return allc


def cells():
    global _allc
    if _allc is None:
        _allc = pickle.load(open(wpath('cells.pkl'), 'rb'))
        img.register([d['path'] for d in _allc.values() if d.get('path')])
    return _allc


def stems():
    return list(cells())


def rows_of(stem):
    """資料列的索引（太矮的那幾條不是）。"""
    d = cells()[stem]
    return [ri for ri, r in enumerate(d['rows']) if r['y1'] - r['y0'] >= P['min_row_h']]


def ri_of(stem, row):
    """人看的「第幾列」（資料列，從 1 起算）→ 內部的列索引。兩個不一定差 1：
    表頭、被截掉的半列也各佔一個內部索引。給人看、給人填的一律用第幾列。"""
    return rows_of(stem)[row - 1]


def obs_cell(stem, ri, si, x0=None, x1=None):
    """一格的觀測小塊：正規化到白底、裁到有墨的範圍。x0/x1 只取其中幾欄像素（切掉圖示用）。"""
    d = cells()[stem]; c = d['cells'].get((ri, si))
    if c is None: return None
    p = norm_patch(c['patch'], d['rows'][ri]['bg'][0])
    if x0 is not None or x1 is not None:
        p = trim(p[:, (x0 or 0):(x1 if x1 is not None else p.shape[1])])
    return p


def row_region(stem, ri, si):
    """一格所在的整塊區域（還沒裁、還沒正規化），給需要自己切圖示的欄位用。"""
    d = cells()[stem]; r = d['rows'][ri]; x0, x1 = d['segs'][si]
    a = img.load(stem).astype(np.int16)
    return (r['bg'][None, None, :] - a[r['y0']:r['y1'] + 1, x0:x1 + 1]).astype(np.float32), r['bg']


def segstat(stem):
    """每一欄的統計：幾格有字、幾種不同的樣子、高度、寬度、最常見的起始 x。
    用來認欄位：一整欄只有一兩種樣子的是固定值；寬度全都一樣的是日期或編號；
    高度特別高、顏色飽和的是徽章或圖示。"""
    import collections
    d = cells()[stem]; rows = rows_of(stem); out = []
    for si, (x0, x1) in enumerate(d['segs']):
        cs = [d['cells'][(ri, si)] for ri in rows if (ri, si) in d['cells']]
        if not cs: continue
        hs = collections.Counter(c['dy1'] - c['dy'] + 1 for c in cs)
        ws = sorted(set(c['dx1'] - c['dx'] + 1 for c in cs))
        dxs = collections.Counter(c['dx'] for c in cs)
        uniq = len(set((c['patch'].shape, c['patch'].tobytes()) for c in cs))
        sat = sum(1 for c in cs if (c['patch'].max(axis=2) - c['patch'].min(axis=2)).max() > 150)
        out.append(dict(seg=si, x0=x0, x1=x1, n=len(cs), uniq=uniq, heights=dict(hs), widths=ws, dx=dict(dxs.most_common(3)), saturated=sat))
    return out
