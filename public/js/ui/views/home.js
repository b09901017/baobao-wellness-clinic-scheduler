// 待辦中心。SPEC 第 8.1 節。首頁。
//
// 主力裝置是手機：她在院內走動、臨時被問，要能隨手勾掉一筆。
//
// **這一頁只放分類與數字，完整內容一律點進去看。** 她開這一頁是為了知道
// 「現在有幾件事、哪一件最急」，不是為了讀完所有細節。
//
// 最重要的一條動線是「跟客人確認時間」：壓表記完 → 這裡出現 → 問完按打勾 →
// 跳出確認畫面把所有時段攤開 → 確認後進日曆。客人說某幾筆不行就逐筆退回，
// 其餘照樣成立 —— 不做整批一次確認，因為客人常常是「這兩天可以、那天不行」。

import * as tasksData from '../../data/tasks.js';
import * as health from './health.js';
import * as visitsData from '../../data/visits.js';
import * as notesData from '../../data/notes.js';
import * as customersData from '../../data/customers.js';
import * as config from '../../data/config.js';
import * as invitesData from '../../data/formInvites.js';
import * as responsesData from '../../data/formResponses.js';
import * as formInbox from './formInbox.js';
import { urgency, isCancelKind } from '../../domain/taskRules.js';
import { confirmMessage, askAvailabilityMessage } from '../../domain/messages.js';
import {
  visitsToClose, visitsToConfirm, closeVisit, describeStatus, formSlotIndexes, NOTE_MAX,
} from '../../domain/visits.js';
import { waitState, followupNoteOf } from '../../domain/confirmations.js';
import {
  sortNotes, openCount, groupByCustomer, MAX_LENGTH as NOTE_TEXT_MAX,
} from '../../domain/notes.js';
import { customersToAsk, customersToBook, monthRange } from '../../domain/scheduling.js';
import { groupByStage, nextStage, isRetired, RETIRED_KINDS } from '../../domain/todoFlow.js';
import { contraindicationTerms } from '../../domain/contraindications.js';
import * as flagsUi from '../components/flags.js';
import { splitByInvite, formLink } from '../../domain/availabilityForm.js';
import {
  todayISO, shortDate, daysBetween, addMonths, monthLabel,
} from '../../domain/dates.js';
import { wireDrag, openSheet } from '../components/sheet.js';
import { timeLabel } from '../../domain/visitTime.js';
import * as f from '../components/form.js';
import * as message from '../components/message.js';
import * as note from '../components/note.js';
import { icon } from '../icons.js';
import { confirmAction } from '../components/dialog.js';
import * as toast from '../toast.js';
import { go } from '../router.js';

const esc = f.esc;

// 勾選的任務只活在這一次畫面裡。重畫（勾完送出、復原）就清空。
let picked = new Set();

// 總覽 / 依客戶。切換不進網址 —— 它是看法，不是位置。
let tab = 'all';

// 確認畫面。開著的是哪一位、哪幾段被客人退掉。
let drawer = null;

// 「問這輪的時間」那一列。null = 還沒載完（見 loadAsk）。
let askRows = null;

// 其中「連結已經發出、還沒填」的有幾位。那一列的數字不減掉他們（ADR-0033），
// 但說明文字要講出來，不然她會重複問。
let sentCount = 0;

// 「客戶填好的時間」那一列。null = 還沒載完，跟 askRows 同一個道理。
let inboxRows = null;

// 「壓表登記」那一列。null = 還沒載完，跟 askRows 同一個道理。
let bookRows = null;

// 「問這輪的時間」那一頁的分段切換：還沒發連結 / 已經發出。
// 存在模組裡而不是網址裡 —— 它是看法，不是位置（同首頁的「總覽／依客戶」）。
let askTab = 'todo';

// ---------- 總覽 ----------

export async function render(el) {
  el.innerHTML = '<p class="muted">載入中…</p>';
  picked = new Set();
  drawer = null;
  askRows = null;
  sentCount = 0;
  inboxRows = null;
  bookRows = null;

  const today = todayISO();
  let tasks;
  let pending;
  let unclosed;
  let notes;
  let settings;
  try {
    [tasks, pending, unclosed, notes, settings] = await Promise.all([
      tasksData.listOpen(),
      visitsData.listByStatus('pending_confirm'),
      visitsData.listUnclosed(today),
      notesData.listOpen(),
      config.getSettings(),
    ]);
  } catch (err) {
    el.innerHTML = `<div class="card"><p>讀取失敗：${esc(err.message)}</p>
      <p class="muted">如果一直失敗，可能是 Firestore 的索引還沒建好 ——
      Console 的錯誤訊息裡會有一個建立索引的連結。</p></div>`;
    return;
  }

  const ctx = { el, tasks, pending, unclosed, notes, settings, today };
  paint(ctx);
  loadAsk(ctx);
  loadInbox(ctx);
  loadBook(ctx);
}

/**
 * 「壓表登記」那一列要的四份資料，算成一組 row。首頁那一列與 `#/todo/book`
 * 兩邊共用 —— 兩份寫法遲早會有一份忘了帶 `includeDeleted`，而那一顆的後果
 * 是整位客戶從清單上消失（見底下）。
 *
 * **課程主檔要含已刪除的。** `customersToBook()` 認不得課程時會把那一筆
 * 來訪當成「沒動到任何系統」，於是她只要在主檔停用一個課程，用過那個課程的
 * 客戶就會被算成「這個月還沒壓」而重複出現 —— 帶著已刪除的才問得到真話。
 */
async function loadBookRows(today) {
  const month = today.slice(0, 7);
  const range = monthRange(month);
  const [customers, entitlementsBy, visits, courses] = await Promise.all([
    customersData.list(),
    customersData.entitlementsByCustomer(),
    visitsData.listBetween(range.from, range.to),
    config.listAll('courses', { includeDeleted: true }),
  ]);

  const visitsBy = {};
  for (const v of visits) (visitsBy[v.customerId] ??= []).push(v);

  return customersToBook({
    customers,
    entitlementsBy,
    visitsBy,
    coursesById: Object.fromEntries(courses.map((c) => [c.id, c])),
    targetMonth: month,
  });
}

/**
 * 「壓表登記」那一列。跟 loadAsk 同一個作法：頁面先畫完，這一列等資料回來。
 *
 * 它要多讀四份（客戶、額度、這個月的來訪、課程主檔），而這一頁她一天開十幾次。
 */
async function loadBook(ctx) {
  try {
    bookRows = await loadBookRows(ctx.today);
  } catch {
    // 同 loadAsk：讀不到就當這一列不存在。它是提醒，不是這一頁的主體。
    bookRows = [];
  }

  const slot = ctx.el.querySelector('[data-book]');
  if (slot) slot.innerHTML = bookGroupRow(ctx.today);
  markNext(ctx.el);
}

/**
 * 「問這輪的時間」那一列的數字。
 *
 * 它要多讀三份資料（客戶、額度、可用性），而這一頁她一天開十幾次 ——
 * 所以照資料健檢那顆徽章的作法（scanHealth）：**先把頁面畫出來，
 * 這一列等資料回來再補上去**，不要為了它讓整頁多等一輪。
 *
 * 額度與可用性都是 collection group query，各一次，不是一位客戶一次。
 * 邀請多一次，跟著同一組 Promise.all 走，不多一輪往返。
 */
async function loadAsk(ctx) {
  try {
    const [customers, entitlementsBy, availabilityBy, invites] = await Promise.all([
      customersData.list(),
      customersData.entitlementsByCustomer(),
      customersData.availabilityByCustomer(),
      invitesData.list(),
    ]);
    askRows = customersToAsk({ customers, entitlementsBy, availabilityBy, today: ctx.today });
    // 連結發出去了的那幾位還是留在名單上（他們確實還沒回），只是說明要講出來。
    sentCount = splitByInvite({ rows: askRows, invites, today: ctx.today }).sent.length;
  } catch {
    // 讀不到就當這一列不存在。它是提醒，不是這一頁的主體 ——
    // 為了它把已經畫好的待辦換成一句錯誤訊息，代價比看不到這一列大。
    askRows = [];
    sentCount = 0;
  }

  // 她可能已經切到「依客戶」那個看法了，那時候沒有這個位置可以填。
  // 不用補救：切回來會重畫，那時 askRows 已經有了。
  const slot = ctx.el.querySelector('[data-ask]');
  if (slot) slot.innerHTML = askGroupRow();
  markNext(ctx.el);
}

/**
 * 「客戶填好的時間」那一列。跟 loadAsk 同一個作法：頁面先畫完，這一列等資料回來。
 *
 * 讀失敗一樣當它不存在 —— 收件匣是提醒，客戶填的東西還在 Firestore 裡，
 * 下次打開就看得到，沒有任何東西會因此掉。
 */
async function loadInbox(ctx) {
  try {
    inboxRows = await responsesData.listInbox();
  } catch {
    inboxRows = [];
  }

  const slot = ctx.el.querySelector('[data-inbox]');
  if (slot) slot.innerHTML = inboxGroupRow();
  markNext(ctx.el);
}

