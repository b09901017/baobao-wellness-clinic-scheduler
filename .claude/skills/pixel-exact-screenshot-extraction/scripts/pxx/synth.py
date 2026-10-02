# 合成：叫 Chromium 把一批 (字串, 起始位置) 畫出來，取回每一個的像素小塊。
#
# 三件事只在這裡管，其他模組都不用知道：
#   1. 同時幾個瀏覽器在畫 —— 上限是「整台機器」的，不是這一個行程的（見 _Slot）
#   2. 瀏覽器開著不關、一批一批送進去（見 _Server）；暫時性的截圖失敗就換一個瀏覽器重試
#   3. 畫出來的檔案 —— 預設用完就刪
import atexit, glob, hashlib, json, math, os, queue, re, subprocess, sys, tempfile, threading, time
import numpy as np
from .conf import P, WORK, wpath

HERE = os.path.dirname(os.path.abspath(__file__))


# ---------------------------------------------------------------- 同時數
def budget():
    """整台機器同時最多幾個瀏覽器在畫。預設 2（四核以下 1）。
    一個無頭 Chromium 不只吃一顆核心（排版、點陣化各有自己的執行緒）。實測（12 核 16 緒的筆電）：
    閒置 3%、1 個瀏覽器整機 25%、2 個 43%，而速度只從每秒 970 個磁磚到 1,550 個 —— 多開的收益遞減，
    因為畫完之後把像素讀回來、切成小塊、比對，是 Python 單線在做的。
    PXX_MAXPAR 可以改；改之前先用 selftest.py --load N 量這一台實際吃多少。
    會跑超過十分鐘的工作用 1，或再加 PXX_DUTY=0.5。"""
    v = os.environ.get('PXX_MAXPAR')
    if v:
        return max(1, int(v))
    return 2 if (os.cpu_count() or 4) > 4 else 1


SLOT_DIR = os.path.join(tempfile.gettempdir(), 'pxx-slots')


