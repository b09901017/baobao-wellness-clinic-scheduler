// 合併檔匯入。吃 .claude/skills/calendar-sheet-merge 產生的 import.json：
// 舊試算表與 TimeTree 行事曆比對過、補好時間的結果。
//
// 為什麼比對不在這裡做：那需要解析 .ics 與一整套配對規則，而那套規則已經在 skill 那一側
// 踩過坑、有護欄了。同一件事做兩份，遲早有一份是錯的。這一頁只負責
// 「看得懂這份檔案、對得到她自己的主檔、把要寫的東西講清楚、寫進去」。
//
// 跟舊資料匯入（#/settings/import）同一個節奏：貼上 → 看清楚 → 確認 → 才寫。
// 差別是那一頁吃試算表文字、來訪一律沒有時間；這一頁吃合併檔、時間補得進來。

import * as importer from '../../data/legacyImport.js';
import {
  FORMAT, validateFile, planForCustomer, addExtraVisits, eventDocs, summarize,
} from '../../domain/mergeImport.js';
import { esc } from '../components/form.js';
import { confirmAction } from '../components/dialog.js';
import * as toast from '../toast.js';
import { icon } from '../icons.js';

/**
 * 貼進來的合併檔。**只放在記憶體裡**，重新整理就沒了 ——
 * 裡面是客戶的姓名與療程紀錄，沒有理由讓它留在這台裝置上過夜。
 */
let file = null;
let fileErrors = [];
let fileWarnings = [];
/** 三份候選清單她勾了哪幾筆。預設一筆都不勾 —— 那是她指定的。 */
let picks = { future: new Set(), missing: new Set(), events: new Set() };

export async function render(el) {
  el.innerHTML = '<p class="muted">載入中…</p>';

  let ctx;
  try {
    ctx = await importer.loadContext();
  } catch (err) {
    el.innerHTML = `${backLink()}
      <div class="card"><p>讀取失敗：${esc(err.message)}</p></div>`;
    return;
  }
  paint(el, { ...ctx, rooms: ctx.rooms ?? [], staff: ctx.staff ?? [] });
}

function plansOf(ctx) {
  if (!file) return [];
  const plans = file.customers.map((c) => planForCustomer(c, ctx, file));
  const extras = [
    ...(file.futureVisits ?? []).filter((_, i) => picks.future.has(i)),
    ...(file.missingFromSheet ?? []).filter((_, i) => picks.missing.has(i)),
  ];
  const extraProblems = addExtraVisits(plans, extras, ctx);
  return { plans, extraProblems };
}

