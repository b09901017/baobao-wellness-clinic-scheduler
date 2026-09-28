// 決定頁的畫面：`boardItems()` 的結果 → 一個自己帶 CSS／JS 的 HTML。
//
// 她 2026-09-28：「也許可以做成日曆的形式讓我知道哪幾天有什麼問題，哪種問題，以及可以切換成人等等，
// 就是我覺得我有點認知疲勞了」「我想要這份html更視覺化橫好決定，不要讓我認知疲勞」。
//
// 三種看法、同一份資料：
//   日曆 —— 哪一天有哪幾種（顏色＋數字），點一天攤開那一天的每一項
//   看人 —— 一位一列，點進去是那一位的全部
//   看種類 —— 照報告的分段；以後的雜事一列一筆、點一下就改
//
// **有真名**：只放 `.local/references/`，不發布、不連外（一個外部資源都沒有，離線打得開）。
// 樣子沿用她看過的那兩份問卷（`保留問題-2026-09-16.html`）：同一組顏色、同一種卡片。
//
// 回報的形狀（`record.mjs` 吃這個）：
//   { form, exportedAt, answers: [{ key, choice, label, note, hold, free, ops, snapshot }] }

import { KINDS } from './board.mjs';

/**
 * @param {{ items: object[], customers: object[], context: object, today: string|null }} board `boardItems()` 的結果
 * @param {{ form: string, span?: string[], generatedAt?: string }} meta
 */
