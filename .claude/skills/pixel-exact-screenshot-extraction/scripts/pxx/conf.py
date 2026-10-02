# 工作目錄與「這一批截圖是怎麼畫的」。
# 工作目錄＝環境變數 PXX_WORK，沒設就是目前的目錄。所有中間檔都落在那裡，
# 所以它一定要是一個不進版控的地方（截圖裡的字會原樣出現在 log 與 pkl 裡）。
import json, os

WORK = os.path.abspath(os.environ.get('PXX_WORK') or os.getcwd())

DEFAULTS = dict(
    font="'Microsoft JhengHei UI'",  # CSS font-family，校出來的
    em=5.33,          # 一個 em 佔幾個截圖像素（＝CSS 字級 × 頁面縮放 × DPR；量得到的只有乘積）
    dsf=0.125,        # 合成用的 deviceScaleFactor。越小，每個像素能試的起始位置越多（64/dsf 個）
    color='#000', bg='#fff', weight=400, lang='zh-TW', extra_css='',
    ink_th=4,         # 跟背景差多少才算有墨。觀測與合成兩側要用同一個數字
    line_th=25,       # 切列：一整條像素的中位數比白色暗多少算是分隔線
    col_gap=10,       # 切欄：墨跡之間空幾個像素以上算是兩欄
    min_row_h=8,      # 矮於這個高度的列不是資料列（被截掉的半列、表頭的邊）
)


def wpath(*parts):
    return os.path.join(WORK, *parts)


def load():
    p = dict(DEFAULTS)
    f = wpath('profile.json')
    if os.path.exists(f):
        p.update(json.load(open(f, encoding='utf-8')))
    return p


def save(**changes):
    p = load()
    p.update(changes)
    os.makedirs(WORK, exist_ok=True)
    json.dump(p, open(wpath('profile.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    P.clear(); P.update(p)
    return p


P = load()


def n_phases(dsf=None):
    """版面的最小單位是 1/64 CSS px，所以一個截圖像素裡只有 64/dsf 個不同的起始位置。"""
    return int(round(64 / (dsf or P['dsf'])))


def phases(n=None, dsf=None):
    """全部（n=None）或等距抽 n 個起始位置，單位是截圖像素的小數部分。"""
    full = n_phases(dsf)
    if n is None or n >= full:
        return [k / full for k in range(full)]
    return [k / n for k in range(n)]
