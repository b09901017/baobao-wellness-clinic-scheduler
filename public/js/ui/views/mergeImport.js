// 合併檔匯入。吃 .claude/skills/calendar-sheet-merge 產生的 import.json：
// 舊試算表與 TimeTree 行事曆比對過、補好時間的結果。
//
// 為什麼比對不在這裡做：那需要解析 .ics 與一整套配對規則，而那套規則已經在 skill 那一側
// 踩過坑、有護欄了。同一件事做兩份，遲早有一份是錯的。這一頁只負責
// 「看得懂這份檔案、對得到她自己的主檔、把要寫的東西講清楚、寫進去」。
//
// 節奏是：貼上 → 看清楚 → 確認 → 才寫（SPEC 第 6.10 節要的 dry-run）。
// **舊資料只有這一條路進得來**（ADR-0047）—— 「把試算表文字直接貼進來」那條
// 2026-08-23 拿掉了，它讀得到的東西是這份合併檔的子集。

import * as importer from '../../data/legacyImport.js';
import {
  FORMAT, validateFile, planForCustomer, addExtraVisits, looseDocs, looseTally,
  summarize, countNewTasks, groupCandidates, defaultPicks, eventKind,
  CALENDAR_KINDS, KIND_LABEL,
} from '../../domain/mergeImport.js';
import { todayISO } from '../../domain/dates.js';
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
/**
 * 三份候選清單她勾了哪幾筆，記的是在原本那三份清單裡的位置。
 * 預設值見 `defaultPicks()`：還沒發生的勾起來、已經發生的不勾（ADR-0030）。
 */
let picks = emptyPicks();

/**
 * 她把哪幾筆改成別的分類了（在 `eventCandidates` 裡的位置 → 分類）。
 *
 * **只記她改過的那幾筆**，沒改過的一律現問 `eventKind()`。整份抄一份下來的話，
 * 檔案換了、預設值變了，這裡還會拿著上一份的答案。
 */
let kindOverrides = new Map();

function emptyPicks() {
  return { future: new Set(), missing: new Set(), events: new Set() };
}

/** 這一筆現在算哪一類：她改過就聽她的，沒改過就聽檔案的。 */
function kindOf(index) {
  return kindOverrides.get(index) ?? eventKind(file?.eventCandidates?.[index]);
}

/**
 * 她勾起來的那幾筆，照現在的分類分成兩堆：走 events 的與走 notes 的。
 * **分歧點在 domain**（`looseDocs()`），這裡只負責把她點的東西交過去。
 */
function chosenLoose() {
  return looseDocs(file?.eventCandidates, kindOf, [...picks.events], file);
}

/** 一份檔案剛讀進來時的預設勾選。 */
function pickSets(json) {
  const chosen = defaultPicks(json, todayISO());
  return {
    future: new Set(chosen.future),
    missing: new Set(chosen.missing),
    events: new Set(chosen.events),
  };
}

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
  // 「未來」的界線在**匯入的那一刻**，不是產檔的那一刻：一份 8/19 產的檔案
  // 她 8/21 才貼，下個月再貼一次「未來」會完全不同。所以 today 在這裡取，
  // 不寫進檔案（`.scratch/first-real-import/issues/03`）。
  const withToday = { ...ctx, today: todayISO() };
  const plans = file.customers.map((c) => planForCustomer(c, withToday, file));
  const extras = [
    ...(file.futureVisits ?? []).filter((_, i) => picks.future.has(i)),
    ...(file.missingFromSheet ?? []).filter((_, i) => picks.missing.has(i)),
  ];
  const extraProblems = addExtraVisits(plans, extras, withToday);
  return { plans, extraProblems };
}

