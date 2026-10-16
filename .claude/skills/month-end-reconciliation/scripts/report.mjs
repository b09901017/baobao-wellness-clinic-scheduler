#!/usr/bin/env node
// 比對結果 → 給她看的那一頁（一個 HTML 檔，離線就打得開）。
//
//   node report.mjs <比對.json> <對帳結果.html>
//
// 她要的是「一眼看出哪一天、哪一位有問題」，而且照理不會有問題 —— 所以這一頁的主角是那一句結論：
// 全部對得上就大大一個 ✓；有事的才往下列，一件一張卡，一句白話＋三邊各用自己的樣子（Abovee 的徽章色、
// app 的狀態色、試算表的 ✓△○ 符號）＋「怎麼辦」。不出現程式的字（kind、bucket、entitlement）。
// 有真名，只能留在 .local/，不要發佈成 Artifact。
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
const [Y, M] = R.meta.month.split('-').map(Number);

// ---------- 每一種「要處理的」：標題、圖示、順序 ----------
const TYPES = {
  unsigned: { t: 'Abovee 做完了，app 還沒簽療程單', i: '✍️' },
  closeBlocked: { t: 'Abovee 做完了，app 還簽不了（接的健檢還沒做完）', i: '🔗' },
  missing: { t: 'Abovee 做完了，app 沒有這一段', i: '➕' },
  appCancelled: { t: 'Abovee 做完了，app 把這一段取消了', i: '↩️' },
  status: { t: '兩邊的狀態不一樣', i: '⚖️' },
  stillBooked: { t: 'Abovee 取消了，app 還排著', i: '🗓️' },
  extra: { t: 'app 扣了一次，Abovee 上找不到', i: '❓' },
  extraOpen: { t: '日子過了，app 還排著，Abovee 上找不到', i: '❓' },
  missingOpen: { t: '日子過了，Abovee 還沒結案，app 也沒有', i: '⏳' },
  bothOpen: { t: '日子過了，兩邊都還沒結案', i: '⏳' },
  aboveeBehind: { t: 'app 做完了，Abovee 還沒改成課程完成', i: '📝' },
  course: { t: '同一個時間，課程不一樣', i: '🔀' },
  unknown: { t: '認不出是 app 裡的哪一位', i: '👤' },
  unknownCourse: { t: '課程認不出來', i: '🏷️' },
  cache: { t: 'app 畫面上的次數要重算', i: '🔢' },
  sheet: { t: '試算表算的跟 app 不一樣', i: '📊' },
  other: { t: '其他對不上的', i: '•' },
};
const ORDER = Object.keys(TYPES);
/** 這幾種每一列講的話不一樣（哪一種狀態、app 記成什麼課），要逐列印；其餘的標題＋「怎麼辦」講一次就夠。 */
const PER_ROW = new Set(['status', 'course', 'unknown', 'unknownCourse', 'cache', 'sheet', 'other', 'closeBlocked']);

// ---------- 三邊的樣子 ----------
const bgr = R.meta.pixel?.badgeColors ?? {};
const ABOVEE_COLOR = {
  課程完成: '#5c9cf9', 已取消: '#e87c86', 確認前往: '#64ac8b', 客戶失約: '#f0a050', 待確認: '#9aa0a6', 聯繫中: '#a78bdb',
  ...Object.fromEntries(Object.entries(bgr).map(([k, [b, g, r]]) => [k, `rgb(${r},${g},${b})`])),
};
const APP_STATUS = {
  pending_confirm: ['待確認', 'pending'], confirmed: ['已確認', 'confirmed'], done: ['已完成', 'done'],
  no_show: ['未到', 'noshow'], cancelled: ['已取消', 'cancelled'],
};

const aboveePill = (a) => (a
  ? `<span class="src"><span class="src__k">Abovee</span><span class="ab" style="--c:${ABOVEE_COLOR[a.status] ?? '#999'}">${esc(a.status || '？')}</span></span>`
  : '<span class="src"><span class="src__k">Abovee</span><span class="none">找不到</span></span>');