export function renderBoard(board, meta) {
  const data = {
    form: meta.form,
    generatedAt: meta.generatedAt ?? null,
    span: meta.span ?? null,
    today: board.today,
    kinds: KINDS,
    customers: board.customers,
    visits: board.context?.visits ?? [],
    items: board.items,
  };
  // `</script>` 不可以出現在 JSON 裡 —— 行事曆原文是她打的字，什麼都可能有
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>合併的決定 ${esc(meta.form.replace(/^[^0-9]*/, ''))}</title>
<style>${CSS}</style>
</head><body>
<div class="bar"><div class="in">
  <div class="prog"><div class="t" id="progText"></div><div class="track"><div class="fill" id="progFill"></div></div></div>
  <button id="copyBtn" class="primary" type="button">複製回報</button>
  <button id="dlBtn" type="button">下載</button>
</div></div>
<div class="wrap">
  <h1>合併的決定</h1>
  <p class="sub" id="sub"></p>
  <p class="how">點<b>有顏色的那一天</b>（或切到「看人」點一位）→ 一項一項點選項。點完按右上<b>「複製回報」</b>貼給我。<br>
    做過的收起來了、不會再問；每一題選完都可以按<b>「保留」</b>，下一次再問你。</p>
  <div class="tiles" id="tiles"></div>
  <div class="views" role="tablist" id="views"></div>
  <div class="filters" id="filters"></div>
  <div class="legend" id="legend"></div>
  <main id="main"></main>
</div>
<div class="drawer" id="drawer" hidden><div class="scrim" data-close></div>
  <aside class="panel" role="dialog" aria-modal="true" aria-labelledby="drawerTitle">
    <header><h2 id="drawerTitle"></h2><button type="button" class="x" data-close aria-label="關掉">✕</button></header>
    <div class="body" id="drawerBody"></div>
  </aside></div>
<dialog id="dlg"><p>自動複製沒成功，請全選下面的內容複製：</p><textarea id="dlgText" readonly></textarea><p><button id="dlgClose" type="button">關閉</button></p></dialog>
<div class="toast" id="toast"></div>
<script type="application/json" id="data">${json}</script>
<script>${JS}</script>
</body></html>
`;
}


/**
 * 回報怎麼組。**頁面上跑的跟測試跑的是同一份**（`tests/merge-board-page.test.js` 拿它來跑）——
 * 雜事那一列要寫進決定檔的那幾條是在這裡算的，沒有別的地方算得到。
 *
 * 雜事那一列：先想清楚「決定檔裡這一筆應該長什麼樣」（`want`），再跟原本那一條（`prev`）比 ——
 * 不一樣就拿掉原本的、寫新的。只寫新的話，原本那一條（例：以前說不要）還在，下一輪照舊不匯。
 * 原本那一條帶著日期（休假改過起訖）或「今天以前也要留」的，改分類時一起帶過去。
 */
export const REPORT_SRC = String.raw`function buildReport(D, answers, now) {
  var KL = { leave: '休假', note: '待辦', personal: '行事備註' };
  var byKey = {}; D.items.forEach(function(it){ byKey[it.key] = it; });
  function optOf(it, id){ for (var i = 0; i < (it.options || []).length; i++) if (it.options[i].id === id) return it.options[i]; return null; }
  function canon(v){ if (Array.isArray(v)) return v.map(canon); if (v && typeof v === 'object') { var o = {}; Object.keys(v).filter(function(k){ return k.charAt(0) !== '_' && k !== 'q'; }).sort().forEach(function(k){ o[k] = canon(v[k]); }); return o; } return v; }
  function same(a, b){ return JSON.stringify(canon(a)) === JSON.stringify(canon(b)); }
  function snapshot(it){ return { kind: it.kind, date: it.date || null, endDate: it.endDate || null, who: it.who || null, sheet: it.sheet || null, title: it.title, facts: it.facts || [], now: it.now || null, options: it.options || [], urgent: !!it.urgent, event: it.event || null }; }
  function eventOps(it, a){
    var ev = it.event, prev = ev.prev || null, want = null;
    if (a.choice === 'drop') want = { date: it.date, title: it.title, skip: '她在決定頁說不要' };
    else {
      var kind = a.kind || ev.kind;
      var keepPrev = prev && !prev.skip ? prev : null;
      if (keepPrev) { want = {}; Object.keys(keepPrev).forEach(function(k){ if (k.charAt(0) !== '_') want[k] = keepPrev[k]; }); if (kind !== (keepPrev.kind || ev.autoKind)) want.kind = kind; }
      else if (kind !== ev.autoKind) want = { date: it.date, title: it.title, kind: kind };
    }
    if (prev && want && same(prev, want)) return [];
    var ops = [];
    if (prev) ops.push({ sheet: null, section: 'events', remove: prev });
    if (want) ops.push({ sheet: null, section: 'events', add: want });
    return ops;
  }
  var out = { form: D.form, exportedAt: now, answers: [] };
  Object.keys(answers).forEach(function(key){
    var it = byKey[key], a = answers[key]; if (!it || !a.choice) return;
    var o = { key: key, choice: a.choice, note: (a.note || '').trim() || null, hold: !!a.hold, snapshot: snapshot(it) };
    if (it.kind === 'event' && !it.fromRecord) {
      o.label = a.choice === 'drop' ? '不要' : '匯成' + KL[a.kind || it.event.kind];
      o.ops = eventOps(it, a);
    } else {
      var opt = optOf(it, a.choice) || {};
      o.label = opt.label || a.choice;
      if (opt.free) o.free = true; else o.ops = opt.ops || [];
    }
    out.answers.push(o);
  });
  return out;
}`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const CSS = `
:root{--bg:#f6f4ef;--card:#fffdf9;--ink:#26231f;--muted:#6f6a61;--line:#e3ded4;--soft:#efebe3;--accent:#2f6f5e;--accent-soft:#e1efe9;--warn:#9a5b13;--warn-soft:#f6ead8;--quote:#40506b;--quote-bg:#eceff5;--focus:#1f5fbf;--must:#a33a2a;
--k-red:#c0392b;--k-orange:#c2621a;--k-amber:#9a7400;--k-purple:#7b4bb3;--k-green:#2f7d4f;--k-pink:#b4437a;--k-teal:#1d7a82;--k-brown:#8a5a3c;--k-slate:#56677b;--k-violet:#6552c4;--k-blue:#2d66b5;--k-grey:#8b857b;}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#171614;--card:#201f1c;--ink:#ece8e0;--muted:#a39d92;--line:#35322d;--soft:#2a2824;--accent:#7cc4ae;--accent-soft:#233a33;--warn:#e0a35a;--warn-soft:#3a2d1c;--quote:#b7c4dc;--quote-bg:#262b35;--focus:#7aa7ff;--must:#f08a78;
--k-red:#f08a78;--k-orange:#f0a060;--k-amber:#e2c150;--k-purple:#c3a0f0;--k-green:#7fcf98;--k-pink:#f090bd;--k-teal:#6fc9cf;--k-brown:#d0a07e;--k-slate:#a9b6c7;--k-violet:#b2a6f5;--k-blue:#8db8f2;--k-grey:#aaa398;}}
:root[data-theme="dark"]{--bg:#171614;--card:#201f1c;--ink:#ece8e0;--muted:#a39d92;--line:#35322d;--soft:#2a2824;--accent:#7cc4ae;--accent-soft:#233a33;--warn:#e0a35a;--warn-soft:#3a2d1c;--quote:#b7c4dc;--quote-bg:#262b35;--focus:#7aa7ff;--must:#f08a78;
--k-red:#f08a78;--k-orange:#f0a060;--k-amber:#e2c150;--k-purple:#c3a0f0;--k-green:#7fcf98;--k-pink:#f090bd;--k-teal:#6fc9cf;--k-brown:#d0a07e;--k-slate:#a9b6c7;--k-violet:#b2a6f5;--k-blue:#8db8f2;--k-grey:#aaa398;}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--ink);font:15px/1.6 "PingFang TC","Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif;margin:0;padding-inline:16px;padding-block:0 96px}
.wrap{max-width:980px;margin:0 auto}
h1{font-size:1.5rem;margin:22px 0 2px}
.sub{color:var(--muted);margin:0 0 10px;font-size:.9rem}
.how{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 14px;margin:0 0 14px;font-size:.92rem}
.bar{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 92%,transparent);backdrop-filter:blur(6px);border-bottom:1px solid var(--line);margin:0 -16px 8px;padding:8px 16px}
.bar .in{max-width:980px;margin:0 auto;display:flex;gap:8px;align-items:center}
.prog{flex:1 1 auto;min-width:0}.prog .t{font-size:.88rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.prog .track{height:6px;background:var(--soft);border-radius:4px;overflow:hidden;margin-top:4px}.prog .fill{height:100%;background:var(--accent);width:0;transition:width .2s}
button{font:inherit;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:9px;padding:6px 12px;cursor:pointer;min-height:40px}
button.primary{background:var(--accent);border-color:var(--accent);color:var(--card);font-weight:600}
button:focus-visible,input:focus-visible,textarea:focus-visible,.cell:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:0 0 12px}
.tile{text-align:left;border-radius:12px;padding:8px 12px;min-height:0}
.tile b{display:block;font-size:1.45rem;line-height:1.2}.tile span{font-size:.82rem;color:var(--muted)}
.tile.open b{color:var(--must)}.tile.held b{color:var(--warn)}.tile.done b{color:var(--accent)}.tile.glance b{color:var(--k-blue)}
.tile[aria-pressed="true"]{border-color:var(--ink)}
@media (max-width:560px){.tiles{grid-template-columns:repeat(2,1fr)}}
.views{display:flex;gap:4px;background:var(--soft);border-radius:12px;padding:4px;margin:0 0 10px}
.views button{flex:1;border:0;background:transparent;border-radius:9px;min-height:40px}
.views button[aria-selected="true"]{background:var(--card);box-shadow:0 1px 2px rgba(0,0,0,.12);font-weight:600}
.filters{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px}
.filters button{border-radius:999px;font-size:.88rem;min-height:34px;padding:4px 12px}
.filters button[aria-pressed="true"]{background:var(--accent-soft);border-color:var(--accent)}
.legend{display:flex;flex-wrap:wrap;gap:6px 10px;margin:0 0 12px;font-size:.82rem;color:var(--muted)}
.legend span{display:inline-flex;align-items:center;gap:4px}
.dot{width:10px;height:10px;border-radius:50%;background:var(--kc);display:inline-block;flex:none}
[data-color=red]{--kc:var(--k-red)}[data-color=orange]{--kc:var(--k-orange)}[data-color=amber]{--kc:var(--k-amber)}[data-color=purple]{--kc:var(--k-purple)}[data-color=green]{--kc:var(--k-green)}[data-color=pink]{--kc:var(--k-pink)}[data-color=teal]{--kc:var(--k-teal)}[data-color=brown]{--kc:var(--k-brown)}[data-color=slate]{--kc:var(--k-slate)}[data-color=violet]{--kc:var(--k-violet)}[data-color=blue]{--kc:var(--k-blue)}[data-color=grey]{--kc:var(--k-grey)}
.month{margin:0 0 18px}
.month h2{font-size:1.1rem;margin:0 0 6px}
.grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
.wd{font-size:.75rem;color:var(--muted);text-align:center;padding-bottom:2px}
.cell{background:var(--card);border:1px solid var(--line);border-radius:10px;min-height:74px;padding:4px 5px;text-align:left;display:flex;flex-direction:column;gap:3px;min-width:0;cursor:default}
.cell.blank{background:transparent;border-color:transparent}
.cell .n{font-size:.8rem;color:var(--muted)}
.cell.today .n{color:var(--card);background:var(--accent);border-radius:999px;padding:0 6px;align-self:flex-start}
.cell.has{cursor:pointer}.cell.has:hover{border-color:var(--muted)}
.cell.open{border:2px solid var(--must)}
.cell.alldone{background:color-mix(in srgb,var(--accent) 8%,var(--card))}
.pill{display:flex;align-items:center;gap:4px;font-size:.75rem;line-height:1.25;color:var(--kc);background:color-mix(in srgb,var(--kc) 13%,var(--card));border-radius:6px;padding:1px 5px;white-space:nowrap;overflow:hidden}
.pill b{font-weight:700}
@media (max-width:640px){.cell{min-height:58px;padding:3px}.pill .lb{display:none}.pill{padding:0 4px;justify-content:center}}
.undated h2,.section h2{font-size:1.1rem;margin:22px 0 4px}
.section .lead{color:var(--muted);font-size:.88rem;margin:0 0 8px}
.people{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px}
.person{text-align:left;border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;min-height:0}
.person .nm{font-weight:600}.person .pills{display:flex;flex-wrap:wrap;gap:4px}
.person.quiet{opacity:.6}
.card{background:var(--card);border:1px solid var(--line);border-left:5px solid var(--kc);border-radius:12px;padding:12px 14px;margin:10px 0}
.card header{display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center;font-size:.85rem}
.chip{color:var(--kc);background:color-mix(in srgb,var(--kc) 13%,var(--card));border-radius:999px;padding:1px 9px;font-weight:600}
.card .who{font-weight:600}.card .date{color:var(--muted)}
.badge{border-radius:999px;padding:1px 8px;font-size:.78rem;border:1px solid currentColor}
.badge.held{color:var(--warn)}.badge.done{color:var(--accent)}.badge.urgent{color:var(--must);font-weight:700}.badge.translate{color:var(--k-violet)}
.card h3{font-size:1.02rem;margin:6px 0 0}
.facts{margin:8px 0 0;display:grid;gap:4px}
.fact{display:grid;grid-template-columns:7em 1fr;gap:8px}.fact dt{color:var(--muted);font-size:.82rem;padding-top:2px}.fact dd{margin:0}
.fact dd div+div{margin-top:2px}
.qt{color:var(--quote);background:var(--quote-bg);border-radius:5px;padding:0 4px;overflow-wrap:anywhere}
.now{margin:8px 0 0;font-size:.88rem;background:var(--warn-soft);border-radius:8px;padding:4px 10px}
.opts{display:grid;gap:6px;margin-top:10px}
.opt{text-align:left;border-radius:10px;padding:8px 12px;min-height:44px;display:flex;align-items:center;gap:8px}
.opt[aria-pressed="true"]{border-color:var(--accent);background:var(--accent-soft);font-weight:600}
.opt[aria-pressed="true"]::before{content:"✓";color:var(--accent)}
.rec{font-size:.72rem;color:var(--warn);border:1px solid currentColor;border-radius:999px;padding:0 6px;font-weight:400}
.after{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;margin-top:10px}
.hold{display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:.9rem;border:1px dashed var(--warn);color:var(--warn);border-radius:999px;padding:4px 12px}
.hold input{accent-color:var(--warn);width:18px;height:18px}
.linkish{border:0;background:none;color:var(--accent);text-decoration:underline;min-height:32px;padding:0}
.bulk{border-style:dashed;border-color:var(--accent);color:var(--accent);margin:0 0 6px}
.note{width:100%;font:inherit;border:1px solid var(--line);border-radius:9px;padding:7px 10px;background:var(--bg);color:var(--ink);resize:vertical;min-height:44px;margin-top:6px}
.compact .body-full{display:none}
.compact .sumline{margin:6px 0 0;font-size:.9rem}
.sumline b{color:var(--accent)}
.evrow{display:grid;grid-template-columns:4.2em 3.3em 1fr auto;gap:6px 8px;align-items:center;background:var(--card);border:1px solid var(--line);border-left:5px solid var(--kc);border-radius:10px;padding:6px 10px;margin:6px 0}
.evrow .d{font-size:.85rem;font-weight:600}.evrow .tm{font-size:.82rem;color:var(--muted)}
.evrow .ttl{overflow-wrap:anywhere}.evrow .why{display:block;font-size:.75rem;color:var(--muted)}
.evrow .ctl{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end}
.evrow .ctl button{min-height:34px;padding:2px 9px;font-size:.82rem;border-radius:8px}
.evrow .ctl button[aria-pressed="true"]{background:var(--accent-soft);border-color:var(--accent);font-weight:600}
.evrow.off{opacity:.55}.evrow.off .ttl{text-decoration:line-through}
@media (max-width:640px){.evrow{grid-template-columns:3.6em 1fr}.evrow .tm{display:none}.evrow .ctl{grid-column:1/-1;justify-content:flex-start}}
details.fold{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:8px 14px;margin:8px 0}
details.fold summary{cursor:pointer;font-weight:600}
details.fold ul{margin:6px 0 0;padding-left:1.2em;font-size:.88rem}
details.fold li{margin:2px 0}
.ctx{margin:14px 0 0;font-size:.86rem;color:var(--muted)}
.ctx ul{margin:4px 0 0;padding-left:1.2em}
.drawer{position:fixed;inset:0;z-index:20}
.drawer .scrim{position:absolute;inset:0;background:rgba(0,0,0,.35)}
.drawer .panel{position:absolute;top:0;right:0;bottom:0;width:min(560px,100vw);background:var(--bg);border-left:1px solid var(--line);display:flex;flex-direction:column}
.drawer header{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--line);background:var(--card)}
.drawer h2{font-size:1.1rem;margin:0;flex:1}
.drawer .x{min-width:44px}
.drawer .body{overflow-y:auto;padding:4px 14px 40px;flex:1}
.empty{color:var(--muted);padding:20px 0}
dialog{border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--ink);max-width:min(720px,92vw);width:100%}
dialog textarea{width:100%;height:50vh;font:12px/1.5 ui-monospace,Consolas,monospace;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:8px}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:8px 14px;border-radius:10px;opacity:0;transition:opacity .2s;pointer-events:none;z-index:30}.toast.on{opacity:1}
@media (max-width:520px){.fact{grid-template-columns:1fr;gap:0}}
`;

// 頁面上跑的那一段。刻意寫成不靠任何函式庫的一般 JS（她的電腦離線也打得開）。
const JS = String.raw`
(function(){
${REPORT_SRC}
var D = JSON.parse(document.getElementById('data').textContent);
var KEY = 'baobao-board:' + D.form;
var S = { answers: {}, view: 'cal', mode: 'todo', urgent: false };
try { var saved = JSON.parse(localStorage.getItem(KEY) || 'null'); if (saved) { S.answers = saved.answers || {}; S.view = saved.view || 'cal'; S.mode = saved.mode || 'todo'; } } catch (e) {}
// _fresh（這一次剛點的，先不要收起來）不存：重新打開頁面時，點過的照樣收成一行
function save(){ try { var keep = {}; Object.keys(S.answers).forEach(function(k){ var a = Object.assign({}, S.answers[k]); delete a._fresh; keep[k] = a; });
  localStorage.setItem(KEY, JSON.stringify({ answers: keep, view: S.view, mode: S.mode })); } catch (e) {} }

var byKey = {}; D.items.forEach(function(it){ byKey[it.key] = it; });
var WD = ['日','一','二','三','四','五','六'];
function el(tag, attrs, kids){ var n = document.createElement(tag); if (attrs) Object.keys(attrs).forEach(function(k){ var v = attrs[k]; if (v == null || v === false) return; if (k === 'text') n.textContent = v; else if (k === 'class') n.className = v; else if (k.slice(0,2) === 'on') n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v); }); (kids || []).forEach(function(c){ if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); }); return n; }
function quoted(parent, text){ String(text == null ? '' : text).split(/(「[^」]*」)/).forEach(function(part){ if (!part) return; if (part.charAt(0) === '「') parent.appendChild(el('span', { class: 'qt', text: part })); else parent.appendChild(document.createTextNode(part)); }); return parent; }
function md(date){ if (!date) return ''; var d = new Date(date + 'T00:00:00Z'); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + '（' + WD[d.getUTCDay()] + '）'; }
function kind(it){ return D.kinds[it.kind] || D.kinds.question; }

