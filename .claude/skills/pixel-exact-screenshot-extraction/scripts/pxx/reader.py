# 逐字讀取：不知道內容（也不一定知道起始位置）的格子，一個字一個字往右讀。
#
# 每一步：現有的每一條前綴後面接上字集裡的每一個字，真的畫出來，只留「到目前為止每個像素都對得上」的。
# 一條前綴畫出來的寬度到了整格的寬度、而且整格誤差 < accept，就是讀完了。
#
# 這是整套方法裡最貴的一步：一步＝字集大小 ×（粗篩的起始位置 ＋ 細篩）個磁磚，一格＝字數 × 那麼多。
# 一萬三千字的字集讀一則二十個字的句子是幾十萬個磁磚。先看 SKILL.md「先估再跑」那一節。
import numpy as np
from .match import synth, perr, spread, local_err, patterns, LOCAL_OK
from .synth import BudgetExceeded
from .conf import P, phases
from .charset import TEXT, BLANKS

PH4 = [0.0, 0.25, 0.5, 0.75]


def prefix_err_batch(obs, pats, drop=1, tail=None):
    """一批合成小塊，各自只比自己蓋到的那幾欄像素（最後 drop 欄不比：下一個字的邊會滲進來）。
    除以的是「合成那一側」有墨的通道數 —— 除以觀測那一側的話，前綴越短誤差看起來越小。
    tail：只比最後這麼多欄像素。前面的欄在之前的步驟已經對過了；整條前綴一起平均的話，
    前綴越長、新接上去的那個字佔的比例越小 —— 讀到第 25 個字時，一個完全錯的字只讓平均多 0.6，照樣過關。"""
    errs = np.full(len(pats), 999.0, np.float32)
    buckets = {}
    for i, p in enumerate(pats):
        if p is None: continue
        buckets.setdefault(p.shape[1], []).append(i)
    for Ws, idxs in buckets.items():
        w = Ws - drop
        if w <= 0 or obs.shape[1] < w: continue
        n = len(idxs); Hm = max(max(pats[i].shape[0] for i in idxs), obs.shape[0]) + 2
        best = np.full(n, 1e9, np.float32)
        lo = 0 if tail is None else max(0, w - tail)
        floor = 1.0 if tail is None else 4.0 * min(tail, w)     # 尾段沒什麼墨時（空白、標點）不要把幾個灰階放大
        for sy in range(3):
            S = np.zeros((n, Hm, Ws, 3), np.float32)
            for k, i in enumerate(idxs):
                p = pats[i]; S[k, sy:sy + p.shape[0]] = p
            for sx in (0, 1):
                if sx + w > Ws: continue
                Ss = S[:, :, sx + lo:sx + w]
                norm = np.maximum(floor, (np.abs(Ss) > 0).sum(axis=(1, 2, 3)).astype(np.float32))
                for ox in (0, 1):
                    if ox + w > obs.shape[1]: continue
                    O = np.zeros((Hm, w - lo, 3), np.float32); O[1:1 + obs.shape[0]] = obs[:, ox + lo:ox + w]
                    best = np.minimum(best, np.abs(Ss - O[None]).sum(axis=(1, 2, 3)) / norm)
        errs[idxs] = best
    return errs


LONG = 16      # 超過這麼多個字寬的格子算「長字串」：不要求整格在同一個起始位置上吻合（見 read 的說明）
PAD = 12       # 起始位置每一步最多可以漂多少（單位：conf.phases() 的一格；12 格約 0.023 像素）


def _expand(gp, pad=PAD):
    n = len(phases()); idx = set()
    for p_ in gp:
        k = int(round(p_ * n))
        for d_ in range(-pad, pad + 1): idx.add((k + d_) % n)
    return [k / n for k in sorted(idx)]


def _track(hist, win):
    """最近三步「尾段吻合的位置」的交集（空的就只用這一步的）。回傳 (新的 hist, 接下來用的位置)。"""
    hist2 = (hist + [frozenset(win)])[-3:]
    inter = frozenset.intersection(*hist2)
    return hist2, sorted(inter) if inter else sorted(win)


