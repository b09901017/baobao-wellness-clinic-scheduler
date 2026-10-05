# 一批截圖的工作檔範本。複製到工作目錄（不進版控的地方）、照這一批的欄位改，一步一步跑：
#   python job.py status            用顏色分的那一欄
#   python job.py closed            候選列得完的欄位（日期、時段……）
#   python job.py open <欄位名> [分鐘] [retry]   候選列不完的欄位：已知詞彙 → 逐字讀 → 反套（重，有時間上限，再跑一次接著做）
#   python job.py assemble          彙整成一列一筆＋互相對
#   python job.py verify            最後一道：每一格重畫再比一次
# 每一步都把結果存成檔案，下一步只讀檔案；哪一步斷了就從那一步重跑。
import collections, datetime, json, os, pickle, sys
sys.path.insert(0, r'<這個 skill 的 scripts 目錄的絕對路徑>')
sys.stdout.reconfigure(encoding='utf-8')
from pxx import grid, badges
from pxx.conf import P, phases, wpath
from pxx.match import calibrate, calibrate_prefix, pick_phases, spread, decode, fine_decode, verify_local, EXACT, CLOSE, LOCAL_OK
from pxx.discover import Field
from pxx.reader import check, LONG
from pxx.charset import TEXT, TEXT_FULL, TEXT_ALL, DIGITS, L1, L2, CJK

# ---------------------------------------------------------------- 1. 欄位對應
# 每張圖各寫一份。截圖時捲動的位置不一樣、有的欄整欄沒有字就不會被切出來，
# 所以同一個欄位在每張圖的索引常常不一樣 —— 照 slice_grid.py 印的統計一張一張認。
BASE = {0: 'status', 1: 'date', 2: 'time', 3: 'name', 4: 'id'}
COLMAP = {
    'shot1': {**BASE, 5: 'item', 6: 'room', 7: 'note'},
    'shot2': {**BASE, 5: 'item', 6: 'note'},          # 這一張整欄沒有 room
}


def seg_of(stem, field):
    return [i for i, f in COLMAP.get(stem, {}).items() if f == field]   # 沒列在 COLMAP 的圖一律跳過


def save(name, obj):
    pickle.dump(obj, open(wpath(name + '.pkl'), 'wb'))


def load(name):
    return pickle.load(open(wpath(name + '.pkl'), 'rb'))


# ---------------------------------------------------------------- 2. 用顏色分的欄位
PALETTE = {'完成': (64, 158, 255), '取消': (245, 108, 108), '確認': (103, 194, 58), '失約': (230, 162, 60)}   # 先跑 badges.colors() 看實際的值


def run_status():
    seg = lambda stem: (seg_of(stem, 'status') or [None])[0]
    print(badges.colors(seg))
    out = badges.classify(seg, PALETTE)
    print(collections.Counter(v['label'] for v in out.values()))
    save('dec_status', out)


# ---------------------------------------------------------------- 3. 候選列得完的欄位
def closed_field(field, cands, prefix=None, more=None):
    """每張圖：先校這一欄的起始位置，再用校好的位置窮舉候選，最後把還差一點的格子在所有位置上再比一次。
    prefix：整欄共同的開頭（'2026-'、'0000'）。有的話不用先知道任何一格的全文就能校。
    cands 放常見的（幾百個以內）；more 是完整的那一份，只拿去比 cands 沒吻合的格子。
    候選一開始就給一萬個的話，每張圖要畫幾十萬個磁磚，而九成的格子用前幾百個就吻合了。"""
    out = {}
    for stem in grid.stems():
        for si in seg_of(stem, field):
            rows = [ri for ri in grid.rows_of(stem) if grid.obs_cell(stem, ri, si) is not None]
            obs = [grid.obs_cell(stem, ri, si) for ri in rows]
            if not obs: continue
            if prefix:
                # 短前綴只能把起始位置收到一段範圍；整個字串吻合的位置是其中更窄的一段。
                # 所以這一段要整段拿去比（spread），不能只抽頭中尾三個（會漏，漏的那幾格誤差是 5 而不是 0.8）
                good, worst = calibrate_prefix(obs, prefix, tag='c_' + field)
                ph = spread(good)
                res = decode(obs, cands, ph, tag='d_' + field)
            else:
                # 沒有共同的開頭：先用 64 個位置粗比，拿明顯吻合的當錨點校，再用校好的位置比一次
                first = decode(obs, cands, phases(64), tag='a_' + field)
                A = []; seen = set()
                for o, m in zip(obs, first):
                    if m and m[0][0] < 2.2 and m[0][1] not in seen: seen.add(m[0][1]); A.append((o, m[0][1]))
                if not A:
                    print('%s %s：常見候選一格都沒吻合，校不了起始位置（候選不對、欄位認錯、或字型字級還沒校好）' % (stem, field)); continue
                good, worst, _ = calibrate(A[:12], tag='c_' + field)
                ph = spread(good)
                res = decode(obs, cands, ph, tag='d_' + field)
                res = [b if b and (not a or b[0][0] <= a[0][0]) else a for a, b in zip(first, res)]
            hard = [i for i, m in enumerate(res) if not m or m[0][0] >= EXACT]
            if more and hard:
                for i, m in zip(hard, decode([obs[i] for i in hard], more, ph, tag='m_' + field)):
                    if m and (not res[i] or m[0][0] < res[i][0][0]): res[i] = m
            for i, m in enumerate(res):   # 卡在邊界上的：最接近的三個候選在所有位置上再比
                if m and EXACT <= m[0][0] < 8:
                    r = fine_decode(obs[i], [l for _, l in m[:3]], tag='f_' + field)
                    if r[0][0] < m[0][0]: res[i] = r
            for ri, m in zip(rows, res): out[(stem, ri, si)] = m
            bad = [ri for ri, m in zip(rows, res) if not m or m[0][0] >= EXACT]
            print('%s %s：起始位置 %.3f～%.3f（%d 個）錨點最差 %.2f｜%d 格，沒吻合 %d' % (stem, field, good[0], good[-1], len(good), worst, len(rows), len(bad)), flush=True)
    errs = [m[0][0] for m in out.values() if m]; margins = [m[1][0] - m[0][0] for m in out.values() if len(m) > 1]
    print('%s：%d 格，最大誤差 %.2f，第一名與第二名最小的差距 %.2f' % (field, len(errs), max(errs), min(margins) if margins else 99))
    save('dec_' + field, out)
    return out