// ---------- 一項現在是什麼狀態 ----------
// open 要你決定｜held 保留中｜done 決定了｜translate 等我翻成規則｜glance 以後的雜事｜info 不用決定
function status(it){
  var a = S.answers[it.key];
  if (it.state === 'record' && !a) return 'done';
  if (it.kind === 'event') return a ? 'done' : (it.state === 'decided' ? 'done' : 'glance');
  if (!it.required && it.state !== 'held') return (it.state === 'record') ? 'done' : 'info';
  if (a) return a.hold ? 'held' : (a.choice === 'other' || optOf(it, a.choice) && optOf(it, a.choice).free ? 'translate' : 'done');
  if (it.state === 'held') return 'held';
  if (it.state === 'translate') return 'translate';
  if (it.state === 'decided' || it.state === 'record') return 'done';
  return 'open';
}
function optOf(it, id){ for (var i = 0; i < (it.options || []).length; i++) if (it.options[i].id === id) return it.options[i]; return null; }
function visible(it){
  var s = status(it);
  if (S.urgent && !it.urgent) return false;
  if (S.mode === 'todo') return s === 'open' || s === 'held';
  if (S.mode === 'all') return s !== 'info';
  return true;
}
function counts(){
  var c = { open: 0, held: 0, done: 0, glance: 0, translate: 0, total: 0 };
  D.items.forEach(function(it){ var s = status(it); if (c[s] != null) c[s] += 1; if (it.required || it.state === 'held') c.total += 1; });
  return c;
}