function paint(ctx) {
  const { el, tasks, pending, unclosed, notes, today } = ctx;

  const overdue = tasks.filter((t) => urgency(t.dueDate, today) === 'overdue');
  const dueToday = tasks.filter((t) => t.dueDate === today);
  const tomorrow = tasks.filter((t) => daysBetween(today, t.dueDate) === 1);
  const waiting = byCustomer(visitsToConfirm(pending, today));
  const toClose = visitsToClose(unclosed ?? [], today);

  el.innerHTML = `
    <div class="page">
      <div class="page__row">
        <span class="muted num">${esc(shortDate(today))}</span>
      </div>
      <h1 class="page__title">${headline(tasks.length, overdue.length, waiting.size, toClose.length)}</h1>
    </div>

    <div data-health></div>

    <div class="seg" role="group" style="margin-bottom: var(--space-4)">
      <button class="seg__item" type="button" aria-pressed="${tab === 'all'}" data-tab="all">總覽</button>
      <button class="seg__item" type="button" aria-pressed="${tab === 'who'}" data-tab="who">依客戶</button>
    </div>

    ${tab === 'all' ? overviewHtml(ctx, { overdue, dueToday, tomorrow, waiting, toClose })
                    : byCustomerHtml(ctx, waiting)}

    ${notesCard(notes)}

    ${quickFab()}`;

  wireOverview(ctx);
  wireQuickCapture(ctx);
  markNext(el);
  scanHealth(el);
}

/**
 * 標出「下一步」：**流程上最前面那個還有東西的段**，不是數字最大的那一段 ——
 * 她的問題是「接下來做什麼」，而流程的答案是從頭開始。
 *
 * 在 DOM 上算而不是在資料上算，因為有三列是等資料回來才補進去的
 * （`loadAsk` / `loadInbox` / `loadBook`）。那三支填完會再叫一次這裡。
 */
function markNext(el) {
  const groups = [...el.querySelectorAll('.flowgroup')];
  for (const g of groups) g.classList.remove('flowgroup--next');
  groups.find((g) => g.querySelector('.grouprow'))?.classList.add('flowgroup--next');
}

/** 一句話講完現在的狀況。數字很小的時候不要硬講成很急。 */
function headline(total, overdue, waiting, toClose = 0) {
  if (!total && !waiting && !toClose) return '今天沒有待辦';
  const parts = [];
  if (total) parts.push(`今天有 ${total} 件`);
  // 沒結案的排在最前面 —— 那是唯一會讓剩餘次數失準的一種（SPEC 第 4.2 節）
  if (toClose) parts.push(`${toClose} 筆還沒簽單結案`);
  else if (overdue) parts.push(`其中 ${overdue} 件逾期了`);
  else if (waiting) parts.push(`${waiting} 位在等你確認`);
  return parts.join('，');
}

/**
 * 總覽。**照流程的順序分段**，不是照樣板裡的出現順序（ADR-0043）。
 *
 * 三顆大數字不動：逾期／今天／明天是緊急度分流，跟流程是兩個軸，
 * 合在一起會兩個都講不清楚。
 *
 * 每一段固定都畫出來，**空的那一段由 CSS 的 `:has()` 收掉** ——
 * 有兩三列是等資料回來才補進去的（`data-ask` / `data-inbox` / `data-book`），
 * 段落先在那裡，補進來才有位置放，而且不必為了它重畫整塊。
 */
function overviewHtml(ctx, { overdue, dueToday, tomorrow, waiting, toClose }) {
  const { tasks } = ctx;
  const cancels = tasks.filter((t) => isCancelKind(t.kind));
  const kinds = [...new Set(tasks.filter((t) => !isCancelKind(t.kind)).map((t) => t.kind))];

  // 每一列先算出來，順序由 STAGES 決定，不是由這裡的寫法決定。
  const rows = [
    { id: 'ask', html: `<div data-ask>${askGroupRow()}</div>` },
    { id: 'forms', html: `<div data-inbox>${inboxGroupRow()}</div>` },
    { id: 'book', html: `<div data-book>${bookGroupRow(ctx.today)}</div>` },
    { id: 'confirm', html: waiting.size ? groupRow({
      href: '#/todo/confirm',
      label: '跟客人確認時間', note: '壓好了、還沒問過本人', n: waiting.size,
    }) : '' },
    { id: 'close', html: toClose.length ? groupRow({
      href: '#/todo/close',
      label: '簽療程單', note: '來了、單簽了就打勾，次數這時才扣', n: toClose.length,
    }) : '' },
    ...kinds.map((k) => ({ id: k, html: groupRow({
      href: `#/todo/${encodeURIComponent(k)}`,
      label: k, note: isRetired(k) ? '這個類別已經取消了，這是舊資料' : kindNote(k),
      n: tasks.filter((t) => t.kind === k).length,
      faded: isRetired(k),
    }) })),
    { id: 'cancel', html: cancels.length ? groupRow({
      href: '#/todo/cancel',
      label: '改時間／取消', note: '要回頭取消舊登記', n: cancels.length, danger: true,
    }) : '' },
  ];

  return `
    <div class="tiles">
      ${tile('overdue', overdue.length, '逾期', 'tile--overdue')}
      ${tile('today', dueToday.length, '今天', 'tile--soon')}
      ${tile('tomorrow', tomorrow.length, '明天', '')}
    </div>

    ${groupByStage(rows).map(({ stage, rows: mine }) => `
      <section class="flowgroup flowgroup--${stage.tone}">
        <h2 class="flowgroup__head">
          <span class="flowgroup__n num">${stage.n}</span>
          <span class="flowgroup__label">${esc(stage.label)}</span>
          <span class="flowgroup__next">下一步</span>
        </h2>
        <div class="groups">${mine.map((r) => r.html).join('')}</div>
      </section>`).join('')}`;
}

/**
 * 她流程的**第一步**：問客戶下個月哪幾天方便。壓表之前的事。
 *
 * 還沒載完（null）與沒有人要問（空）都不畫：一列寫著 0 的提醒，
 * 在一頁專講「現在有幾件事」的畫面上只是雜訊。
 */
function askGroupRow() {
  if (!askRows?.length) return '';
  const never = askRows.filter((r) => r.state === 'never').length;

  // 數字**不減掉**已經發出連結的那幾位：這一輪的時間確實還沒問到，
  // 把數字做小會讓她以為進度比實際好。改成在說明裡講出來（ADR-0033）。
  const note = sentCount
    ? `其中 ${sentCount} 位已經發出連結，在等他填`
    : (never ? `其中 ${never} 位從來沒問過` : '上次問的都過期了');

  return groupRow({
    href: '#/todo/ask',
    label: '問這輪的時間',
    note,
    n: askRows.length,
  });
}

/**
 * 客戶自己填好、還沒被收下的那幾份。
 *
 * 排在「問這輪的時間」上面：客戶已經回了的比還沒開口問的急 ——
 * 一份是等著她處理，另一份是等著她開口。
 *
 * 一樣，0 的時候整列不畫。
 */
function inboxGroupRow() {
  if (!inboxRows?.length) return '';

  return groupRow({
    href: '#/todo/forms',
    label: '客戶填好的時間',
    note: '客戶自己填的，看過就收下',
    n: inboxRows.length,
  });
}

/**
 * 她流程的**第三步**：這個月還有誰沒壓表。
 *
 * 數字是**人數**不是系統數 —— 她問的是「還有幾個人要處理」。同一位客戶
 * 健檢與其他都還沒排時，兩區都會出現，但這裡只算一次。
 */
function bookGroupRow(today) {
  if (!bookRows?.length) return '';
  const examine = bookRows.filter((r) => r.systems.some((x) => x.system === 'Examine')).length;

  return groupRow({
    href: '#/todo/book',
    label: '壓表登記',
    note: examine
      ? `${monthLabel(today)}還有 ${bookRows.length} 位沒排，其中 ${examine} 位是健檢`
      : `${monthLabel(today)}還有 ${bookRows.length} 位沒排`,
    n: bookRows.length,
  });
}

const KIND_NOTES = {
  打電話: '來訪前一天提醒',
  Abovee: '壓表登記',
  Examine: '預約作業 → 查核 → 已報到',
  耀聖: '右下角 → 未報到 → V',
  // 健檢做完了 → 先追蹤報告（兩三週才出來）→ 拿到了才約二返。
  // 兩張的死線都不是來訪日前一天，間隔在設定頁調，見 ADR-0042。
  追蹤健檢報告: '健檢做完了，報告通常兩三週出來',
  約二返: '報告拿到了，還沒約聽報告的時間',
};
const kindNote = (k) => KIND_NOTES[k] ?? '';

function tile(id, n, label, cls) {
  return `
    <button class="tile ${cls}" type="button" data-tile="${id}">
      <span class="tile__n">${n}</span>
      <span class="tile__label">${esc(label)}</span>
    </button>`;
}

/**
 * 一列。**小圓點與「重點列」的底色都拿掉了** —— 段落左邊那條線接手了顏色
 * 這件事。一列一個點、一列一片綠底、一段一條線，三套視覺語言在講同一件事，
 * 而看的人只會覺得吵（ADR-0043）。
 */
