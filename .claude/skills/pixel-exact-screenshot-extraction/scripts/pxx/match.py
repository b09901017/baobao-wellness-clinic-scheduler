# 比對：誤差怎麼算、校起始位置（phase）、拿一份候選清單窮舉。
#
# 誤差的單位：每一個「有墨的通道值」平均差多少（0～255）。實測的刻度（Chrome、ClearType、5 像素高的字）：
#   < 1.1      這個字串、這個起始位置就是截圖上那一格
#   1.1～1.6   差一兩個很淡的像素（筆畫密的字會這樣），可以收但要標出來
#   ≥ 3        差一個字或差一個像素的位置
#   ≥ 10       完全不同的字串
# 換一批截圖時這幾個數字要重新看一次（跑 calibrate.py em 會印出正確答案的誤差落在哪裡）。
#
# 整格誤差是平均，會把單一個錯字稀釋掉。所以另外有「區域誤差」（local_err：最差的那一個字寬差多少，≤ LOCAL_OK 才算），
# 而寬度超過十幾個字的長字串不在同一個起始位置上整格比（reader.check 一步一步對）。
import os
import numpy as np
from . import synth as _synth
from .conf import P, phases, wpath

EXACT = 1.1
CLOSE = 1.6

_lut = [None]


def lut():
    if _lut[0] is None:
        f = wpath('lut.npy')
        _lut[0] = np.load(f) if os.path.exists(f) else np.arange(256, dtype=np.float32)
    return _lut[0]


def reload_lut():
    _lut[0] = None


def apply_lut(p):
    """合成值 → 截圖上會看到的值。兩邊的字是同一個形狀，但深淺的曲線不一樣（見 references/calibration.md）。"""
    return lut()[np.clip(p, 0, 255).astype(np.int32)]


def perr(obs, syn):
    """整格的誤差。寬或高差超過 1 個像素直接算不合；對齊容許 ±1 像素。"""
    if obs is None or syn is None: return 999.0
    if abs(obs.shape[1] - syn.shape[1]) > 1 or abs(obs.shape[0] - syn.shape[0]) > 1: return 999.0
    H = max(obs.shape[0], syn.shape[0]) + 2; W = max(obs.shape[1], syn.shape[1]) + 2
    O = np.zeros((H, W, 3), np.float32); O[1:1 + obs.shape[0], 1:1 + obs.shape[1]] = obs
    norm = max(1.0, float((np.abs(obs) > 0).sum())); best = 1e9
    for sy in range(3):
        for sx in range(3):
            S = np.zeros((H, W, 3), np.float32); S[sy:sy + syn.shape[0], sx:sx + syn.shape[1]] = syn
            best = min(best, float(np.abs(O - S).sum() / norm))
    return best


LOCAL_OK = 2.0


def local_err(obs, syn, win=None):
    """（整格誤差, 最大的區域誤差, 那個區域的 x）。區域＝一個字寬的滑動視窗。
    整格誤差是平均，字串一長就會把單一個錯字稀釋掉：30 個字裡錯 1 個，平均只多 0.4，照樣在門檻以內；
    長得幾乎一樣的字（差一兩個像素的那種）連短字串都看不出來。區域誤差不會被稀釋 ——
    實測正確的字串最大的區域誤差在 1.0～1.3，錯一個字的是 5～17，選錯標點（全形半形、不同的破折號）的是 2.5～5。
    分母有下限（視窗裡沒什麼墨的地方，幾個灰階的差不該被放大成很大的誤差）。"""
    if obs is None or syn is None: return 999.0, 999.0, -1
    if abs(obs.shape[1] - syn.shape[1]) > 1 or abs(obs.shape[0] - syn.shape[0]) > 1: return 999.0, 999.0, -1
    win = win or max(3, int(round(P['em'] * 1.1)))
    H = max(obs.shape[0], syn.shape[0]) + 2; W = max(obs.shape[1], syn.shape[1]) + 2
    O = np.zeros((H, W, 3), np.float32); O[1:1 + obs.shape[0], 1:1 + obs.shape[1]] = obs
    norm = max(1.0, float((np.abs(obs) > 0).sum())); best = None
    for sy in range(3):
        for sx in range(3):
            S = np.zeros((H, W, 3), np.float32); S[sy:sy + syn.shape[0], sx:sx + syn.shape[1]] = syn
            e = float(np.abs(O - S).sum() / norm)
            if best is None or e < best[0]: best = (e, S)
    e, S = best
    col = np.abs(O - S).sum(axis=(0, 2))
    ink = np.maximum((np.abs(O) > 0).sum(axis=(0, 2)), (np.abs(S) > 0).sum(axis=(0, 2))).astype(np.float32)
    c = np.concatenate([[0], np.cumsum(col)]); k = np.concatenate([[0], np.cumsum(ink)])
    n = max(1, W - win + 1)
    loc = (c[win:win + n] - c[:n]) / np.maximum(4.0 * win, k[win:win + n] - k[:n]) if W > win else np.array([col.sum() / max(4.0 * win, ink.sum())])
    i = int(np.argmax(loc))
    return e, float(loc[i]), i - 1