// ---------- 最上面 ----------
function renderTop(){
  var c = counts();
  var need = c.open + c.held;
  document.getElementById('progText').textContent = need ? ('還要你決定 ' + c.open + ' 項' + (c.held ? '、保留中 ' + c.held + ' 項' : '')) : '全部決定完了，按「複製回報」貼給我';
  var done = c.total ? Math.round(100 * (c.total - c.open) / c.total) : 100;
  document.getElementById('progFill').style.width = done + '%';
  var tiles = document.getElementById('tiles'); tiles.innerHTML = '';
  [['open', c.open, '要你決定', 'todo'], ['held', c.held, '保留中', 'todo'], ['done', c.done + c.translate, '已經決定', 'all'], ['glance', c.glance, '以後的雜事（看一眼）', 'events']].forEach(function(t){
    tiles.appendChild(el('button', { type: 'button', class: 'tile ' + t[0], onclick: function(){ if (t[3] === 'events') { S.view = 'type'; S.mode = 'all'; save(); render(); var s = document.getElementById('sec-event'); if (s) s.scrollIntoView(); } else { S.mode = t[3]; save(); render(); } } }, [el('b', { text: String(t[1]) }), el('span', { text: t[2] })]));
  });
}
function renderChrome(){
  var sub = document.getElementById('sub');
  sub.textContent = (D.today ? '今天 ' + md(D.today) + ' · ' : '') + D.customers.length + ' 位客戶' + (D.span ? ' · 行事曆 ' + D.span[0] + '～' + D.span[1] : '') + ' · 有真名，只在你的電腦';
  var views = document.getElementById('views'); views.innerHTML = '';
  [['cal', '日曆'], ['people', '看人'], ['type', '看種類']].forEach(function(v){
    views.appendChild(el('button', { type: 'button', role: 'tab', 'aria-selected': S.view === v[0] ? 'true' : 'false', text: v[1], onclick: function(){ S.view = v[0]; save(); render(); } }));
  });
  var f = document.getElementById('filters'); f.innerHTML = '';
  [['todo', '只看要決定的'], ['all', '也看已經決定的'], ['every', '全部（含不用決定的）']].forEach(function(m){
    f.appendChild(el('button', { type: 'button', 'aria-pressed': S.mode === m[0] ? 'true' : 'false', text: m[1], onclick: function(){ S.mode = m[0]; save(); render(); } }));
  });
  if (D.items.some(function(it){ return it.urgent; })) {
    f.appendChild(el('button', { type: 'button', 'aria-pressed': S.urgent ? 'true' : 'false', text: '⚠ 只看上線前要定的', onclick: function(){ S.urgent = !S.urgent; render(); } }));
  }
  var lg = document.getElementById('legend'); lg.innerHTML = '';
  var seen = {};
  D.items.filter(visible).forEach(function(it){ seen[it.kind] = (seen[it.kind] || 0) + 1; });
  Object.keys(D.kinds).forEach(function(k){ if (!seen[k]) return; var kk = D.kinds[k];
    lg.appendChild(el('span', { 'data-color': kk.color }, [el('i', { class: 'dot' }), kk.label + ' ' + seen[k]])); });
}

