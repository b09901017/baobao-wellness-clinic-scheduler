# 一欄的完整流程（閉環）：
#   已知詞彙先比 → 每個 (圖, 欄) 用吻合的那幾格校起始位置 → 比不到的挑一格逐字讀
#   → 讀出來的新詞馬上回頭套到所有圖的同一欄 → 再挑下一格 …… 直到沒有沒吻合的格子。
#
# 表格欄位的值會重複。讀一格的成本是幾十秒，套一個詞到幾百格是一兩秒，
# 所以每讀出一個新詞就全域反套，通常讀十幾次就收掉一整欄。
import collections, os, pickle, re, time
from . import grid
from .match import calibrate, decode, fine_decode, spread, EXACT, CLOSE, LOCAL_OK
from .reader import read, refine, check, LONG
from .conf import P, phases, wpath
from .charset import TEXT
from .synth import BudgetExceeded, set_deadline

OKERR = CLOSE   # < EXACT 完全吻合；EXACT～CLOSE 只差一兩個像素，照樣收但輸出時要標出來


class Field:
    def __init__(self, name, segs, vocab=(), alphabet=TEXT, fallback=None, fallbacks=(), obs_fn=None, maxlen=40, prefix='', K=2):
        """name：欄位名（也是 log 與存檔的檔名）。segs：{stem: [欄的索引, ...]} 或 stem → 清單的函式。
        vocab：已知或猜得到的詞（錯的不會有事，只是白畫）。
        alphabet：逐字讀的字集。fallbacks：讀不下去時依序換的字集（由小到大）；每一輪從上一輪讀到的地方接著讀，不重頭來。
        obs_fn(stem, ri, si)：這一欄的格子要自己切（去掉圖示之類）時給。prefix：整欄共同的開頭。
        maxlen：最多讀幾個字；None＝照那一格的寬度算（自由文字用）。"""
        self.name = name; self.alphabet = alphabet; self.maxlen = maxlen; self.prefix = prefix; self.K = K
        self.fallbacks = ([fallback] if fallback else []) + list(fallbacks)
        self.vocab = list(dict.fromkeys(vocab))
        self.logf = wpath('discover_%s.log' % name); self.pkl = wpath('disc_%s.pkl' % name)
        # 讀到一半被時間上限打斷的格子讀到哪裡、所有字集都試過還是讀不完的格子：跨次執行都要記得
        self.partials = {}; self.failed = {}; self.retracted = set(); self._direct = []
        if os.path.exists(self.pkl):
            try:
                old = pickle.load(open(self.pkl, 'rb')); self.partials = dict(old.get('partials', {})); self.failed = dict(old.get('failed', {}))
                self.retracted = set(old.get('retracted', ()))
                self._direct = [(cid, v['text'], v['err']) for cid, v in old.get('cells', {}).items() if v.get('direct') and v.get('text')]
            except Exception:
                pass
        # 上一輪已經讀出來的詞寫在 log 裡：接著用，不用重讀（斷電、逾時、手動停掉之後就是靠這個接回來）
        if os.path.exists(self.logf):
            # 一行一行照順序看：讀到 → 加進詞彙；修正 → 換掉；撤回 → 拿掉。順序要緊 ——
            # 撤回之後重讀、讀出來是同一個字串的話，它是算數的（「所有撤回過的都不要」會讓那一格每次重啟都重讀一遍）。
            tag = re.escape(name)
            for line in open(self.logf, encoding='utf-8'):
                m = re.search(r"\[%s\].*?讀到 '(.*?)' [0-9.]+ 其他候選" % tag, line)
                if m:
                    if m.group(1) not in self.vocab: self.vocab.append(m.group(1))
                    continue
                m = re.search(r"\[%s\].*?修正 '(.*?)' → '(.*?)' 區域" % tag, line)
                if m:
                    if m.group(1) in self.vocab: self.vocab.remove(m.group(1))
                    if m.group(2) not in self.vocab: self.vocab.append(m.group(2))
                    continue
                m = re.search(r"\[%s\].*?撤回 '(.*?)' 從" % tag, line)
                if m and m.group(1) in self.vocab: self.vocab.remove(m.group(1))
        obs_fn = obs_fn or grid.obs_cell
        self.st = {}      # (stem, si) → dict(phases, cells={ri: dict(obs, text, err, alts)})
        self.unread = {}  # 讀不出來的樣子 → 讀到哪裡
        for stem in grid.stems():
            for si in (segs(stem) if callable(segs) else segs.get(stem, [])):
                cells = {}
                for ri in grid.rows_of(stem):
                    o = obs_fn(stem, ri, si)
                    if o is not None: cells[ri] = dict(obs=o, text=None, err=999.0, alts=[])
                if cells: self.st[(stem, si)] = dict(phases=None, cells=cells)
        # 長字串是分段吻合的（read 的 piecewise），整格比（_apply）對不回去：上次直接記下來的照樣算數
        for cid, text, err in self._direct:
            c = self.st.get((cid[0], cid[2]), {}).get('cells', {}).get(cid[1])
            if c is not None: c.update(text=text, err=err, alts=[(err, text)], direct=True)

    def log(self, *a):
        s = ' '.join(str(x) for x in a); print(s, flush=True)
        open(self.logf, 'a', encoding='utf-8').write(s + '\n')

    def _apply(self, key, words):
        """把 words 套到這個 (圖, 欄) 還沒吻合的格子上。"""
        S = self.st[key]; todo = [ri for ri, c in S['cells'].items() if c['err'] >= OKERR and not c.get('direct')]
        if not todo or not words: return
        obs = [S['cells'][ri]['obs'] for ri in todo]
        if S['phases'] is None:
            # 還不知道起始位置：先用 64 個位置粗比，挑「明顯吻合而且第二名差很遠」的當錨點來校
            resA = decode(obs, words, phases(64), tag='dA_' + self.name)
            anchors = []; seen = set()
            for o, m in zip(obs, resA):
                if m and m[0][0] < 2.2 and (len(m) < 2 or m[1][0] > m[0][0] * 2.5 or m[1][0] > 6) and m[0][1] not in seen:
                    seen.add(m[0][1]); anchors.append((o, m[0][1]))
            anchors = anchors[:8]
            while anchors:
                good, mm, E = calibrate(anchors, tag='dcal_' + self.name)
                if mm < 1.4: break
                # 有一個錨點拖累全部（一個讀得差一點的長句、一個碰巧像的詞）：把在共同最佳位置上最差的那個拿掉再校。
                # 不拿掉的話整張圖這一欄都校不起來，連本來吻合的格子都變成「沒讀出」。
                anchors.pop(int(E[:, int(E.max(axis=0).argmin())].argmax()))
            if not anchors: return
            S['phases'] = good
            words = self.vocab     # 起始位置剛知道：整份詞彙重比一次
            todo = [ri for ri, c in S['cells'].items() if c['err'] >= OKERR]; obs = [S['cells'][ri]['obs'] for ri in todo]
        for ri, m in zip(todo, decode(obs, words, spread(S['phases']), tag='dB_' + self.name)):
            if m and m[0][0] < S['cells'][ri]['err']:
                S['cells'][ri].update(text=m[0][1], err=m[0][0], alts=m[:3])

    def apply_all(self, words=None):
        for key in self.st: self._apply(key, words or self.vocab)

    def unmatched(self):
        """還沒吻合的格子，照「長得一模一樣」分組（同一個值在同一張圖同一欄會畫成一模一樣的像素）。"""
        g = collections.defaultdict(list)
        for key, S in self.st.items():
            for ri, c in S['cells'].items():
                if c['err'] >= OKERR:
                    k = (c['obs'].shape, c['obs'].tobytes())
                    if k not in self.unread: g[k].append((key, ri))
        return g

    def summary(self):
        c = collections.Counter(); bad = 0
        for S in self.st.values():
            for cc in S['cells'].values():
                if cc['err'] < OKERR: c[cc['text']] += 1
                else: bad += 1
        return c, bad

    def save(self):
        pickle.dump(self.export(), open(self.pkl, 'wb'))

    def run(self, max_reads=80, max_minutes=10, order='common', retry_failed=False):
        """max_minutes：這一輪最多畫幾分鐘。到了就存檔收工；再呼叫一次會接著做 ——
        已經讀出來的詞從 log 撿回來，讀到一半的那一格從停下來的那個字接著讀。
        order：'common'＝最常出現的樣子先讀（值會重複的欄位）；'short'＝最窄的先讀（自由文字：短的便宜，先收掉）。
        retry_failed：上次所有字集都試過還讀不完的格子，這次要不要再試。"""
        set_deadline(max_minutes)
        try:
            self.apply_all()
            c, bad = self.summary(); self.log('[' + self.name + '] 起始：吻合', sum(c.values()), '未吻合', bad, dict(c.most_common(12)))
            for _ in range(max_reads):
                g = self.unmatched()
                if not retry_failed:
                    g = {k: v for k, v in g.items() if not any((key[0], ri, key[1]) in self.failed for key, ri in v)}
                if not g: break
                if order == 'short':
                    k = min(g, key=lambda k: (k[0][1], -len(g[k])))
                else:
                    # 先讀「已經知道起始位置的欄」裡最常出現的那個樣子：最便宜、一次收掉最多格
                    k = max(g, key=lambda k: (any(self.st[key]['phases'] is not None for key, _ in g[k]), len(g[k])))
                key, ri = sorted(g[k], key=lambda x: self.st[x[0]]['phases'] is None)[0]
                S = self.st[key]; o = S['cells'][ri]['obs']; ph = S['phases']; t = time.time()
                pp = None if ph is None else spread(ph)
                cid = (key[0], ri, key[1])
                start = self.partials.get(cid) or self.prefix
                if retry_failed and cid in self.failed and not self.partials.get(cid):
                    # 上次讀不完的那一格：最後一兩個字可能就是走錯的那一步，退兩個字再接著讀
                    start = self.failed[cid][:max(len(self.prefix), len(self.failed[cid]) - 2)] or self.prefix
                maxlen = self.maxlen or int(o.shape[1] / (P['em'] * 0.4)) + 2
                r = None
                for ai, alpha in enumerate([self.alphabet] + self.fallbacks):
                    r = read(o, phs=pp, alphabet=alpha, maxlen=maxlen, tag='rd%d_%s' % (ai, self.name), prefix=start, K=self.K)
                    if r['complete'] or r.get('interrupted'): break
                    if r['partial'] and len(r['partial']) > len(start): start = r['partial']   # 下一個字集從這裡接著讀
                if r.get('interrupted'):
                    got = r['partial'] if r['partial'] and len(r['partial']) > len(start) else start
                    if got: self.partials[cid] = got
                    self.log('[' + self.name + ']', key[0], 'R%02d' % (ri + 1), '這一格讀到一半到時間上限：已經讀了', len(got), '個字，寬', o.shape[1], '(%.0fs)' % (time.time() - t))
                    self.save()
                    raise BudgetExceeded('read interrupted')
                if r['complete']:
                    self.partials.pop(cid, None)
                    w = r['text']; self.vocab.append(w)
                    self.apply_all([w])
                    c, bad = self.summary()
                    self.log('[' + self.name + ']', key[0], 'R%02d' % (ri + 1), '讀到', repr(w), '%.2f' % r['err'], '其他候選',
                             [(round(e, 2), s) for e, s in r['alts'][1:3]], '→ 未吻合剩', bad, '(%.0fs)' % (time.time() - t))
                    if S['cells'][ri]['err'] >= OKERR:   # 讀到了卻套不回自己（長字串是分段吻合的，整格比對不回去）：直接記
                        S['cells'][ri].update(text=w, err=r['err'], alts=r['alts'][:3], direct=True)
                else:
                    r['partial'] = r['partial'] if r['partial'] and len(r['partial']) > len(start) else start
                    self.partials.pop(cid, None); self.failed[cid] = r['partial']
                    self.unread[k] = dict(cells=[(kk[0], kk[1], rr) for kk, rr in g[k]], partial=r['partial'], alts=r['alts'], steps=r['steps'][-2:])
                    self.log('[' + self.name + ']', key[0], 'R%02d' % (ri + 1), '讀不完：讀到', repr(r['partial']), '最接近',
                             [(round(e, 2), s) for e, s in r['alts'][:2]], '格數', len(g[k]), '寬', o.shape[1], '(%.0fs)' % (time.time() - t))
                self.save()
        except BudgetExceeded:
            self.log('[' + self.name + '] 到時間上限，先停在這裡（再跑一次會接著做）')
        finally:
            set_deadline(None)
        c, bad = self.summary(); self.log('[' + self.name + '] 結束：吻合', sum(c.values()), '未吻合', bad); self.log('   ', dict(c.most_common()))
        self.save()
        return self

    def refine_suspects(self, alphabet=None):
        """吻合的格子裡找「整格平均過關、但有一個地方對不上」的（區域誤差 > LOCAL_OK），把那個位置逐一換字再比。
        長字串與自由文字讀完之後一定要跑：選到長得像的另一個符號、長得幾乎一樣的字，只有這裡看得出來。
        每一種（像素, 字）要畫一次全部的起始位置，所以值很少的大欄位不需要跑（它們的區域誤差在 verify_local 看）。"""
        alphabet = alphabet or (self.fallbacks[-1] if self.fallbacks else self.alphabet)
        seen = {}; n = 0; left = 0
        try:
            for (stem, si), S in self.st.items():
                for ri, c in S['cells'].items():
                    if c['err'] >= OKERR or not c['text']: continue
                    k = (c['obs'].shape, c['obs'].tobytes(), c['text'])
                    if k not in seen:
                        if c['obs'].shape[1] > LONG * P['em']:
                            # 長字串：整格在同一個位置上比太嚴（正確的也會在尾巴對不上），照讀取時同一套規矩一步一步對
                            ck = check(c['obs'], c['text'], tag='ck_' + self.name)
                            seen[k] = dict(text=c['text'], err=c['err'], local=ck['err'] if ck['ok'] else max(ck['err'], LOCAL_OK + 0.01),
                                           before=(c['err'], ck['err']), at=ck['at'], changed=False)
                        else:
                            seen[k] = refine(c['obs'], c['text'], alphabet, tag='rf_' + self.name)
                    r = seen[k]
                    if r is None: continue
                    c['local'] = float(r['local'])
                    if r['changed']:
                        old = c['text']; c.update(text=r['text'], err=float(r['err']), alts=[(float(r['err']), r['text'])]); n += 1
                        if old in self.vocab: self.vocab.remove(old)
                        if r['text'] not in self.vocab: self.vocab.append(r['text'])
                        self.log('[' + self.name + ']', stem, 'R%02d' % (ri + 1), '修正', repr(old), '→', repr(r['text']),
                                 '區域誤差 %.2f → %.2f（第 %s 個字）' % (r['before'][1], r['local'], r['at']))
                    elif r['local'] > LOCAL_OK:
                        cid = (stem, ri, si)
                        if r['at'] and cid not in self.retracted:
                            # 換一個字救不回來（多半是連著兩個字錯、或多一個少一個字）：撤回，從可疑的位置前兩個字重讀。一格只撤一次
                            old = c['text']; keep = max(len(self.prefix), r['at'] - 3)
                            self.retracted.add(cid); self.partials[cid] = old[:keep]; self.failed.pop(cid, None)
                            if old in self.vocab: self.vocab.remove(old)
                            c.update(text=None, err=999.0, alts=[])
                            self.log('[' + self.name + ']', stem, 'R%02d' % (ri + 1), '撤回', repr(old), '從第 %d 個字重讀（區域誤差 %.2f，換字也沒有更好的）' % (keep + 1, r['local']))
                        else:
                            left += 1
                            self.log('[' + self.name + ']', stem, 'R%02d' % (ri + 1), '可疑：區域誤差 %.2f（第 %s 個字附近），換字、重讀都沒有更好的' % (r['local'], r['at']))
        except BudgetExceeded:
            self.log('[' + self.name + '] 換字比對到時間上限，先停在這裡')
        self.log('[' + self.name + '] 換字比對：修正', n, '格；還可疑', left, '格')
        self.save()
        return self

    def finalize(self):
        """還沒到完全吻合、但最接近的候選已經很近（< 8）的格子：在所有起始位置上再比一次。
        窮舉時每一欄只取三個起始位置，剛好落在邊界上的格子會差一點點。"""
        n = 0
        for S in self.st.values():
            for c in S['cells'].values():
                if c['err'] >= EXACT and not c.get('direct'):
                    labels = [l for e, l in c['alts'][:3] if e < 8] if c['alts'] else []
                    if not labels: continue
                    r = fine_decode(c['obs'], labels, tag='fin_' + self.name)
                    if r and r[0][0] < c['err']:
                        c.update(text=r[0][1], err=r[0][0], alts=r[:3]); n += 1
        c, bad = self.summary(); self.log('[' + self.name + '] 細掃之後：改善', n, '格；吻合', sum(c.values()), '未吻合', bad)
        self.save()
        return self

    def export(self):
        """{(stem, ri, si): dict(text, err, alts, best)}。text 是 None＝沒讀出來（best 是最接近的，不能當答案）。"""
        out = {}
        for (stem, si), S in self.st.items():
            for ri, c in S['cells'].items():
                out[(stem, ri, si)] = dict(text=c['text'] if c['err'] < OKERR else None, err=float(c['err']),
                                           alts=[(float(e), s) for e, s in c['alts']], best=c['text'], width=int(c['obs'].shape[1]))
                if 'local' in c: out[(stem, ri, si)]['local'] = c['local']   # 區域誤差（refine_suspects 跑過才有）
                if c.get('direct'): out[(stem, ri, si)]['direct'] = True     # 分段吻合的長字串
        for cid, part in self.failed.items():      # 讀不完的格子：讀到哪裡也一起交出去
            if cid in out and out[cid]['text'] is None: out[cid]['partial'] = part
        return dict(cells=out, vocab=self.vocab, unread=list(self.unread.values()), partials=self.partials, failed=self.failed, retracted=self.retracted)