function groupRow({ href, label, note, n, danger = false, faded = false }) {
  return `
    <a class="grouprow ${faded ? 'grouprow--faded' : ''}" href="${href}">
      <span class="grouprow__main">
        <span class="grouprow__label" ${danger ? 'style="color: var(--overdue)"' : ''}>${esc(label)}</span>
        ${note ? `<span class="grouprow__note">${esc(note)}</span>` : ''}
      </span>
      <span class="grouprow__n" ${danger ? 'style="color: var(--overdue)"' : ''}>${n}</span>
      ${icon('right', { size: 18 })}
    </a>`;
}

/** 依客戶：一位客戶一列，看得出「這個人身上還有幾件事」。 */
function byCustomerHtml(ctx, waiting) {
  const { tasks } = ctx;
  const rows = new Map();

  const bump = (id, name, what) => {
    if (!rows.has(id)) rows.set(id, { id, name, whats: new Set(), n: 0 });
    const row = rows.get(id);
    row.whats.add(what);
    row.n += 1;
  };

  for (const t of tasks) bump(t.customerId, t.customerName ?? '（沒有名字）', t.kind);
  for (const [id, visits] of waiting) {
    bump(id, visits[0].customerName ?? '（沒有名字）', '跟客人確認時間');
  }

  if (!rows.size) return '<p class="muted">沒有待辦。</p>';

  return `
    <div class="stack">
      ${[...rows.values()]
        .sort((a, b) => b.n - a.n || String(a.name).localeCompare(String(b.name), 'zh-TW'))
        .map((r) => `
          <a class="card row" href="#/customers/${esc(r.id)}" style="text-decoration: none; color: inherit">
            <span class="row__main">
              <span class="row__title">${esc(r.name)}</span>
              <span class="muted">${esc([...r.whats].join('・'))}</span>
            </span>
            <span class="badge ${r.whats.has('跟客人確認時間') ? 'badge--ok' : 'badge--soon'}">${r.n}</span>
            ${icon('right', { size: 18 })}
          </a>`).join('')}
    </div>`;
}

// ---------- 隨手記 ----------

/**
 * 客人的零碎小要求。沒有死線，所以它不是任務（見 CONTEXT.md）。
 *
 * 首頁只放最近幾筆與一個輸入框 —— 它要能在三秒內記完，多一個必填欄位
 * 就會變成「算了我等一下再記」，然後就忘了。掛客戶在點進去那一頁做。
 */
function notesCard(notes) {
  const rows = sortNotes(notes).slice(0, 4);
  return `
    <section class="card" style="margin-top: var(--space-5)">
      <div class="row" style="align-items: baseline; margin-bottom: var(--space-2)">
        <h2 class="card__title row__main" style="margin: 0">隨手記
          <span class="muted"> ${openCount(notes)}</span></h2>
        <a class="muted" href="#/todo/notes"
           style="display: inline-flex; align-items: center; gap: 2px; white-space: nowrap">
          全部${icon('right', { size: 14 })}</a>
      </div>

      <div class="groups">
        ${rows.map((n) => note.row(n)).join('') || '<p class="muted" style="padding: var(--space-3)">還沒記過。客人臨時說的小要求記在這裡。</p>'}
      </div>

      <form data-newnote style="margin-top: var(--space-3)">
        <div style="display: flex; gap: var(--space-2)">
          <input type="text" name="text" maxlength="${NOTE_TEXT_MAX}" style="flex: 1; min-width: 0"
                 placeholder="記一筆…" aria-label="新的隨手記" />
          <button class="btn btn--primary" type="submit">記</button>
        </div>
        ${note.field()}
      </form>
    </section>`;
}

// ---------- 隨手記：右下角那顆泡泡 ----------

/*
 * `domain/notes.js` 的檔頭寫死了這件事的標準：「它要能在三秒內記完，
 * 多一個必填欄位就會變成『算了我等一下再記』，然後就忘了」。
 *
 * 那份判斷是對的，只是**它只管到了表單裡面**。表單本身確實只要打一行字 ——
 * 但走到那個表單前面要先捲過整頁待辦，而她要記的那句話是客人**當著她的面**
 * 講的。三秒是從口袋掏出手機開始算，不是從捲到底開始算。
 *
 * 所以右下角一顆泡泡：點下去、鍵盤自己上來、打字、送出。
 */

function quickFab() {
  return `
    <div class="fab">
      <button class="fab__main" type="button" data-quick aria-label="記一筆隨手記">
        ${icon('pencil', { size: 24, width: 2 })}
      </button>
    </div>`;
}

function wireQuickCapture(ctx) {
  ctx.el.querySelector('[data-quick]')?.addEventListener('click', () => openQuick(ctx));
}

/**
 * 從底部滑出來的捕捉面板。
 *
 * **送出之後不關掉。** 同一位客人常常一次講三件事，關掉再點開三次
 * 就是把剛剛省下來的又還回去。清空、焦點留著、剛記的那幾筆列在底下。
 */
function openQuick(ctx) {
  // 這一趟記了哪幾筆。關掉時用它決定要不要重畫首頁 ——
  // 什麼都沒記就不要重畫，那會白閃一下。
  const added = [];

  openSheet({
    title: '記一筆',
    note: '客人臨時說的小要求。沒有死線，所以它不是任務。',
    body: quickBody(),
    actions: '<button class="btn btn--primary btn--wide" type="button" data-save>記下來</button>',
    onMount: (drawer) => {
      const input = drawer.querySelector('[data-quicktext]');
      // **同步聚焦。** onMount 是在 openSheet() 裡面同步呼叫的（在 playIn() 之前），
      // 所以這一下還在她點泡泡那個手勢的堆疊裡，iOS 才肯把鍵盤叫出來。
      // 包進 setTimeout 或 requestAnimationFrame 就會失效，而且是**靜靜地**失效
      // —— 桌機上看起來完全正常。
      input?.focus();

      if (drawer.dataset.quickWired) return;
      drawer.dataset.quickWired = '1';
      wireQuick(drawer, ctx, added);
    },
    onClose: () => {
      // 記了東西才重畫首頁：底下那張卡與數字要跟著更新
      if (added.length) render(ctx.el);
    },
  });
}

function quickBody() {
  return `
    <input type="text" data-quicktext maxlength="${NOTE_TEXT_MAX}"
           placeholder="例：指定 LuLu，不要排騰崴" aria-label="記什麼"
           enterkeyhint="done" autocomplete="off" style="width: 100%" />

    <div class="quickwho">
      <button class="chip chip--sm" type="button" data-who aria-pressed="false">
        <span data-wholabel>掛給誰？可以不掛</span>
      </button>
      <button class="chip chip--sm" type="button" data-whoclear hidden>不掛了</button>
    </div>
    <div data-wholist hidden></div>

    ${note.field()}

    <div data-just></div>`;
}

function wireQuick(drawer, ctx, added) {
  // 掛給誰是選填的，所以客戶名單**點開才讀** —— 她十次有九次不掛人，
  // 沒必要為了那一次讓每次開面板都多一次往返。
  let customers = null;
  let picked = null;
  const when = note.wire(drawer);

  const input = () => drawer.querySelector('[data-quicktext]');
  const label = () => drawer.querySelector('[data-wholabel]');

  const showPicked = () => {
    label().textContent = picked ? picked.name : '掛給誰？可以不掛';
    drawer.querySelector('[data-who]').setAttribute('aria-pressed', String(Boolean(picked)));
    drawer.querySelector('[data-whoclear]').hidden = !picked;
    drawer.querySelector('[data-wholist]').hidden = true;
  };

  const openWho = async () => {
    const box = drawer.querySelector('[data-wholist]');
    if (!box.hidden) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    if (!customers) {
      box.innerHTML = '<p class="muted">讀取中…</p>';
      try {
        customers = await customersData.list();
      } catch {
        box.innerHTML = '<p class="muted">讀不到客戶名單。先記下來，之後再掛人也行。</p>';
        return;
      }
    }
    box.innerHTML = `
      <div class="chips" style="margin-top: var(--space-2)">
        ${customers.map((c) => `
          <button class="chip chip--sm" type="button" data-pick="${esc(c.id)}"
                  aria-pressed="${picked?.id === c.id}">${esc(c.name)}</button>`).join('')
        || '<span class="muted">還沒有客戶。</span>'}
      </div>`;
  };

  const save = async () => {
    const text = String(input()?.value ?? '').trim();
    if (!text) {
      input()?.focus();
      return;
    }
    try {
      await toast.withSaveState(
        () => notesData.create({
          text,
          customerId: picked?.id ?? null,
          customerName: picked?.name ?? null,
          date: note.read(drawer),
        }),
        { success: '記下來了' },
      );
    } catch {
      return; /* withSaveState 已經顯示錯誤與重試 */
    }

    added.push(text);
    const just = drawer.querySelector('[data-just]');
    just.innerHTML = `
      <p class="quickjust__head">剛剛記的 ${added.length}</p>
      ${added.map((t) => `
        <p class="quickjust__row">${icon('check', { size: 13, width: 3 })}
          <span>${esc(t)}</span></p>`).join('')}`;

    // 清空、焦點留在輸入框 —— 她的下一句話通常就跟在後面。
    // **不重畫整個面板**：換掉節點就等於把鍵盤收起來再叫一次，那一下會閃。
    // 日期一起清掉：三件事記在一起不代表都掛同一天，而她「忘了取消上一筆的日期」
    // 的後果是日曆上多一條她沒打算放的東西。
    input().value = '';
    when.set(null);
    input().focus();
  };

  drawer.addEventListener('click', (e) => {
    if (e.target.closest('[data-save]')) return save();
    if (e.target.closest('[data-whoclear]')) {
      picked = null;
      showPicked();
      return;
    }
    if (e.target.closest('[data-who]')) return openWho();

    const pick = e.target.closest('[data-pick]');
    if (pick) {
      const found = (customers ?? []).find((c) => c.id === pick.dataset.pick);
      // 再點一次同一位就取消
      picked = picked?.id === found?.id ? null : found;
      showPicked();
      input()?.focus();
    }
    return null;
  });

  drawer.addEventListener('keydown', (e) => {
    // 輸入法組字中的 Enter 是「確定這個字」，不是「送出」
    if (!e.target.matches('[data-quicktext]')) return;
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    save();
  });
}