function paint(el, ctx) {
  const { plans = [], extraProblems = [] } = file ? plansOf(ctx) : {};
  const s = file ? summarize(plans) : null;
  const tasks = file ? countNewTasks(plans, { courses: ctx.courses, today: todayISO() }) : 0;

  el.innerHTML = `
    <div data-mergepage>
    ${backLink()}

    <section class="card">
      <h2 class="card__title">舊資料匯入</h2>
      <p class="muted">把 Claude 對照過試算表與行事曆之後給你的 <code>import.json</code>
        整份貼進來。時間、診間、治療師與器材是從行事曆補起來的，舊試算表上沒有那些。</p>
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

    ${file ? contraindicationCard(s, plans) : ''}
    ${file ? summaryCard(s, plans, extraProblems) : ''}
    ${file ? lowCard(plans) : ''}
    ${file ? candidateCards() : ''}
    ${file ? runCard(s, tasks) : ''}
    </div>`;

  el.querySelector('[data-load]')?.addEventListener('click', () => load(el, ctx));
  el.querySelector('[data-clear]')?.addEventListener('click', () => {
    file = null;
    fileErrors = [];
    fileWarnings = [];
    picks = emptyPicks();
    kindOverrides = new Map();
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
  // 一個時間區塊一顆。198 筆全部要或全部不要都是一次點擊，
  // 而不是勾 198 次 —— 那才是「一樣可以勾選」講得通的前提。
  el.querySelectorAll('[data-all]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const on = btn.dataset.on === '1';
      const group = groupCandidates(file, todayISO())[btn.dataset.all];
      for (const r of [...group.visits, ...group.events]) {
        if (on) picks[r.kind].add(r.index);
        else picks[r.kind].delete(r.index);
      }
      paint(el, ctx);
    }),
  );
  // 分類鈕。**只換這一列**（ADR-0038）—— 這一頁一次列兩百筆，
  // 整頁重畫等於每點一下就捲回最上面，而她要點的正是清單中段那幾列。
  // 事件用委派掛在容器上：兩百列 × 三顆鈕 = 六百個 listener。
  //
  // 掛在 `[data-mergepage]` 而不是 `el`：`paint()` 每點一下勾就跑一次，
  // 掛在 `el` 上等於每次多留一顆，而且離開這一頁之後它還活著 ——
  // `data-kind` 在日曆頂端是篩選丸，那裡沒有 `index` 可以讀
  //（`.scratch/asks-2026-08-25/issues/04` 是同一個形狀）。
  el.querySelector('[data-mergepage]').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-kind]');
    if (!btn) return;
    const index = Number(btn.dataset.index);
    kindOverrides.set(index, btn.dataset.kind);
    const row = el.querySelector(`[data-kindrow="${index}"]`);
    if (row) row.outerHTML = kindPicker(index, file.eventCandidates[index]);
    // 「待辦沒有時間」那一句是靠 eventLine() 畫的，換了類別要跟著重畫。
    const line = el.querySelector(`[data-eventline="${index}"]`);
    if (line) line.innerHTML = eventLine({ item: file.eventCandidates[index], index });
    repaintLooseCounts(el);
  });

  el.querySelector('[data-run]')?.addEventListener('click', () => run(el, ctx, plans, s, tasks));
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
  picks = file ? pickSets(file) : emptyPicks();
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

/**
 * 文字裡提到警示的那幾位。**排在所有東西前面**，因為它是這一頁唯一
 * 會造成實際傷害的一件事。
 *
 * 舊表沒有「永久限制」這個欄位，那幾句話寫在購買名稱或空白處，合併檔照抄進備註。
 * 匯進來之後 `customer.flags` 是空的，而那一句提醒是拿 flags 比對的 ——
 * **沒有那個標記，壓表卡片牆上那顆丸子不會出現，選超磁場也不會多那一句**。
 * 2026-09-06 之後它不擋器材了（ADR-0074），但「她在診間看不到這件事」
 * 的傷害一點都沒有變小。
 *
 * 不自動填 flags：「手有金屬」要提醒、「金屬已取出」不用，而兩句話都有「金屬」，
 * 那是她的判斷（ADR-0002）。
 */