def run_closed():
    d0 = datetime.date(2026, 1, 1)
    closed_field('date', [(d0 + datetime.timedelta(days=i)).isoformat() for i in range(366)], prefix='2026-')
    hm = lambda m: '%02d:%02d' % (m // 60, m % 60)
    span = lambda step, durs: ['%s - %s' % (hm(s), hm(s + d)) for s in range(7 * 60, 21 * 60 + 1, step) for d in durs]
    closed_field('time', span(15, (15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 180)),      # 常見的：十五分鐘一格
                 more=span(5, range(5, 301, 5)))                                           # 完整的：五分鐘一格、最長五小時


# ---------------------------------------------------------------- 4. 候選列不完的欄位
OPEN = {
    # 欄位: dict(vocab=猜得到的詞, alphabet=逐字讀的字集, fallbacks=讀不下去時依序換的字集, maxlen=最多幾個字, prefix=共同開頭)
    'item': dict(vocab=['課程A 60', '課程B 30'], alphabet=TEXT, fallbacks=[TEXT_FULL], maxlen=12),
    'room': dict(vocab=[], alphabet=TEXT, maxlen=8),
    'id':   dict(vocab=[], alphabet=DIGITS, maxlen=10, prefix='0000'),
    'name': dict(vocab=[], alphabet=L1, fallbacks=[L1 + L2, CJK], maxlen=6),   # vocab 可以從別的資料來源灌：只是候選，算不算數由像素決定
    # 自由文字最貴，放最後。free=True：短的先讀、maxlen 照格子的寬度算、讀完之後做換字比對與分段驗證
    'note': dict(vocab=[], alphabet=TEXT, fallbacks=[TEXT_FULL, TEXT_ALL], maxlen=None, free=True),
}


def run_open(name, minutes=10, retry=False):
    """再跑一次就是接著做：讀出來的詞從 log 撿回來，讀到一半的格子從停下來的那個字接著讀。
    retry：所有字集都試過還讀不完的格子，退兩個字再試一次。"""
    cfg = dict(OPEN[name]); free = cfg.pop('free', False)
    f = Field(name, lambda stem: seg_of(stem, name), **cfg)
    f.run(max_minutes=minutes, order='short' if free else 'common', retry_failed=retry).finalize()
    if free: f.refine_suspects(TEXT_ALL)     # 選到長得像的另一個符號、長得幾乎一樣的字：只有這一步看得出來
    c, bad = f.summary()
    print('%s：吻合 %d 格、%d 種值；沒讀出 %d 格（讀到一半 %d、讀不完 %d）' % (name, sum(c.values()), len(c), bad, len(f.partials), len(f.failed)))


# ---------------------------------------------------------------- 5. 彙整與互相對
def run_assemble():
    rows = []; res = {}; todo = set()
    for field in sorted(set(f for m in COLMAP.values() for f in m.values())):
        for kind in ('dec_', 'disc_'):
            if os.path.exists(wpath(kind + field + '.pkl')): res[field] = (kind, load(kind + field))
        if field not in res: todo.add(field)
    if todo: print('還沒做的欄位（這一輪先留空）：', sorted(todo))
    for stem in grid.stems():
        if stem not in COLMAP: continue
        for n, ri in enumerate(grid.rows_of(stem)):
            r = dict(src=stem, row=n + 1, _err={}, _issues=[])
            for field in sorted(set(COLMAP[stem].values())):
                if field in todo: continue
                si = seg_of(stem, field)[0]; kind, data = res[field]
                if field == 'status':
                    r[field] = data[(stem, ri)]['label']
                    if r[field] in (None, '?'): r['_issues'].append('status 的顏色認不得 %s' % (data[(stem, ri)]['rgb'],))
                    continue
                if kind == 'dec_':
                    m = data.get((stem, ri, si)); text, err = (m[0][1], m[0][0]) if m else (None, None)
                    if m and m[0][0] >= CLOSE: r['_issues'].append('%s 候選裡沒有吻合的（最接近的誤差 %.1f）' % (field, m[0][0]))
                else:
                    c = data['cells'].get((stem, ri, si)); text, err = (c['text'], c['err']) if c else (None, None)
                    if c and c['text'] is None:
                        r['_issues'].append('%s 有字沒讀出（約 %d 個字%s）' % (field, round(c['width'] / P['em']), '，開頭讀到「%s」' % c['partial'] if c.get('partial') else ''))
                if err is not None and err >= CLOSE: text = None
                if err is not None and EXACT <= err < CLOSE: r['_issues'].append('%s 只差一兩個像素（誤差 %.2f）' % (field, err))
                r[field] = text
                if err is not None: r['_err'][field] = round(float(err), 2)
            rows.append(r)
    # 互相對。各欄是各自獨立讀的，所以它們之間的關係是免費的檢查：
    for stem in COLMAP:   # 清單本來就照日期、開始時間排 → 讀出來的也要是排好的（同一個開始時間的先後不保證）
        ds = [(r['date'], r['time'][:5]) for r in rows if r['src'] == stem and r.get('date') and r.get('time')]
        if ds != sorted(ds): print('!', stem, '日期與開始時間不是遞增的：有一格讀錯，或這張圖不是照時間排的')
    one = collections.defaultdict(set)   # 一個編號只該對到一個名字
    for r in rows:
        if r.get('id') and r.get('name'): one[r['id']].add(r['name'])
    for k, v in one.items():
        if len(v) > 1: print('! 編號', k, '對到', len(v), '個名字：回頭逐像素確認是原圖真的這樣寫，還是讀錯')
    json.dump(rows, open(wpath('rows.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('rows.json：', len(rows), '筆；有沒讀出或要再看的：', sum(1 for r in rows if r['_issues']))


# ---------------------------------------------------------------- 6. 最後一道
def run_verify():
    """每一格兩個數字：整格誤差、最差的那一個字寬的誤差（區域誤差）。整格誤差是平均，會把單一個錯字稀釋掉。
    長字串（超過 LONG 個字寬）不在同一個起始位置上整格比 —— 正確的也會在尾巴對不上 —— 改成一步一步對（reader.check）。"""
    rows = json.load(open(wpath('rows.json'), encoding='utf-8')); short = []; ver = {}
    for r in rows:
        ri = grid.rows_of(r['src'])[r['row'] - 1]
        for field, text in r.items():
            if field in ('src', 'row', 'status') or field.startswith('_') or not text: continue
            o = grid.obs_cell(r['src'], ri, seg_of(r['src'], field)[0]); key = (r['src'], r['row'], field)
            if o is not None and o.shape[1] > LONG * P['em']:
                ck = check(o, text); ver[key] = (ck['err'], ck['err'], ck['at'])
            else:
                short.append((key, o, text))
    ver.update(verify_local(short))
    json.dump({'%s|%d|%s' % k: v for k, v in ver.items()}, open(wpath('verify.json'), 'w'), indent=1)
    e = [v[0] for v in ver.values()]; bad = {k: v for k, v in ver.items() if v[0] >= EXACT or v[1] > LOCAL_OK}
    print('驗證 %d 格｜整格誤差 < %.1f：%d｜%.1f～%.1f：%d｜更大：%d｜區域誤差 > %.1f：%d' % (
        len(e), EXACT, sum(x < EXACT for x in e), EXACT, CLOSE, sum(EXACT <= x < CLOSE for x in e), sum(x >= CLOSE for x in e),
        LOCAL_OK, sum(v[1] > LOCAL_OK for v in ver.values())))
    for k, v in sorted(bad.items(), key=lambda kv: -max(kv[1][0], kv[1][1]))[:20]:
        print('  !', k, '整格 %.2f 區域 %.2f（x=%d）' % v)


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'status': run_status()
    elif cmd == 'closed': run_closed()
    elif cmd == 'open': run_open(sys.argv[2], float(sys.argv[3]) if len(sys.argv) > 3 else 10, retry='retry' in sys.argv)
    elif cmd == 'assemble': run_assemble()
    elif cmd == 'verify': run_verify()
    else: print('用法見檔頭')