const appPill = (a) => {
  if (!a) return '<span class="src"><span class="src__k">app</span><span class="none">沒有</span></span>';
  const [word, cls] = APP_STATUS[a.status] ?? [a.status ?? '？', 'cancelled'];
  return `<span class="src"><span class="src__k">app</span><span class="st st--${cls}">${esc(word)}</span></span>`;
};
const sheetPill = (s) => {
  if (!s || s.mark == null) return '';
  return `<span class="src"><span class="src__k">試算表</span><span class="cell" title="${esc(s.label)}">${esc(s.mark) || '&nbsp;'}</span></span>`;
};

function card(i, { detail = true } = {}) {
  const course = [i.abovee?.course, i.app?.name].filter(Boolean);
  const what = [...new Set(course)].join(' ／ ');
  return `<article class="row" data-date="${esc(i.date ?? '')}" data-who="${esc(i.customerId ?? '')}">
    <div class="row__head"><span class="when">${esc(md(i.date))}${i.time ? ` <span class="time">${esc(String(i.time).slice(0, 5))}</span>` : ''}</span>
      <span class="who">${esc(i.name ?? '')}</span><span class="what">${esc(what || i.sheet?.label || '')}</span>
      ${i.date ? `<span class="srcs">${aboveePill(i.abovee)}${appPill(i.app)}${sheetPill(i.sheet)}</span>` : ''}</div>
    ${i.abovee?.paidBy ? `<p class="todo">Abovee 上這一段扣的是${i.abovee.paidBy.name ? `「${esc(i.abovee.paidBy.name)}」` : ''}（病歷號 ${esc(i.abovee.paidBy.chartNo)}${
      i.abovee.paidBy.relation ? `，${esc(i.abovee.paidBy.relation)}` : ''}）的額度 —— app 上那一段可能記在那一位身上</p>` : ''}
    ${detail ? `<p class="say">${esc(i.say)}</p><p class="todo"><span class="todo__k">怎麼辦</span>${esc(i.todo)}</p>` : ''}
  </article>`;
}

// ---------- 結論 ----------
const s = R.summary;
const strangers = R.strangers ?? [];
const st = s.aboveeStatus ?? {};
const fixN = R.issues.length;
const done = st['課程完成'] ?? 0;
const appDone = R.people.reduce((n, p) => n + p.buckets.reduce((m, b) => m + b.app, 0), 0);
const sheetDone = R.people.reduce((n, p) => n + p.buckets.reduce((m, b) => m + (b.sheet ?? 0), 0), 0);
const verdict = fixN === 0
  ? `<section class="verdict verdict--ok"><div class="verdict__mark">✓</div><div><h2>三邊都對得上</h2>
      <p>Abovee ${R.meta.aboveeRows} 段、app、試算表，${R.meta.month.slice(5).replace(/^0/, '')} 月的次數一樣。${
        strangers.length ? `另外 Abovee 上有 ${strangers.length} 位 app 裡沒有的人，列在下面。` : ''}</p></div></section>`
  : `<section class="verdict verdict--warn"><div class="verdict__mark">${fixN}</div><div><h2>有 ${fixN} 件要看</h2>
      <p>${s.people - R.people.filter((p) => !p.ok).length} 位對得上、${R.people.filter((p) => !p.ok).length} 位有事。下面照日子與照人各列一次，點一天或一位只看那一天／那一位。</p></div></section>`;

const statusLine = Object.entries(st).sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `<span class="ab ab--sm" style="--c:${ABOVEE_COLOR[k] ?? '#999'}">${esc(k)} ${v}</span>`).join('');

const T = s.totals ?? { abovee: 0, app: 0, sheet: 0 };
const monthEndDay = R.days[R.days.length - 1]?.date;
const partial = R.meta.from && (R.meta.from !== R.days[0]?.date || R.meta.to !== monthEndDay);
const edges = R.days.filter((d) => d.coverage === 'edge').map((d) => md(d.date));
const rangeWord = [
  partial ? `只截了 ${md(R.meta.from)}～${md(R.meta.to)}` : '',
  edges.length ? `${edges.join('、')} 只截到一部分，不算` : '',
].filter(Boolean).join('；');