def loose_err(obs, syn, maxshift=1):
    """不管大小合不合都給一個數字（小的那一塊補零）。只給校字型與字級用：
    那時候寬度本來就對不上，要的是「往哪個方向比較好」。"""
    if obs is None or syn is None: return 999.0
    H = max(obs.shape[0], syn.shape[0]) + 2 * maxshift; W = max(obs.shape[1], syn.shape[1]) + 2 * maxshift
    A = np.zeros((H, W, 3), np.float32); A[maxshift:maxshift + obs.shape[0], maxshift:maxshift + obs.shape[1]] = obs
    norm = max(1.0, float((np.abs(A) > 0).sum())); best = 1e9
    for sy in range(2 * maxshift + 1):
        for sx in range(2 * maxshift + 1):
            B = np.zeros((H, W, 3), np.float32); B[sy:sy + syn.shape[0], sx:sx + syn.shape[1]] = syn
            best = min(best, float(np.abs(A - B).sum() / norm))
    return best


def prefix_err(obs, syn, drop=1):
    """只比合成字串自己蓋到的那幾欄像素（最後 drop 欄不比：下一個字的邊會滲進來）。"""
    if obs is None or syn is None: return 999.0
    w = syn.shape[1] - drop
    if w <= 0 or obs.shape[1] < w: return 999.0
    H = max(obs.shape[0], syn.shape[0]) + 2; best = 1e9
    for ox in (0, 1):
        if ox + w > obs.shape[1]: continue
        o = obs[:, ox:ox + w]
        for sx in (0, 1):
            s = syn[:, sx:sx + w]
            if s.shape[1] < w: continue
            O = np.zeros((H, w, 3), np.float32); O[1:1 + o.shape[0]] = o
            norm = max(1.0, float((np.abs(s) > 0).sum()))
            for sy in range(3):
                S = np.zeros((H, w, 3), np.float32); S[sy:sy + s.shape[0]] = s
                best = min(best, float(np.abs(O - S).sum() / norm))
    return best


def synth(items, tag='p', chunk=8000, keep=False, raw=False, **over):
    """畫一批 (字串, 起始位置)，回傳套過色調對照的小塊（raw=True 就不套）。
    一批最多 chunk 個；超過就分批，分批之間照 synth 的同時上限平行。"""
    batches = [items[i:i + chunk] for i in range(0, len(items), chunk)]
    if not batches: return []
    out = []
    for r in _synth.render_many(batches, tag=tag, keep=keep, **over):
        for x in r:
            if x is None: out.append(None)
            else: out.append(x['patch'].astype(np.float32) if raw else apply_lut(x['patch']))
    return out


