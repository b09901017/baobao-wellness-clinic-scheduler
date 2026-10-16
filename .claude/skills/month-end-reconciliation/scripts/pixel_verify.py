# 逐像素驗證「用看的抄」出來的每一格（Abovee 預約清單、100% 左右的截圖）。
#
#   python pixel_verify.py calibrate --shots <截圖資料夾> --abovee <abovee-抄的.json> --work <工作目錄> [--shared <共用校正資料夾>]
#   python pixel_verify.py verify    --shots <截圖資料夾> --abovee <abovee-抄的.json> --work <工作目錄> --out <逐像素.json>
#                                    [--shared <共用校正資料夾>] [--vocab <候選字.json>]
#
# 渲染、比對、校正全部用 pixel-exact-screenshot-extraction 那一支 skill 的 pxx（同一個 repo 裡）。這裡只多做三件事：
#
# 1. **不靠固定的欄位置找格子**。Abovee 的表格照那一頁的內容自動調欄寬，每一頁的欄位 x 都不一樣，而且大部分截圖沒有表頭。
#    所以一列切成一塊一塊有墨的區域，每一格「抄到的字」重畫之後在那一列裡找吻合的那一塊；找到的位置要照欄位的順序排
#    （同一個字串出現在兩欄時 —— 病歷號與實際扣課病歷號 —— 靠順序分）。
# 2. **抄錯的換一個**：抄的字對不上，就拿整個月同一欄出現過的字、加上 app 裡的名字與病歷號（`--vocab`）當候選再比一次。
#    剛好一個吻合才換，而且記下「抄的是什麼、像素說是什麼」。像素說了算 —— 候選從哪裡來不影響判準。
# 3. **預約狀態看徽章的顏色**：同一種狀態的徽章顏色要一樣、不同狀態要分得開，每一列的顏色要落在它抄的那一種。
#
# 另外一個免費的檢查：課程與預約來源之間（合併扣課、實際扣課病歷號、關係那三欄）有墨、抄本卻是空的 → 那一列不算驗證過。
#
# 校正（字型、字級、色調）存在工作目錄的 profile.json 與 lut.npy；`--shared` 給了就順便存一份到那裡，下個月同樣縮放的截圖直接沿用。
# 截圖裡的字會原樣出現在工作目錄的中間檔裡 —— 工作目錄一定要在 .local/ 底下。
import argparse, json, os, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PXX = os.path.abspath(os.path.join(HERE, '..', '..', 'pixel-exact-screenshot-extraction', 'scripts'))

FIELDS = ['date', 'time', 'name', 'chartNo', 'course', 'merged', 'actualChartNo', 'relation', 'source', 'room', 'resource', 'cancelReason']
# 課程與預約來源之間只有這三欄（Abovee 的欄位順序）；其餘沒抄的欄（身份別、性別、電話、交通方式、車牌、東購、中心紀錄）不在這一段
DEDUCT = ['merged', 'actualChartNo', 'relation']
EXACT, CLOSE, LOCAL_OK = 1.1, 1.6, 2.0
PER_SHOT = {}


def setup(work, shared):
    os.makedirs(work, exist_ok=True)
    os.environ['PXX_WORK'] = os.path.abspath(work)
    if shared:
        for f in ('profile.json', 'lut.npy'):
            src, dst = os.path.join(shared, f), os.path.join(work, f)
            if os.path.exists(src) and not os.path.exists(dst):
                shutil.copy(src, dst)
    sys.path.insert(0, PXX)
    sys.stdout.reconfigure(encoding='utf-8')


def clean(v):
    return '' if v is None or v == '-' else str(v).replace('??', '').strip()


# ---------- 切：一張圖 → 資料列 → 一塊一塊有墨的區域 ----------