// ---------- 卡片 ----------
function card(it){
  var kk = kind(it), s = status(it), a = S.answers[it.key];
  if (it.kind === 'event' && !it.fromRecord) return evRow(it);
  var art = el('article', { class: 'card', 'data-color': kk.color, 'data-key': it.key });
  var head = el('header', null, [el('span', { class: 'chip', text: kk.short }), it.who ? el('span', { class: 'who', text: it.who }) : null,
    it.date ? el('span', { class: 'date', text: md(it.date) + (it.endDate ? '～' + md(it.endDate) : '') }) : null,
    it.urgent ? el('span', { class: 'badge urgent', text: '⚠ 上線前要定' }) : null,
    s === 'held' ? el('span', { class: 'badge held', text: '保留中' }) : null,
    s === 'done' ? el('span', { class: 'badge done', text: '已決定' }) : null,
    s === 'translate' ? el('span', { class: 'badge translate', text: '等我翻成規則' }) : null]);
  art.appendChild(head);
  art.appendChild(el('h3', { text: it.title }));
  // 決定過的收成一行（她：「之前我做過的決定就不要再問了」）；按「改」才攤開
  var collapsed = (s === 'done' || s === 'translate') && !OPENED[it.key] && !(a && a._fresh);
  if (collapsed && (it.prev || a)) {
    art.classList.add('compact');
    var chose = a ? (optOf(it, a.choice) || {}).label : (it.prev && it.prev.label);
    var when = a ? '剛剛' : (it.prev && it.prev.at ? shortDay(it.prev.at) + ' ' : '之前');
    var line = el('p', { class: 'sumline' }, [when + '選了：', el('b', { text: chose || '（見備註）' }),
      (a && a.note) || (it.prev && it.prev.note) ? '　備註：' + ((a && a.note) || it.prev.note) : '']);
    art.appendChild(line);
    if ((it.options || []).length) art.appendChild(el('button', { type: 'button', class: 'linkish', text: '改', onclick: function(){ OPENED[it.key] = true; refreshCard(it); } }));
    return art;
  }
  body(art, it);
  return art;
}
var OPENED = {};
function shortDay(at){ var m = /^\d{4}-(\d{2})-(\d{2})/.exec(at || ''); return m ? Number(m[1]) + '/' + Number(m[2]) : ''; }
function body(art, it){
  var dl = el('dl', { class: 'facts' });
  (it.facts || []).forEach(function(f){ var dd = el('dd'); (Array.isArray(f[1]) ? f[1] : [f[1]]).forEach(function(l){ dd.appendChild(quoted(el('div'), l)); }); dl.appendChild(el('div', { class: 'fact' }, [el('dt', { text: f[0] }), dd])); });
  // 保留中的：她上次先給的答案要看得到（她 9/15：「必須記錄我這次先回答了甚麼」）
  var saysAlready = (it.facts || []).some(function(f){ return /上次|9\/15 答/.test(f[0]); });
  if (it.state === 'held' && it.prev && it.prev.label && !saysAlready) {
    dl.appendChild(el('div', { class: 'fact' }, [el('dt', { text: '你上次先答' }), quoted(el('dd'), '「' + it.prev.label + '」' + (it.prev.note ? '　' + it.prev.note : ''))]));
  }
  if (dl.childNodes.length) art.appendChild(dl);
  if (it.now) art.appendChild(quoted(el('p', { class: 'now' }), '現在先照：' + it.now));
  if (!(it.options || []).length) return;
  var a = S.answers[it.key];
  var chosen = a ? a.choice : (it.state === 'held' && it.prev ? it.prev.choice : null);
  var opts = el('div', { class: 'opts', role: 'group', 'aria-label': it.title });
  it.options.forEach(function(o){
    var b = el('button', { type: 'button', class: 'opt', 'aria-pressed': chosen === o.id ? 'true' : 'false', onclick: function(){ choose(it, o.id); } }, [o.label, o.rec ? el('span', { class: 'rec', text: '建議' }) : null]);
    opts.appendChild(b);
  });
  art.appendChild(opts);
  if (chosen) {
    var held = a ? !!a.hold : it.state === 'held';
    var after = el('div', { class: 'after' });
    var hold = el('label', { class: 'hold' }, [el('input', { type: 'checkbox', checked: held ? true : null, onchange: function(e){ setAns(it, { hold: e.target.checked }); } }), '保留（下次再問我）']);
    after.appendChild(hold);
    var noteText = (a && a.note) || (it.prev && it.prev.note) || '';
    var ta = el('textarea', { class: 'note', rows: '2', placeholder: '寫給我的備註（選填）', hidden: noteText ? null : true, oninput: function(e){ setAns(it, { note: e.target.value }, true); } });
    ta.value = noteText;
    var free = optOf(it, chosen) && optOf(it, chosen).free;
    if (free) ta.hidden = false;
    after.appendChild(el('button', { type: 'button', class: 'linkish', text: '寫備註', onclick: function(){ ta.hidden = false; ta.focus(); } }));
    art.appendChild(after);
    art.appendChild(ta);
  }
}
function choose(it, id){
  var prev = S.answers[it.key] || {};
  var hold = prev.choice ? !!prev.hold : it.state === 'held';
  S.answers[it.key] = { choice: id, hold: hold, note: prev.note || '', _fresh: true };
  save(); refreshCard(it); renderTop();
}
function setAns(it, patch, quiet){
  var cur = S.answers[it.key] || { choice: it.prev && it.prev.choice, hold: it.state === 'held', note: '' };
  S.answers[it.key] = Object.assign({}, cur, patch, { _fresh: true });
  save(); if (!quiet) { refreshCard(it); } renderTop();
}
function refreshCard(it){
  document.querySelectorAll('[data-key]').forEach(function(n){ if (n.getAttribute('data-key') === it.key) { var fresh = card(it); n.replaceWith(fresh); } });
}