// ---------- 資料健檢 ----------

/**
 * SPEC 第 6.6 節要求 app 啟動時也在背景跑一次，而她一打開 app 就是這一頁。
 * 掃描本身每天最多跑一次，細節見 views/health.js。
 *
 * 沒問題時整張卡不出現：沒事還佔一格，下次真的有事時她也不會注意到。
 */
async function scanHealth(el) {
  const paintCard = (badge) => {
    const slot = el.querySelector('[data-health]');
    if (!slot) return;
    slot.innerHTML = badge
      ? `<a class="card" href="#/settings/health" style="display: block; text-decoration: none; color: inherit; border-color: var(--soon)">
           <div class="row">
             <span class="row__main">
               <span class="card__title" style="margin: 0; display: block">資料健檢</span>
               <span class="badge badge--soon" style="margin: 3px 0">${esc(badge)}</span>
               <span class="muted" style="display: block">背景掃描發現的差異。只是提醒，沒有動到任何資料。</span>
             </span>
             ${icon('right', { size: 16 })}
           </div>
         </a>`
      : '';
  };

  paintCard(health.lastBadge());
  const result = await health.runIfDue();
  if (result) paintCard(health.lastBadge());
}

// ---------- 總覽的事件 ----------

function wireOverview(ctx) {
  const { el } = ctx;

  el.querySelectorAll('[data-tab]').forEach((btn) =>
    btn.addEventListener('click', () => {
      tab = btn.dataset.tab;
      paint(ctx);
    }),
  );

  el.querySelectorAll('[data-tile]').forEach((btn) =>
    btn.addEventListener('click', () => go(`/todo/${btn.dataset.tile}`)),
  );

  el.querySelectorAll('[data-note]').forEach((btn) =>
    btn.addEventListener('click', () => toggleNote(ctx, btn.dataset.note)),
  );

  note.wire(el);

  el.querySelector('[data-newnote]')?.addEventListener('submit', (e) => {
    e.preventDefault();
    addNote(ctx, e.target);
  });
}

async function toggleNote(ctx, id) {
  const note = ctx.notes.find((n) => n.id === id);
  if (!note) return;
  try {
    await toast.withSaveState(() => notesData.setDone(id, !note.done), {
      success: note.done ? '拿回來了' : '勾掉了',
    });
    await render(ctx.el);
  } catch {
    /* 已處理 */
  }
}

async function addNote(ctx, form) {
  const text = form.elements.text.value.trim();
  if (!text) return;
  try {
    await toast.withSaveState(
      () => notesData.create({ text, date: note.read(form) }),
      { success: '記下來了' },
    );
    await render(ctx.el);
  } catch {
    /* 已處理 */
  }
}

// ---------- 點進去的那一頁 ----------

const GROUPS = {
  confirm: { title: '跟客人確認時間', lead: '壓好了、還沒問過本人。問完回來按打勾。' },
  close: { title: '簽療程單', lead: '客人來了、療程單簽了就打勾。次數是這時候才扣的。' },
  overdue: { title: '逾期的', lead: '死線已經過去了。' },
  today: { title: '今天要做的', lead: '死線是今天。' },
  tomorrow: { title: '明天要做的', lead: '可以提早做。' },
  cancel: { title: '改時間／取消', lead: '來訪取消後，要回去把已經做掉的登記收回來。' },
  notes: { title: '隨手記', lead: '客人臨時說的小要求。沒有死線，所以它不是任務。' },
  ask: { title: '問這輪的時間', lead: '' },
  forms: { title: '客戶填好的時間', lead: '' },
  book: { title: '壓表登記', lead: '' },
};

/** 網址列與 app 標題用。認不得的當成任務種類原樣顯示。 */
export function groupTitle(group) {
  return GROUPS[group]?.title ?? group;
}

export async function renderGroup(el, group) {
  el.innerHTML = '<p class="muted">載入中…</p>';
  picked = new Set();
  drawer = null;

  if (group === 'confirm') return renderConfirm(el);
  if (group === 'close') return renderClose(el);
  if (group === 'notes') return renderNotes(el);
  if (group === 'ask') {
    askTab = 'todo';
    return renderAsk(el);
  }
  if (group === 'forms') return formInbox.render(el);
  if (group === 'book') return renderBook(el);

  const tasks = await tasksData.listOpen();
  const today = todayISO();

  const filters = {
    overdue: (t) => urgency(t.dueDate, today) === 'overdue',
    today: (t) => t.dueDate === today,
    tomorrow: (t) => daysBetween(today, t.dueDate) === 1,
    cancel: (t) => isCancelKind(t.kind),
  };
  const match = filters[group] ?? ((t) => t.kind === group);
  const meta = GROUPS[group] ?? {
    title: group,
    // 已經拿掉的種類（ADR-0041）。列還在是因為那是她真的還沒做的事 ——
    // 替她刪待辦比留著更糟（同 ADR-0027 的判斷）。但要講出來它不會再長了。
    lead: isRetired(group)
      ? '這個類別已經取消了 —— 底下是舊資料，不會再長出新的。勾掉就不會再出現。'
      : kindNote(group),
    retired: isRetired(group),
  };

  paintTasks({ el, group, tasks: tasks.filter(match), today, meta });
}

function paintTasks(ctx) {
  const { el, tasks, today, meta } = ctx;

  el.innerHTML = `
    ${backLink()}
    <div class="page">
      <h1 class="page__title">${esc(meta.title)}</h1>
      <p class="page__lead">${esc(meta.lead)}</p>
    </div>

    ${tasks.length ? `
      ${meta.retired ? `
        <div class="form__actions" style="margin-bottom: var(--space-3)">
          <button class="btn" type="button" data-pick-all>全部勾起來（${tasks.length} 筆）</button>
        </div>` : ''}
      <div class="stack">${tasks.map((t) => taskRow(t, today)).join('')}</div>
      <div class="form__actions" style="margin-top: var(--space-4)">
        <button class="btn btn--primary btn--wide" type="button" data-mark disabled>
          把勾起來的標成完成</button>
      </div>`
      : '<p class="muted">這裡是空的。</p>'}`;

  el.querySelectorAll('[data-task]').forEach((box) =>
    box.addEventListener('change', () => {
      if (box.checked) picked.add(box.dataset.task);
      else picked.delete(box.dataset.task);
      syncMarkButton(el);
    }),
  );

  el.querySelectorAll('[data-visit]').forEach((btn) =>
    btn.addEventListener('click', () => go(`/visits/${btn.dataset.visit}`)),
  );

  // 已經取消的類別才有這一顆。**它只是全部勾起來，不是直接標完成** ——
  // 送出前還要再按一次「把勾起來的標成完成」，而那一批是同一個 commit，
  // 所以復原退得回去（SPEC 第 6.3 節）。
  el.querySelector('[data-pick-all]')?.addEventListener('click', () => {
    el.querySelectorAll('[data-task]').forEach((box) => {
      box.checked = true;
      picked.add(box.dataset.task);
    });
    syncMarkButton(el);
  });

  el.querySelector('[data-mark]')?.addEventListener('click', () => markDone(ctx));
  syncMarkButton(el);
}

function backLink() {
  return `<a class="backlink" href="#/">${icon('left', { size: 19 })}待辦</a>`;
}

function taskRow(t, today) {
  const state = urgency(t.dueDate, today);
  return `
    <div class="card row" style="margin: 0">
      <label class="choice" style="border: none; background: none; padding: 0; flex: 1; min-width: 0; align-items: flex-start">
        <input type="checkbox" data-task="${esc(t.id)}" ${picked.has(t.id) ? 'checked' : ''} />
        <span class="row__main">
          <span class="row__title">
            ${esc(t.customerName ?? '（沒有名字）')}
            <span class="badge">${esc(t.kind)}</span>
            <span class="badge ${badgeClass(state)}">${esc(dueLabel(t.dueDate, today))}</span>
          </span>
          ${t.note ? `<span class="muted">${esc(t.note)}</span>` : ''}
        </span>
      </label>
      ${t.visitId ? `<button class="btn" type="button" data-visit="${esc(t.visitId)}"
                             style="min-height: 40px">來訪</button>` : ''}
    </div>`;
}

function badgeClass(state) {
  if (state === 'overdue') return 'badge--overdue';
  if (state === 'soon') return 'badge--soon';
  return '';
}