def _end_err(obs, pat, tail):
    """字串結尾那一段（含最後一欄像素）對不對。兩邊都裁到有墨的範圍，所以右緣是對齊的。"""
    t = min(tail, obs.shape[1], pat.shape[1])
    return perr(obs[:, -t:], pat[:, -t:])


def read(obs, phs=None, alphabet=TEXT, maxlen=40, K=2, M=16, tag='rd', accept=1.6, pfx_ok=2.0, sure=1.3, tail=None, verbose=False, prefix=''):
    """回傳 dict(text, err, local, complete, piecewise, alts, partial, steps)；被時間上限打斷時另外帶 interrupted=True。
    phs：這一欄校好的起始位置（None＝不知道，第一個字會貴很多）。
    K：留幾條前綴（預設 2：乾淨吻合的最寬那一條＋勉強過關的一條；其餘的放進退路，走到死路才回來試）。
    M：每條前綴粗篩後留幾個候選去細篩。prefix：已知的開頭（編號前面的 0、區碼）。
    tail：「接上去的這個字對不對」只看最後幾欄像素（預設兩個字寬多一點）。

    起始位置是「跟著走」的，不是整條字串共用一個：每一步只要求最近三步吻合的位置有交集，
    而且下一步可以往兩邊各漂 PAD 格。原因是模型的字距準到大約 0.01 像素，而每一對相鄰的字只在一段
    約 0.08 像素寬的位置上吻合 —— 十個字以內，這些範圍的交集還有幾個位置；三十個字的交集常常是空的，
    正確的字串也會「讀到第二十幾個字突然沒有任何字接得上」。

    所以長字串（寬度超過 LONG 個字）的吻合也是分段算的：piecewise=True，err＝一路上每一步尾段誤差的最大值。
    短字串照舊用整格誤差（err）與區域誤差（local，超過 LOCAL_OK 交給 refine()）。"""
    blanks = [b for b in BLANKS if b in alphabet] or [' ']
    alpha = [ch for ch in alphabet if ch not in BLANKS]
    tail = tail or int(round(P['em'] * 2.2))
    long_ = obs.shape[1] > LONG * P['em']
    ph0 = sorted(phs) if phs else None
    # 一條前綴＝(字串, 目前吻合的起始位置, 最近幾步的位置, 一路上最大的尾段誤差)
    beams = [(prefix, ph0, [], 0.0)]
    if prefix and not prefix.endswith(tuple(BLANKS)): beams += [(prefix + b, ph0, [], 0.0) for b in blanks]   # 接著讀的時候，下一個也可能是空白
    steps = []; done = {}; partial = (prefix, 0)
    stack = []; backs = 0     # 每一步沒被選上的候選。走到死路時退回來試（見下面）

    def stopped():
        """到時間上限：把目前讀到的地方交回去。呼叫端記下來，下次從這裡接著讀（prefix=）。"""
        return dict(text=None, err=999.0, complete=False, alts=[], partial=partial[0], steps=steps, interrupted=True)

    for step in range(maxlen + 16):
        # 粗篩：所有前綴 × 整個字集。位置取目前範圍的頭與尾（範圍還很寬時再加中間）——
        # 只畫一個點的話，下一個字吻合的位置剛好在範圍另一頭時，正確的字在粗篩就被刷掉
        # （實測：前綴在 0.201～0.217 都吻合，下一個字只在 0.215～0.217 吻合；粗篩畫 0.201，那個字排不進前 16 名）。
        items = []; meta = []
        for s, ph, hist, worst in beams:
            if ph is None: coarse = PH4
            else: coarse = sorted(set([ph[0], ph[-1]] + ([ph[len(ph) // 2]] if len(ph) > 32 else [])))
            meta.append((len(items), coarse))
            items += [(s + ch, p) for ch in alpha for p in coarse]
        try:
            pats = synth(items, tag=tag)
        except BudgetExceeded:
            return stopped()
        e_all = prefix_err_batch(obs, pats, tail=tail)
        items2 = []; meta2 = []
        for bi, (s, ph, hist, worst) in enumerate(beams):
            off, coarse = meta[bi]; nc = len(coarse)
            e = e_all[off:off + len(alpha) * nc].reshape(len(alpha), nc)
            wd = np.array([max((pats[off + i * nc + j].shape[1] if pats[off + i * nc + j] is not None else 0) for j in range(nc)) for i in range(len(alpha))])
            em = e.min(axis=1); base = wd.min() if len(wd) else 0
            order = np.argsort(em)
            # 寬字、中等、細字各留一些。細的字（l . | i 1）只蓋到一兩欄像素，很容易「局部吻合」，
            # 只照誤差排的話它們會把真正的寬字整批擠出名單
            wide = [i for i in order if wd[i] - base >= 4][:M]
            mid = [i for i in order if 2 <= wd[i] - base < 4][:M // 2]
            thin = [i for i in order if wd[i] - base < 2][:M // 2]
            top = list(dict.fromkeys(wide + mid + thin))
            fine = phases() if ph is None else spread(_expand(ph))   # 細篩：目前的範圍往兩邊各放寬一點，全部畫
            meta2.append((len(items2), top, fine, s, hist, worst))
            items2 += [(s + alpha[i], p) for i in top for p in fine]
        try:
            pats2 = synth(items2, tag=tag + 'f')
        except BudgetExceeded:
            return stopped()
        e2_all = prefix_err_batch(obs, pats2, tail=tail)
        cand = {}
        for off, top, fine, s, hist, worst in meta2:
            nf = len(fine)
            e2 = e2_all[off:off + len(top) * nf].reshape(len(top), nf)
            for k, i in enumerate(top):
                m = float(e2[k].min())
                if m >= pfx_ok: continue          # 接上去的這個字有像素對不上：丟掉，不留著「看看後面會不會變好」
                s2 = s + alpha[i]
                # 這一步吻合的位置：比最好的差 0.4 以內都算（正確的位置不一定是誤差最小的那個；位置不對時誤差是跳上去的）
                win = [fine[j] for j in range(nf) if e2[k, j] <= m + 0.4]
                hist2, gp = _track(hist, win)
                ws = [pats2[off + k * nf + j].shape[1] for j in range(nf) if pats2[off + k * nf + j] is not None]
                wmax = max(ws) if ws else 0
                worst2 = max(worst, m)
                if s2 not in cand or m < cand[s2][0]: cand[s2] = (m, gp, wmax, hist2, worst2)
                for j in range(nf):
                    pat = pats2[off + k * nf + j]
                    if pat is None or not (obs.shape[1] - 1 <= pat.shape[1] <= obs.shape[1] + 1): continue
                    if long_:
                        if e2[k, j] > m + 0.4: continue
                        ee = max(worst2, _end_err(obs, pat, tail)); ef = (ee, ee, -1)
                    else:
                        ef = local_err(obs, pat)
                    if ef[0] < 999 and (s2 not in done or _rank(ef) < _rank(done[s2])): done[s2] = ef
        # 排名分兩層：乾淨吻合的（< sure）在前，勉強過關的（sure～pfx_ok）在後；每一層裡蓋得比較寬的排前面。
        # 只照寬度排的話，一個勉強過關的寬候選（「空白＋一個橫畫的字」蓋在一個逗號上，誤差 1.25）
        # 會排在乾淨吻合的窄候選（那個逗號，0.7）前面，之後整條路都是錯的、讀到那裡就斷。
        # 但勉強過關的也留一條：筆畫密的字正確時也可能落在 1.1～1.6。
        order = lambda kv: (-kv[1][2], kv[1][0])
        t1 = sorted([kv for kv in cand.items() if kv[1][0] < sure], key=order)
        t2 = sorted([kv for kv in cand.items() if kv[1][0] >= sure], key=order)
        ranked = t1[:max(1, K - 1)] + t2[:1] + t1[max(1, K - 1):] + t2[1:] if t1 else t2
        if verbose: print('  step', step, [(round(v[0], 2), s_, v[2], len(v[1])) for s_, v in ranked[:6]], flush=True)
        steps.append([(round(v[0], 2), s_) for s_, v in ranked[:4]])
        if done and min(v[0] for v in done.values()) < accept: break
        if not cand:
            # 死路：上一步選的那幾條都接不下去。細小的字（逗號、l、|、.）在它自己那一步分不出誰對，
            # 留下來的 K 條可能全是錯的。退回最近一批沒被選上的候選再試，不要整格放棄。
            if stack and backs < 6:
                beams = stack.pop(); backs += 1
                if verbose: print('  退回去試', [b[0] for b in beams], flush=True)
                continue
            break
        if len(ranked) > K: stack.append([(s_, v[1], v[3], v[4]) for s_, v in ranked[K:K + 6]])
        ranked = ranked[:K]
        if ranked[0][1][2] > partial[1]: partial = (ranked[0][0], ranked[0][1][2])
        beams = [(s_, v[1], v[3], v[4]) for s_, v in ranked]
        # 空白不佔墨，靠誤差選不出來。「最好的那一條後面接一個空白」（半形、全形各一條）不每一步都畫 ——
        # 那會讓每一步多畫一倍 —— 而是放進退路：下一步接不下去時先試它。空白後面的字位置差一兩個像素，不接空白一定接不下去。
        sp = [(s_ + b, v[1], v[3], v[4]) for s_, v in ranked[:1] if not s_.endswith(tuple(BLANKS)) for b in blanks]
        if sp: stack.append(sp)
        del stack[:-8]
    # 讀完的候選：區域誤差過關的排前面，再比整格誤差
    fin = sorted((_rank(v), s_, v) for s_, v in done.items() if v[0] < accept)[:5]
    alts = [(float(v[0]), s_) for _, s_, v in fin]
    if fin:
        _, s_, v = fin[0]
        return dict(text=s_, err=float(v[0]), local=float(v[1]), local_x=int(v[2]), complete=True, piecewise=long_, alts=alts, partial=None, steps=steps)
    near = sorted((float(v[0]), s_) for s_, v in done.items())[:5]
    return dict(text=None, err=near[0][0] if near else 999.0, complete=False, alts=near, partial=partial[0], steps=steps)


def check(obs, text, phs=None, tail=None, tag='ck'):
    """已經知道（或讀出來）的字串，照 read() 同一套規矩一步一步對：每多一個字，尾段要吻合，
    而且吻合的位置跟前兩步有交集。回傳 dict(ok, err=一路上最大的尾段誤差, at=最差的是第幾個字, end=結尾那一段的誤差)。
    長字串的最後驗證用這一支（整格在同一個位置上比的 verify() 對三十個字以上的字串太嚴）。一個字串約畫「字數 × 幾十」個磁磚。"""
    tail = tail or int(round(P['em'] * 2.2))
    ph = sorted(phs) if phs else None; hist = []; worst = (0.0, 0); last = None
    for n in range(1, len(text) + 1):
        if text[n - 1] in BLANKS and n < len(text): continue      # 空白沒有墨，跟下一個字一起比
        fine = phases() if ph is None else spread(_expand(ph))
        pats = synth([(text[:n], p_) for p_ in fine], tag=tag)
        e = prefix_err_batch(obs, pats, tail=tail)
        m = float(e.min())
        if m >= 999: continue                                     # 太窄（一個像素寬的字）：跟下一個字一起比
        if m > worst[0]: worst = (m, n)
        win = [fine[j] for j in range(len(fine)) if e[j] <= m + 0.4]
        hist, ph = _track(hist, win)
        last = [pats[j] for j in range(len(fine)) if e[j] <= m + 0.4 and pats[j] is not None]
    end = min([_end_err(obs, s_, tail) for s_ in (last or []) if abs(s_.shape[1] - obs.shape[1]) <= 1] or [999.0])
    err = max(worst[0], end)
    return dict(ok=err < 1.6, err=float(err), at=worst[1], end=float(end), path=float(worst[0]))   # path：不看結尾，只看一路上（拿來對「只知道開頭」的字串）


def _rank(v):
    """讀完的候選怎麼比：區域誤差過不過關優先，其次整格誤差。"""
    return (v[1] > LOCAL_OK, v[0])


def refine(obs, text, alphabet=TEXT, span=1, tag='rf'):
    """讀出來了、整格誤差也過關，但有一個地方區域誤差偏高：把那個位置（與左右各 span 個字）
    逐一換成字集裡的每個字（也試刪掉它），看哪一個讓區域誤差最小。
    回傳 dict(text, err, local, before=(整格, 區域), at=第幾個字, changed)；沒有可比的就回 None。
    字集給大的（TEXT_ALL）：這一步只畫「幾個位置 × 字集」，便宜。"""
    PH = phases()
    pats = synth([(text, p) for p in PH], tag=tag)
    stats = {}
    for p, s in zip(PH, pats):
        if s is None: continue
        k = (s.shape, s.tobytes())
        if k not in stats: stats[k] = (local_err(obs, s), p)
    if not stats: return None
    (e0, l0, x0), p0 = min(stats.values(), key=lambda v: (v[0][1], v[0][0]))
    if e0 >= 999: return None
    res = dict(text=text, err=e0, local=l0, before=(e0, l0), at=None, changed=False)
    if l0 <= LOCAL_OK: return res
    # 區域的 x → 第幾個字：每一段前綴畫出來多寬
    pre = synth([(text[:j], p0) for j in range(1, len(text) + 1)], tag=tag)
    widths = [s.shape[1] if s is not None else 0 for s in pre]
    cx = x0 + max(3, int(round(P['em'] * 1.1))) / 2
    j = next((j for j, w in enumerate(widths) if w > cx), len(text) - 1)
    res['at'] = j + 1
    J = range(max(0, j - span), min(len(text), j + span + 1))
    alpha = [c for c in dict.fromkeys(list(alphabet) + BLANKS)]
    items = [(text[:jj] + ch + text[jj + 1:], p0) for jj in J for ch in alpha if ch != text[jj]] + [(text[:jj] + text[jj + 1:], p0) for jj in J]
    scored = []
    for (t, _), s in zip(items, synth(items, tag=tag)):
        if s is None: continue
        e, l, _x = local_err(obs, s)
        if e < 999: scored.append((l, e, t))
    scored.sort()
    top = [t for l, e, t in scored[:12]]
    if not top: return res
    full = patterns(top, tag=tag)              # 前幾名在所有起始位置上再比一次
    best = min(((min([local_err(obs, s) for s in full[t]] or [(999.0, 999.0, -1)]), t) for t in top), key=lambda v: (v[0][1], v[0][0]))
    (e1, l1, _x), t1 = best
    res['alts'] = [(round(l, 2), round(e, 2), t) for l, e, t in scored[:5]]
    if l1 < l0 - 0.3 and e1 <= e0 + 0.05:
        res.update(text=t1, err=e1, local=l1, changed=True)
    return res


def estimate(n_chars, alphabet=TEXT, phases_known=True, K=3, M=16):
    """讀一格大約要畫幾個磁磚。跑之前先乘上格數、再除以這台機器每秒畫幾個（selftest.py 會量）。"""
    a = len([c for c in alphabet if c != ' '])
    top = min(a, 2 * M)
    first = a * (1 if phases_known else 4) + top * (40 if phases_known else len(phases()))
    rest = (K + 1) * (a + top * 40)     # 細篩用整段起始位置，通常幾十個
    return first + max(0, n_chars - 1) * rest