def shot_rows(stem, n_expected):
    import numpy as np
    from pxx import grid, img
    a = img.load(stem).astype(np.int16)
    bands = [(y0, y1) for y0, y1 in grid.bands(a) if y1 - y0 + 1 >= 20]
    if not bands:
        return a, None, '切不出任何一列'
    med = float(np.median([y1 - y0 + 1 for y0, y1 in bands]))
    # 多出來的先拿掉頭尾比較矮的（表頭、被截掉一半的列）
    while len(bands) > n_expected:
        top, bot = bands[0], bands[-1]
        ht, hb = top[1] - top[0] + 1, bot[1] - bot[0] + 1
        if min(ht, hb) >= 0.8 * med:
            break
        bands = bands[1:] if ht <= hb else bands[:-1]
    if len(bands) != n_expected:
        return a, None, '切出 %d 列，抄本是 %d 列' % (len(bands), n_expected)
    return a, bands, None


def segments(a, y0, y1):
    """一列裡每一塊有墨的區域：(x0, x1, 觀測小塊（正規化到白底、裁好）, 原圖那一塊)。"""
    import numpy as np
    from pxx.conf import P
    from pxx.grid import norm_patch, trim
    band = a[y0:y1 + 1]
    bg = np.median(band.reshape(-1, 3), axis=0).astype(np.int16)
    diff = bg[None, None, :] - band
    ink = np.abs(diff).max(axis=2) > P['ink_th']
    colink = ink.any(axis=0)
    segs, s, last = [], None, -99
    for x in range(len(colink)):
        if colink[x]:
            if s is None:
                s = x
            elif x - last > P['col_gap']:
                segs.append((s, last)); s = x
            last = x
    if s is not None:
        segs.append((s, last))
    out = []
    for x0, x1 in segs:
        raw = diff[:, x0:x1 + 1]
        p = trim(norm_patch(raw, max(1, int(bg[0]))))
        if p is not None:
            out.append(dict(x0=x0, x1=x1, obs=p, region=band[:, x0:x1 + 1], lstrip=lstrip_colored(p)))
    return out, bg


def lstrip_colored(p):
    """那一塊最前面是彩色的圖示（名字前面的蛋糕）、中間空一段才是字 → 回字那一段；不是這種形狀回 None。"""
    import numpy as np
    from pxx.conf import P
    from pxx.grid import trim
    cols = (np.abs(p).max(axis=2) > P['ink_th']).any(axis=0)
    x = 0
    while x < p.shape[1] and cols[x]:
        x += 1
    if x == 0 or x >= p.shape[1] or not colored(p[:, :x]):
        return None
    while x < p.shape[1] and not cols[x]:
        x += 1
    return trim(p[:, x:]) if x < p.shape[1] else None


def colored(patch):
    """這一塊是不是彩色的東西（圖示、按鈕），不是黑字。
    **看整塊的平均色，不看每個像素**：ClearType 的黑字每個邊緣像素都偏紅或偏藍（中位數的色差 90～110，跟圖示一樣高），
    但紅邊藍邊互相抵掉，整塊平均是灰的（比例 0.0～0.15）；藍色按鈕、蛋糕圖示整塊平均是彩色的（0.9 以上）。"""
    import numpy as np
    from pxx.conf import P
    inkm = np.abs(patch).max(axis=2) > P['ink_th']
    if not inkm.any():
        return False
    v = patch[inkm].mean(axis=0)
    return float((v.max() - v.min()) / max(float(v.max()), 1.0)) > 0.5


# ---------- 畫：每個字串在 64 個起始位置（100% 縮放的版面單位是 1/64 px）上的不同樣子 ----------

def patterns(texts, phases_n=64):
    from pxx import synth
    from pxx.conf import phases
    from pxx.match import apply_lut
    texts = [t for t in dict.fromkeys(texts) if t]
    PH = phases(phases_n)
    res = {}
    per = 12
    groups = [texts[i:i + per] for i in range(0, len(texts), per)]
    outs = synth.render_many([[(t, p) for t in g for p in PH] for g in groups], tag='mev', keep=False) if groups else []
    for g, o in zip(groups, outs):
        for ti, t in enumerate(g):
            u = {}
            for x in o[ti * len(PH):(ti + 1) * len(PH)]:
                if x is None:
                    continue
                p = apply_lut(x['patch'])
                u[(p.shape, p.tobytes())] = p
            res[t] = list(u.values())
    return res