// ---------- 以後的雜事：一列一筆 ----------
var KL = { leave: '休假', note: '待辦', personal: '行事備註' };
function evState(it){ var a = S.answers[it.key]; return { keep: a ? a.choice !== 'drop' : !/不匯/.test(it.now || ''), kind: (a && a.kind) || it.event.kind }; }
function evRow(it){
  var kk = kind(it), st = evState(it);
  var row = el('div', { class: 'evrow' + (st.keep ? '' : ' off'), 'data-color': kk.color, 'data-key': it.key });
  row.appendChild(el('span', { class: 'd', text: md(it.date).replace(/（.）/, '') + (it.endDate ? '～' : '') }));
  row.appendChild(el('span', { class: 'tm', text: it.event.time || (st.kind === 'leave' ? '整天' : '') }));
  var t = el('span', { class: 'ttl' }, [it.title + (it.event.repeats ? ' ↻' : '') + (it.endDate ? '（到 ' + md(it.endDate) + '）' : ''), it.who ? el('span', { class: 'why', text: '提到：' + it.who }) : null]);
  row.appendChild(t);
  var ctl = el('span', { class: 'ctl' });
  ['leave', 'note', 'personal'].forEach(function(k){ ctl.appendChild(el('button', { type: 'button', 'aria-pressed': st.kind === k ? 'true' : 'false', text: KL[k], onclick: function(){ setEv(it, { kind: k, choice: 'keep' }); } })); });
  ctl.appendChild(el('button', { type: 'button', 'aria-pressed': st.keep ? 'false' : 'true', text: st.keep ? '不要' : '不要 ✓', onclick: function(){ setEv(it, { choice: st.keep ? 'drop' : 'keep' }); } }));
  row.appendChild(ctl);
  return row;
}
function setEv(it, patch){
  var st = evState(it);
  S.answers[it.key] = Object.assign({ choice: st.keep ? 'keep' : 'drop', kind: st.kind, hold: false }, S.answers[it.key] || {}, patch);
  save(); refreshCard(it); renderTop();
}

