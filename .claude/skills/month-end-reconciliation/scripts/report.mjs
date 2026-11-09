#!/usr/bin/env node
// 比對結果 → 給她看的那一頁（一個 HTML 檔，離線就打得開）。
//
//   node report.mjs <比對.json> <對帳結果.html>
//
// 她 2026-11-04 定的樣子（第一版每件一張卡、四格並排加「多半是／怎麼辦」，她說「太複雜，認知負荷過載」）：
// 一句結論 → 三個數字 → 月曆（留著）→ 底下幾張小表，**一列就是「哪一天、哪一位、Abovee 怎麼寫、app 怎麼寫」**，
// 讓她知道要去找哪一天的誰。順序固定：
//   1. 可能少截（哪一天幾點到幾點、有誰）
//   2. Abovee 和 app 對不上（次數不一樣）
//   3. 只有時間不一樣（次數對）
//   4. 舊表（.xlsx）多勾／少勾
//   5. Abovee 上有、app 裡沒有這個人
//   6. 不影響次數，看看就好（幾行字）
// 沒事的那一塊整塊不畫。不寫推論段落（「多半是……」）；要她做的事一塊最多一句。每一位的次數表、這一頁怎麼來的收起來。
// 不出現程式的字（kind、bucket、entitlement）。有真名，只能留在 .local/，不要發佈成 Artifact。
import { readFileSync, writeFileSync } from 'node:fs';

const [src, out] = process.argv.slice(2);
if (!src || !out) {
  console.error('用法：node report.mjs <比對.json> <對帳結果.html>');
  process.exit(2);
}
const R = JSON.parse(readFileSync(src, 'utf8'));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const WD = ['日', '一', '二', '三', '四', '五', '六'];
const dow = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const md = (iso) => (iso ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}（${WD[dow(iso)]}）` : '');
const mdShort = (iso) => (iso ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}` : '');
const hm = (t) => String(t ?? '').slice(0, 5);
const [Y, M] = R.meta.month.split('-').map(Number);
const APP_WORD = { pending_confirm: '待確認', confirmed: '已確認', done: '已完成', no_show: '未到', cancelled: '已取消' };

// ---------- 每一件放進哪一塊 ----------
/** 2：次數不一樣（Abovee 與 app 的狀態或有沒有這一段不一樣） */
const COUNT = new Set(['unsigned', 'closeBlocked', 'missing', 'appCancelled', 'status', 'stillBooked', 'extra', 'extraOpen',
  'missingOpen', 'bothOpen', 'aboveeBehind', 'course', 'mergeUnmarked', 'timeAndStatus', 'familyMissing']);
/** 3：只差時間 */
const TIME = new Set(['timeOnly', 'moved']);
/** app 自己要修的（不是 Abovee 對 app）：照有才畫 */
const APPFIX = new Set(['cache', 'sheet', 'unknown', 'unknownCourse', 'other']);

const issues = R.issues ?? [];
const minor = R.minor ?? [];
const countRows = issues.filter((i) => COUNT.has(i.type));
const timeRows = [...issues, ...minor].filter((i) => TIME.has(i.type));
const appFix = issues.filter((i) => APPFIX.has(i.type));
const quiet = minor.filter((i) => !TIME.has(i.type));
const gaps = R.gaps ?? [];
const legacy = R.legacy ?? { rows: [] };
const tt = R.timetree ?? { missing: [] };
const strangers = R.strangers ?? [];

// ---------- 一格的字 ----------
const aboveeCell = (i) => {
  const a = i.abovee;
  if (!a) return '<span class="none">沒有這一段</span>';
  const course = a.with ? `${a.with.course}＋${a.course}` : a.course;
  const tail = i.type === 'mergeUnmarked' ? '<span class="note">兩列，沒標合併扣課</span>' : '';
  return `${esc(course)} <b>${esc(a.status)}</b>${i.time ? ` <span class="t">${esc(hm(a.with?.time ?? i.time))}</span>` : ''}${tail}`;
};
const appCell = (i) => {
  const a = i.app;
  if (!a) return '<span class="none">沒有這一段</span>';
  return `${esc(a.name)} <b>${esc(APP_WORD[a.status] ?? a.status)}</b>${a.time ? ` <span class="t">${esc(hm(a.time))}</span>` : ''}${
    i.type === 'mergeUnmarked' ? '<span class="note">一段</span>' : ''}`;
};

