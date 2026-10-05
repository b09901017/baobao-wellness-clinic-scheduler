# 環境自我檢查：這台機器能不能畫、字型有沒有裝、畫得多快、一個瀏覽器吃多少 CPU。
#   python selftest.py            基本檢查（幾秒）
#   python selftest.py --load 4   另外量 1 個與 4 個瀏覽器同時畫的時候整機的 CPU 佔用（各十幾秒）
# 長時間的工作開跑之前跑一次 --load，再決定 PXX_MAXPAR。
import os, shutil, subprocess, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding='utf-8')
import numpy as np
from pxx import synth
from pxx.conf import P, WORK, n_phases, phases


def cpu_times():
    """(閒置, 全部) 的累計時間。兩次相減就是這段期間整機的佔用率。"""
    if os.name == 'nt':
        import ctypes
        from ctypes import wintypes
        idle, kern, user = wintypes.FILETIME(), wintypes.FILETIME(), wintypes.FILETIME()
        ctypes.windll.kernel32.GetSystemTimes(ctypes.byref(idle), ctypes.byref(kern), ctypes.byref(user))
        f = lambda ft: (ft.dwHighDateTime << 32) | ft.dwLowDateTime
        return f(idle), f(kern) + f(user)          # kernel 那一格已經含閒置
    try:
        v = list(map(int, open('/proc/stat').readline().split()[1:]))
        return v[3] + v[4], sum(v)
    except OSError:
        return None


def measure(fn):
    a = cpu_times(); t = time.time(); r = fn(); el = time.time() - t; b = cpu_times()
    util = None if not a or b[1] == a[1] else 100 * (1 - (b[0] - a[0]) / (b[1] - a[1]))
    return r, el, util


def same(a, b):
    return all((x is None and y is None) or (x is not None and y is not None and x['patch'].shape == y['patch'].shape and (x['patch'] == y['patch']).all()) for x, y in zip(a, b))


def main():
    print('工作目錄', WORK)
    print('畫法', {k: P[k] for k in ('font', 'em', 'dsf', 'color', 'ink_th')}, '｜每像素', n_phases(), '個起始位置')
    node = shutil.which('node')
    print('node', subprocess.run([node, '--version'], capture_output=True, text=True).stdout.strip() if node else '找不到（要裝 Node.js）')
    print('playwright', synth.node_modules())
    print('邏輯核心', os.cpu_count(), '｜同時上限', synth.budget(), '（PXX_MAXPAR 可以改）｜快取 %.0f MB' % synth.cache_mb())

    probe = '測試ABC123'
    items = [(probe, p) for p in phases(16)]
    a = synth.render(items, tag='st')
    if any(x is None for x in a):
        print('✗ 什麼都沒畫出來'); return 1
    b = synth.render(items, tag='st')
    print('✓ 畫得出來，小塊大小', a[0]['patch'].shape, '｜重畫一次', '完全一樣' if same(a, b) else '✗ 不一樣（這套方法靠的就是每次畫都一樣）')

    # 字型沒裝的話瀏覽器會安靜地換成預設字型，畫出來一樣有字、只是永遠對不上
    c = synth.render(items, tag='st', font="'pxx-no-such-font'")
    print('✗ 字型 %s 沒有裝：畫出來的跟「不存在的字型」一模一樣' % P['font'] if same(a, c) else '✓ 字型 %s 有裝' % P['font'])

    ch = [x['patch'] for x in a]
    rgb = max(float(np.abs(p[:, :, 0].astype(int) - p[:, :, 2]).max()) for p in ch)
    print('次像素（ClearType／LCD）渲染：', '有，三個通道不一樣（最大差 %d）' % rgb if rgb > 8 else '沒有，三個通道一樣（灰階反鋸齒）')
    full = synth.render([(probe, p) for p in phases()], tag='st')
    print('起始位置不同會畫出', len(set((x['patch'].shape, x['patch'].tobytes()) for x in full if x is not None)), '種不同的樣子（共試', len(full), '個位置）')

    n = 4000
    batch = [(probe[i % 3:] + str(i), (i % 64) / 64) for i in range(n)]
    _, el, util = measure(lambda: synth.render(batch, tag='st'))
    print('速度：%d 個磁磚 %.1f 秒（每秒約 %d 個）' % (n, el, n / el), '' if util is None else '｜這段期間整機 CPU %.0f%%' % util)

    if '--load' in sys.argv:
        k = int(sys.argv[sys.argv.index('--load') + 1])
        _, el0, idle = measure(lambda: time.sleep(4))
        print('閒著的時候整機 CPU %.0f%%' % idle)
        for par in sorted(set([1, k])):
            os.environ['PXX_MAXPAR'] = str(par); synth._slots = None
            bs = [[(probe + str(j) + '_' + str(i), (i % 64) / 64) for i in range(8000)] for j in range(4)]
            _, el, util = measure(lambda: synth.render_many(bs, tag='st'))
            print('同時 %d 個瀏覽器：%d 個磁磚 %.1f 秒（每秒 %d 個），整機 CPU %.0f%%' % (par, 8000 * len(bs), el, 8000 * len(bs) / el, util))
    st = synth.stats()
    print('畫了 %d 頁、%d 個磁磚｜重試 %d、逾時 %d、整頁重畫 %d 個磁磚、畫不出墨 %d' % (st['batches'], st['tiles'], st['retries'], st['timeouts'], st['repainted'], st['blank']))
    synth.clear_cache()
    return 0


if __name__ == '__main__':
    sys.exit(main())
