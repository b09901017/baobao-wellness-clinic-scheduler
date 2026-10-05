# 看一格長什麼樣子：字元畫（每個像素一個字元）＋每個通道的數值。
#   python peek.py <stem> <列> <欄>            列＝第幾列資料（從 1 起算），欄＝slice_grid.py 印的欄號
#   python peek.py <stem> <列> <欄> "候選字串"  另外把候選字串畫出來並排比（所有起始位置裡最接近的那一個）
# 字只有幾個像素高的時候，放大圖幫不上忙；看數字才知道差在哪一欄像素。
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding='utf-8')
import numpy as np
from pxx import grid
from pxx.match import patterns, perr

CH = ' .:-=+*#%@'


def art(p):
    g = np.clip(np.abs(p).mean(axis=2), 0, 255)
    return [''.join(CH[min(9, int(v / 25.6))] for v in row) for row in g]


def main(a):
    stem, row, si = a[0], int(a[1]), int(a[2])
    o = grid.obs_cell(stem, grid.ri_of(stem, row), si)
    if o is None:
        print('這一格沒有墨'); return 1
    print('觀測 %s 第 %d 列 欄%d：高 %d 寬 %d' % (stem, row, si, o.shape[0], o.shape[1]))
    rows = art(o)
    if len(a) > 3:
        pats = patterns([a[3]])[a[3]]
        best = min(pats, key=lambda s: perr(o, s)) if pats else None
        e = perr(o, best) if best is not None else 999.0
        if e >= 999:   # 大小就對不上：挑寬度最接近的給人看
            best = min(pats, key=lambda s: abs(s.shape[1] - o.shape[1])) if pats else None
        print('合成「%s」：%s，誤差 %.2f（< 1.1 才算吻合）' % (a[3], '高 %d 寬 %d' % best.shape[:2] if best is not None else '畫不出來', e))
        r2 = art(best) if best is not None else []
        for i in range(max(len(rows), len(r2))):
            print('  %-*s   |   %s' % (o.shape[1], rows[i] if i < len(rows) else '', r2[i] if i < len(r2) else ''))
    else:
        for r in rows: print('  ' + r)
    np.set_printoptions(linewidth=250)
    for ci, name in enumerate('BGR'):
        print(name); print(o[:, :min(o.shape[1], 40), ci].astype(int))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