/** 死線用「還剩幾天」講，不是只給一個日期 —— 她要的是急不急，不是哪一天。 */
function dueLabel(dueDate, today) {
  const days = daysBetween(today, dueDate);
  if (days < 0) return `逾期 ${-days} 天`;
  if (days === 0) return '今天';
  if (days === 1) return '明天';
  return `${shortDate(dueDate)} 還有 ${days} 天`;
}

function syncMarkButton(el) {
  const btn = el.querySelector('[data-mark]');
  if (!btn) return;
  btn.disabled = picked.size === 0;
  btn.textContent = picked.size
    ? `把勾起來的 ${picked.size} 筆標成完成`
    : '把勾起來的標成完成';
}

async function markDone(ctx) {
  const ids = [...picked];
  if (!ids.length) return;
  try {
    // 一批寫在同一個 commit 裡，所以復原是整批一起退回去
    await toast.withSaveState(() => tasksData.setDone(ids, true), {
      success: `${ids.length} 筆完成`,
    });
    picked = new Set();
    await renderGroup(ctx.el, ctx.group);
  } catch {
    /* 已處理 */
  }
}

// ---------- 問這輪的時間 ----------
//
// 她流程的第一步，發生在壓表之前。在這一頁之前這件事只看得到一半：
// buildCustomerQueue() 算得出誰沒問過，但那個結果只出現在壓表卡片牆上，
// 她得先開一個批次才知道要問誰 —— 而開批次已經是下一步了。
//
// 誰該進來、怎麼排，一條規則都不在這裡：全部在 domain/scheduling.js 的
// customersToAsk()。

async function renderAsk(el, { focus = null } = {}) {
  const [customers, entitlementsBy, availabilityBy, invites] = await Promise.all([
    customersData.list(),
    customersData.entitlementsByCustomer(),
    customersData.availabilityByCustomer(),
    invitesData.list(),
  ]);

  const today = todayISO();
  const byId = Object.fromEntries(customers.map((c) => [c.id, c]));

  paintAsk({
    el, byId, invites, today, focus,
    rows: customersToAsk({ customers, entitlementsBy, availabilityBy, today }),
    // 她問的是下個月的時間 —— askAvailabilityMessage() 的預設也是下個月，
    // 兩邊講同一個月份，不要一邊寫 9 月一邊寫 10 月。
    month: addMonths(today, 1).slice(0, 7),
  });
}

/**
 * 三區，不是兩區。第三區是表單做出來之後才存在的那一段時間：
 * **連結發出去了、客戶還沒填**。她不該在那時候再問一次，但那一位也還沒問到，
 * 所以他留在名單上，只是排到最後面。見 ADR-0033。
 */
