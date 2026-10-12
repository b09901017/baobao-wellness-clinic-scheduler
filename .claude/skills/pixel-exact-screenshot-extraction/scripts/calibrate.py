# 校正：找出截圖是用什麼字型、多大的字畫的，以及合成值到截圖值的色調對照。
# 需要工作目錄裡有 cells.pkl（先跑 slice_grid.py）與 anchors.json ——
# 幾格「內容確定」的格子（放大後看得出來的日期、整欄都一樣的固定值、你自己知道的字）：
#   [{"stem": "shot1", "row": 1, "seg": 1, "text": "2026-05-21"}, ...]     row＝第幾列資料（從 1 起算），seg＝slice_grid.py 印的欄號
# 錨點越長越好（字級差一點點，誤差是沿著字串累積的），數字與中文各要有幾個（可能來自不同字型）。
#
#   python calibrate.py font ["字型A;字型B;…"]     每個候選字型的誤差（em 用 profile 裡的）
#   python calibrate.py em <從> <到> <間隔>          掃字級（單位：截圖像素／em）
#   python calibrate.py lut                          擬合色調對照表 → lut.npy
#   python calibrate.py check                        用現在的設定把每個錨點比一次
# 順序：font → em（粗）→ lut → em（細）→ lut → check。lut 之前誤差降不到 1 以下是正常的。
import collections, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding='utf-8')
import numpy as np
from pxx import grid, conf, synth
from pxx.conf import P, wpath, phases
from pxx.match import apply_lut, loose_err, perr, reload_lut

FONTS = ["'Microsoft JhengHei UI'", "'Microsoft JhengHei'", "'Microsoft YaHei UI'", "'Microsoft YaHei'", "'Segoe UI'", 'Arial', 'Tahoma',
         'Verdana', 'Calibri', 'PMingLiU', "'Yu Gothic UI'", 'Meiryo', "'Malgun Gothic'", "'Noto Sans TC'", "'Noto Sans CJK TC'",
         "'PingFang TC'", "'Helvetica Neue'", 'Roboto', 'system-ui', 'sans-serif']


def anchors():
    out = []
    for a in json.load(open(wpath('anchors.json'), encoding='utf-8')):
        o = grid.obs_cell(a['stem'], grid.ri_of(a['stem'], a['row']), a['seg'], *(a.get('cols') or (None, None)))
        if o is None:
            print('  ! 錨點 %s 第 %d 列 欄%d 沒有墨，跳過' % (a['stem'], a['row'], a['seg'])); continue
        out.append((o, a['text']))
    return out


def render(texts, phs, raw=False, **over):
    """{字串: [每個起始位置的小塊]}。一次呼叫＝一個瀏覽器。"""
    r = synth.render([(t, p) for t in texts for p in phs], tag='calib', **over)
    out = {}
    for ti, t in enumerate(texts):
        out[t] = [None if x is None else (x['patch'].astype(np.float32) if raw else apply_lut(x['patch'])) for x in r[ti * len(phs):(ti + 1) * len(phs)]]
    return out


def score(A, pats, strict):
    f = perr if strict else loose_err
    return [min([f(o, s) for s in pats[t] if s is not None] or [999.0]) for o, t in A]


def cmd_font(args):
    A = anchors(); texts = sorted(set(t for _, t in A)); phs = phases(16)
    fonts = [f.strip() for f in args[0].split(';')] if args else FONTS
    none = render(texts, phs, font="'pxx-no-such-font'")
    res = []
    for f in fonts:
        pats = render(texts, phs, font=f)
        missing = all(a is not None and b is not None and a.shape == b.shape and (a == b).all() for t in texts for a, b in zip(pats[t], none[t]))
        e = score(A, pats, strict=False)
        res.append((float(np.mean(e)), f, missing, e))
    print('em＝%.4f（截圖像素）。誤差越小越像；「＝預設」＝畫出來跟不存在的字型一模一樣（這台機器沒裝，或它本來就是預設字型）。' % P['em'])
    for m, f, missing, e in sorted(res, key=lambda r: r[0]):
        print('  %6.2f  %-28s %s  每個錨點：%s' % (m, f, '（＝預設）' if missing else '', ' '.join('%.1f' % x for x in e)))
    print('第一名跟第二名差不多的話，多半是字級還沒對：先掃 em 再回來比。數字與中文分開看 —— 它們可能來自字型堆疊裡不同的字型。')