const eq = (a, b) => (a === b ? '<span class="eq">＝</span>' : '<span class="eq eq--bad">≠</span>');
const sources = `<section class="three"><p class="three__t">有額度的課，這個月做完幾次${rangeWord ? `（${esc(rangeWord)}）` : ''}</p><div class="three__row">
  <div class="three__c"><p class="three__k">Abovee 課程完成</p><p class="three__n">${T.abovee}</p></div>${eq(T.abovee, T.app)}
  <div class="three__c"><p class="three__k">app 已完成</p><p class="three__n">${T.app}</p></div>${eq(T.app, T.sheet)}
  <div class="three__c"><p class="three__k">試算表 ✓</p><p class="three__n">${T.sheet}</p></div></div>
  <p class="three__s">Abovee 截圖上一共 ${R.meta.aboveeRows} 段：${statusLine}</p></section>`;

// ---------- 月曆 ----------


const first = dow(`${R.meta.month}-01`);
const lead = (first + 6) % 7; // 星期一開頭
const cells = [];
for (let k = 0; k < lead; k += 1) cells.push('<div class="day day--pad"></div>');
for (const d of R.days) {
  const n = Number(d.date.slice(8));
  const edge = d.coverage === 'edge';
  const cls = d.coverage === 'out' ? 'day--out' : d.fix ? 'day--bad' : edge ? 'day--edge' : d.abovee || d.app ? 'day--ok' : 'day--empty';
  const mark = d.coverage === 'out' ? '' : d.fix ? `<span class="day__n">${d.fix}</span>` : edge ? '<span class="day__part">部分</span>'
    : d.abovee || d.app ? '<span class="day__ok">✓</span>' : '';
  const sub = d.abovee ? `${d.abovee} 段` : '';
  cells.push(`<button type="button" class="day ${cls}" data-day="${d.date}" ${d.fix ? '' : 'aria-disabled="true"'}
    title="${d.date}：Abovee ${d.abovee} 段（完成 ${d.aboveeDone}）、app ${d.app} 段">
    <span class="day__d">${n}</span>${mark}<span class="day__sub">${sub}</span></button>`);
}
const calendar = `<section class="block"><h2>哪一天</h2>
  <div class="cal"><div class="cal__h">${['一', '二', '三', '四', '五', '六', '日'].map((w) => `<span>${w}</span>`).join('')}</div>
  <div class="cal__g">${cells.join('')}</div></div>
  <p class="legend"><span class="lg lg--bad">2</span> 有幾件要看　<span class="lg lg--ok">✓</span> 對得上${
    edges.length ? '　<span class="lg lg--part">部分</span> 截圖只拍到那天的一部分（沒拍到「共 N 筆」），不算次數' : ''}　格子底下：那天 Abovee 上有幾段</p></section>`;

// ---------- 要處理的 ----------
const groups = ORDER.map((type) => [type, R.issues.filter((i) => (TYPES[i.type] ? i.type : 'other') === type)]).filter(([, l]) => l.length);
const issuesHtml = fixN === 0 ? '' : `<section class="block" id="issues"><div class="block__h"><h2>要處理的</h2>
  <button type="button" class="reset" data-reset hidden>看全部</button></div>
  ${groups.map(([type, list]) => {
    const per = PER_ROW.has(type);
    return `<div class="grp" data-grp><h3><span class="grp__i">${TYPES[type].i}</span>${esc(TYPES[type].t)}<span class="grp__n">${list.length}</span></h3>
    ${per ? '' : `<p class="todo todo--grp"><span class="todo__k">怎麼辦</span>${esc(list[0].todo)}</p>`}
    <div class="rows">${list.map((i) => card(i, { detail: per })).join('')}</div></div>`;
  }).join('')}</section>`;

// ---------- Abovee 上有、app 裡沒有的人 ----------
const strangersHtml = strangers.length ? `<section class="block"><h2><span class="grp__i">👤</span> Abovee 上有、app 裡沒有的人<span class="grp__n">${strangers.length} 位</span></h2>
  <p class="hint">不是妳的客人（體驗、別人的客人）就不用管；是的話先在 app 建檔，下個月就對得到。</p>
  ${strangers.map((p) => `<div class="stranger"><span class="who">${esc(p.name)}</span><span class="dim">${esc(p.chartNo)}</span>
    ${p.maybe?.length ? `<span class="maybe">app 上同一個時間是「${esc(p.maybe.map((m) => m.name).join('、'))}」—— 可能是同一位、名字寫法不一樣</span>` : ''}
    <span class="stranger__rows">${p.rows.map((r) => `<span class="chip">${esc(md(r.date))} ${esc(r.course)} <span class="ab ab--sm" style="--c:${ABOVEE_COLOR[r.status] ?? '#999'}">${esc(r.status)}</span></span>`).join('')}</span></div>`).join('')}
</section>` : '';