function contraindicationCard(s, plans = []) {
  const rows = s?.contraindications ?? [];
  if (!rows.length) return '';
  // v3 的檔案已經照舊表的字帶上了一部分警示（ADR-0092）。哪幾位已經帶上要講清楚 ——
  // 不講的話她會以為還要自己去設，或反過來以為這一張卡上的全部都設好了。
  const flagsOf = (name) => plans.find((p) => p.customerName === name)?.customer?.flags ?? [];
  return `
    <section class="card card--danger">
      <h2 class="card__title">這 ${rows.length} 位的文字裡提到要注意的狀況</h2>
      <ul class="tight">
        ${rows.map((x) => {
    const set = flagsOf(x.customerName);
    return `<li><b>${esc(x.customerName)}</b>：${esc(x.terms.join('、'))}
          ${set.length ? `<span class="muted">（已經帶上警示：${esc(set.join('、'))}）</span>` : ''}
          ${x.warns.length ? `<span class="muted">（排 ${esc(x.warns.join('、'))} 時會多一句提醒）</span>` : ''}</li>`;
  }).join('')}
      </ul>
      <p class="muted"><b>只有金屬類、血管類會自動帶上警示</b>，而且「沒有金屬」「金屬已取出」這種否定句不算。
        其餘的字眼不會自動設定 —— 沒寫「已經帶上」的那幾位，匯完請到客戶詳情頁自己設，
        沒設的話壓表卡片牆上那顆丸子不會出現，你在診間就看不到這件事。</p>
    </section>`;
}

function summaryCard(s, plans, extraProblems) {
  const problems = [...plans.flatMap((p) => p.problems), ...extraProblems];
  const span = file.calendar?.span ?? [];
  return `
    <section class="card">
      <h2 class="card__title">會寫進去什麼</h2>
      <p><b>${s.customers}</b> 位客戶　<b>${s.entitlements}</b> 筆額度　<b>${s.visits}</b> 筆來訪　<b>${s.slots}</b> 個時段</p>
      <p class="muted">其中 <b>${s.timed}</b> 個時段有時間，${s.slots - s.timed} 個時間不詳（行事曆上找不到，維持空白）。</p>
      ${s.future ? `<p class="muted">來訪裡有 <b>${s.future}</b> 筆的日期在今天之後，會建成
        <b>已確認</b> —— 那是「已經約好、還沒來」：算進已排未上，次數還不會扣。
        其餘的標成已完成。</p>` : ''}
      ${s.followups ? `<p class="muted">額度裡有 <b>${s.followups}</b> 筆二返是系統配的
        —— 買幾次健檢就有幾次二返，合併檔上沒有這一項。次數不對就到客戶詳情頁改。</p>` : ''}
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
      ${purchaseProblemsHtml(plans)}
    </section>`;
}

/**
 * B2「購買名稱」拿應有次數驗過一次、對不上的那幾條（合併檔 v2，
 * `.scratch/asks-2026-09-13/issues/08`）。**預設展開**：她說「合併的時候也可以再問我一次」，
 * 而匯進去的是應有次數那一份 —— 收起來的話她不會知道有幾位的方案是照 D 欄匯的。
 */