def calibrate(anchors, tag='cal', tol=0.3):
    """anchors：[(觀測小塊, 已知的字串)]，同一張圖同一欄的。
    回傳 (所有錨點都吻合的起始位置, 那些位置上最差的誤差, 誤差矩陣)。
    同一欄每一格的字都從同一個 x 開始，所以起始位置是「一張圖一欄一個」，不是一格一個。
    tol：比最好的位置差多少以內都算。不要設成 0 —— 真正的位置不一定是誤差最小的那一個（差 0.05 是常態），
    只留最小的話會留到隔壁那一段，之後那一欄比較長的字串就一直「差一點點」。位置真的不對時誤差是跳上去的（1 以上）。"""
    PH = phases()
    labels = sorted(set(l for _, l in anchors))
    pats = synth([(l, p) for l in labels for p in PH], tag=tag)
    idx = {l: i for i, l in enumerate(labels)}
    NP = len(PH); E = np.zeros((len(anchors), NP), np.float32)
    for ai, (o, l) in enumerate(anchors):
        base = idx[l] * NP; cache = {}
        for pi in range(NP):
            s = pats[base + pi]
            k = None if s is None else (s.shape, s.tobytes())
            if k not in cache: cache[k] = perr(o, s)
            E[ai, pi] = cache[k]
    worst = E.max(axis=0); m = float(worst.min())
    return [PH[i] for i in range(NP) if worst[i] <= m + tol], m, E


def calibrate_prefix(obs_list, prefix, tag='calp', tol=0.3):
    """整欄都以同一段字開頭（年份、編號前面的 0、電話的區碼）時，不用知道任何一格的全文就能校。"""
    PH = phases()
    pats = synth([(prefix, p) for p in PH], tag=tag)
    worst = np.zeros(len(PH), np.float32); cache = {}
    for o in obs_list:
        for pi, s in enumerate(pats):
            k = (o.shape, o.tobytes(), None if s is None else (s.shape, s.tobytes()))
            if k not in cache: cache[k] = prefix_err(o, s)
            worst[pi] = max(worst[pi], cache[k])
    m = float(worst.min())
    return [PH[i] for i in range(len(PH)) if worst[i] <= m + tol], m