class _Slot:
    """一個檔案鎖＝一個瀏覽器的名額。鎖在作業系統那一層，所以好幾個行程（好幾個終端機、
    好幾個工作階段）同時跑的時候，加起來也不會超過上限 —— 上限只寫在每個行程自己身上的話，
    三個工作各開四個就是十二個。行程死掉時作業系統會自己放掉鎖，不會留下佔著名額的殭屍。"""

    def __init__(self, i):
        os.makedirs(SLOT_DIR, exist_ok=True)
        self.f = open(os.path.join(SLOT_DIR, 'slot%d.lock' % i), 'a+b')
        self.held = False

    def acquire(self):
        if self.held:
            return False
        try:
            if os.name == 'nt':
                import msvcrt
                self.f.seek(0); msvcrt.locking(self.f.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            return False
        self.held = True
        return True

    def release(self):
        if not self.held:
            return
        if os.name == 'nt':
            import msvcrt
            self.f.seek(0); msvcrt.locking(self.f.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(self.f.fileno(), fcntl.LOCK_UN)
        self.held = False


_slots = None


def _free_slot():
    global _slots
    if _slots is None:
        _slots = [_Slot(i) for i in range(budget())]
    for s in _slots:
        if s.acquire():
            return s
    return None


# ---------------------------------------------------------------- 開著不關的瀏覽器
class _Server:
    """一個 node render.cjs --serve。stdin 送一批、stdout 回一行。"""

    def __init__(self, env):
        self.p = subprocess.Popen(['node', os.path.join(HERE, 'render.cjs'), '--serve'], stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env)
        self.q = queue.Queue()
        threading.Thread(target=self._pump, daemon=True).start()

    def _pump(self):
        for line in self.p.stdout:
            self.q.put(line.decode('utf-8', 'replace').strip())
        self.q.put(None)

    def send(self, spec_path, pref):
        self.p.stdin.write((json.dumps(dict(spec=spec_path, out=pref)) + '\n').encode('utf-8')); self.p.stdin.flush()

    def result(self):
        """None＝還在畫；('ok', '')；('err', 訊息)。"""
        try:
            r = self.q.get_nowait()
        except queue.Empty:
            return None
        if r is None: return ('err', 'renderer exited')
        return ('ok', '') if r == 'ok' else ('err', r)

    def close(self):
        for f in (self.p.stdin.close, self.p.kill):
            try: f()
            except OSError: pass


_idle = []


@atexit.register
def _shutdown():
    while _idle:
        _idle.pop().close()


# ---------------------------------------------------------------- 時間預算
class BudgetExceeded(RuntimeError):
    pass


STATS = dict(batches=0, tiles=0, busy=0.0, retries=0, timeouts=0, repainted=0, blank=0, started=time.time())
_deadline = [None]


def set_deadline(minutes):
    """從現在起最多再畫幾分鐘。到了就丟 BudgetExceeded —— 呼叫端接住、存檔、收工。
    重的那幾步（逐字讀取）一定要設：估錯一個數量級是常態，而機器不會自己停。"""
    _deadline[0] = None if minutes is None else time.time() + minutes * 60


def _rest(elapsed):
    """PXX_DUTY=0.5 ＝畫多久就停多久。長時間的工作用這個把平均負載壓下來。"""
    duty = float(os.environ.get('PXX_DUTY', '1'))
    if 0 < duty < 1:
        time.sleep(elapsed * (1 - duty) / duty)


# ---------------------------------------------------------------- 找 Playwright
def node_modules():
    v = os.environ.get('PXX_NODE_MODULES')
    if v and os.path.isdir(os.path.join(v, 'playwright')):
        return v
    for start in (WORK, os.getcwd(), HERE):
        d = start
        while True:
            c = os.path.join(d, 'node_modules')
            if os.path.isdir(os.path.join(c, 'playwright')):
                return c
            up = os.path.dirname(d)
            if up == d:
                break
            d = up
    raise RuntimeError('找不到 node_modules/playwright。在專案裡 npm i -D playwright && npx playwright install chromium，'
                       '或把 PXX_NODE_MODULES 指到一個裝了 playwright 的 node_modules')


# ---------------------------------------------------------------- 一批的版面
PAGE_TIMEOUT = 60   # 一頁正常是一兩秒。超過這麼久沒回應就當成卡住
MAX_W_CSS, MAX_H_CSS = 12000, 6000   # 一頁最大多少 CSS px
# 頁面太大時，後段有時候不會被畫出來：截圖照樣成功、那幾塊磁磚是空白的，而空白在比對時只是
# 「不吻合」—— 完全安靜，症狀是逐字讀取讀到一半莫名其妙讀不下去。看的是面積。實測（dsf 0.125、兩個瀏覽器同時畫）：
#   12,000 × 31,000：每次都是最後一段空白
#   12,000 × 12,000：約四分之一的頁有空白
#   12,000 × 8,000、12,000 × 6,000、6,000 × 12,000：沒有
# 上限取 12,000 × 6,000，而且不靠它：render_many 最後那一段完整性檢查才是保證。


def _geom(items, prof):
    em, dsf = prof['em'], prof['dsf']
    cw = max(60, int(max(len(t) for t, _ in items) * em * 1.25) + 16)   # 全形字一個 em 寬
    ch = int(math.ceil(em * 1.6)) + 5
    pad = int(math.ceil(em * 0.17)) + 2                                  # line-height:1 時字會往上凸出約 0.17em
    cols = max(1, int(MAX_W_CSS * dsf) // cw)
    rows = max(1, int(MAX_H_CSS * dsf) // ch)
    return cw, ch, pad, cols, rows


def _split(items, prof):
    """一批太大就拆成好幾頁，每一頁都在上限以內。"""
    cw, ch, pad, cols, rows = _geom(items, prof)
    n = cols * rows
    return [items[i:i + n] for i in range(0, len(items), n)]


def _prepare(items, prof, tag, keep_png=False):
    """每個 (字串, 起始位置) 佔一塊磁磚。座標先用截圖像素想，再除以 dsf 換成 CSS px。"""
    dsf = prof['dsf']; em = prof['em']
    cw, ch, pad, cols, rows = _geom(items, prof)
    its, pos = [], []
    for i, (t, ph) in enumerate(items):
        cx = (i % cols) * cw + 6; cy = (i // cols) * ch
        its.append(dict(text=t, x=(cx + ph) / dsf, y=(cy + pad) / dsf))
        pos.append((cx, cy))
    Wd = cols * cw + 10; Hd = ((len(items) - 1) // cols + 1) * ch + 10
    spec = dict(dsf=dsf, fontFamily=prof['font'], fontSizePx=em / dsf, color=prof['color'], bg=prof['bg'], weight=prof['weight'],
                lang=prof['lang'], extraCss=prof.get('extra_css', ''), args=prof.get('chromium_args', []), keepPng=keep_png,
                width=int(Wd / dsf) + 8, height=int(Hd / dsf) + 8, items=its)
    key = hashlib.md5(json.dumps(spec, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:12]
    os.makedirs(wpath('syn'), exist_ok=True)
    return spec, wpath('syn', (tag or 'r') + '_' + key), pos, cw, ch, prof['ink_th']


def _load(pref, pos, cw, ch, ink_th):
    f = glob.glob(glob.escape(pref) + '__*.bgr')[0]
    w, h = map(int, re.search(r'__(\d+)x(\d+)\.bgr$', f).groups())
    a = np.fromfile(f, dtype=np.uint8).reshape(h, w, 3).astype(np.int16)
    bgc = a[0, 0].astype(np.int16)
    th = ink_th * bgc.max() / 255
    out = []
    for cx, cy in pos:
        reg = bgc[None, None, :] - a[cy:cy + ch, cx - 4:cx + cw - 6]   # 正值＝比背景暗
        ink = np.abs(reg).max(axis=2) > th
        if not ink.any():
            out.append(None); continue
        ys = np.where(ink.any(axis=1))[0]; xs = np.where(ink.any(axis=0))[0]
        # dx：第一個有墨的欄離「字串原點所在的那個像素」多遠
        out.append(dict(patch=reg[ys[0]:ys[-1] + 1, xs[0]:xs[-1] + 1].copy(), dy=int(ys[0]), dx=int(xs[0]) - 4))
    return out


def _cleanup(pref):
    for f in glob.glob(glob.escape(pref) + '__*.bgr') + glob.glob(glob.escape(pref) + '.png') + glob.glob(glob.escape(pref) + '.json'):
        try: os.remove(f)
        except OSError: pass


def cache_mb():
    return sum(os.path.getsize(f) for f in glob.glob(wpath('syn', '*'))) / 1e6


def clear_cache():
    for f in glob.glob(wpath('syn', '*')):
        try: os.remove(f)
        except OSError: pass


def _cache_limit():
    return float(os.environ.get('PXX_CACHE_MB', '300'))


def _gc():
    """keep=True 留下來的檔案超過上限（PXX_CACHE_MB，預設 300）時，從最舊的刪到剩一半。"""
    files = sorted(glob.glob(wpath('syn', '*')), key=os.path.getmtime)
    total = sum(os.path.getsize(f) for f in files) / 1e6
    while files and total > _cache_limit() / 2:
        f = files.pop(0)
        try:
            total -= os.path.getsize(f) / 1e6; os.remove(f)
        except OSError:
            pass


# ---------------------------------------------------------------- 主要入口
def render_many(batches, tag=None, keep=False, keep_png=False, _depth=0, **over):
    """batches：好幾批 [(字串, 起始位置), ...]。回傳每一批的結果：每個 item 是
    dict(patch, dy, dx) 或 None（什麼都沒畫出來：只有空白的字串）。patch 是「背景減像素」，還沒套色調對照。
    over 可以蓋掉 profile 的任何一格（font=、em=、color=……），校正時用。"""
    prof = dict(P); prof.update(over)
    pages = []; owner = []
    for bi, b in enumerate(batches):
        for part in _split(b, prof):
            pages.append(part); owner.append(bi)
    preps = [_prepare(pg, prof, tag, keep_png) for pg in pages]
    todo = {}
    for spec, pref, *_ in preps:
        if not glob.glob(glob.escape(pref) + '__*.bgr'):
            todo[pref] = spec
    if keep and cache_mb() > _cache_limit():
        _gc()
    env = dict(os.environ, PXX_NODE_MODULES=node_modules())

    t0 = time.time()
    pending = [(spec, pref, 0) for pref, spec in todo.items()]; running = []
    try:
        while pending or running:
            if _deadline[0] is not None and time.time() > _deadline[0] and pending:
                raise BudgetExceeded('超過這一輪設定的時間上限')
            while pending:
                slot = _free_slot()
                if slot is None:
                    break
                spec, pref, tries = pending.pop(0)
                json.dump(spec, open(pref + '.json', 'w', encoding='utf-8'), ensure_ascii=False)
                try:
                    srv = _idle.pop() if _idle else _Server(env)
                    srv.send(pref + '.json', pref)
                except OSError:      # 那個瀏覽器已經死了：下一圈換一個新的
                    slot.release(); pending.append((spec, pref, tries + 1)); continue
                running.append((srv, spec, pref, tries, slot, time.time()))
            still = []
            for srv, spec, pref, tries, slot, since in running:
                r = srv.result()
                if r is None and time.time() - since > PAGE_TIMEOUT:
                    STATS['timeouts'] += 1; r = ('err', 'timeout')     # 瀏覽器卡住了（不回成功也不回失敗）：當成失敗，換一個重來
                if r is None:
                    still.append((srv, spec, pref, tries, slot, since)); continue
                slot.release()
                if r[0] == 'ok':
                    _idle.append(srv); continue
                srv.close()
                if tries >= 4:
                    raise RuntimeError('render failed: ' + r[1])
                # 機器忙的時候 Chromium 偶爾回「Unable to capture screenshot」：等一下、換一個瀏覽器再來一次就好
                STATS['retries'] += 1; time.sleep(1.0 + tries); pending.append((spec, pref, tries + 1))
            running = still
            if pending or running:
                time.sleep(0.01)
    finally:
        for srv, _, pref, _, slot, _ in running:
            srv.close(); slot.release()
    loaded = {}
    for spec, pref, pos, cw, ch, ink_th in preps:
        if pref not in loaded: loaded[pref] = _load(pref, pos, cw, ch, ink_th)
    outs = [[] for _ in batches]
    for (spec, pref, *_), bi in zip(preps, owner):
        outs[bi] += loaded[pref]
    if not keep:
        for pref in loaded: _cleanup(pref)   # 一頁好幾 MB；全部留著的話幾個小時就是十幾 GB
    el = time.time() - t0
    if todo:
        STATS['batches'] += len(todo); STATS['tiles'] += sum(len(sp['items']) for sp in todo.values()); STATS['busy'] += el
        _rest(el)
    # 完整性檢查：有字的字串一定要畫出墨。一頁裡只要有一塊該有墨卻空白，整頁都不能信
    # （沒畫到的區域是一整塊，邊界上的磁磚會是「畫了一半」的字 —— 不是空白，檢查不出來），
    # 所以整頁拆成更小的頁重畫。拆到最小還是空白的才是真的空白（字型裡沒有那個字、零寬字元）。
    if _depth < 3:
        bad = []; at = [0] * len(batches)
        for pg, bi in zip(pages, owner):
            lo = at[bi]; at[bi] += len(pg)
            if any(outs[bi][lo + i] is None and t.strip() for i, (t, _) in enumerate(pg)):
                bad.append((bi, lo, pg))
        if bad:
            STATS['repainted'] += sum(len(pg) for _, _, pg in bad)
            parts = []
            for bi, lo, pg in bad:
                q = max(1, len(pg) // 4)
                parts += [(bi, lo + k, pg[k:k + q]) for k in range(0, len(pg), q)]
            redo = render_many([pg for _, _, pg in parts], tag=(tag or 'r') + 'x', _depth=_depth + 1, **over)
            for (bi, lo, pg), r in zip(parts, redo):
                outs[bi][lo:lo + len(pg)] = r
    else:
        left = [t for bi, b in enumerate(batches) for i, (t, _) in enumerate(b) if outs[bi][i] is None and t.strip()]
        if left:
            if not STATS['blank']:
                print('  ! 這些字串單獨畫也沒有墨（字型沒有那個字？）。把那個字從字集拿掉，不然每一頁都要多畫一倍多：', left[:5], file=sys.stderr, flush=True)
            STATS['blank'] += len(left)
    return outs


def render(items, **kw):
    return render_many([items], **kw)[0]


def stats():
    s = dict(STATS); s['wall'] = time.time() - s.pop('started'); s['budget'] = budget()
    return s


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    print('work', WORK); print('node_modules', node_modules()); print('同時上限', budget(), '｜快取 %.0f MB' % cache_mb())