// ---------- 日曆 ----------
function renderCal(main){
  var dated = D.items.filter(function(it){ return it.date && visible(it); });
  var byDay = {};
  dated.forEach(function(it){ (byDay[it.date] = byDay[it.date] || []).push(it); });
  var months = Object.keys(byDay).map(function(d){ return d.slice(0, 7); }).filter(function(m, i, a){ return a.indexOf(m) === i; }).sort();
  if (!months.length) main.appendChild(el('p', { class: 'empty', text: S.mode === 'todo' ? '日曆上沒有要你決定的了 🎉' : '沒有東西' }));
  months.forEach(function(m){
    var box = el('section', { class: 'month' }, [el('h2', { text: Number(m.slice(0, 4)) + ' 年 ' + Number(m.slice(5)) + ' 月' })]);
    var grid = el('div', { class: 'grid' });
    WD.forEach(function(w){ grid.appendChild(el('div', { class: 'wd', text: w })); });
    var first = new Date(m + '-01T00:00:00Z'), pad = first.getUTCDay();
    var days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    for (var i = 0; i < pad; i++) grid.appendChild(el('div', { class: 'cell blank' }));
    for (var d = 1; d <= days; d++) {
      var date = m + '-' + (d < 10 ? '0' : '') + d;
      var list = byDay[date] || [];
      var open = list.some(function(it){ var s = status(it); return s === 'open' || s === 'held'; });
      var cell = el(list.length ? 'button' : 'div', { type: list.length ? 'button' : null, class: 'cell' + (list.length ? ' has' : '') + (open ? ' open' : (list.length ? ' alldone' : '')) + (date === D.today ? ' today' : ''),
        'aria-label': list.length ? md(date) + ' ' + list.length + ' 項' : null, onclick: list.length ? (function(dt){ return function(){ openDay(dt); }; })(date) : null }, [el('span', { class: 'n', text: String(d) })]);
      var groups = {};
      list.forEach(function(it){ (groups[it.kind] = groups[it.kind] || []).push(it); });
      Object.keys(D.kinds).forEach(function(k){ if (!groups[k]) return; var kk = D.kinds[k];
        cell.appendChild(el('span', { class: 'pill', 'data-color': kk.color }, [el('i', { class: 'dot' }), el('span', { class: 'lb', text: kk.short }), el('b', { text: String(groups[k].length) })])); });
      grid.appendChild(cell);
    }
    box.appendChild(grid);
    main.appendChild(box);
  });
  var undated = D.items.filter(function(it){ return !it.date && visible(it); });
  if (undated.length) {
    var sec = el('section', { class: 'undated' }, [el('h2', { text: '沒有日期的（買的東西、舊表、設定）' })]);
    undated.forEach(function(it){ sec.appendChild(card(it)); });
    main.appendChild(sec);
  }
}
function openDay(date){
  var list = D.items.filter(function(it){ return it.date === date && visible(it); });
  var body = [];
  list.forEach(function(it){ body.push(card(it)); });
  var vs = D.visits.filter(function(v){ return v.date === date; });
  if (vs.length) {
    var ul = el('ul');
    vs.forEach(function(v){ ul.appendChild(el('li', { text: v.who + '｜' + v.course + (v.startsAt ? ' ' + v.startsAt : '（時間不詳）') + (v.room ? ' ' + v.room : '') + (v.confidence === 'low' ? '（推測）' : '') })); });
    body.push(el('div', { class: 'ctx' }, [el('b', { text: '那天舊表與行事曆已經對好的（不用決定）' }), ul]));
  }
  openDrawer(md(date), body);
}

// ---------- 看人 ----------
function mine(it, c){ return it.sheet === c.sheet || (it.who && it.who.split(/[／、]/).indexOf(c.name) >= 0); }
function renderPeople(main){
  var busy = [], quiet = [];
  D.customers.forEach(function(c){ var list = D.items.filter(function(it){ return visible(it) && mine(it, c); }); (list.length ? busy : quiet).push({ c: c, list: list }); });
  var others = D.items.filter(function(it){ return visible(it) && !D.customers.some(function(c){ return mine(it, c); }); });
  var grid = el('div', { class: 'people' });
  busy.forEach(function(p){
    var pills = el('span', { class: 'pills' });
    var g = {}; p.list.forEach(function(it){ g[it.kind] = (g[it.kind] || 0) + 1; });
    Object.keys(D.kinds).forEach(function(k){ if (g[k]) pills.appendChild(el('span', { class: 'pill', 'data-color': D.kinds[k].color }, [el('i', { class: 'dot' }), el('span', { class: 'lb', text: D.kinds[k].short }), el('b', { text: String(g[k]) })])); });
    grid.appendChild(el('button', { type: 'button', class: 'person', onclick: function(){ openPerson(p.c); } }, [el('span', { class: 'nm', text: p.c.name + '（' + p.list.length + '）' }), pills]));
  });
  if (!busy.length) main.appendChild(el('p', { class: 'empty', text: '沒有要決定的了 🎉' }));
  main.appendChild(grid);
  if (others.length) {
    main.appendChild(el('section', { class: 'section' }, [el('h2', { text: '不是哪一位的（' + others.length + '）' })].concat(others.map(card))));
  }
  if (quiet.length) {
    var ul = el('ul'); quiet.forEach(function(p){ ul.appendChild(el('li', { text: p.c.name })); });
    main.appendChild(el('details', { class: 'fold' }, [el('summary', { text: '沒有要決定的 ' + quiet.length + ' 位' }), ul]));
  }
}
function openPerson(c){
  var list = D.items.filter(function(it){ return visible(it) && mine(it, c); })
    .sort(function(a, b){ return String(a.date || '').localeCompare(String(b.date || '')); });
  openDrawer(c.name, list.map(card));
}