function purchaseProblemsHtml(plans) {
  const rows = plans.filter((p) => !p.skip && p.purchaseProblems?.length);
  if (!rows.length) return '';
  const n = rows.reduce((sum, p) => sum + p.purchaseProblems.length, 0);
  return `
    <details open data-purchase-problems>
      <summary>${n} 條購買名稱跟應有次數對不上（照應有次數匯）</summary>
      <ul class="tight">${rows.map((p) => p.purchaseProblems.map((why) =>
    `<li>${esc(p.customerName)}｜${esc(why)}</li>`).join('')).join('')}</ul>
    </details>`;
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

/**
 * 候選清單。**先分時間、再分來源** —— 她要問的是「這件事發生了沒」，
 * 不是「這筆資料哪裡來的」（`.scratch/first-real-import/issues/05`）。
 *
 * 分組與預設值都在 `domain/mergeImport.js`，這裡只負責畫。
 */
function candidateCards() {
  const groups = groupCandidates(file, todayISO());
  return [
    block('future', '還沒發生的', groups.future, {
      note: '她現在正在管理的事，所以<b>預設全部勾起來</b>。不要的自己取消。',
      extra: groups.plannedFuture
        ? `另外有 <b>${groups.plannedFuture}</b> 筆未來的來訪寫在客戶的療程紀錄裡，`
          + '那些一定會匯入，不用勾 —— 那是她已經約好的事，日曆上必須看得到。'
        : '',
    }),
    block('past', '已經發生的', groups.past, {
      note: '補歷史要謹慎：補一筆進去等於說「那天做了這件事」，而那會扣一次次數。'
        + '所以<b>預設一筆都不勾</b>，要哪幾筆自己挑。',
      extra: '',
    }),
    ambiguousCard(),
  ].join('');
}

/** 一個時間區塊：底下再分「來訪」與「行事備註」兩段。 */
function block(which, title, group, { note, extra }) {
  const rows = [...group.visits, ...group.events];
  if (!rows.length) return '';
  const chosen = rows.filter((r) => picks[r.kind].has(r.index)).length;

  return `
    <section class="card">
      <h2 class="card__title">${title}<span class="badge">${chosen} / ${rows.length}</span></h2>
      <p class="muted">${note}</p>
      <p class="form__actions">
        <button class="btn" type="button" data-all="${which}" data-on="1">全選</button>
        <button class="btn" type="button" data-all="${which}" data-on="0">全不選</button>
      </p>
      ${section('來訪', group.visits, (r) => visitLine(r, which),
    which === 'future'
      ? '勾起來會建成「已確認」的來訪，算進已排未上，而且會長出登記待辦。'
      : '勾起來會補成一筆「已完成」的來訪，次數才算得對。')}
      ${section('行事曆上的雜事', group.events, eventLine,
    '<b>分類是猜的，改得掉。</b>Claude 照標題判成待辦／行事備註／休假，'
    + '每一列點一下就換一類 —— 判錯休假的代價最大，那幾天會整片排不進去。'
    + '待辦會變成掛了日期的隨手記，另外兩種不綁客戶、不產生任務、不扣次數。',
    (r) => kindPicker(r.index, r.item))}
      ${extra ? `<p class="muted">${extra}</p>` : ''}
    </section>`;
}

/**
 * @param {(r: object) => string} [after]
 *   畫在 `<label>` **外面**的東西。分類鈕一定要走這裡 ——
 *   放進 label 裡的話，點「休假」會順便把那一列的勾選也切掉。
 */
function section(title, rows, line, note, after = null) {
  if (!rows.length) return '';
  return `
    <h3 class="card__title" style="margin-top: var(--space-5)">${title}<span class="badge">${rows.length}</span></h3>
    <p class="muted">${note}</p>
    <ul class="tight">
      ${rows.map((r) => `
        <li><label class="choice" style="border: none; background: none; padding: 2px 0">
          <input type="checkbox" data-pick="${r.kind}" data-index="${r.index}"
            ${picks[r.kind].has(r.index) ? 'checked' : ''}>
          <span${r.kind === 'events' ? ` data-eventline="${r.index}"` : ''}>${line({ ...r, index: r.index })}</span>
        </label>${after ? after(r) : ''}</li>`).join('')}
    </ul>`;
}

const visitLine = ({ kind, item: x, date }, which) => `${esc(date)}　${esc(x.customerName)}　${esc(x.courseName)}
  ${x.startsAt ? `<b>${esc(x.startsAt)}</b>` : ''}
  <span class="muted">「${esc(x.evidence ?? '')}」${
  kind === 'missing'
    ? `（行事曆上有、試算表沒勾${x.sheetHasThatDay ? '，那天試算表有勾別的' : ''}）`
    : '（行事曆上的預約）'}${
  // 產檔的時候還在未來、貼進來的時候已經過了。照檔案標的建成「已確認」
  // （issues/03 的判準：檔案說 confirmed 就聽它），但那一筆的登記待辦
  // 一長出來就是逾期的紅字 —— 先講出來，不要讓她在待辦中心才發現。
  which === 'past' && x.status === 'confirmed'
    ? '　⚠ 檔案標成已確認，但日期已經過了 —— 會建成已確認，登記待辦一出生就逾期'
    : ''}</span>`;

const eventLine = ({ item: x, index }) => `${esc(x.startDate)}${
  x.endDate && x.endDate !== x.startDate ? `～${esc(x.endDate)}` : ''}　${
  x.startTime && kindOf(index) !== 'note' ? `<b>${esc(x.startTime)}</b>　` : ''}${esc(x.title)}
  ${x.endDate && x.endDate !== x.startDate ? '<span class="muted">（跨天）</span>' : ''}
  ${x.repeats ? '<span class="muted">（行事曆上是重複事件，只匯這一次）</span>' : ''}`;

/**
 * 那一列的三選一：待辦／行事備註／休假。
 *
 * 用 `aria-pressed` 標選中的那一顆、只重畫這一列（ADR-0038），不整頁重畫 ——
 * 這一頁一次列兩百筆，整頁重畫等於每點一下就捲回最上面。
 *
 * `why` 是產檔那側判斷的理由，只在**她還沒改過**的那幾列顯示：改過之後那句話
 * 講的是上一個答案，留著只會讓人以為系統不同意她。
 */
function kindPicker(index, x) {
  const now = kindOf(index);
  const why = !kindOverrides.has(index) && x.why ? x.why : '';
  return `<span class="kindpick" data-kindrow="${index}">
    <span class="seg" role="group">
      ${CALENDAR_KINDS.map((k) => `<button class="seg__item" type="button"
        data-kind="${k}" data-index="${index}" aria-pressed="${k === now}">${KIND_LABEL[k]}</button>`).join('')}
    </span>
    ${why ? `<span class="muted">${esc(why)}</span>` : ''}
  </span>`;
}

/**
 * 對得上兩位以上客戶的那幾筆。**唯讀** —— 勾了也不知道要算給誰。
 *
 * 產檔那側花力氣不猜，app 這側連提都沒提的話，那一筆來訪就這樣消失了：
 * 兩邊都沒有錯，但東西不見了。
 */
function ambiguousCard() {
  const rows = file.ambiguous ?? [];
  if (!rows.length) return '';
  return `
    <section class="card">
      <h2 class="card__title">這 ${rows.length} 筆兩位客戶都可能</h2>
      <p class="muted">行事曆上沒寫是誰，而那天有兩位以上都排了這個療程。
        <b>一筆都沒有匯入</b>，也沒辦法在這裡勾 —— 勾了也不知道要算給誰。
        匯完到日曆上自己補。</p>
      <ul class="tight">
        ${rows.map((a) => `<li>${esc(a.date ?? '')}　${esc(a.course ?? '')}
          <span class="muted">「${esc(a.evidence ?? '')}」</span>
          → 可能是：${esc((a.who ?? []).join(' 或 '))}</li>`).join('')}
      </ul>
    </section>`;
}

/**
 * 勾起來的雜事照現在的分類數一遍，一句話。
 *
 * **不重算整頁**：她改分類的時候要看得到「休假變幾筆了」，而那正是最該看一眼的
 * 數字 —— 休假多一天，那一天就整片排不進去。
 */
function tallyText() {
  return looseTally(file?.eventCandidates, kindOf, [...picks.events])
    .map((x) => `${x.label} ${x.count}`).join('　');
}

function repaintLooseCounts(el) {
  const node = el.querySelector('[data-loosecount]');
  if (node) node.textContent = tallyText();
}

/**
 * 「一筆待辦都不會長」的理由。
 *
 * **會不會長是看課程的類別，不是看有沒有未來的來訪**（`countNewTasks()` 問的是
 * `syncTasksForVisit()`）。這兩件事以前被寫成同一句，於是未來那幾筆全是 C 類
 * （復能、靜脈、EECP、營養點滴 —— 她大部分的量）的時候，這一頁上面才剛說
 * 「來訪裡有 N 筆的日期在今天之後」，兩段之後就說「這次沒有還沒發生的來訪」。
 * 同一頁自打嘴巴比不講還糟。
 */
function noTaskWhy(s, tasks) {
  if (tasks) {
    return `還沒發生的那些會，這次是 <b>${tasks}</b> 筆：那幾件登記與確認是真的還沒做。`;
  }
  if (s.future) {
    return `還沒發生的那 <b>${s.future}</b> 筆都是不用另外掛號的課程，`
      + '所以這次一筆待辦也不會長出來。';
  }
  return '這次沒有還沒發生的來訪，所以一筆待辦都不會長出來。';
}

function runCard(s, tasks) {
  return `
    <section class="card">
      <p class="muted">行事曆上的雜事，勾起來的有：<b data-loosecount>${tallyText()}</b>。
        待辦會變成掛了日期的隨手記，在日曆上是可以勾掉的那一類。</p>
      <p class="form__actions">
        <button class="btn btn--primary" type="button" data-run ${s.customers ? '' : 'disabled'}>開始匯入</button>
      </p>
      <p class="muted">每一筆都會標上來源，之後查得出是從哪一次合併進來的。
        已經發生的來訪標成<b>已完成</b>，日期在今天之後的建成<b>已確認</b>
        （算進已排未上，次數還不會扣）。</p>
      <p class="muted">已經發生的那些<b>不會產生任何待辦任務</b> ——
        那些掛號在舊系統早就做完了。${noTaskWhy(s, tasks)}</p>
    </section>`;
}

async function run(el, ctx, plans, s, tasks) {
  const { events, notes } = chosenLoose();
  const extras = picks.future.size + picks.missing.size;

  const ok = await confirmAction({
    title: '開始匯入',
    consequences: [
      `建立 ${s.customers} 位客戶、${s.entitlements} 筆額度、${s.visits} 筆來訪（${s.slots} 個時段）`,
      `其中 ${s.timed} 個時段有時間，${s.slots - s.timed} 個時間不詳`,
      s.future
        ? `${s.future} 筆的日期在今天之後，建成「已確認」（算進已排未上，次數還不會扣）`
        : '沒有日期在今天之後的來訪，全部標成已完成',
      ...(s.followups ? [`額度裡有 ${s.followups} 筆二返是系統配的（買幾次健檢就有幾次二返）`] : []),
      extras ? `另外補 ${extras} 筆你勾起來的來訪` : '沒有勾任何要補的來訪',
      events.length ? `建立 ${events.length} 筆行事備註或休假` : '沒有勾任何行事備註或休假',
      notes.length ? `建立 ${notes.length} 筆待辦（掛了日期的隨手記）` : '沒有勾任何待辦',
      s.low ? `${s.low} 個時段的時間是推測的，匯完可以再改` : '沒有推測來的時間',
      tasks
        ? `還沒發生的那幾筆會產生 ${tasks} 筆登記待辦；已經發生的一筆都不會長`
        : `不會產生任何待辦任務 —— ${s.future
          ? `還沒發生的那 ${s.future} 筆都是不用另外掛號的課程`
          : '這次沒有還沒發生的來訪'}`,
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
      toast.saving(`匯入中… 行事備註與休假 ${events.length} 筆`);
      await importer.importEvents(events);
    }
    if (notes.length) {
      toast.saving(`匯入中… 待辦 ${notes.length} 筆`);
      await importer.importNotes(notes);
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
    picks = emptyPicks();
    kindOverrides = new Map();
  }

  await render(el);
}

function backLink() {
  return `<a class="backlink" href="#/settings">${icon('left', { size: 19 })}設定</a>`;
}