// ---------- 哪一位 ----------
const personRow = (b) => {
  const num = (v) => (v == null ? '<span class="dim">—</span>' : v);
  const remain = b.remaining == null ? '<span class="dim">—</span>'
    : `${b.remaining < 0 ? `<span class="bad" title="超用">${b.remaining}</span>` : b.remaining}${b.sheetRemaining != null && b.sheetRemaining !== b.remaining ? `<span class="bad">（試算表 ${b.sheetRemaining}）</span>` : ''}${
      b.cachedRemaining != null && b.cachedRemaining !== b.remaining ? `<span class="bad">（畫面上 ${b.cachedRemaining}）</span>` : ''}`;
  return `<tr class="${b.ok ? '' : 'row--bad'}"><td>${b.ok ? '<span class="ok">✓</span>' : '<span class="bad">✗</span>'} ${esc(b.label)}</td>
    <td class="n">${b.abovee == null ? '<span class="dim" title="這門課不在 Abovee 壓">不壓</span>' : b.abovee}</td><td class="n">${b.app}</td><td class="n">${num(b.sheet)}</td><td class="n">${remain}</td></tr>`;
};
const bad = R.people.filter((p) => !p.ok);
const good = R.people.filter((p) => p.ok);
const person = (p) => `<details class="who-d ${p.ok ? '' : 'who-d--bad'}" data-person="${esc(p.customerId)}"${p.ok ? '' : ' open'}>
  <summary><span class="who-d__m">${p.ok ? '✓' : '!'}</span><span class="who-d__n">${esc(p.name)}</span>
    ${p.issues ? `<span class="who-d__c">${p.issues} 件</span>` : ''}</summary>
  <table class="tbl"><thead><tr><th>這個月做的</th><th>Abovee</th><th>app</th><th>試算表</th><th>還剩</th></tr></thead>
  <tbody>${p.buckets.map(personRow).join('')}</tbody></table>
  ${p.alias?.length ? `<p class="todo">Abovee 上寫的是「${esc(p.alias.join('、'))}」，認不出是這一位 —— 那幾段在上面「app 裡沒有的人」。</p>` : ''}
  ${p.issues ? `<button type="button" class="linkish" data-who-filter="${esc(p.customerId)}">只看這一位的 ${p.issues} 件</button>` : ''}
</details>`;
const peopleHtml = `<section class="block"><h2>哪一位</h2>
  <p class="hint">每一位這個月每一項做了幾次：Abovee 的課程完成、app 的已完成、試算表的 ✓，三個數字要一樣。</p>
  ${bad.map(person).join('')}
  ${good.length ? `<details class="rest"><summary>其餘 ${good.length} 位都對得上</summary>${good.map(person).join('')}</details>` : ''}
</section>`;

// ---------- 順便看看、這一頁怎麼來的 ----------
const minorGroups = {};
for (const i of R.minor) (minorGroups[i.say.split('，')[0].slice(0, 18)] ??= []).push(i);
const minorHtml = R.minor.length ? `<details class="block block--quiet"><summary><h2>順便看看（不影響次數）<span class="grp__n">${R.minor.length}</span></h2></summary>
  <p class="hint">治療師、診間、時間不一樣，或還沒到的預約。不會讓次數變錯，有空再看。</p>
  ${R.minor.map(card).join('')}</details>` : '';

