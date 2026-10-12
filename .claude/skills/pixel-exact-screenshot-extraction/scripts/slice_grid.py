# 第一步：把截圖切成格子，印出每張圖每一欄的統計（用來認欄位、寫欄位對應表）。
#   python slice_grid.py <圖檔或資料夾> [...]
# 產出 cells.pkl（在工作目錄）。不渲染，幾秒鐘。
import glob, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding='utf-8')
from pxx import grid
from pxx.conf import P


def main(args):
    paths = []
    for a in args:
        paths += sorted(glob.glob(os.path.join(a, '*.png'))) if os.path.isdir(a) else [a]
    if not paths:
        print(__doc__ or '用法：python slice_grid.py <圖檔或資料夾>'); return 1
    allc = grid.build(paths)
    for stem, d in allc.items():
        rows = grid.rows_of(stem)
        hs = sorted(set(d['rows'][ri]['y1'] - d['rows'][ri]['y0'] + 1 for ri in rows))
        pitch = [d['rows'][b]['y0'] - d['rows'][a]['y0'] for a, b in zip(rows, rows[1:])]
        bgs = sorted(set(int(d['rows'][ri]['bg'][0]) for ri in rows))
        print('== %s：%d 列（高 %s、列距 %s）、%d 欄、背景 %s' % (stem, len(rows), hs, sorted(set(pitch)), len(d['segs']), bgs))
        for s in grid.segstat(stem):
            ws = s['widths'] if len(s['widths']) < 9 else '%d..%d（%d 種）' % (s['widths'][0], s['widths'][-1], len(s['widths']))
            print('  欄%02d x=%4d-%4d 有字 %2d 格、%2d 種樣子 高度%s 寬度%s 起點%s%s' % (
                s['seg'], s['x0'], s['x1'], s['n'], s['uniq'], s['heights'], ws, s['dx'], ' ←有顏色（徽章／圖示）' if s['saturated'] else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