// ---------- 看種類 ----------
var FOLD = { dropped: 1, sheetInfo: 1, sheetOnly: 1, unreadable: 1 };
function renderType(main){
  Object.keys(D.kinds).forEach(function(k){
    var kk = D.kinds[k];
    var list = D.items.filter(function(it){ return it.kind === k && (visible(it) || (S.mode !== 'todo' && FOLD[k])); });
    if (!list.length) return;
    var sec = el('section', { class: 'section', id: 'sec-' + k, 'data-color': kk.color }, [el('h2', null, [el('i', { class: 'dot' }), ' ' + kk.label + '（' + list.length + '）'])]);
    if (FOLD[k]) {
      var ul = el('ul'); list.forEach(function(it){ ul.appendChild(quoted(el('li'), (it.date ? md(it.date) + ' ' : '') + (it.who ? it.who + '｜' : '') + it.title)); });
      sec.appendChild(el('p', { class: 'lead', text: k === 'dropped' ? '今天以前的雜事，照你 9/28 說的不匯。列在這裡是讓你知道沒有漏掉。' : '不用決定，列出來讓你知道。' }));
      sec.appendChild(el('details', { class: 'fold' }, [el('summary', { text: '打開看 ' + list.length + ' 筆' }), ul]));
    } else {
      if (k === 'event') sec.appendChild(el('p', { class: 'lead', text: '預設全部匯進去（分類照標題猜的）。不要的按「不要」，分類錯了點一下改。' }));
      // 一整類都有「建議」的（例：最近兩週的待辦都建議「不用了」）：一顆鈕全部照建議 —— 還是她按的，而且按完一項一項都改得回來
      var bulk = list.filter(function(it){ return status(it) === 'open' && (it.options || []).some(function(o){ return o.rec; }); });
      if (bulk.length >= 2) {
        sec.appendChild(el('button', { type: 'button', class: 'bulk', text: '這 ' + bulk.length + ' 項全部選「建議」的那一個', onclick: function(){
          bulk.forEach(function(it){ var rec = it.options.filter(function(o){ return o.rec; })[0]; S.answers[it.key] = { choice: rec.id, hold: false, note: '', _fresh: true }; });
          save(); render(); toast('選好了 ' + bulk.length + ' 項，每一項都還可以改'); } }));
      }
      list.sort(function(a, b){ return String(a.date || '').localeCompare(String(b.date || '')); }).forEach(function(it){ sec.appendChild(card(it)); });
    }
    main.appendChild(sec);
  });
  var rec = D.items.filter(function(it){ return it.state === 'record'; });
  if (rec.length && S.mode !== 'todo') {
    var ul = el('ul'); rec.forEach(function(it){ ul.appendChild(quoted(el('li'), it.title + ' → ' + ((it.prev && it.prev.label) || '') + (it.prev && it.prev.note ? '（' + it.prev.note + '）' : ''))); });
    main.appendChild(el('details', { class: 'fold' }, [el('summary', { text: '以前的決定 ' + rec.length + ' 條' }), ul]));
  }
}

// ---------- 抽屜 ----------
var drawer = document.getElementById('drawer');
function openDrawer(title, nodes){
  document.getElementById('drawerTitle').textContent = title;
  var b = document.getElementById('drawerBody'); b.innerHTML = '';
  if (!nodes.length) b.appendChild(el('p', { class: 'empty', text: '這裡沒有要決定的了' }));
  nodes.forEach(function(n){ b.appendChild(n); });
  drawer.hidden = false; b.scrollTop = 0;
  drawer.querySelector('.x').focus();
}
function closeDrawer(){ drawer.hidden = true; render(); }
drawer.addEventListener('click', function(e){ if (e.target.hasAttribute('data-close')) closeDrawer(); });
document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && !drawer.hidden) closeDrawer(); });

// ---------- 回報 ----------
function report(){ return JSON.stringify(buildReport(D, S.answers, new Date().toISOString()), null, 1); }
function toast(msg){ var t = document.getElementById('toast'); t.textContent = msg; t.classList.add('on'); setTimeout(function(){ t.classList.remove('on'); }, 1800); }
document.getElementById('copyBtn').addEventListener('click', function(){
  var text = report();
  var fallback = function(){ var d = document.getElementById('dlg'); document.getElementById('dlgText').value = text; d.showModal(); document.getElementById('dlgText').select(); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function(){ toast('複製好了，貼到對話框給我'); }, fallback); else fallback();
});
document.getElementById('dlgClose').addEventListener('click', function(){ document.getElementById('dlg').close(); });
document.getElementById('dlBtn').addEventListener('click', function(){ var blob = new Blob([report()], { type: 'application/json' }); var url = URL.createObjectURL(blob); var a = document.createElement('a'); a.href = url; a.download = D.form + '-回報.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function(){ URL.revokeObjectURL(url); }, 1000); });

function render(){
  renderChrome(); renderTop();
  var main = document.getElementById('main'); main.innerHTML = '';
  if (S.view === 'people') renderPeople(main); else if (S.view === 'type') renderType(main); else renderCal(main);
}
render();
})();
`;