const px = R.meta.pixel;
const unverified = R.unverified ?? [];
const howHtml = `<details class="block block--quiet"><summary><h2>這一頁怎麼來的</h2></summary><ul class="how">
  <li><b>Abovee</b>：${R.meta.shots.length} 張截圖、${R.meta.aboveeRows} 段。先用看的抄，再一格一格用同樣的字型重畫、逐像素比對${
    px ? `：${px.ok}/${px.cells} 格吻合${unverified.length ? `，<span class="bad">${unverified.length} 列有讀不準的格子（下面列出）</span>` : ''}` : '（這一次沒有跑逐像素驗證）'}。${
    R.meta.complete === false ? '<span class="bad">截圖可能沒有拍到整個月。</span>' : ''}</li>
  <li><b>app</b>：直接讀 ${R.meta.emulator ? '本機模擬器' : R.meta.project === 'wellness-clinic-scheduler' ? '正式站' : esc(R.meta.project)} 的資料（只讀、一個字都沒改），${esc((R.meta.readAt ?? '').slice(0, 16).replace('T', ' '))} 讀的。哪一段對哪一列，用的是 app「拍 Abovee」同一套規則。</li>
  <li><b>試算表</b>：用 app 推試算表的同一支程式、拿同一份資料現算的（Google 試算表本身沒有打開）。</li>
  <li>「今天」算 ${esc(R.meta.today)}：這一天以後的預約還沒發生，不算對不上。</li>
  ${unverified.length ? `<li>讀不準的格子：${unverified.map((u) => `${esc(u.src)} 第 ${u.row} 列（${esc(u.fields.join('、'))}）`).join('、')} —— 回 Abovee 看那幾列。</li>` : ''}
</ul></details>`;