function paintAsk(ctx) {
  const { el, rows, invites, month, today, focus } = ctx;
  const groups = splitByInvite({ rows, invites, today });
  const todo = groups.never.length + groups.expired.length;

  el.innerHTML = `
    ${backLink()}
    <div class="page">
      <h1 class="page__title">問這輪的時間</h1>
      <p class="page__lead">問 ${Number(month.slice(5))} 月哪幾天方便。
        發一條連結讓客戶自己點，或者照舊自己問、問到之後記進客戶頁的「不能的時間」。</p>
    </div>

    ${rows.length ? `
      <div class="seg" role="group" style="margin-bottom: var(--space-4)">
        <button class="seg__item" type="button" data-asktab="todo"
                aria-pressed="${askTab === 'todo'}">還沒發連結 ${todo}</button>
        <button class="seg__item" type="button" data-asktab="sent"
                aria-pressed="${askTab === 'sent'}">已經發出 ${groups.sent.length}</button>
      </div>

      ${askTab === 'sent'
        ? askSection('已經發出連結', groups.sent, ctx,
          '連結給出去了，在等他填。先不要再問一次 —— 他填好會出現在「客戶填好的時間」。')
          || '<p class="muted">還沒發出任何連結。</p>'
        : `${askSection('從來沒問過', groups.never, ctx,
            '這幾位身上還有次數，但一次都沒問過時間。')}
           ${askSection('該重問了', groups.expired, ctx,
            '上次問到的已經過期了。過期的條件不能拿來排，要重新問一次。')}
           ${todo ? '' : '<p class="muted">都發出去了，在等他們填。</p>'}`}`
      : '<p class="muted">都問到了。</p>'}`;

  message.wire(el, toast.info);
  wireAsk(ctx);

  // 產生連結之後那一位會從左邊那一格跳到右邊，捲軸也會停在別的地方 ——
  // 她的下一個動作是「複製那則訊息」，所以捲回眼前，順便把訊息展開。
  if (focus) {
    el.querySelector(`[data-card="${CSS.escape(focus)}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const wrap = el.querySelector(`[data-msg-wrap="ask-${CSS.escape(focus)}"]`);
    if (wrap) wrap.open = true;
  }
}

function askSection(title, rows, ctx, lead) {
  if (!rows.length) return '';

  return `
    <div class="section">
      <h2 class="section__title">${esc(title)}</h2>
      <span class="section__n">${rows.length}</span>
    </div>
    <p class="muted" style="margin: 0 0 var(--space-3)">${esc(lead)}</p>
    <div class="stack">${rows.map((r) => askCard(r, ctx)).join('')}</div>`;
}

function askCard(row, { byId, month }) {
  const customer = byId[row.customerId];
  const name = row.customerName ?? '（沒有名字）';
  const link = row.invite ? formLink(location.origin, row.invite.id) : '';

  // 「幾天前」講的是最後一次問的那天，不是收集的有效期 ——
  // 她要判斷的是「這個人我多久沒聯絡了」。
  const when = row.invite
    // sentAt 壞掉或缺了就不要編一個日期出來 —— 「不知道哪天發的」跟「今天發的」
    // 是兩件事，而她看這一行就是為了判斷「等多久了，該不該催」。
    ? `連結${row.invite.sentAt ? ` ${shortDate(row.invite.sentAt)}` : ''}發出・還沒填`
    : row.state === 'never'
      ? '從來沒問過'
      : row.lastAskedAt
        ? `上次 ${shortDate(row.lastAskedAt)} 問的・${row.daysSinceAsked} 天前`
        : '問過，但不知道是哪天問的';

  return `
    <div class="card" style="margin: 0" data-card="${esc(row.customerId)}">
      <div class="row" style="align-items: flex-start">
        <div class="row__main">
          <div class="row__title">${esc(name)}</div>
          <div class="muted num">${esc(when)}・還剩 ${row.remaining} 次</div>
        </div>
        <a class="footlink" href="#/customers/${esc(row.customerId)}">去記錄</a>
      </div>

      ${link ? `
        ${message.box({
          id: `ask-${row.customerId}`,
          text: askAvailabilityMessage(customer ?? { name }, { month, link }),
          collapsed: true,
          buttonLabel: '複製 LINE 訊息',
        })}
        <p style="margin: var(--space-1) 0 0">
          <button class="btn btn--sm" type="button"
                  data-resend="${esc(row.customerId)}">重發一條新連結</button></p>`
        // 還沒產生連結就只有這一顆。訊息框要等連結出來才有意義 ——
        // 先把它畫在上面，她按完「產生」還得往下捲才找得到「複製」。
        : `<p style="margin: var(--space-3) 0 0">
             <button class="btn btn--primary btn--wide" type="button"
                     data-makelink="${esc(row.customerId)}">產生表單連結</button></p>`}
    </div>`;
}

/**
 * 連結**按下去的那一刻才產生**。她有二十幾位客戶但這一輪可能只問十二位，
 * 進這一頁就全部產生等於留下一堆沒發出去的邀請。
 *
 * 重發是「作廢舊的、發一條新的」：表單不重填（Rules 擋著），客戶填錯了的
 * 唯一出路就是拿到一條新連結。舊的留著只會讓他填一個已經作廢的東西。
 */
function wireAsk(ctx) {
  const { el, rows, invites, month, today } = ctx;
  const nameOf = (id) => rows.find((r) => r.customerId === id)?.customerName ?? '';

  // 切換**不重新讀資料**，就地重畫 —— 那三份資料剛剛才讀過，再讀一次只是讓她等。
  el.querySelectorAll('[data-asktab]').forEach((btn) =>
    btn.addEventListener('click', () => {
      askTab = btn.dataset.asktab;
      paintAsk({ ...ctx, focus: null });
    }));

  el.querySelectorAll('[data-makelink]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const customerId = btn.dataset.makelink;
      await toast.withSaveState(
        () => invitesData.create({ customerId, customerName: nameOf(customerId), month, sentAt: today }),
        { pending: '產生中…', success: '連結好了，複製訊息貼到 LINE' },
      );
      askTab = 'sent';
      renderAsk(el, { focus: customerId });
    }));

  el.querySelectorAll('[data-resend]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const customerId = btn.dataset.resend;
      const old = invites.filter((i) => i.customerId === customerId && !i.deletedAt);

      const ok = await confirmAction({
        title: '重發一條新連結？',
        consequences: [
          `${esc(nameOf(customerId))}手上那條連結會作廢`,
          '他如果已經點開舊的那條，會看到「這個連結找不到」',
          '重發是客戶填錯之後唯一的改法 —— 表單填過一次就不能再填',
        ],
        confirmLabel: '重發',
      });
      if (!ok) return;

      await toast.withSaveState(
        async () => {
          for (const invite of old) await invitesData.revoke(invite.id, '重發新連結');
          await invitesData.create({ customerId, customerName: nameOf(customerId), month, sentAt: today });
        },
        { pending: '重發中…', success: '新的連結好了', undoable: false },
      );
      askTab = 'sent';
      renderAsk(el, { focus: customerId });
    }));
}

// ---------- 跟客人確認時間 ----------
//
// 這一列有三條路，不是兩條：打勾確認、逐段標「客人說不行」，
// 以及**寫一句「禮拜一再問問」**。第三條是她 2026-08-20 講的 ——
// 「問了但還沒回」寫不進去的話，下次打開那一列長得跟從來沒問過的一模一樣。
//
// 那一句存在來訪上（`followupNote` / `followupAt`），不是任務也不是備註：
// 任務要有死線（而「再問問」沒有死線），備註跟著人一輩子（而這一句下禮拜一就過期）。
// 命名對齊 `customers/{id}/availability` 上那一個，小寫的 followup。
// 見 .scratch/visit-lifecycle/issues/01-confirm-row-cannot-carry-a-note.md

async function renderConfirm(el) {
  const [pending, settings] = await Promise.all([
    visitsData.listByStatus('pending_confirm'),
    config.getSettings(),
  ]);
  const today = todayISO();
  paintConfirm({ el, pending: visitsToConfirm(pending, today), settings, today });
}

function paintConfirm(ctx) {
  const { el, pending, settings, today } = ctx;
  const groups = [...byCustomer(pending).entries()];
  const noReplyDays = settings.noReplyDays ?? 3;

  el.innerHTML = `
    ${backLink()}
    <div class="page">
      <h1 class="page__title">跟客人確認時間</h1>
      <p class="page__lead">壓好了、還沒問過本人的有 ${groups.length} 位。問完回來按打勾。</p>
    </div>

    ${groups.length ? `
      <div class="stack">
        ${groups.map(([id, visits]) => confirmCard(id, visits, today, noReplyDays)).join('')}
      </div>`
      : '<p class="muted">都問過了。</p>'}

    ${drawer ? drawerHtml(ctx) : ''}`;

  wireConfirm(ctx);
}

function confirmCard(customerId, visits, today, noReplyDays) {
  const name = visits[0].customerName ?? '（沒有名字）';
  const state = waitState(visits, today, noReplyDays);
  const slots = visits.flatMap((v) => v.slots ?? []);

  return `
    <div class="card ${state.asked ? 'card--asked' : ''}" style="margin: 0">
      <div class="row" style="align-items: flex-start">
        <div class="row__main">
          <div class="row__title">${esc(name)}</div>
          <div class="muted num">壓了 ${slots.length} 段・${esc(state.label)}</div>
        </div>
        <button class="fab__main" type="button" data-open="${esc(customerId)}"
                style="width: 46px; height: 46px" aria-label="${esc(name)}・確認">
          ${icon('check', { size: 22, width: 2.6 })}
        </button>
      </div>

      <div class="chips" style="margin-top: var(--space-3)">
        ${visits.map((v) => `<span class="badge num">${esc(shortDate(v.date))}</span>`).join('')}
      </div>

      ${followupForm(customerId, name, state.note)}

      ${message.box({
        id: customerId,
        text: confirmMessage({ name }, visits),
        collapsed: true,
        buttonLabel: '複製 LINE 確認訊息',
      })}
    </div>`;
}

/**
 * 「問過了，在等」那一句。直接是一個輸入框，不是一顆「加備註」按鈕 ——
 * 她人在 LINE 裡，多一次點擊就會變成「算了等一下再記」，然後就忘了
 * （同 notesCard() 的理由）。
 *
 * 寫完那一列看得出問過了：卡片換一個底、天數改成從問的那天算。
 * **但它還在清單上** —— 事情還沒完，移走就等於忘記。
 */
function followupForm(customerId, name, note) {
  return `
    <form data-followup="${esc(customerId)}"
          style="display: flex; gap: var(--space-2); margin-top: var(--space-3)">
      <input type="text" name="text" maxlength="${NOTE_MAX}" value="${esc(note ?? '')}"
             style="flex: 1; min-width: 0" placeholder="問了還沒回？記一句…"
             aria-label="${esc(name)}・問過了要記的一句話" />
      <button class="btn" type="submit">${note ? '改' : '記'}</button>
    </form>`;
}

/**
 * 確認畫面。把這個人所有的時段攤開，逐筆可以標「客人說不行」。
 *
 * 不做整批一次確認 —— 客人常常是「這兩天可以、那天不行」，整批只能全對或全錯，
 * 等於逼她重壓。
 */
function drawerHtml(ctx) {
  const visits = byCustomer(ctx.pending).get(drawer.customerId) ?? [];
  const name = visits[0]?.customerName ?? '';
  const rows = visits.flatMap((v) =>
    (v.slots ?? []).map((s, i) => ({ visit: v, slot: s, key: `${v.id}:${i}` })),
  );
  const okCount = rows.filter((r) => !drawer.rejected.has(r.key)).length;
  const note = followupNoteOf(visits);

  return `
    <div class="drawer-backdrop" data-backdrop>
      <div class="drawer" role="dialog" aria-modal="true" aria-label="確認 ${esc(name)} 的時段">
        <button class="drawer__grip" type="button" data-close-drawer aria-label="關閉"></button>
        <div class="drawer__head">
          <h2 class="drawer__title">${esc(name)} 的 ${rows.length} 段</h2>
        </div>
        ${note
          // 這張面板蓋住了底下那張卡，她自己寫的那一句要跟著進來，
          // 否則「上次問到哪」在最需要它的那一刻反而看不到。
          ? `<p class="card__asked" style="margin-top: 0">上次問過：${esc(note)}</p>`
          : ''}
        <p class="drawer__note">確認之後會自動排進日曆，並且產生該做的登記。</p>

        <div class="drawer__body">
        ${rows.map((r) => {
          const no = drawer.rejected.has(r.key);
          return `
            <button class="slotrow ${no ? 'slotrow--no' : ''}" type="button" data-slot="${esc(r.key)}">
              <span class="slotrow__main">
                <span class="slotrow__when">${esc(shortDate(r.visit.date))} ${esc(timeLabel(r.slot))}</span>
                <span class="slotrow__what">${esc(r.slot.courseName ?? '')}</span>
                ${r.visit.note ? `<span class="muted dim">備註：${esc(r.visit.note)}</span>` : ''}
              </span>
              <span class="badge ${no ? 'badge--overdue' : 'badge--ok'}">${no ? '客人說不行' : '可以'}</span>
            </button>`;
        }).join('')}

        <p class="card__note" style="margin-top: var(--space-3)">
          哪一段客人說不行就點它一下，其餘的照樣成立。</p>
        </div>

        <div class="drawer__actions">
          <button class="btn btn--primary" type="button" data-apply>
            ${okCount ? `確認 ${okCount} 段，加進日曆` : '全部退回未確認'}</button>
          <button class="btn" type="button" data-close-drawer>先不要，回去</button>
        </div>
      </div>
    </div>`;
}

function wireConfirm(ctx) {
  const { el } = ctx;

  message.wire(el, toast.info);

  el.querySelectorAll('[data-open]').forEach((btn) =>
    btn.addEventListener('click', () => {
      drawer = { customerId: btn.dataset.open, rejected: new Set() };
      paintConfirm(ctx);
    }),
  );

  el.querySelectorAll('[data-slot]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const key = btn.dataset.slot;
      if (drawer.rejected.has(key)) drawer.rejected.delete(key);
      else drawer.rejected.add(key);
      paintConfirm(ctx);
    }),
  );

  const close = () => {
    drawer = null;
    paintConfirm(ctx);
  };
  el.querySelectorAll('[data-close-drawer]').forEach((b) => b.addEventListener('click', close));
  el.querySelector('[data-backdrop]')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) close();
  });

  // 這一張是自己畫的（它要跟著整頁重畫），沒走 openSheet，
  // 但手勢要跟全站一樣 —— 只有一張拖不動的話，她會以為那張壞了。
  const box = el.querySelector('.drawer');
  if (box) wireDrag(box, close, { backdrop: el.querySelector('[data-backdrop]') }).playIn();

  el.querySelectorAll('[data-followup]').forEach((form) =>
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      saveFollowupNote(ctx, form.dataset.followup, form.querySelector('[name=text]').value);
    }),
  );

  el.querySelector('[data-apply]')?.addEventListener('click', () => applyConfirm(ctx));
}

/**
 * 記下（或收掉）「問過了，在等」那一句。
 *
 * 這位客戶所有還在等的來訪各自帶一份同樣的字，一個 commit 寫完 ——
 * 分開寫的話復原只退得回其中一筆（見 data/visits.js 的 setFollowupNote）。
 */
async function saveFollowupNote(ctx, customerId, text) {
  const visits = byCustomer(ctx.pending).get(customerId) ?? [];
  if (!visits.length) return;

  const trimmed = String(text ?? '').trim();
  if (trimmed === (followupNoteOf(visits) ?? '')) return; // 沒改就不要白寫一筆稽核

  try {
    await toast.withSaveState(
      () => visitsData.setFollowupNote(visits.map((v) => v.id), trimmed),
      { success: trimmed ? '記下了，這一列還留著' : '收掉了' },
    );
    await renderConfirm(ctx.el);
  } catch {
    /* 已處理 */
  }
}

/**
 * 套用確認結果。
 *
 * 一位客戶可能有好幾天的來訪，每一天各自是一筆 visit：
 *
 * - 一整天都被退掉 → 那一筆轉 cancelled，**時段留著不刪** ——
 *   當初壓了什麼是要留下來的紀錄，而且 Rules 也不收沒有時段的來訪。
 * - 只退掉其中幾段 → 把那幾段移出來訪，其餘轉 confirmed。
 *   任務會跟著收（見 domain/taskRules.js 的規則矩陣）。
 * - 一段都沒退 → 整筆轉 confirmed。
 */
async function applyConfirm(ctx) {
  const visits = byCustomer(ctx.pending).get(drawer.customerId) ?? [];
  const rejected = drawer.rejected;
  const at = new Date().toISOString();

  const customerVisits = await visitsData.listByCustomer(drawer.customerId);

  const writes = visits.map((v) => {
    const keep = (v.slots ?? []).filter((_, i) => !rejected.has(`${v.id}:${i}`));

    // 「禮拜一再問問」是「還在等回覆」那一段的東西。這一筆走出去了就收掉，
    // 留著只會在別的畫面變成一句過期的話。改動留在稽核紀錄裡，沒有真的消失。
    if (!keep.length) {
      return {
        ...v,
        status: 'cancelled',
        cancelledAt: at,
        statusAt: at,
        cancelReason: '客人說這個時間不行',
        released: true,
        followupNote: null,
        followupAt: null,
      };
    }
    return {
      ...v,
      slots: keep,
      status: 'confirmed',
      confirmedAt: at,
      statusAt: at,
      followupNote: null,
      followupAt: null,
    };
  });

  try {
    await toast.withSaveState(
      async () => {
        // 一筆一筆存：每一筆各自要重算次數與任務，硬塞進同一個 commit
        // 會超過 Firestore 一批 500 個操作的上限
        for (const v of writes) await visitsData.save(v, customerVisits);
      },
      {
        success: writes.some((v) => v.status === 'cancelled')
          ? '記好了，客人說不行的那幾段已經退掉'
          : '確認了，已排進日曆',
        // 跨多個 commit 的動作給不出正確的復原（見 data/repo.js 的 withUndo）
        undoable: false,
      },
    );
    drawer = null;
    await renderConfirm(ctx.el);
  } catch {
    /* 已處理 */
  }
}

// ---------- 簽療程單（收尾） ----------
//
// 這一頁是 SPEC 第 4.2 節那句「次數在已完成才扣」的入口。
// 在這之前它藏在來訪編輯器的狀態卡裡，走動時拿手機要點四層 ——
// 而這是每天都要做好幾次的動作，漏掉的後果是剩餘次數整個不準。
//
// 不是任務，是從來訪推導的（`domain/visits.js` 的 `visitsToClose()`）：
// 療程單就是「這一次算不算數」的憑據，而那個答案就在來訪的狀態上。

async function renderClose(el) {
  const today = todayISO();
  // 課程主檔是為了「這一段要不要簽療程單」。二返不用簽，其餘都要 ——
  // 判斷在 domain/visits.js 的 needsForm()，這一頁不自己認課程名字。
  const [unclosed, courses] = await Promise.all([
    visitsData.listUnclosed(today),
    // 含已刪除的：她停用一個課程，那幾筆還沒結案的來訪照樣要問得出「要不要簽單」
    config.listAll('courses', { includeDeleted: true }),
  ]);
  paintClose({
    el,
    rows: visitsToClose(unclosed, today),
    coursesById: Object.fromEntries(courses.map((c) => [c.id, c])),
    today,
  });
}

function paintClose(ctx) {
  const { el, rows, coursesById, today } = ctx;

  el.innerHTML = `
    ${backLink()}
    <div class="page">
      <h1 class="page__title">簽療程單</h1>
      <p class="page__lead">${rows.length
        ? `有 ${rows.length} 筆還沒結案。客人來了、療程單簽了就打勾 —— 次數是這時候才扣的。`
        : '都結案了。'}</p>
    </div>

    ${rows.length
      ? `<div class="stack">${rows.map((v) => closeCard(v, coursesById, today)).join('')}</div>`
      : ''}

    ${drawer ? closeDrawerHtml(ctx) : ''}`;

  wireClose(ctx);
}

/**
 * 這一筆來訪裡，哪幾段要標「不用簽療程單」（目前只有二返）。
 *
 * **反過來標的理由**：一整天四段裡通常四段都要簽，四顆標記等於沒有標記；
 * 真正要她看到的是「這一段是例外」。
 *
 * **整筆都不用簽時回空的** —— 那時候底下那一句已經講完了（「不用簽療程單 ——
 * 來了就打勾」），逐段再標一次是同一件事講兩遍。卡片與收尾抽屜共用這一支，
 * 兩邊各寫一次的話遲早有一邊忘了那個例外。
 */
function formMarks(visit, coursesById) {
  const slots = visit.slots ?? [];
  const need = new Set(formSlotIndexes(visit, coursesById));
  const skip = slots.map((_, i) => i).filter((i) => !need.has(i));
  return {
    /** 要標「不用簽」的那幾段 */
    mark: new Set(skip.length === slots.length ? [] : skip),
    /** 整筆都不用簽 */
    none: skip.length === slots.length,
    /** 要簽的有幾段 */
    count: slots.length - skip.length,
  };
}

function closeCard(visit, coursesById, today) {
  const late = daysBetween(visit.date, today);
  const slots = visit.slots ?? [];
  // **標的是不用簽的那幾段，不是要簽的。** 一整天通常四段都要簽，四顆標記
  // 等於沒有標記；真正要她看到的是「這一段是例外」。整筆都不用簽時
  // 底下那一句已經講完了，逐段就不再標一次。
  const form = formMarks(visit, coursesById);

  return `
    <div class="card" style="margin: 0">
      <div class="row" style="align-items: flex-start">
        <div class="row__main">
          <div class="row__title">${esc(visit.customerName ?? '（沒有名字）')}</div>
          <div class="muted num">${esc(shortDate(visit.date))}・${slots.length} 段${
            late > 0 ? `・過了 ${late} 天` : ''}</div>
        </div>
        <button class="fab__main" type="button" data-open="${esc(visit.id)}"
                style="width: 46px; height: 46px"
                aria-label="${esc(visit.customerName ?? '')}・結案">
          ${icon('check', { size: 22, width: 2.6 })}
        </button>
      </div>

      <div class="chips" style="margin-top: var(--space-3)">
        ${slots.map((sl, i) => `<span class="badge num">${esc(timeLabel(sl))}　${
          esc(sl.courseName ?? '')}${
          form.mark.has(i) ? '<span class="badge__aside">不用簽</span>' : ''}</span>`).join('')}
      </div>

      <p class="card__note" style="margin-top: var(--space-2)">${form.none
        ? '不用簽療程單 —— 來了就打勾'
        : `請客人簽療程單（${form.count} 段）`}</p>

      ${visit.status === 'pending_confirm' ? `
        <p class="card__note" style="margin-top: var(--space-3)">
          這一筆到現在還是「${esc(describeStatus(visit.status))}」—— 那天過了，
          要嘛她來了要嘛沒來，兩種都在下面結掉。</p>` : ''}
    </div>`;
}

/**
 * 收尾畫面。把那一天的時段攤開，逐段勾「這段做了沒」。
 *
 * 預設全部打勾 —— 十次有九次是整天照排的做完了。
 * 客人做了兩段就走的情況會發生（2026-08-20 使用者確認），那時取消勾選那一段，
 * 它就不扣次數（`domain/entitlements.js` 的 `slotOutcome()`）。
 */
function closeDrawerHtml(ctx) {
  const visit = ctx.rows.find((v) => v.id === drawer.visitId);
  if (!visit) return '';

  const slots = visit.slots ?? [];
  const doneCount = slots.filter((_, i) => !drawer.missed.has(i)).length;
  const form = formMarks(visit, ctx.coursesById);

  return `
    <div class="drawer-backdrop" data-backdrop>
      <div class="drawer" role="dialog" aria-modal="true"
           aria-label="替 ${esc(visit.customerName ?? '')} 結案">
        <button class="drawer__grip" type="button" data-close-drawer aria-label="關閉"></button>
        <div class="drawer__head">
          <h2 class="drawer__title">${esc(visit.customerName ?? '')}・${esc(shortDate(visit.date))}</h2>
        </div>
        <p class="drawer__note">哪一段沒做就點它一下。次數只扣打勾的那幾段。</p>

        <div class="drawer__body">
          ${slots.map((sl, i) => {
            const missed = drawer.missed.has(i);
            return `
              <button class="slotrow ${missed ? 'slotrow--no' : ''}" type="button" data-slot="${i}">
                <span class="slotrow__main">
                  <span class="slotrow__when">${esc(timeLabel(sl))}</span>
                  <span class="slotrow__what">${esc(sl.courseName ?? '')}${
                    form.mark.has(i) ? '<span class="slotrow__form">不用簽療程單</span>' : ''}</span>
                </span>
                <span class="badge ${missed ? 'badge--overdue' : 'badge--ok'}">${
                  missed ? '沒做' : '做了'}</span>
              </button>`;
          }).join('')}

          ${visit.note ? `<p class="card__note" style="margin-top: var(--space-3)">
            壓表時記的：${esc(visit.note)}</p>` : ''}
        </div>

        <div class="drawer__actions">
          <button class="btn btn--primary" type="button" data-apply>
            ${doneCount ? `這 ${doneCount} 段做了，結案` : '一段都沒做 → 記成未到'}</button>
          <button class="btn" type="button" data-close-drawer>先不要，回去</button>
        </div>
      </div>
    </div>`;
}

function wireClose(ctx) {
  const { el } = ctx;

  el.querySelectorAll('[data-open]').forEach((btn) =>
    btn.addEventListener('click', () => {
      drawer = { visitId: btn.dataset.open, missed: new Set() };
      paintClose(ctx);
    }),
  );

  el.querySelectorAll('[data-slot]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.slot);
      if (drawer.missed.has(i)) drawer.missed.delete(i);
      else drawer.missed.add(i);
      paintClose(ctx);
    }),
  );

  const close = () => {
    drawer = null;
    paintClose(ctx);
  };
  el.querySelectorAll('[data-close-drawer]').forEach((b) => b.addEventListener('click', close));
  el.querySelector('[data-backdrop]')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) close();
  });

  // 手勢跟全站一樣 —— 只有一張拖不動的話，她會以為那張壞了
  const box = el.querySelector('.drawer');
  if (box) wireDrag(box, close, { backdrop: el.querySelector('[data-backdrop]') }).playIn();

  el.querySelector('[data-apply]')?.addEventListener('click', () => applyClose(ctx));
}

/**
 * 結案。一次只動一筆來訪，所以是單一個 commit —— 復原退得回去。
 *
 * 規則本身在 `domain/visits.js` 的 `closeVisit()`，這裡只負責把畫面上的
 * 勾選狀態翻成逐段的布林。來訪編輯器的狀態按鈕走同一支。
 */
async function applyClose(ctx) {
  const visit = ctx.rows.find((v) => v.id === drawer.visitId);
  if (!visit) return;

  const attended = (visit.slots ?? []).map((_, i) => !drawer.missed.has(i));
  const next = closeVisit(visit, attended);
  const customerVisits = await visitsData.listByCustomer(visit.customerId);

  try {
    await toast.withSaveState(() => visitsData.save(next, customerVisits), {
      success: next.status === 'done'
        ? `${visit.customerName ?? ''} 結案了，次數扣掉了`
        : `記成未到，次數沒有扣`,
    });
    drawer = null;
    await renderClose(ctx.el);
  } catch {
    /* 已處理 */
  }
}

// ---------- 壓表登記那一頁 ----------

/**
 * 這個月還有誰沒壓表，分兩區：健檢直接去 Examine、其餘去 Abovee（ADR-0041）。
 *
 * **這一頁不排序也不計分**（ADR-0028 的同一個理由）：「先壓誰」是壓表那一頁的事，
 * 這裡只回答「還有誰」。所以底下一顆按鈕直接跳過去。
 */
async function renderBook(el) {
  const today = todayISO();
  const [rows, equipment] = await Promise.all([
    loadBookRows(today),
    config.listAll('equipment'),
  ]);

  // 哪幾個永久限制是會擋掉器材的。那幾個要紅、要跟著名字（SPEC 第 4.3 節）。
  // 算一次就好 —— 二十幾張卡各算一次是白費的。
  const terms = contraindicationTerms(equipment);

  const section = (system, title, note) => {
    const mine = rows.filter((r) => r.systems.some((x) => x.system === system));
    if (!mine.length) return '';
    return `
      <section class="card">
        <h2 class="card__title">${esc(title)}<span class="muted"> ${mine.length}</span></h2>
        <p class="card__note">${esc(note)}</p>
        <div class="groups" style="margin-top: var(--space-3)">
          ${mine.map((r) => bookRow(r, system, terms)).join('')}
        </div>
      </section>`;
  };

  el.innerHTML = `
    ${backLink()}
    <div class="page">
      <h1 class="page__title">${esc(monthLabel(today))}壓表登記</h1>
      <p class="page__lead">${rows.length
        ? `還有 ${rows.length} 位沒排。壓好了回來按「這位壓完了」，他就會出現在「跟客人確認時間」。`
        : '這個月每一位都排過了。'}</p>
    </div>

    <div class="stack">
      ${section('Examine', '直接去 Examine', '健檢不佔 Abovee 的格子，直接在 Examine 上登記。')}
      ${section('Abovee', '去 Abovee', '在 Abovee 上把時段佔住。壓完回 app 記錄。')}
    </div>

    ${rows.length ? `
      <div class="form__actions" style="margin-top: var(--space-4)">
        <a class="btn btn--primary" href="#/schedule">開始壓${esc(monthLabel(today))}的表</a>
      </div>` : ''}`;
}

function bookRow(row, system, terms) {
  const pools = row.systems.find((x) => x.system === system)?.pools ?? [];

  return `
    <a class="grouprow" href="#/customers/${esc(row.customerId)}">
      <span class="grouprow__main">
        <span class="grouprow__label" style="display: block">${esc(row.customerName ?? '（沒有名字）')}</span>
        ${flagsUi.blockChips({ flags: row.flags ?? [], terms })}
        <span class="poolchips" style="margin-top: var(--space-1)">
          ${pools.map((p) => `<span class="poolchip ${p.remaining <= 2 ? 'poolchip--low' : ''}">${
            esc(p.label)}<b class="num">${p.remaining}</b></span>`).join('')}
        </span>
      </span>
      ${icon('right', { size: 18 })}
    </a>`;
}

// ---------- 隨手記那一頁 ----------

async function renderNotes(el) {
  const [notes, customers] = await Promise.all([
    notesData.listOpen(),
    customersData.list(),
  ]);
  paintNotes({ el, notes, customers });
}

function paintNotes(ctx) {
  const { el, notes, customers } = ctx;
  const groups = groupByCustomer(notes);

  el.innerHTML = `
    ${backLink()}
    <div class="page">
      <h1 class="page__title">隨手記</h1>
      <p class="page__lead">客人臨時說的小要求。沒有死線，所以它不是任務。</p>
    </div>

    <section class="card">
      <form data-newnote>
        <label class="field">
          <span class="field__label">記什麼</span>
          <input type="text" name="text" maxlength="${NOTE_TEXT_MAX}" placeholder="例：指定 LuLu，不要排騰崴" />
        </label>
        ${f.select({
          name: 'customerId', label: '關於誰　可以不填', value: '',
          options: [{ value: '', label: '（沒掛客戶）' },
            ...customers.map((c) => ({ value: c.id, label: c.name }))],
        })}
        <span class="field__label">哪一天　可以不填</span>
        ${note.field()}
        <p class="field__hint">掛了日期就會出現在日曆上。它不是死線 ——
          隨手記沒有死線，過了也不會變紅。</p>
        <button class="btn btn--primary btn--wide" type="submit"
                style="margin-top: var(--space-3)">記一筆</button>
      </form>
    </section>

    ${groups.map((g) => `
      <section class="card">
        <h2 class="card__title">${esc(g.customerName)}
          <span class="muted"> ${g.notes.length}</span></h2>
        <div class="groups">${g.notes.map((n) => note.row(n, { customer: false })).join('')}</div>
      </section>`).join('')
      || '<p class="muted">還沒記過。</p>'}`;

  el.querySelectorAll('[data-note]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const note = notes.find((n) => n.id === btn.dataset.note);
      if (!note) return;
      try {
        await toast.withSaveState(() => notesData.setDone(note.id, !note.done), {
          success: note.done ? '拿回來了' : '勾掉了',
        });
        await renderNotes(el);
      } catch {
        /* 已處理 */
      }
    }),
  );

  note.wire(el);

  el.querySelector('[data-newnote]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = f.readForm(e.target);
    if (!String(v.text ?? '').trim()) return;
    const customer = customers.find((c) => c.id === v.customerId) ?? null;
    try {
      await toast.withSaveState(
        () => notesData.create({
          text: v.text,
          customerId: customer?.id ?? null,
          customerName: customer?.name ?? null,
          date: note.read(el),
        }),
        { success: '記下來了' },
      );
      await renderNotes(el);
    } catch {
      /* 已處理 */
    }
  });
}

// ---------- 小工具 ----------

/** @returns {Map<string, object[]>} 客戶 id → 他的來訪 */
function byCustomer(visits) {
  const out = new Map();
  for (const v of visits) {
    if (!out.has(v.customerId)) out.set(v.customerId, []);
    out.get(v.customerId).push(v);
  }
  for (const rows of out.values()) rows.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

// 「已等 N 天」「問過了」那一組判斷全部在 domain/confirmations.js ——
// 進度追蹤頁之後要問同一句話，這裡不留第二份。