function paint(el, ctx) {
  const { plans = [], extraProblems = [] } = file ? plansOf(ctx) : {};
  const s = file ? summarize(plans) : null;

  el.innerHTML = `
    ${backLink()}

    <section class="card">
      <h2 class="card__title">合併檔匯入</h2>
      <p class="muted">把 Claude 對照過試算表與行事曆之後給你的 <code>import.json</code>
        整份貼進來。它比舊資料匯入多了時間、診間、治療師與器材 —— 那些是從行事曆補起來的。</p>
      <p class="muted">貼進來的東西只留在這個畫面上，重新整理就沒了。</p>

      <label class="field">
        <span class="field__label">貼在這裡</span>
        <textarea data-json rows="5" placeholder="{ &quot;format&quot;: &quot;${FORMAT}&quot;, … }"></textarea>
      </label>
      <p class="form__actions">
        <button class="btn btn--primary" type="button" data-load>讀進來</button>
        ${file ? '<button class="btn" type="button" data-clear>清掉</button>' : ''}
      </p>
      ${fileErrors.length ? errorsCard() : ''}
      ${fileWarnings.length ? `
        <div class="card" style="margin-top: 12px">
          <ul class="tight">${fileWarnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
        </div>` : ''}
    </section>

    ${file ? summaryCard(s, plans, extraProblems) : ''}
    ${file ? lowCard(plans) : ''}
    ${file ? candidateCards() : ''}
    ${file ? runCard(s) : ''}`;

  el.querySelector('[data-load]')?.addEventListener('click', () => load(el, ctx));
  el.querySelector('[data-clear]')?.addEventListener('click', () => {
    file = null;
    fileErrors = [];
    fileWarnings = [];
    picks = { future: new Set(), missing: new Set(), events: new Set() };
    paint(el, ctx);
  });
  el.querySelectorAll('[data-pick]').forEach((box) =>
    box.addEventListener('change', () => {
      const [kind, i] = [box.dataset.pick, Number(box.dataset.index)];
      if (box.checked) picks[kind].add(i);
      else picks[kind].delete(i);
      paint(el, ctx);
    }),
  );
  el.querySelector('[data-run]')?.addEventListener('click', () => run(el, ctx, plans, s));
}

function load(el, ctx) {
  const text = el.querySelector('[data-json]').value;
  if (!text.trim()) {
    toast.info('框裡沒有東西');
    return;
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    file = null;
    fileErrors = [`讀不出 JSON：${err.message}`, '整份貼，不要只貼一段。'];
    fileWarnings = [];
    paint(el, ctx);
    return;
  }
  const { errors, warnings } = validateFile(json);
  fileErrors = errors;
  fileWarnings = warnings;
  file = errors.length ? null : json;
  picks = { future: new Set(), missing: new Set(), events: new Set() };
  paint(el, ctx);
}

function errorsCard() {
  return `
    <div class="card card--danger" style="margin-top: 12px">
      <p><b>這份檔案沒辦法用</b></p>
      <ul class="tight">${fileErrors.slice(0, 12).map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
      ${fileErrors.length > 12 ? `<p class="muted">還有 ${fileErrors.length - 12} 項</p>` : ''}
      <p class="muted">整份擋下來是刻意的 —— 匯進去一半比整份失敗難救得多。</p>
    </div>`;
}

function summaryCard(s, plans, extraProblems) {
  const problems = [...plans.flatMap((p) => p.problems), ...extraProblems];
  const span = file.calendar?.span ?? [];
  return `
    <section class="card">
      <h2 class="card__title">會寫進去什麼</h2>
      <p><b>${s.customers}</b> 位客戶　<b>${s.entitlements}</b> 筆額度　<b>${s.visits}</b> 筆來訪　<b>${s.slots}</b> 個時段</p>
      <p class="muted">其中 <b>${s.timed}</b> 個時段有時間，${s.slots - s.timed} 個時間不詳（行事曆上找不到，維持空白）。</p>
      ${span.length ? `<p class="muted">行事曆涵蓋 ${esc(span[0] ?? '')} ～ ${esc(span[1] ?? '')}，
        更早的來訪本來就補不到時間。</p>` : ''}
      ${s.skipped.length ? `<p class="muted">${s.skipped.length} 位整位跳過：
        ${s.skipped.map((x) => `${esc(x.customerName)}（${esc(x.why)}）`).join('；')}</p>` : ''}
      ${problems.length ? `
        <details>
          <summary>${problems.length} 處對不到主檔</summary>
          <ul class="tight">${problems.map((x) =>
    `<li>${esc(x.where)}｜${esc(x.raw)}｜${esc(x.why)}</li>`).join('')}</ul>
          <p class="muted">對不到的東西一律留空或整筆不匯入，不會猜一個填進去。
            先去主檔把它建起來，再貼一次會比較完整。</p>
        </details>` : '<p class="muted">每一樣都對得到你的主檔。</p>'}
    </section>`;
}

function lowCard(plans) {
  const rows = [];
  for (const c of file.customers) {
    if (plans.find((p) => p.customerName === c.name)?.skip) continue;
    for (const v of c.visits ?? []) {
      for (const s of v.slots ?? []) {
        if (s.confidence === 'low') rows.push({ name: c.name, date: v.date, ...s });
      }
    }
  }
  if (!rows.length) return '';
  return `
    <section class="card">
      <h2 class="card__title">這 ${rows.length} 個時段的時間是推測的</h2>
      <p class="muted">行事曆上那筆事件只寫了一半（沒寫是誰，或沒寫做什麼），
        是靠「那天只有這一筆對得上」推出來的。看一眼原文，不對的話匯完再改。</p>
      <ul class="tight">
        ${rows.map((r) => `<li>${esc(r.date)}　${esc(r.name)}　${esc(r.courseName)}
          → <b>${esc(r.startsAt ?? '')}</b>　<span class="muted">「${esc(r.evidence ?? '')}」</span></li>`).join('')}
      </ul>
    </section>`;
}

/** 三份候選清單。**一律預設不勾** —— 匯什麼由她一筆一筆決定。 */
function candidateCards() {
  const list = (kind, title, note, items, line) => (items?.length ? `
    <section class="card">
      <h2 class="card__title">${title}<span class="badge">${picks[kind].size} / ${items.length}</span></h2>
      <p class="muted">${note}</p>
      <ul class="tight">
        ${items.map((x, i) => `
          <li><label class="choice" style="border: none; background: none; padding: 2px 0">
            <input type="checkbox" data-pick="${kind}" data-index="${i}" ${picks[kind].has(i) ? 'checked' : ''}>
            <span>${line(x)}</span>
          </label></li>`).join('')}
      </ul>
    </section>` : '');

  return [
    list('missing', '行事曆上有，試算表沒勾',
      '她那天做了、但忘記回去打勾的。勾起來會補成一筆來訪，次數才算得對。',
      file.missingFromSheet,
      (x) => `${esc(x.date)}　${esc(x.customerName)}　${esc(x.courseName)}
        ${x.startsAt ? `<b>${esc(x.startsAt)}</b>` : ''}
        <span class="muted">「${esc(x.evidence ?? '')}」${x.sheetHasThatDay ? '（那天試算表有勾別的）' : ''}</span>`),
    list('future', '未來的預約',
      '已經約好、還沒來的。勾起來會建成「已確認」的來訪，算進已排未上。',
      file.futureVisits,
      (x) => `${esc(x.date)}　${esc(x.customerName)}　${esc(x.courseName)}
        ${x.startsAt ? `<b>${esc(x.startsAt)}</b>` : ''}
        <span class="muted">「${esc(x.evidence ?? '')}」</span>`),
    list('events', '對不到客戶的行事曆事件',
      '個人行程、公司的事、待辦全部混在一起。勾起來的會變成個人行程 ——'
      + '不綁客戶、不產生任務、不扣次數。',
      file.eventCandidates,
      (x) => `${esc(x.startDate)}　${x.startTime ? `<b>${esc(x.startTime)}</b>　` : ''}${esc(x.title)}
        ${x.repeats ? '<span class="muted">（行事曆上是重複事件，只匯這一次）</span>' : ''}`),
  ].join('');
}

function runCard(s) {
  return `
    <section class="card">
      <p class="form__actions">
        <button class="btn btn--primary" type="button" data-run ${s.customers ? '' : 'disabled'}>開始匯入</button>
      </p>
      <p class="muted">每一筆都會標上來源，之後查得出是從哪一次合併進來的。
        來訪一律標成已完成（未來的預約是已確認），而且<b>不會產生任何待辦任務</b> ——
        那些掛號在舊系統早就做完了。</p>
    </section>`;
}

async function run(el, ctx, plans, s) {
  const events = eventDocs((file.eventCandidates ?? []).filter((_, i) => picks.events.has(i)));
  const extras = picks.future.size + picks.missing.size;

  const ok = await confirmAction({
    title: '開始匯入',
    consequences: [
      `建立 ${s.customers} 位客戶、${s.entitlements} 筆額度、${s.visits} 筆來訪（${s.slots} 個時段）`,
      `其中 ${s.timed} 個時段有時間，${s.slots - s.timed} 個時間不詳`,
      extras ? `另外補 ${extras} 筆你勾起來的來訪` : '沒有勾任何要補的來訪',
      events.length ? `建立 ${events.length} 筆個人行程` : '沒有勾任何個人行程',
      s.low ? `${s.low} 個時段的時間是推測的，匯完可以再改` : '沒有推測來的時間',
      '不會產生任何待辦任務',
      '每位客戶各自寫入，一位失敗不影響其他人',
    ],
    confirmLabel: '匯入',
  });
  if (!ok) return;

  toast.saving('匯入中…');
  let results;
  try {
    results = await importer.importAll(plans, (done, total, name) =>
      toast.saving(`匯入中… ${done}/${total}（${name}）`),
    );
    if (events.length) {
      toast.saving(`匯入中… 個人行程 ${events.length} 筆`);
      await importer.importEvents(events);
    }
  } catch (err) {
    toast.failed(`匯入失敗：${err.message}`);
    return;
  }

  const failed = results.filter((r) => !r.ok);
  toast.hide();
  if (failed.length) {
    toast.failed(`${results.length - failed.length} 位進去了，${failed.length} 位失敗：`
      + failed.map((r) => `${r.customerName}（${r.error}）`).join('；'));
  } else {
    toast.info(`${results.length} 位客戶都匯進去了`);
    file = null;
    picks = { future: new Set(), missing: new Set(), events: new Set() };
  }

  await render(el);
}

function backLink() {
  return `<a class="backlink" href="#/settings">${icon('left', { size: 19 })}設定</a>`;
}