def cmd_em(args):
    lo, hi, step = map(float, args[:3]); A = anchors(); texts = sorted(set(t for _, t in A)); phs = phases()
    best = None
    v = lo
    while v <= hi + 1e-9:
        e = score(A, render(texts, phs, em=v), strict=True)
        loose = None
        if max(e) >= 999: loose = score(A, render(texts, phases(64), em=v), strict=False)
        ok = sum(x < 1.1 for x in e)
        print('  em %.4f  吻合 %d/%d  平均 %s  最差 %s' % (v, ok, len(e), '%.2f' % np.mean(e) if max(e) < 999 else '—（大小對不上；寬鬆比 %.1f）' % np.mean(loose),
                                                  '%.2f' % max(e) if max(e) < 999 else '—'))
        key = (-ok, np.mean(e) if max(e) < 999 else 999 + np.mean(loose))
        if best is None or key < best[0]: best = (key, v)
        v += step
    print('最好的是 em＝%.4f。要寫進 profile.json：python -c "from pxx import conf; conf.save(em=%.4f)"（在 scripts 目錄下）' % (best[1], best[1]))


def cmd_lut(args):
    """每個錨點在所有起始位置畫一次（不套對照），挑「大小一樣而且最像」的那一個，
    把 (合成值, 截圖值) 一個通道一個通道收起來；每個合成值取中位數，中間沒看過的值內插。"""
    A = anchors(); texts = sorted(set(t for _, t in A)); pats = render(texts, phases(), raw=True)
    pairs = collections.defaultdict(list); used = 0
    for o, t in A:
        best = None
        for s in pats[t]:
            if s is None or s.shape != o.shape: continue
            e = float(np.abs(s - o).mean())
            if best is None or e < best[0]: best = (e, s)
        if best is None or best[0] > 12:
            print('  ! 「%s」找不到大小一樣又夠像的合成（字型或字級還沒對）' % t); continue
        used += 1
        for a, b in zip(best[1].ravel(), o.ravel()): pairs[int(a)].append(float(b))
    if used < 3:
        print('能用的錨點只有 %d 個，不夠擬合。先把字型與字級校到「大小一樣」再來。' % used); return 1
    ks = sorted(k for k in pairs if 0 <= k <= 255 and len(pairs[k]) >= 5)
    xs = np.array(ks, dtype=np.float32); ys = np.array([np.median(pairs[k]) for k in ks], dtype=np.float32)
    full = np.interp(np.arange(256), xs, ys).astype(np.float32)
    hi = int(xs[-1])
    if hi < 255 and len(xs) >= 3:   # 最深的那一段常常沒被觀測到：照最後一段的斜率外推，不要讓它平掉
        slope = (ys[-1] - ys[-3]) / max(1.0, xs[-1] - xs[-3])
        for v in range(hi + 1, 256): full[v] = min(255, ys[-1] + slope * (v - hi))
    np.save(wpath('lut.npy'), full); reload_lut()
    print('用了 %d 個錨點、%d 個不同的合成值。對照（合成 → 截圖）：' % (used, len(ks)),
          ' '.join('%d→%d' % (v, int(full[v])) for v in (0, 8, 24, 40, 64, 96, 128, 160, 192, 224, 255)))
    spread = [float(np.percentile(pairs[k], 95) - np.percentile(pairs[k], 5)) for k in ks]
    print('每個合成值對到的截圖值，5%%～95%% 的範圍中位數是 %.1f（越小越好；很大表示字型／字級／起始位置還沒對，對照表是糊的）' % np.median(spread))
    return cmd_check([])


def cmd_check(args):
    A = anchors(); texts = sorted(set(t for _, t in A)); e = score(A, render(texts, phases()), strict=True)
    for (o, t), x in zip(A, e): print('  %6.2f %s  「%s」' % (x, '✓' if x < 1.1 else ('△' if x < 1.6 else '✗'), t))
    print('吻合（< 1.1）%d/%d。全部吻合才往下做；不吻合的先用 peek.py 看是哪一欄像素差。' % (sum(x < 1.1 for x in e), len(e)))
    return 0


if __name__ == '__main__':
    cmds = dict(font=cmd_font, em=cmd_em, lut=cmd_lut, check=cmd_check)
    if len(sys.argv) < 2 or sys.argv[1] not in cmds:
        print('用法：python calibrate.py font|em|lut|check …（見檔頭）'); sys.exit(1)
    rc = cmds[sys.argv[1]](sys.argv[2:])
    synth.clear_cache()
    sys.exit(rc or 0)
