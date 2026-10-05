# 格子裡除了字還有別的東西（圖示、按鈕、標籤）時，把字切出來。
# 切出來的小塊直接當 Field 的 obs_fn 回傳值、或拿去 decode()／verify()。
# 這兩支是從實戰的版面抽出來的：一支處理「字的前後有比字高的圖示」，一支處理「字後面隔一點空白跟著一個小圖示」。
# 別的版面多半要照著改；改完用 peek 的字元畫看切出來的東西對不對，再拿一格已知答案的格子比一次。
import numpy as np
from . import grid
from .conf import P


def strip_tall(stem, ri, si, text_h=None, group_th=10):
    """字的前面或後面有「比字高」的東西（彩色圖示、方塊按鈕）：照連續有墨的欄分組，高的那幾組是圖示，其餘是字。
    回傳 (小塊或 None, dict(lead=前面有圖示, trail=後面有圖示))。
    text_h：字最高幾個像素（預設 1.2 em，取整數）。超過的就當圖示。
    字貼著後面的方塊、中間沒有空欄時，兩個會連成一組：在方塊的左邊框（整欄都有墨的那一欄）切開。"""
    em = P['em']; text_h = text_h or int(round(em * 1.2))
    reg, bg = grid.row_region(stem, ri, si)
    ink = np.abs(reg).max(axis=2) > group_th          # 分組用高一點的門檻：很淡的邊緣會把相鄰的兩組黏在一起
    colink = ink.any(axis=0); W = len(colink)
    groups = []; s0 = None
    for x in range(W + 1):
        on = x < W and colink[x]
        if on and s0 is None: s0 = x
        if not on and s0 is not None:
            ys = np.where(ink[:, s0:x].any(axis=1))[0]
            groups.append((s0, x - 1, int(ys[0]), int(ys[-1]))); s0 = None
    split = []
    for g in groups:
        if g[3] - g[2] + 1 > text_h and g[1] - g[0] + 1 > int(round(em * 2.6)):
            ext = [(np.where(ink[:, x])[0].max() - np.where(ink[:, x])[0].min() + 1) if ink[:, x].any() else 0 for x in range(g[0], g[1] + 1)]
            edge = next((i for i, e in enumerate(ext) if e >= int(round(em * 1.7)) and i >= 3), None)
            if edge is not None:
                xa, xb = g[0], g[0] + edge - 1
                ys = np.where(ink[:, xa:xb + 1].any(axis=1))[0]
                if len(ys) and ys[-1] - ys[0] + 1 <= text_h:
                    split.append((xa, xb, int(ys[0]), int(ys[-1])))
                    ys2 = np.where(ink[:, g[0] + edge:g[1] + 1].any(axis=1))[0]
                    split.append((g[0] + edge, g[1], int(ys2[0]), int(ys2[-1]))); continue
        split.append(g)
    text = [g for g in split if g[3] - g[2] + 1 <= text_h]
    tall = [g for g in split if g[3] - g[2] + 1 > text_h]
    info = dict(lead=any(g[0] < (text[0][0] if text else 0) for g in tall), trail=any(g[0] > (text[-1][1] if text else 0) for g in tall))
    if not text: return None, info
    xa, xb = text[0][0], text[-1][1]; ya = min(g[2] for g in text); yb = max(g[3] for g in text)
    # 字的範圍往外各放 1 個像素：很淡的邊緣像素也要留著（合成那一側留著它們），圖示那幾欄清成 0
    xa2 = max(0, xa - 1); xb2 = min(W - 1, xb + 1); ya2 = max(0, ya - 1); yb2 = min(reg.shape[0] - 1, yb + 1)
    band = reg[ya2:yb2 + 1, xa2:xb2 + 1].copy()
    for g in tall:
        lo = max(g[0], xa2); hi = min(g[1] + 1, xb2)
        if lo <= hi: band[:, lo - xa2:hi - xa2 + 1] = 0
    return grid.trim(np.round(band * 255.0 / float(bg[0]))), info


def crops(stem, ri, si, lo=0):
    """這一格所有可能的切法：在第 lo 欄像素之後每一個沒有墨的欄切一刀，再加上整格不切。
    「在第一個空欄切開」遇到細的字會切錯：一串 1 的每個 1 後面都有一欄空白，最後一個 1 會被當成後面的圖示切掉。
    驗證（已經知道要比哪個字）的時候不要猜切在哪裡，把每一種切法都給 verify()，讓它取最好的。"""
    p = grid.obs_cell(stem, ri, si)
    if p is None: return []
    ink = (np.abs(p).max(axis=2) > P['ink_th']).any(axis=0)
    out = [p]
    for x in range(max(1, lo), len(ink)):
        if not ink[x] and ink[x - 1]:
            t = grid.trim(p[:, :x])
            if t is not None: out.append(t)
    return out


def cut_after(stem, ri, si, lo, hi, fallback=None):
    """字後面隔一小段空白跟著一個不比字高的小圖示：在第 lo～hi 欄像素之間找第一個沒有墨的欄，從那裡切開。
    lo 設成「字最短也有這麼寬」，hi 設成「字最長到這裡」。找不到空欄就切在 fallback（預設 lo 與 hi 的中間）。"""
    p = grid.obs_cell(stem, ri, si)
    if p is None: return None
    ink = (np.abs(p).max(axis=2) > P['ink_th']).any(axis=0)
    cut = next((x for x in range(lo, min(len(ink), hi)) if not ink[x]), None)
    if cut is None:
        cut = min(len(ink), fallback if fallback is not None else (lo + hi) // 2)
    return grid.trim(p[:, :cut])