def match_seg(seg, pats):
    """一塊觀測對一個字串的所有樣子：(整格誤差, 區域誤差)。觀測比字串寬（名字後面黏著按鈕）時只比左邊那一段，
    但那一段後面要先空兩欄、剩下的要是彩色的（按鈕、圖示）—— 不然「SIS 6」會吻合「SIS 60」的前半。"""
    import numpy as np
    from pxx.conf import P
    from pxx.grid import trim
    from pxx.match import perr, local_err
    best = (999.0, 999.0)
    for o in [x for x in (seg['obs'], seg.get('lstrip')) if x is not None]:
        best = min(best, _match_obs(o, pats))
    return best


def _match_obs(o, pats):
    import numpy as np
    from pxx.conf import P
    from pxx.grid import trim
    from pxx.match import perr, local_err
    best = (999.0, 999.0)
    for s in pats:
        cands = []
        if abs(o.shape[1] - s.shape[1]) <= 1 and abs(o.shape[0] - s.shape[0]) <= 2:
            cands.append(o)
        elif o.shape[1] > s.shape[1] + 2:
            w = s.shape[1] + 1
            gap = np.abs(o[:, w:w + 2]).max(axis=2) > P['ink_th']
            rest = o[:, w + 2:]
            if not gap.any() and (rest.shape[1] == 0 or colored(rest) or not (np.abs(rest).max(axis=2) > P['ink_th']).any()):
                win = trim(o[:, :w])
                if win is not None:
                    cands.append(win)
        for c in cands:
            e = perr(c, s)
            if e < best[0]:
                best = (e, local_err(c, s)[1] if e < 999 else 999.0)
    return best


# ---------- 徽章的顏色 ----------

def badge_color(seg):
    import numpy as np
    r = seg['region'].astype(np.int16)
    chroma = r.max(axis=2) - r.min(axis=2)
    # 徽章的底色：不是白字、也不是列的底色（白或淺灰）的那些像素。灰色的徽章也算得到
    m = (r.max(axis=2) < 225) | (chroma > 30)
    if m.sum() < 20:
        return None
    return [float(v) for v in np.median(r[m], axis=0)]


def check_badges(rows):
    """rows：[(key, 抄的狀態, 顏色)]。同一種狀態的顏色要聚在一起、不同狀態要分得開。"""
    import numpy as np
    by = {}
    for _, st, c in rows:
        if c is not None and st:
            by.setdefault(st, []).append(c)
    centers = {st: np.median(np.array(cs), axis=0) for st, cs in by.items()}
    out = {}
    for key, st, c in rows:
        if c is None or not st or st not in centers:
            out[key] = dict(ok=False, why='徽章沒有顏色或沒抄到狀態')
            continue
        d = {k: float(np.abs(np.array(c) - v).max()) for k, v in centers.items()}
        near = min(d, key=d.get)
        others = [v for k, v in d.items() if k != st]
        sep = min(others) if others else 999.0
        ok = near == st and d[st] <= 12 and sep >= 30
        out[key] = dict(ok=ok, dist=round(d[st], 1), nearestOther=round(sep, 1),
                        why=None if ok else ('顏色比較像「%s」' % near if near != st else '跟別種狀態的顏色太接近，分不出來'))
    return out, {k: [round(x) for x in v] for k, v in centers.items()}


# ---------- 校正 ----------