def pick_phases(good):
    """頭、中、尾三個。只在「這一段是好幾個不同的錨點一起校出來的」時候用（那時候它已經很窄）。
    只靠一個詞或一段短前綴校出來的範圍不要用這一支，用 spread()：
    每個字串吻合的範圍邊界都不一樣，真正的位置落在它們的交集裡，而交集可能只有 0.01 個像素寬。
    一段 0.08 像素寬的範圍抽三個點，剛好全部落在交集外面是常態，不是運氣不好。"""
    if not good: return [0.0]
    g = sorted(good)
    return sorted(set([g[0], g[len(g) // 2], g[-1]]))


def spread(good, n=64):
    """整段都要（太長才等距抽成 n 個以內）。多畫幾個位置很便宜，漏掉正確的位置是整格讀不出來。"""
    if not good: return [0.0]
    g = sorted(good)
    return g if len(g) <= n else g[::(len(g) - 1) // n + 1]


def decode(obs_list, cands, phs, tag='dec', topk=3):
    """每個觀測小塊對一份候選清單。回傳每個觀測的 [(誤差, 字串), ...]（由小到大，最多 topk 個）。
    看結果時第一名與第二名都要看：第一名 < 1.1 而且第二名離得遠（≥ 3）才是乾淨的吻合。"""
    items = [(c, p) for c in cands for p in phs]
    pats = synth(items, tag=tag)
    uniq = {}
    for (c, p), s in zip(items, pats):
        if s is None: continue
        uniq.setdefault((s.shape, s.tobytes()), (s, set()))[1].add(c)   # 很多起始位置畫出來是同一個樣子
    U = list(uniq.values())
    if not U: return [[] for _ in obs_list]
    widths = np.array([s.shape[1] for s, _ in U]); heights = np.array([s.shape[0] for s, _ in U])
    Hm = int(heights.max()) + 2; Wm = int(widths.max()) + 2
    stacks = []
    for sy in range(3):
        for sx in range(3):
            A = np.zeros((len(U), Hm + 2, Wm + 2, 3), np.float32)
            for i, (s, _) in enumerate(U): A[i, sy:sy + s.shape[0], sx:sx + s.shape[1]] = s
            stacks.append(A)
    out = []; cache = {}
    for o in obs_list:
        if o is None: out.append([]); continue
        k = (o.shape, o.tobytes())
        if k not in cache:
            if o.shape[0] > Hm or o.shape[1] > Wm:
                cache[k] = [(999.0, '<too big>')]
            else:
                idx = np.where((np.abs(widths - o.shape[1]) <= 1) & (np.abs(heights - o.shape[0]) <= 1))[0]
                if len(idx) == 0: cache[k] = [(999.0, '<no size match>')]
                else:
                    O = np.zeros((Hm + 2, Wm + 2, 3), np.float32); O[1:1 + o.shape[0], 1:1 + o.shape[1]] = o
                    norm = max(1.0, float((np.abs(o) > 0).sum()))
                    best = np.full(len(idx), 1e9, np.float32)
                    for A in stacks:
                        best = np.minimum(best, np.abs(A[idx] - O[None]).sum(axis=(1, 2, 3)) / norm)
                    bl = {}
                    for e, j in zip(best.tolist(), idx.tolist()):
                        for l in U[j][1]:
                            if l not in bl or e < bl[l]: bl[l] = e
                    cache[k] = sorted((e, l) for l, e in bl.items())[:topk]
        out.append(cache[k])
    return out


def patterns(texts, tag='pat', per_batch=14):
    """每個字串在「所有」起始位置上畫出來的不同樣子。回傳 {字串: [小塊, ...]}。
    最便宜的一種運算：一個字串一次、畫完可以拿去比任意多格。收尾與驗證都用這一支。"""
    PH = phases(); n = len(PH); res = {}
    texts = list(dict.fromkeys(texts))
    groups = [texts[i:i + per_batch] for i in range(0, len(texts), per_batch)]
    outs = _synth.render_many([[(t, p) for t in g for p in PH] for g in groups], tag=tag, keep=False)
    for g, o in zip(groups, outs):
        for ti, t in enumerate(g):
            u = {}
            for x in o[ti * n:(ti + 1) * n]:
                if x is None: continue
                p = apply_lut(x['patch']); u[(p.shape, p.tobytes())] = p
            res[t] = list(u.values())
    return res


def best_err(obs, pats):
    return min([perr(obs, s) for s in pats] or [999.0])


def verify(pairs, tag='ver'):
    """最後一道。pairs：[(key, 觀測小塊, 讀到的字)]。每個字在所有起始位置上重畫，回傳 {key: 誤差}。
    只吃（像素, 字），不看任何中間結果 —— 前面哪一步記錯格、套錯欄、存錯檔，在這裡都會現形。
    觀測可以給一串小塊（同一格的幾種切法，見 cut.crops）：取最好的那一個。"""
    pats = patterns([t for _, _, t in pairs], tag=tag)
    out = {}; cache = {}
    for key, o, t in pairs:
        best = 999.0
        for x in (o if isinstance(o, (list, tuple)) else [o]):
            if x is None: continue
            k = (x.shape, x.tobytes(), t)
            if k not in cache: cache[k] = best_err(x, pats[t])
            best = min(best, cache[k])
        out[key] = float(best)
    return out


def verify_local(pairs, tag='verl'):
    """跟 verify() 一樣，但每一格回傳 (整格誤差, 最大的區域誤差, 區域的 x)。長字串、自由文字一定要看區域誤差。"""
    pats = patterns([t for _, _, t in pairs], tag=tag)
    out = {}; cache = {}
    for key, o, t in pairs:
        best = (999.0, 999.0, -1)
        for x in (o if isinstance(o, (list, tuple)) else [o]):
            if x is None: continue
            k = (x.shape, x.tobytes(), t)
            if k not in cache:
                cache[k] = min([local_err(x, s) for s in pats[t]] or [(999.0, 999.0, -1)])
            best = min(best, cache[k])
        out[key] = best
    return out


def fine_decode(obs, labels, tag='fine'):
    """卡在 1.1 附近的格子：幾個最接近的候選在所有起始位置上再比一次。"""
    pats = patterns(labels, tag=tag)
    return sorted((best_err(obs, pats[l]), l) for l in labels)