/** 同一天、同一位、同一種、兩邊狀態一樣的幾段收成一列（客戶A 同一天的 ILIB 與 EECP 都是 Abovee 取消、app 已完成那種） */
function grouped(list) {
  const map = new Map();
  for (const i of list) {
    const k = [i.date, i.customerId ?? i.name, i.type, i.abovee?.status ?? '-', i.app?.status ?? '-'].join('|');
    (map.get(k) ?? map.set(k, []).get(k)).push(i);
  }
  return [...map.values()].sort((a, b) => `${a[0].date}|${a[0].time}`.localeCompare(`${b[0].date}|${b[0].time}`));
}
const joinCells = (list, f) => list.map(f).join('<br>');

const row = (date, cells) => `<tr data-date="${esc(date ?? '')}"><td class="d">${esc(mdShort(date))}</td>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
const table = (heads, body) => `<div class="tw"><table class="tbl"><thead><tr><th>日期</th>${heads.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body.join('')}</tbody></table></div>`;
const block = (id, title, n, inner, todo = '') => `<section class="block" id="${id}"><h2>${esc(title)}<span class="n">${n}</span></h2>${inner}${
  todo ? `<p class="todo">${esc(todo)}</p>` : ''}</section>`;

// 1. 可能少截
const gapHtml = gaps.length ? block('gaps', '可能少截', `${gaps.length} 段`, gaps.map((g) => {
  const [d1, t1] = g.from.split(' ');
  const [d2, t2] = g.to.split(' ');
  const when = d1 === d2 ? `${md(d1)} ${t1} ～ ${t2}` : `${md(d1)} ${t1} ～ ${md(d2)} ${t2}`;
  const why = g.twin ? `「${g.twin}」跟「${g.after}」一模一樣（同一頁截了兩次），下一頁沒截到` : `「${g.after}」與「${g.before}」之間 app 有段、截圖上沒有`;
  return `<div class="gap"><p class="gap__h">${esc(when)}</p><p class="gap__why">${esc(why)}</p>${
    g.slots.length ? table(['時間', '誰', 'app'], g.slots.map((x) => row(x.date, [esc(x.time), `<span class="who">${esc(x.name)}</span>`,
      `${esc(x.course)} <b>${esc(APP_WORD[x.status] ?? x.status)}</b>`]))) : ''}</div>`;
}).join(''), 'Abovee 補截這幾段，放進截圖資料夾，跟 Claude 說「補好了」。') : '';

// 2. 次數不一樣
const countGroups = grouped(countRows);
const countHtml = countGroups.length ? block('count', 'Abovee 和 app 對不上', `${countGroups.length} 件`,
  table(['誰', 'Abovee', 'app'], countGroups.map((g) => row(g[0].date, [`<span class="who">${esc(g[0].name)}</span>`,
    joinCells(g, aboveeCell), joinCells(g, appCell)])))) : '';

// 3. 只差時間
const timeGroups = grouped(timeRows);
const timeHtml = timeGroups.length ? block('time', '只有時間不一樣（次數對）', `${timeGroups.length} 件`,
  table(['誰', 'Abovee', 'app'], timeGroups.map((g) => row(g[0].date, [`<span class="who">${esc(g[0].name)}</span>`,
    joinCells(g, aboveeCell), joinCells(g, appCell)]))), '去 app 日曆把時間改成跟 Abovee 一樣。') : '';

// 4. 舊表（同一天同一位、同一種（多勾或少勾）的幾格收成一列）
const legacyGroups = [...(legacy.rows ?? []).reduce((m, r) => {
  const k = `${r.date}|${r.name}|${r.kind}`;
  return m.set(k, [...(m.get(k) ?? []), r]);
}, new Map()).values()];
const uniq = (list) => [...new Set(list)].join('、');
const legacyHtml = legacyGroups.length ? block('legacy', '舊表（.xlsx）多勾／少勾', `${legacyGroups.length} 件`,
  table(['誰', '舊表', 'Abovee', 'app'], legacyGroups.map((g) => row(g[0].date, [`<span class="who">${esc(g[0].name)}</span>`,
    `<b>${esc(g[0].kind === 'extra' ? `${uniq(g.map((r) => r.sheet.replace(/ 勾了$/, '')))} 勾了` : '沒勾')}</b>`,
    esc(uniq(g.map((r) => r.abovee))), esc(uniq(g.map((r) => r.app)))])))) : '';

// 5. app 裡沒有的人
const strangerRows = strangers.flatMap((p) => p.rows.map((r) => ({ ...r, name: p.name, maybe: p.maybe })))
  .sort((a, b) => `${a.date}|${a.time}`.localeCompare(`${b.date}|${b.time}`));
const strangerHtml = strangerRows.length ? block('strangers', 'Abovee 上有、app 裡沒有這個人', `${strangers.length} 位`,
  table(['誰', 'Abovee'], strangerRows.map((r) => row(r.date, [`<span class="who">${esc(r.name)}</span>`,
    `${esc(r.course)} <b>${esc(r.status)}</b>${r.paidBy ? `<span class="note">扣 ${esc(r.paidBy)} 的號碼</span>` : ''}${
      r.maybe?.length ? `<span class="note">app 上同一個時間是 ${esc(r.maybe.map((m) => m.name).join('、'))}，可能是同一位</span>` : ''}`]))),
  '不是妳的客人就不用管；要記進 app，拍 Abovee 時那一列按「記成一次性客人」。') : '';

// app 自己要修的（有才畫）
const appFixHtml = appFix.length ? block('appfix', 'app 裡要修的', `${appFix.length} 件`,
  `<ul class="lines">${appFix.map((i) => `<li>${i.date ? `${esc(mdShort(i.date))} ` : ''}<b>${esc(i.name ?? '')}</b>：${esc(i.say)}<span class="t">（${esc(i.todo)}）</span></li>`).join('')}</ul>`) : '';

// 6. 不影響次數
const who = (list) => grouped(list).map((g) => `${mdShort(g[0].date)} ${g[0].name}${g.length > 1 ? ` ×${g.length}` : ''}`).join('、');
const QUIET = [
  ['statusNoCount', 'Abovee「已取消」、app「未到」（兩邊都不扣）'],
  ['extraNoShow', 'app 記「未到」、Abovee 上沒有'],
  ['missingNoShow', 'Abovee「客戶失約」、app 上沒有'],
  ['appCancelled', 'Abovee 還沒結案、app 那一段取消了'],
  ['diffs', '治療師或診間不一樣'],
  ['mergedOneSlot', '合併扣課的兩列，app 記成一段（兩邊都扣一次）'],
  ['missingFuture', '還沒到的預約，app 上還沒有'],
  ['extraFuture', '還沒到的預約，Abovee 上還沒有'],
  ['unknownCourse', 'Abovee 取消了、課程 app 認不出來'],
];
const quietLines = [
  ...QUIET.map(([type, label]) => [label, quiet.filter((i) => i.type === type)]).filter(([, l]) => l.length).map(([label, l]) => `${esc(label)}：${esc(who(l))}`),
  ...(tt.file && tt.missing.length ? [`TimeTree 那天沒寫（Abovee 有做完）：${esc(tt.missing.map((m) => `${mdShort(m.date)} ${m.name}`).join('、'))}`] : []),
  ...(appFix.some((i) => i.type === 'sheet') ? [] : ['試算表（app 推過去的那一份）跟 app 一樣 ✓']),
];
const quietHtml = quietLines.length ? `<section class="block block--quiet" id="quiet"><h2>不影響次數，看看就好</h2><ul class="lines">${
  quietLines.map((l) => `<li>${l}</li>`).join('')}</ul></section>` : '';

// ---------- 結論、三個數字 ----------
const parts = [
  [gaps.length, '可能少截', 'gaps'], [countGroups.length, '次數不一樣', 'count'], [timeGroups.length, '只差時間', 'time'],
  [legacyGroups.length, '舊表', 'legacy'], [appFix.length, 'app 要修', 'appfix'],
].filter(([n]) => n);
const total = parts.reduce((n, [k]) => n + k, 0);
const verdict = total === 0
  ? `<section class="verdict verdict--ok"><div class="verdict__mark">✓</div><div><h2>全部對得上</h2>
      <p>Abovee、app${legacy.file ? '、舊表' : ''}、試算表，${M} 月的次數一樣。</p></div></section>`
  : `<section class="verdict verdict--warn"><div class="verdict__mark">${total}</div><div><h2>有 ${total} 件要看</h2>
      <p class="chips">${parts.map(([n, label, id]) => `<a class="chip" href="#${id}">${esc(label)} ${n}</a>`).join('')}</p></div></section>`;

const T = R.summary.totals ?? { abovee: 0, app: 0, sheet: 0 };
const skipped = R.days.filter((d) => d.coverage === 'gap' || d.coverage === 'edge').map((d) => mdShort(d.date));
const partial = R.meta.from && (R.meta.from !== R.days[0]?.date || R.meta.to !== R.days[R.days.length - 1]?.date);
const rangeWord = [partial ? `截了 ${mdShort(R.meta.from)}～${mdShort(R.meta.to)}` : '', skipped.length ? `${skipped.join('、')} 沒截完整，不算` : '']
  .filter(Boolean).join('；');
const eq = (a, b) => (a === b ? '<span class="eq">＝</span>' : '<span class="eq eq--bad">≠</span>');
const three = `<section class="three"><p class="three__t">有額度的課，這個月做完幾次${rangeWord ? `（${esc(rangeWord)}）` : ''}</p><div class="three__row">
  <div class="three__c"><p class="three__k">Abovee 課程完成</p><p class="three__n">${T.abovee}</p></div>${eq(T.abovee, T.app)}
  <div class="three__c"><p class="three__k">app 已完成</p><p class="three__n">${T.app}</p></div>${eq(T.app, T.sheet)}
  <div class="three__c"><p class="three__k">試算表 ✓</p><p class="three__n">${T.sheet}</p></div></div></section>`;

// ---------- 月曆 ----------
const perDay = {};
for (const g of [...countGroups, ...timeGroups]) perDay[g[0].date] = (perDay[g[0].date] ?? 0) + 1;
for (const g of legacyGroups) perDay[g[0].date] = (perDay[g[0].date] ?? 0) + 1;
const lead = (dow(`${R.meta.month}-01`) + 6) % 7; // 星期一開頭
const cells = [];
for (let k = 0; k < lead; k += 1) cells.push('<div class="day day--pad"></div>');
for (const d of R.days) {
  const n = perDay[d.date] ?? 0;
  const gap = d.coverage === 'gap';
  const cls = d.coverage === 'out' ? 'day--out' : n ? 'day--bad' : gap ? 'day--gap' : d.coverage === 'edge' ? 'day--edge' : d.abovee || d.app ? 'day--ok' : 'day--empty';
  const mark = d.coverage === 'out' ? '' : n ? `<span class="day__n">${n}</span>` : gap ? '<span class="day__part">少截</span>'
    : d.coverage === 'edge' ? '<span class="day__part">部分</span>' : d.abovee || d.app ? '<span class="day__ok">✓</span>' : '';
  cells.push(`<button type="button" class="day ${cls}${gap && n ? ' day--gapbad' : ''}" data-day="${d.date}" ${n || gap ? '' : 'aria-disabled="true"'}>
    <span class="day__d">${Number(d.date.slice(8))}</span>${mark}<span class="day__sub">${d.abovee ? `${d.abovee} 段` : ''}</span></button>`);
}
const calendar = `<section class="block"><div class="block__h"><h2>哪一天</h2><button type="button" class="reset" data-reset hidden>看全部</button></div>
  <div class="cal"><div class="cal__h">${['一', '二', '三', '四', '五', '六', '日'].map((w) => `<span>${w}</span>`).join('')}</div>
  <div class="cal__g">${cells.join('')}</div></div>
  <p class="legend"><span class="lg lg--bad">2</span> 有幾件要看　<span class="lg lg--ok">✓</span> 對得上　<span class="lg lg--part">少截</span> 可能少截了一頁　點有數字的那一天，下面只列那一天</p></section>`;

// ---------- 收起來的 ----------
const personRow = (b) => `<tr class="${b.ok ? '' : 'bad'}"><td>${b.ok ? '✓' : '✗'} ${esc(b.label)}</td><td class="n">${b.abovee == null ? '不壓' : b.abovee}</td>
  <td class="n">${b.app}</td><td class="n">${b.sheet ?? '—'}</td><td class="n">${b.remaining ?? '—'}</td></tr>`;
const peopleHtml = `<details class="block block--fold"><summary><h2>每一位這個月做了幾次</h2></summary>
  ${R.people.map((p) => `<p class="pname">${p.ok ? '✓' : '<span class="badt">✗</span>'} ${esc(p.name)}</p>
  <div class="tw"><table class="tbl tbl--n"><thead><tr><th>項目</th><th>Abovee</th><th>app</th><th>試算表</th><th>還剩</th></tr></thead>
  <tbody>${p.buckets.map(personRow).join('')}</tbody></table></div>`).join('')}</details>`;
const px = R.meta.pixel;
const howHtml = `<details class="block block--fold"><summary><h2>這一頁怎麼來的</h2></summary><ul class="lines">
  <li>Abovee：${R.meta.shots.length} 張截圖、${R.meta.aboveeRows} 段，每一格逐像素驗證${px ? `（${px.ok}/${px.cells} 格吻合）` : '（這一次沒有驗證）'}。</li>
  <li>app：讀${R.meta.emulator ? '本機模擬器' : R.meta.project === 'wellness-clinic-scheduler' ? '正式站' : esc(R.meta.project)}的資料（只讀），${esc((R.meta.readAt ?? '').slice(0, 16).replace('T', ' '))}。</li>
  <li>試算表：用 app 推試算表的同一支程式現算。${legacy.file ? `舊表：${esc(legacy.file)}（${legacy.ticks} 格勾）。` : ''}${tt.file ? `TimeTree：${esc(tt.file)}。` : ''}</li>
  <li>「今天」算 ${esc(R.meta.today)}，之後的預約還沒發生，不算對不上。</li></ul></details>`;

const html = `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${Y} 年 ${M} 月對帳</title>
<style>
:root{--bg:#f6f5f2;--card:#fff;--ink:#1f2328;--mute:#6b7178;--line:#e4e1da;--ok:#17714b;--ok-bg:#d5efe2;--bad:#c0271a;--bad-bg:#fbdedb;--warn:#995400;--warn-bg:#fbeacd}
@media (prefers-color-scheme:dark){:root{--bg:#161719;--card:#1f2124;--ink:#e8e6e3;--mute:#9aa0a6;--line:#33363a;--ok:#6fc79a;--ok-bg:#123024;--bad:#f08a7c;--bad-bg:#3a1e1a;--warn:#e8a94a;--warn-bg:#3a2c14}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 "Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif}
.page{max-width:760px;margin:0 auto;padding:28px 16px 64px}
.top h1{font-size:30px;margin:2px 0 0}.kicker{margin:0;color:var(--mute);font-size:14px;letter-spacing:.1em}.sub{margin:4px 0 0;color:var(--mute);font-size:14px}
h2{font-size:18px;margin:0 0 10px;display:flex;align-items:center;gap:8px}
.n{margin-left:auto;font-size:12px;font-weight:400;color:var(--mute);border:1px solid var(--line);border-radius:999px;padding:0 9px}
.verdict{display:flex;gap:16px;align-items:center;border-radius:18px;padding:20px;margin:22px 0 14px}
.verdict h2{font-size:24px;margin:0}.verdict p{margin:4px 0 0;color:var(--mute)}
.verdict--ok{background:var(--ok-bg)}.verdict--ok .verdict__mark{background:var(--ok)}.verdict--warn{background:var(--bad-bg)}.verdict--warn .verdict__mark{background:var(--bad)}
.verdict__mark{flex:none;width:60px;height:60px;border-radius:50%;color:#fff;font-size:30px;font-weight:700;display:grid;place-items:center}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{font-size:13px;color:var(--ink);text-decoration:none;background:var(--card);border:1px solid var(--line);border-radius:999px;padding:2px 10px}
.three{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px 16px;margin-bottom:16px}
.three__t{margin:0 0 8px;font-size:13px;color:var(--mute)}.three__row{display:flex;align-items:center;gap:6px}.three__c{flex:1;min-width:0;text-align:center}
.eq{font-size:22px;color:var(--ok);font-weight:700}.eq--bad{color:var(--bad)}.three__k{margin:0;color:var(--mute);font-size:12px}
.three__n{margin:0;font-size:28px;font-weight:700;font-variant-numeric:tabular-nums}
.block{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px;margin:0 0 16px}
.block--quiet{background:transparent}.block--fold{background:transparent}.block--fold>summary{cursor:pointer;list-style:none}
.block--fold>summary h2{margin:0;color:var(--mute);font-size:16px}.block--fold>summary h2::before{content:'▸';margin-right:4px}.block--fold[open]>summary h2::before{content:'▾'}
.block__h{display:flex;justify-content:space-between;align-items:baseline}
.tw{overflow-x:auto}.tbl{width:100%;border-collapse:collapse;font-size:14px}
.tbl th{font-size:12px;color:var(--mute);font-weight:400;text-align:left;padding:4px 6px;border-bottom:1px solid var(--line);white-space:nowrap}
.tbl td{padding:7px 6px;border-top:1px solid var(--line);vertical-align:top}.tbl tr:first-child td{border-top:0}
.tbl td.d{white-space:nowrap;font-weight:700}.who{font-weight:700;white-space:nowrap}
.t{color:var(--mute);font-size:12px;white-space:nowrap}.none{color:var(--mute)}.note{display:block;font-size:12px;color:var(--warn)}
.todo{margin:10px 0 0;font-size:13px;color:var(--mute)}
.gap{border-left:4px solid var(--warn);background:var(--warn-bg);border-radius:10px;padding:10px 12px;margin:0 0 10px}
.gap__h{margin:0;font-weight:700}.gap__why{margin:2px 0 6px;font-size:13px;color:var(--mute)}.gap .tbl td{border-color:rgba(0,0,0,.08)}
.lines{margin:0;padding-left:20px;font-size:14px}.lines li{margin:4px 0}
.cal__h,.cal__g{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}.cal__h span{text-align:center;color:var(--mute);font-size:12px;padding-bottom:4px}
.day{aspect-ratio:1/1;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--ink);font:inherit;padding:4px;display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:0}
.day--pad{visibility:hidden}.day--out{opacity:.25;background:transparent;border-style:dashed}.day--empty{opacity:.45}.day--edge{border-style:dashed}
.day--gap{border:2px dashed var(--warn);cursor:pointer}.day--gapbad{border-style:dashed}
.day__d{font-size:13px;color:var(--mute);line-height:1}.day__ok{color:var(--ok);font-size:18px;line-height:1.2;font-weight:700}.day__sub{font-size:10px;color:var(--mute);line-height:1}
.day__part{font-size:11px;color:var(--warn);border:1px dashed var(--warn);border-radius:4px;padding:0 3px;margin:2px 0}
.day--bad{background:var(--bad-bg);border-color:var(--bad);cursor:pointer}.day__n{background:var(--bad);color:#fff;border-radius:999px;min-width:22px;height:22px;display:grid;place-items:center;font-size:13px;font-weight:700;margin:2px 0}
.day[aria-pressed="true"]{outline:3px solid var(--ink);outline-offset:1px}
.legend{margin:10px 0 0;font-size:12px;color:var(--mute);display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center}
.lg{display:inline-grid;place-items:center;min-width:18px;height:18px;border-radius:999px;font-size:11px;font-weight:700}.lg--bad{background:var(--bad);color:#fff}.lg--ok{color:var(--ok)}
.lg--part{font-size:10px;font-weight:400;border:1px dashed var(--warn);border-radius:4px;padding:0 3px;color:var(--warn)}
.reset{font:inherit;font-size:13px;background:none;border:1px solid var(--line);border-radius:999px;padding:3px 12px;color:var(--ink);cursor:pointer}
.pname{margin:12px 0 2px;font-weight:700}.badt{color:var(--bad)}.tbl--n td.n{text-align:right;font-variant-numeric:tabular-nums}.tbl tr.bad td{background:var(--bad-bg)}
.foot{color:var(--mute);font-size:12px;text-align:center;margin-top:28px}
@media (max-width:520px){.three__n{font-size:22px}.verdict{padding:16px}.verdict__mark{width:50px;height:50px;font-size:24px}.top h1{font-size:26px}.day__sub{display:none}.tbl{font-size:13px}}
</style></head><body><main class="page">
<header class="top"><p class="kicker">月底對帳</p><h1>${Y} 年 ${M} 月</h1><p class="sub">以 Abovee 截圖為準，跟 app${legacy.file ? '、舊表' : ''}${tt.file ? '、TimeTree' : ''} 對一次</p></header>
${verdict}
${three}
${calendar}
${gapHtml}
${countHtml}
${timeHtml}
${legacyHtml}
${strangerHtml}
${appFixHtml}
${quietHtml}
${peopleHtml}
${howHtml}
<p class="foot">產生於 ${esc(R.meta.generatedAt.slice(0, 16).replace('T', ' '))}（UTC）・有客戶姓名，不要轉傳</p>
</main>
<script>
(() => {
  const rows = [...document.querySelectorAll('tr[data-date]')];
  const gaps = [...document.querySelectorAll('.gap')];
  const reset = document.querySelector('[data-reset]');
  const days = [...document.querySelectorAll('.day[data-day]')];
  const blocks = [...document.querySelectorAll('section.block[id]')];
  function clear() {
    rows.forEach((r) => { r.hidden = false; }); gaps.forEach((g) => { g.hidden = false; }); blocks.forEach((b) => { b.hidden = false; });
    days.forEach((d) => d.setAttribute('aria-pressed', 'false')); if (reset) reset.hidden = true;
  }
  days.forEach((d) => d.addEventListener('click', () => {
    if (d.hasAttribute('aria-disabled')) return;
    const on = d.getAttribute('aria-pressed') === 'true';
    clear();
    if (on) return;
    d.setAttribute('aria-pressed', 'true');
    rows.forEach((r) => { r.hidden = r.dataset.date !== d.dataset.day; });
    gaps.forEach((g) => { g.hidden = ![...g.querySelectorAll('tr[data-date]')].some((r) => !r.hidden); });
    blocks.forEach((b) => { if (b.querySelector('tr[data-date]')) b.hidden = ![...b.querySelectorAll('tr[data-date]')].some((r) => !r.hidden); });
    if (reset) reset.hidden = false;
    const first = blocks.find((b) => !b.hidden && b.querySelector('tr[data-date]'));
    first?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  reset?.addEventListener('click', clear);
})();
</script></body></html>`;

writeFileSync(out, html);
console.log(`寫好了：${out}（要看的 ${total} 件：${parts.map(([n, label]) => `${label} ${n}`).join('、') || '沒有'}）`);