def anchors_from(shots, rows_by_shot, limit_shots=3):
    """校正用的錨點：前幾張圖的日期與時段（格式最確定、整欄都有）。位置照順序：徽章之後第一塊是日期、第二塊是時段。"""
    from pxx import img
    out = []
    for stem in list(rows_by_shot)[:limit_shots]:
        recs = rows_by_shot[stem]
        a, bands, why = shot_rows(stem, PER_SHOT.get(stem + '.png', len(recs)))
        if why:
            continue
        for r in recs:
            y0, y1 = bands[r['row'] - 1]
            segs, _ = segments(a, y0, y1)
            text_h = sorted(g['obs'].shape[0] for g in segs)[len(segs) // 2] if segs else 0
            texty = segs[1:] if segs and segs[0]['obs'].shape[0] >= 1.6 * text_h else segs
            if len(texty) >= 2 and len(clean(r['date'])) == 10 and len(clean(r['time'])) >= 11:
                out.append((texty[0]['obs'], clean(r['date'])))
                out.append((texty[1]['obs'], clean(r['time'])))
    return out


def cmd_calibrate(opt, recs_by_shot):
    """字型照 Abovee 的（Noto Sans TC）、字級從日期的寬度粗估，再掃：粗 → 色調 → 細 → 色調 → check。
    錨點只拿第一張的日期與時段（十幾個不同的字串就夠），起始位置只試 64 個（100% 縮放的版面單位是 1/64 px）——
    第一版拿三張圖、每個字級試 512 個位置，跑了十分鐘以上還沒完。"""
    import calibrate as cal
    from pxx import conf
    A = anchors_from(opt.shots, recs_by_shot, limit_shots=1)
    if len(A) < 6:
        A = anchors_from(opt.shots, recs_by_shot, limit_shots=3)
    if len(A) < 6:
        print('錨點太少（%d 個）：切不出日期與時段。照 pixel-exact-screenshot-extraction 的第 2 步手動校。' % len(A))
        return 1
    cal.anchors = lambda: A
    widths = sorted(o.shape[1] for o, t in A if len(t) == 10)
    em0 = round(widths[len(widths) // 2] / 5.17, 1)   # 「2026-10-01」大約 5.17 em 寬（Noto Sans TC）
    conf.save(font=opt.font, em=em0)
    print('錨點 %d 個（%d 種字串）；字型 %s；字級粗估 %.1f' % (len(A), len(set(t for _, t in A)), opt.font, em0), flush=True)
    best = pick_em(cal, em0 - 0.4, em0 + 0.4, 0.1)
    conf.save(em=best)
    print('字級（粗）%.2f' % best, flush=True)
    cal.cmd_lut([])
    best = pick_em(cal, best - 0.06, best + 0.06, 0.02)
    conf.save(em=best)
    print('字級（細）%.2f' % best, flush=True)
    cal.cmd_lut([])
    if opt.shared:
        os.makedirs(opt.shared, exist_ok=True)
        for f in ('profile.json', 'lut.npy'):
            shutil.copy(os.path.join(os.environ['PXX_WORK'], f), os.path.join(opt.shared, f))
        print('校正存了一份到 %s（下次同樣縮放的截圖直接用）' % opt.shared)
    return 0


def pick_em(cal, lo, hi, step):
    import numpy as np
    from pxx.conf import phases
    A = cal.anchors(); texts = sorted(set(t for _, t in A))
    best, v = None, lo
    while v <= hi + 1e-9:
        e = cal.score(A, cal.render(texts, phases(64), em=v), strict=True)
        key = (-sum(x < EXACT for x in e), float(np.mean(e)))
        if best is None or key < best[0]:
            best = (key, round(v, 4))
        v += step
    return best[1]


# ---------- 驗證 ----------

def cmd_verify(opt, recs_by_shot):
    from pxx import synth
    vocab_extra = json.load(open(opt.vocab, encoding='utf-8')) if opt.vocab else {}
    # 一張一張切
    shots = {}
    for stem, recs in recs_by_shot.items():
        a, bands, why = shot_rows(stem, opt.per_shot.get(stem + '.png', len(recs)))
        shots[stem] = dict(a=a, bands=bands, why=why, recs=recs)

    # 要畫的字：抄到的每一格＋每一欄的候選（整個月這一欄出現過的字＋--vocab）
    vocab = {f: set() for f in FIELDS}
    for recs in recs_by_shot.values():
        for r in recs:
            for f in FIELDS:
                v = clean(r.get(f))
                if v and '??' not in str(r.get(f)):
                    vocab[f].add(v)
    for f, words in vocab_extra.items():
        if f in vocab:
            vocab[f].update(w for w in words if w)
    texts = set()
    for recs in recs_by_shot.values():
        for r in recs:
            texts.update(clean(r.get(f)) for f in FIELDS)
    for words in vocab.values():
        texts.update(words)
    texts.discard('')
    print('要畫 %d 個不同的字串（每個 64 個起始位置）' % len(texts), flush=True)
    pats = patterns(sorted(texts))

    out_rows = []
    badge_rows = []
    for stem, s in shots.items():
        for i, r in enumerate(s['recs']):
            key = '%s#%d' % (r['src'], r['row'])
            rec = dict(src=r['src'], row=r['row'], cells={}, notes=[])
            out_rows.append(rec)
            if s['why']:
                rec['notes'].append(s['why'])
                for f in FIELDS:
                    if clean(r.get(f)):
                        rec['cells'][f] = dict(ok=False, value=clean(r.get(f)), why=s['why'])
                rec['cells']['status'] = dict(ok=False, value=clean(r.get('status')), why=s['why'])
                continue
            y0, y1 = s['bands'][r['row'] - 1]
            segs, _ = segments(s['a'], y0, y1)
            text_h = sorted(g['obs'].shape[0] for g in segs)[len(segs) // 2] if segs else 0
            badge = segs[0] if segs and segs[0]['obs'].shape[0] >= 1.6 * text_h else None
            badge_rows.append((key, clean(r.get('status')), badge_color(badge) if badge else None))
            cursor = badge['x1'] if badge else -1
            used = set()
            where = {}
            for f in FIELDS:
                seen = clean(r.get(f))
                if not seen and '??' not in str(r.get(f) or ''):
                    continue
                cand = [(j, g) for j, g in enumerate(segs) if g['x0'] > cursor and j not in used]
                res = best_in(cand, pats.get(seen, [])) if seen else None
                cell = dict(value=seen)
                if res and res[1] < CLOSE and res[2] <= LOCAL_OK:
                    j, e, loc = res
                    cell.update(ok=True, err=round(e, 2), local=round(loc, 2), x=[segs[j]['x0'], segs[j]['x1']])
                else:
                    # 抄的字對不上：同一欄的候選裡找剛好一個吻合的
                    alts = []
                    for w in sorted(vocab[f]):
                        if w == seen:
                            continue
                        rr = best_in(cand, pats.get(w, []))
                        if rr and rr[1] < EXACT and rr[2] <= LOCAL_OK:
                            alts.append((rr[1], w, rr))
                    alts.sort()
                    if len(alts) == 1 or (len(alts) > 1 and alts[1][0] - alts[0][0] >= 2):
                        e, w, (j, _, loc) = alts[0]
                        cell.update(ok=True, value=w, fixedFrom=str(r.get(f)), err=round(e, 2), local=round(loc, 2),
                                    x=[segs[j]['x0'], segs[j]['x1']])
                    else:
                        cell.update(ok=False, err=round(res[1], 2) if res else None,
                                    why='沒有吻合' if not alts else '有 %d 個候選都吻合，分不出來' % len(alts))
                if cell.get('ok'):
                    j = next(k for k, g in enumerate(segs) if g['x0'] == cell['x'][0])
                    used.add(j)
                    cursor = segs[j]['x1']
                    where[f] = j
                rec['cells'][f] = cell
            # 合併扣課那三欄：課程與預約來源之間有沒抄到的墨
            if 'course' in where and 'source' in where:
                between = [j for j in range(where['course'] + 1, where['source']) if j not in used]
                if between:
                    rec['notes'].append('課程與預約來源之間有 %d 塊沒對到的字（合併扣課、實際扣課病歷號、關係那幾欄可能漏抄）' % len(between))
                    rec['deductInk'] = True
            # 日期、時段、姓名之間不該有別的東西
            order = [where.get(f) for f in ('date', 'time', 'name') if f in where]
            if len(order) == 3 and any(j not in used for j in range(order[0], order[2])):
                rec['notes'].append('日期與姓名之間有沒對到的字')
    badges, centers = check_badges(badge_rows)
    for rec in out_rows:
        key = '%s#%d' % (rec['src'], rec['row'])
        if key in badges:
            rec['cells']['status'] = dict(value=None, **badges[key])
    # 日期這一欄每一列都有、格式又死：大部分對不上＝校正不合（縮放換了、字型換了），不是抄錯
    dates = [r['cells'].get('date') for r in out_rows if r['cells'].get('date')]
    if dates and sum(1 for c in dates if c.get('ok')) < 0.5 * len(dates):
        print('日期那一欄 %d 格只有 %d 格吻合 —— 校正不合這一批截圖（縮放或字型換了）。先跑 calibrate。' % (len(dates), sum(1 for c in dates if c.get('ok'))))
        return 3
    total = sum(len(r['cells']) for r in out_rows)
    ok = sum(1 for r in out_rows for c in r['cells'].values() if c.get('ok'))
    fixed = sum(1 for r in out_rows for c in r['cells'].values() if c.get('fixedFrom') is not None)
    result = dict(meta=dict(profile=json.load(open(os.path.join(os.environ['PXX_WORK'], 'profile.json'), encoding='utf-8')),
                            phases=64, exact=EXACT, close=CLOSE, local=LOCAL_OK, badgeColors=centers,
                            cells=total, ok=ok, fixed=fixed, stats=synth.stats() if hasattr(synth, 'stats') else None),
                  rows=out_rows)
    json.dump(result, open(opt.out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    bad_rows = [r for r in out_rows if not all(c.get('ok') for c in r['cells'].values()) or r.get('deductInk')]
    print('逐像素：%d/%d 格吻合（其中 %d 格抄錯、像素認出了正確的字）；%d 列有沒驗證過的格子' % (ok, total, fixed, len(bad_rows)))
    for r in bad_rows:
        bad = [f for f, c in r['cells'].items() if not c.get('ok')]
        print('  %s 第 %d 列：%s%s' % (r['src'], r['row'], '、'.join(bad), ('；' + '；'.join(r['notes'])) if r['notes'] else ''))
    return 0


def best_in(cand, pats):
    """在一列的那幾塊裡找最吻合的：(第幾塊, 整格誤差, 區域誤差)。吻合的有好幾塊時取最左邊的（欄位照順序）。"""
    if not pats:
        return None
    scored = []
    for j, g in cand:
        e, loc = match_seg(g, pats)
        scored.append((j, e, loc))
    if not scored:
        return None
    good = [x for x in scored if x[1] < EXACT]
    if good:
        return min(good, key=lambda x: x[0])
    return min(scored, key=lambda x: x[1])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['calibrate', 'verify'])
    ap.add_argument('--shots', required=True)
    ap.add_argument('--abovee', required=True)
    ap.add_argument('--work', required=True)
    ap.add_argument('--shared')
    ap.add_argument('--out')
    ap.add_argument('--vocab')
    ap.add_argument('--font', default="'Noto Sans TC'")
    opt = ap.parse_args()
    setup(opt.work, opt.shared)
    if opt.cmd == 'verify' and not os.path.exists(os.path.join(opt.work, 'profile.json')):
        print('還沒有校正（工作目錄與 --shared 都沒有 profile.json）—— 先跑 calibrate。')
        return 3
    from pxx import img, synth
    data = json.load(open(opt.abovee, encoding='utf-8'))
    # 每張抄了幾列（去掉兩張重疊的之前）：切列照它，一列照 `row` 對回去
    opt.per_shot = (data.get('meta') or {}).get('rowsPerShot') or {}
    PER_SHOT.update(opt.per_shot)
    recs_by_shot = {}
    for r in data['rows']:
        recs_by_shot.setdefault(os.path.splitext(r['src'])[0], []).append(r)
    img.register([os.path.join(opt.shots, stem + '.png') for stem in recs_by_shot])
    try:
        if opt.cmd == 'calibrate':
            return cmd_calibrate(opt, recs_by_shot)
        if not opt.out:
            print('verify 要 --out'); return 2
        return cmd_verify(opt, recs_by_shot)
    finally:
        synth.clear_cache()


if __name__ == '__main__':
    sys.exit(main() or 0)