const html = `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${Y} 年 ${M} 月對帳</title>
<style>
:root{--bg:#f6f5f2;--card:#fff;--ink:#1f2328;--mute:#6b7178;--line:#e4e1da;--ok:#17714b;--ok-bg:#d5efe2;--bad:#c0271a;--bad-bg:#fbdedb;--warn:#995400;
--pending:#995400;--pending-bg:#fbeacd;--confirmed:#1c5fa8;--confirmed-bg:#dde9f8;--done:#17714b;--done-bg:#d5efe2;--noshow:#c0271a;--noshow-bg:#fbdedb;--cancelled:#6b7178;--cancelled-bg:#ecebe7}
@media (prefers-color-scheme:dark){:root{--bg:#161719;--card:#1f2124;--ink:#e8e6e3;--mute:#9aa0a6;--line:#33363a;--ok:#6fc79a;--ok-bg:#123024;--bad:#f08a7c;--bad-bg:#3a1e1a;--warn:#e8a94a;
--pending:#e8a94a;--pending-bg:#3a2c14;--confirmed:#7fb3e8;--confirmed-bg:#16283a;--done:#6fc79a;--done-bg:#123024;--noshow:#f08a7c;--noshow-bg:#3a1e1a;--cancelled:#9aa0a6;--cancelled-bg:#2a2c2f}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 "Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif}
.page{max-width:760px;margin:0 auto;padding:28px 16px 64px}
.top h1{font-size:30px;margin:2px 0 0;letter-spacing:.02em}.kicker{margin:0;color:var(--mute);font-size:14px;letter-spacing:.1em}
.sub{margin:4px 0 0;color:var(--mute);font-size:14px}
h2{font-size:19px;margin:0 0 12px}h3{font-size:16px;margin:0 0 10px;display:flex;align-items:center;gap:8px}
.verdict{display:flex;gap:18px;align-items:center;border-radius:18px;padding:22px 22px;margin:22px 0 14px}
.verdict h2{font-size:24px;margin:0}.verdict p{margin:4px 0 0;color:var(--mute)}
.verdict--ok{background:var(--ok-bg)}.verdict--ok .verdict__mark{background:var(--ok)}
.verdict--warn{background:var(--bad-bg)}.verdict--warn .verdict__mark{background:var(--bad)}
.verdict__mark{flex:none;width:64px;height:64px;border-radius:50%;color:#fff;font-size:32px;font-weight:700;display:grid;place-items:center}
.three{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px 16px;margin-bottom:16px}
.three__t{margin:0 0 8px;font-size:14px;color:var(--mute)}.three__row{display:flex;align-items:center;gap:6px}
.three__c{flex:1;min-width:0;text-align:center}.eq{font-size:22px;color:var(--ok);font-weight:700}.eq--bad{color:var(--bad)}
.three__k{margin:0;color:var(--mute);font-size:12px}.three__n{margin:0;font-size:30px;font-weight:700;font-variant-numeric:tabular-nums}
.three__s{margin:10px 0 0;font-size:12px;color:var(--mute);display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.rows{border:1px solid var(--line);border-radius:12px;overflow:hidden}.row{padding:9px 12px;border-top:1px solid var(--line)}.row:first-child{border-top:0}
.row__head{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center}.row__head .srcs{margin:0 0 0 auto}
.todo--grp{margin:-4px 0 10px}.maybe{font-size:13px;color:var(--warn)}
.block{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px 16px;margin:0 0 16px}
.block--quiet{background:transparent}.block--quiet>summary{cursor:pointer;list-style:none}.block--quiet>summary h2{display:inline-flex;gap:8px;align-items:center;margin:0}
.block--quiet>summary::before{content:'▸ ';color:var(--mute)}.block--quiet[open]>summary::before{content:'▾ '}
.block__h{display:flex;justify-content:space-between;align-items:baseline}
.cal__h,.cal__g{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}.cal__h span{text-align:center;color:var(--mute);font-size:12px;padding-bottom:4px}
.day{position:relative;aspect-ratio:1/1;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--ink);font:inherit;padding:4px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0;min-width:0}
.day--pad{visibility:hidden}.day--edge{border-style:dashed}.day__part{font-size:11px;color:var(--mute);border:1px dashed var(--mute);border-radius:4px;padding:0 3px;margin:2px 0}.day--out{opacity:.25;background:transparent;border-style:dashed}.day--empty{opacity:.45}.day__d{font-size:13px;color:var(--mute);line-height:1}
.day__ok{color:var(--ok);font-size:18px;line-height:1.2;font-weight:700}.day__sub{font-size:10px;color:var(--mute);line-height:1}
.day--bad{background:var(--bad-bg);border-color:var(--bad);cursor:pointer}.day__n{background:var(--bad);color:#fff;border-radius:999px;min-width:22px;height:22px;display:grid;place-items:center;font-size:13px;font-weight:700;margin:2px 0}
.day[aria-pressed="true"]{outline:3px solid var(--ink);outline-offset:1px}
.legend{margin:10px 0 0;font-size:12px;color:var(--mute);display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center}
.lg{display:inline-grid;place-items:center;min-width:18px;height:18px;border-radius:999px;font-size:11px;font-weight:700}.lg--bad{background:var(--bad);color:#fff}.lg--ok{color:var(--ok)}.lg--part{font-size:10px;font-weight:400;border:1px dashed var(--mute);border-radius:4px;padding:0 3px;color:var(--mute)}
.grp{margin-top:18px}.grp__i{font-size:18px}.grp__n{margin-left:auto;background:var(--bg);border:1px solid var(--line);border-radius:999px;font-size:12px;padding:0 9px;color:var(--mute);font-weight:400}
.card{border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:0 0 10px;background:var(--card)}
.card__head{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline}.when{font-weight:700}.time{color:var(--mute);font-weight:400}
.who{font-weight:700}.what{color:var(--mute);font-size:14px}
.srcs{display:flex;flex-wrap:wrap;gap:8px 14px;margin:8px 0 2px}.src{display:inline-flex;align-items:center;gap:6px}.src__k{font-size:11px;color:var(--mute)}
.ab{display:inline-block;background:var(--c);color:#fff;border-radius:6px;padding:1px 8px;font-size:13px;font-weight:700}.ab--sm{font-size:11px;padding:0 6px;font-weight:600}
.st{display:inline-block;border-radius:999px;padding:1px 9px;font-size:13px;font-weight:600}
.st--pending{color:var(--pending);background:var(--pending-bg)}.st--confirmed{color:var(--confirmed);background:var(--confirmed-bg)}.st--done{color:var(--done);background:var(--done-bg)}
.st--noshow{color:var(--noshow);background:var(--noshow-bg)}.st--cancelled{color:var(--cancelled);background:var(--cancelled-bg)}
.cell{display:inline-grid;place-items:center;min-width:28px;height:22px;border:1px solid #9aa0a6;background:var(--card);font-size:14px;padding:0 4px}
.none{font-size:13px;color:var(--mute);border:1px dashed var(--line);border-radius:6px;padding:0 8px}
.say{margin:8px 0 4px}.todo{margin:0;font-size:14px;color:var(--mute)}.todo__k{display:inline-block;font-size:11px;border:1px solid var(--line);border-radius:4px;padding:0 5px;margin-right:6px;color:var(--ink)}
.hint{margin:-6px 0 12px;font-size:13px;color:var(--mute)}
.who-d{border-top:1px solid var(--line);padding:8px 0}.who-d summary{cursor:pointer;display:flex;align-items:center;gap:10px;list-style:none}
.who-d__m{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;font-weight:700;background:var(--ok-bg);color:var(--ok);flex:none}
.who-d--bad .who-d__m{background:var(--bad);color:#fff}.who-d__n{font-weight:600}.who-d__c{font-size:12px;color:var(--bad)}
.rest{margin-top:8px}.rest>summary{cursor:pointer;color:var(--mute);padding:8px 0}
.tbl{width:100%;border-collapse:collapse;margin:10px 0 6px;font-size:14px}.tbl th{font-size:11px;color:var(--mute);font-weight:400;text-align:right;padding:2px 6px}
.tbl th:first-child{text-align:left}.tbl td{padding:5px 6px;border-top:1px solid var(--line)}.tbl td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.row--bad td{background:var(--bad-bg)}.ok{color:var(--ok);font-weight:700}.bad{color:var(--bad);font-weight:600}.dim{color:var(--mute)}
.linkish,.reset{font:inherit;font-size:13px;background:none;border:1px solid var(--line);border-radius:999px;padding:3px 12px;color:var(--ink);cursor:pointer}
.how{margin:10px 0 0;padding-left:20px;font-size:14px;color:var(--mute)}.how li{margin:4px 0}.how b{color:var(--ink)}
.stranger{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline;border-top:1px solid var(--line);padding:8px 0}
.stranger__rows{display:flex;flex-wrap:wrap;gap:6px;width:100%}.chip{font-size:13px;border:1px solid var(--line);border-radius:8px;padding:1px 6px;display:inline-flex;gap:6px;align-items:center}
.foot{color:var(--mute);font-size:12px;text-align:center;margin-top:28px}
@media (max-width:520px){.row__head .srcs{margin:4px 0 0}.three__n{font-size:24px}.verdict{padding:18px}.verdict__mark{width:52px;height:52px;font-size:26px}.top h1{font-size:26px}.day__sub{display:none}}
</style></head><body><main class="page">
<header class="top"><p class="kicker">月底對帳</p><h1>${Y} 年 ${M} 月</h1><p class="sub">Abovee 截圖 × app × 試算表，看「有額度的來訪」次數對不對得上</p></header>
${verdict}
${sources}
${calendar}
${issuesHtml}
${strangersHtml}
${peopleHtml}
${minorHtml}
${howHtml}
<p class="foot">產生於 ${esc(R.meta.generatedAt.slice(0, 16).replace('T', ' '))}（UTC）・有客戶姓名，不要轉傳</p>
</main>
<script>
(() => {
  const cards = [...document.querySelectorAll('#issues .card')];
  const grps = [...document.querySelectorAll('#issues [data-grp]')];
  const reset = document.querySelector('[data-reset]');
  const days = [...document.querySelectorAll('.day[data-day]')];
  function show(pred) {
    cards.forEach((c) => { c.hidden = !pred(c); });
    grps.forEach((g) => { g.hidden = ![...g.querySelectorAll('.card')].some((c) => !c.hidden); });
    if (reset) reset.hidden = false;
  }
  function clear() {
    cards.forEach((c) => { c.hidden = false; }); grps.forEach((g) => { g.hidden = false; });
    days.forEach((d) => d.setAttribute('aria-pressed', 'false')); if (reset) reset.hidden = true;
  }
  days.forEach((d) => d.addEventListener('click', () => {
    if (!d.classList.contains('day--bad')) return;
    const on = d.getAttribute('aria-pressed') === 'true';
    clear();
    if (on) return;
    d.setAttribute('aria-pressed', 'true');
    show((c) => c.dataset.date === d.dataset.day);
    document.getElementById('issues')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  document.querySelectorAll('[data-who-filter]').forEach((b) => b.addEventListener('click', () => {
    clear(); show((c) => c.dataset.who === b.dataset.whoFilter);
    document.getElementById('issues')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  reset?.addEventListener('click', clear);
})();
</script></body></html>`;

writeFileSync(out, html);
console.log(`寫好了：${out}（要處理的 ${fixN} 件、順便看看 ${R.minor.length} 件、${R.people.length} 位）`);
