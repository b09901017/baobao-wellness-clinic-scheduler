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
  visitsToClose, visitsToConfirm, closeVisit, describeStatus, formSlotIndexes,
  visitCourseLabel, describeConfirmed, NOTE_MAX,
} from '../../domain/visits.js';
import { waitState, followupNoteOf } from '../../domain/confirmations.js';
import {
  sortNotes, openCount, groupByCustomer, sameOpenNote, MAX_LENGTH as NOTE_TEXT_MAX,
} from '../../domain/notes.js';
import { customersToAsk, customersToBook, monthRange } from '../../domain/scheduling.js';
import {
  groupByStage, nextStage, isRetired, RETIRED_KINDS, groupByDoneDay,
} from '../../domain/todoFlow.js';
import { contraindicationTerms } from '../../domain/contraindications.js';
import * as flagsUi from '../components/flags.js';
import { splitByInvite, formLink } from '../../domain/availabilityForm.js';
import {
  todayISO, shortDate, daysBetween, addMonths, monthLabel, weekdayLabel,
} from '../../domain/dates.js';
import { wireDrag, openSheet } from '../components/sheet.js';
import { confirmConsequences } from '../../domain/consequences.js';
import { isConfigured } from '../../data/sheetSync.js';
import { openCard } from '../components/card.js';
import { timeLabel } from '../../domain/visitTime.js';
import * as f from '../components/form.js';
import * as message from '../components/message.js';
import * as note from '../components/note.js';
import { icon } from '../icons.js';
import { confirmAction } from '../components/dialog.js';
import * as toast from '../toast.js';
import { go } from '../router.js';
import * as scheduleView from './schedule.js';
import { visitReadHtml } from './calendar.js';

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

  const nothing = !tasks.length && !waiting.size && !toClose.length;

  el.innerHTML = `
    <div class="page">
      <h1 class="page__title num">${esc(longDate(today))}</h1>
      ${nothing ? '<p class="page__lead">今天沒有待辦。</p>' : ''}
    </div>

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
  // **提醒不算「下一步」。** 她的下一步不會是一件永遠做不完的事 ——
  // 壓表那一段身上永遠有人，標成下一步等於那顆標記永遠停在同一個地方。
  groups
    .find((g) => g.querySelector('.grouprow:not(.grouprow--reminder)'))
    ?.classList.add('flowgroup--next');
}

/**
 * 抬頭就是日期。
 *
 * 這裡本來有一句「今天有 N 件，M 筆還沒簽單結案」，而那句話在說謊：
 * 那個 N 是 `tasksData.listOpen()` 的長度，也就是**身上所有還沒完成的任務**，
 * 不分死線。她問「為什麼上面寫 18 件、下面又寫今天 2 件」—— 兩個數字沒有
 * 矛盾，是那句話用錯了詞（2026-08-24）。
 *
 * 拿掉之後這一頁的順序是「今天幾號 → 三顆大數字（逾期／今天／明天）→ 分段清單」，
 * 而那三顆本來就準。全部歸零時才多一句「今天沒有待辦」—— 那是難得的好消息。
 */
function longDate(iso) {
  const [, m, d] = iso.split('-').map(Number);
  return `${m}月${d}日 星期${weekdayLabel(iso)}`;
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
 * **這一列是提醒，不是任務，所以不給數字。** ADR-0028 與 ADR-0041 早就寫了
 * 這件事（沒有死線也不計分），但畫面一直沒照著做 —— 它跟 Examine、耀聖
 * 那幾列用同一支 `groupRow()`、同一個大數字、同一個紅字位置。
 *
 * 她的原話：「其實應該沒有這個月一定要壓所有人的限制，只是可以提醒，
 * 因為我有很多客戶，所以一定會有沒壓到的，那這樣 todo 這邊顯示了好多數字，
 * 看了就會很煩，他不像其他 todo 是真的要做的。」
 *
 * 「其中 N 位是健檢」也一起拿掉：想知道有誰就點進去，那一頁本來就分兩區。
 */
function bookGroupRow(today) {
  if (!bookRows?.length) return '';

  return groupRow({
    href: '#/todo/book',
    label: '壓表登記',
    note: `${monthLabel(today)}還沒排到的人`,
    reminder: true,
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
 *
 * `reminder` 的那幾列**沒有數字**。這一頁上的東西分兩種：真的要做的
 * （漏一件就出事）與提醒（沒有死線、沒有完成的定義）。給第二種一個大數字，
 * 等於每天告訴她「你有九件事沒做」，而那九件永遠不會歸零 ——
 * 看久了的結果不是她去做，是她學會不看這一頁（她的原話：「看了就會很煩」）。
 */
function groupRow({ href, label, note, n, danger = false, faded = false, reminder = false }) {
  return `
    <a class="grouprow ${faded ? 'grouprow--faded' : ''} ${reminder ? 'grouprow--reminder' : ''}"
       href="${href}">
      <span class="grouprow__main">
        <span class="grouprow__label" ${danger ? 'style="color: var(--overdue)"' : ''}>${esc(label)}</span>
        ${note ? `<span class="grouprow__note">${esc(note)}</span>` : ''}
      </span>
      ${reminder ? '' : `
        <span class="grouprow__n" ${danger ? 'style="color: var(--overdue)"' : ''}>${n}</span>`}
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
        <div class="notemeta">
          ${note.field()}
          ${note.who()}
        </div>
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
      // 記了東西才重畫：底下那張卡與數字要跟著更新。什麼都沒記就不要重畫，
      // 那會白閃一下。`#/todo/notes` 傳自己的 render 進來（它也有這顆泡泡）。
      if (added.length) (ctx.render ?? render)(ctx.el);
    },
  });
}

function quickBody() {
  return `
    <input type="text" data-quicktext maxlength="${NOTE_TEXT_MAX}"
           placeholder="例：指定 LuLu，不要排騰崴" aria-label="記什麼"
           enterkeyhint="done" autocomplete="off" style="width: 100%" />

    <div class="notemeta">
      ${note.field()}
      ${note.who()}
    </div>

    <div data-just></div>`;
}

function wireQuick(drawer, ctx, added) {
  // 日期與「掛給誰」都走 `ui/components/note.js` —— 首頁那一格、這顆泡泡、
  // 客戶詳情用的是同一份欄位。長得不一樣會讓她以為是兩種東西
  // （`CLAUDE.md` 的連動表）。
  const when = note.wire(drawer);
  const whom = note.wireWho(drawer, { load: () => customersData.list() });

  const input = () => drawer.querySelector('[data-quicktext]');

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
          date: note.read(drawer),
          ...note.readWho(drawer),
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
    // 日期與掛的人一起清掉：三件事記在一起不代表都是同一天、同一位，
    // 而「忘了取消上一筆的日期」的後果是日曆上多一條她沒打算放的東西。
    input().value = '';
    when.set(null);
    whom.set(null);
    input().focus();
  };

  drawer.addEventListener('click', (e) => {
    if (e.target.closest('[data-save]')) save();
  });

  drawer.addEventListener('keydown', (e) => {
    // 輸入法組字中的 Enter 是「確定這個字」，不是「送出」
    if (!e.target.matches('[data-quicktext]')) return;
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    save();
  });
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
  note.wireWho(el, { load: () => customersData.list() });

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
      () => notesData.create({ text, date: note.read(form), ...note.readWho(form) }),
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
  taskVisits = null;

  if (group === 'confirm') return renderConfirm(el);
  if (group === 'close') return renderClose(el);
  if (group === 'notes') return renderNotes(el);
  if (group === 'ask') {
    askTab = 'todo';
    return renderAsk(el);
  }
  if (group === 'forms') return formInbox.render(el);
  if (group === 'book') return renderBook(el);

  const [open, done] = await Promise.all([tasksData.listOpen(), tasksData.listDone()]);
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

  // 「已完成」那一格用**同一個 match** —— 逾期／今天／明天那三種照死線切的分組，
  // 在已完成那一格也是照死線切的。她在那三頁問的是「這個死線的事情做完了沒」。
  const ctx = {
    el, group, today, meta,
    open: open.filter(match),
    done: done.filter(match),
  };
  paintTasks(ctx);
  loadTaskVisits(ctx);
}

/**
 * 每一列上那個「N 項」與「詳情」那顆按鈕要的來訪。
 *
 * 跟 `loadAsk()` / `loadBook()` 同一個作法：**頁面先畫出來，這一段等資料回來
 * 再補上去** —— 那一頁她一天開十幾次，不要為了一個數字讓整頁多等一輪。
 *
 * 任務身上沒有時段數，也不該有（那會是第二份會對不起來的資料）。
 */
async function loadTaskVisits(ctx) {
  const ids = [...ctx.open, ...ctx.done].map((t) => t.visitId).filter(Boolean);
  if (!ids.length) return;

  try {
    const [visits, rooms, staff] = await Promise.all([
      visitsData.getMany(ids),
      config.listAll('rooms'),
      config.listAll('staff'),
    ]);
    taskVisits = { visits, roomsById: byId(rooms), staffById: byId(staff) };
  } catch {
    // 讀不到就當這一段不存在：少一個數字，不是少一頁。
    return;
  }

  fillSlotCounts(ctx.el);
}

/**
 * 把「N 項」填進那幾顆徽章。
 *
 * **每次重畫都要再叫一次** —— `paintTasks()` 換分頁時把那幾列整個重畫，
 * 而重畫出來的徽章又是 hidden 的。讀回來的東西存在 `taskVisits` 裡不會掉，
 * 但畫面上的節點是新的。
 */
function fillSlotCounts(el) {
  if (!taskVisits) return;
  // 讀回來之前那顆徽章是 hidden 的 —— 空的丸子看起來像壞掉的東西。
  for (const node of el.querySelectorAll('[data-slots]')) {
    const visit = taskVisits.visits.get(node.dataset.slots);
    if (!visit) continue;
    node.textContent = `${(visit.slots ?? []).length} 項`;
    node.hidden = false;
  }
}

/**
 * 那一頁上那幾筆來訪。**存在模組裡而不是 ctx 裡**：`paintTasks()` 會重畫好幾次
 * （換分頁、勾一筆），而重畫不該把已經讀回來的東西丟掉。
 */
let taskVisits = null;

const byId = (rows) => Object.fromEntries((rows ?? []).map((r) => [r.id, r]));

/** 未完成／已完成。存在模組裡不進網址 —— 它是看法，不是位置（同隨手記那一頁）。 */
let taskTab = 'open';

function paintTasks(ctx) {
  const { el, today, meta } = ctx;
  const rows = taskTab === 'done' ? ctx.done : ctx.open;

  el.innerHTML = `
    ${backLink()}
    <div class="page">
      <h1 class="page__title">${esc(meta.title)}</h1>
      <p class="page__lead">${esc(meta.lead)}</p>
    </div>

    <div class="seg" role="group" style="margin-bottom: var(--space-4)">
      <button class="seg__item" type="button" aria-pressed="${taskTab === 'open'}"
              data-task-tab="open">未完成${ctx.open.length ? ` ${ctx.open.length}` : ''}</button>
      <button class="seg__item" type="button" aria-pressed="${taskTab === 'done'}"
              data-task-tab="done">已完成${ctx.done.length ? ` ${ctx.done.length}` : ''}</button>
    </div>

    ${taskTab === 'done' ? doneList(ctx) : openList(ctx, today)}`;

  el.querySelectorAll('[data-task-tab]').forEach((btn) =>
    btn.addEventListener('click', () => {
      taskTab = btn.dataset.taskTab;
      picked = new Set();
      paintTasks(ctx);
    }),
  );

  el.querySelectorAll('[data-task]').forEach((box) =>
    box.addEventListener('change', () => {
      if (box.checked) picked.add(box.dataset.task);
      else picked.delete(box.dataset.task);
      syncMarkButton(el);
    }),
  );

  el.querySelectorAll('[data-visit]').forEach((btn) =>
    btn.addEventListener('click', () => openTaskVisit(btn.dataset.visit)),
  );

  el.querySelectorAll('[data-untick]').forEach((btn) =>
    btn.addEventListener('click', () => untickTask(ctx, btn.dataset.untick)),
  );

  el.querySelectorAll('[data-drop]').forEach((btn) =>
    btn.addEventListener('click', () => dropTask(ctx, btn.dataset.drop)),
  );

  el.querySelector('[data-clear-done]')?.addEventListener('click', () => clearDoneTasks(ctx));

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
  fillSlotCounts(el);
}

function openList(ctx, today) {
  const { open, meta } = ctx;
  if (!open.length) return '<p class="muted">這裡是空的。</p>';

  return `
    ${meta.retired ? `
      <div class="form__actions" style="margin-bottom: var(--space-3)">
        <button class="btn" type="button" data-pick-all>全部勾起來（${open.length} 筆）</button>
      </div>` : ''}
    <div class="stack">${open.map((t) => taskRow(t, today)).join('')}</div>
    <div class="form__actions" style="margin-top: var(--space-4)">
      <button class="btn btn--primary btn--wide" type="button" data-mark disabled>
        把勾起來的標成完成</button>
    </div>`;
}

/**
 * 已完成那一格。**照完成那一天分段**，新的在前 —— 她的原話是
 * 「一樣是條列式往下不過會有今天(完成的) 幾月幾號等等，然後都可以清除」。
 *
 * 勾掉的不會消失（`.scratch/todo-declutter/issues/08` 那一條，隨手記早就這樣了），
 * 點一列拿得回來，垃圾桶只在這一格出現 —— 還沒做的要刪就先勾掉再刪，
 * 兩步比誤刪好。
 */
function doneList(ctx) {
  const groups = groupByDoneDay(ctx.done);
  if (!groups.length) return '<p class="muted">還沒有勾掉的。</p>';

  return `
    ${groups.map((g) => `
      <p class="donegroup">${g.day ? esc(doneDayLabel(g.day, ctx.today)) : '不知道什麼時候'}</p>
      <div class="notelist">${g.tasks.map(doneRow).join('')}</div>`).join('')}

    <p style="margin-top: var(--space-4)">
      <button class="btn btn--danger" type="button" data-clear-done>
        清掉這 ${ctx.done.length} 筆</button></p>`;
}

const doneDayLabel = (day, today) => (day === today ? '今天' : shortDate(day));

function doneRow(t) {
  return `
    <div class="noterow">
      <button class="note note--done" type="button" data-untick="${esc(t.id)}">
        <span class="note__box">${icon('check', { size: 13, width: 3.2 })}</span>
        <span class="note__main">
          <span class="note__text">${esc(t.customerName ?? '（沒有名字）')}・${esc(t.kind)}</span>
        </span>
        <span class="notetags">
          ${t.visitId ? `<span class="notetag" data-slots="${esc(t.visitId)}" hidden></span>` : ''}
        </span>
      </button>
      <button class="noterow__trash" type="button" data-drop="${esc(t.id)}"
              aria-label="刪掉這一筆">${icon('trash', { size: 15 })}</button>
    </div>`;
}

function backLink() {
  return `<a class="backlink" href="#/">${icon('left', { size: 19 })}待辦</a>`;
}

/**
 * 一列任務。**多一個「幾項」** —— 她的原話是「多一個幾項讓我知道今天要壓多少」，
 * 那個數字要等來訪讀回來才填得上（`loadTaskVisits()`）。
 *
 * 右邊那顆按鈕以前叫「來訪」而且直接 `go('/visits/:id')`，落在整頁的編輯器上。
 * `components/card.js` 的檔頭早就寫過相反的規矩：**一律先進讀取模式**。
 * 2026-08-25 再收一格：這一頁的卡片連鉛筆都沒有（ADR-0056）。
 */
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
            ${t.visitId ? `<span class="badge" data-slots="${esc(t.visitId)}" hidden></span>` : ''}
            <span class="badge ${badgeClass(state)}">${esc(dueLabel(t.dueDate, today))}</span>
          </span>
          ${t.note ? `<span class="muted">${esc(t.note)}</span>` : ''}
        </span>
      </label>
      ${t.visitId ? `<button class="btn" type="button" data-visit="${esc(t.visitId)}"
                             style="min-height: 40px">詳情</button>` : ''}
    </div>`;
}

/**
 * 點「詳情」浮出那一天的讀取卡片。**唯讀，沒有鉛筆。**
 *
 * 卡片與 `visitReadHtml()` 跟日曆、客戶詳情共用同一支 —— 同一筆來訪在三個
 * 畫面長一樣，才不會有「哪一個算數」的問題。
 *
 * 她在這一頁做的事是「去 Examine 掛號」，不是改班（她的原話：「不懂什麼情況
 * 點完詳情進去後會需要修改？」）。要改一筆來訪只有日曆一個入口，見 ADR-0056。
 */
function openTaskVisit(visitId) {
  const visit = taskVisits?.visits.get(visitId);
  if (!visit) {
    // 以前這裡是 `go('/visits/:id')`。那條路現在通到一個她不該落在的地方，
    // 而無聲什麼都不發生更糟 —— 講出來是哪一種情況。
    toast.info(taskVisits
      ? '找不到這一筆來訪，可能已經刪掉了'
      : '那一天的資料還在讀，等一下再按一次');
    return;
  }

  openCard({
    title: `${visit.customerName ?? ''}・${shortDate(visit.date)}`,
    subtitle: esc(describeStatus(visit.status)),
    body: visitReadHtml(visit, {
      roomsById: taskVisits.roomsById,
      staffById: taskVisits.staffById,
    }),
  });
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

/**
 * 勾完成。**先跳一個置中的確認**，把要標掉的那幾筆列出來 ——
 * 她的原話是「勾起來按下確認後可以跳出一個中間提示框，說移到已完成」。
 *
 * 那一句「不會消失」很重要：以前勾完那幾筆直接從清單上不見了，
 * 而她會勾錯（同 `.scratch/todo-declutter/issues/08` 對隨手記的判斷）。
 */
async function markDone(ctx) {
  const rows = ctx.open.filter((t) => picked.has(t.id));
  if (!rows.length) return;

  const ok = await confirmAction({
    title: `把 ${rows.length} 筆標成完成？`,
    consequences: [
      ...rows.slice(0, 8).map((t) => `${esc(t.customerName ?? '（沒有名字）')}・${esc(t.kind)}`),
      ...(rows.length > 8 ? [`⋯還有 ${rows.length - 8} 筆`] : []),
      '它們會移到「已完成」，不會消失',
      '勾錯了在那一格點回來就好',
    ],
    confirmLabel: '標成完成',
  });
  if (!ok) return;

  try {
    // 一批寫在同一個 commit 裡，所以復原是整批一起退回去
    await toast.withSaveState(() => tasksData.setDone(rows, true), {
      success: `${rows.length} 筆移到已完成`,
    });
    picked = new Set();
    await renderGroup(ctx.el, ctx.group);
  } catch {
    /* 已處理 */
  }
}

/** 勾錯了點回來。已完成那一格點一列就是這個。 */
async function untickTask(ctx, id) {
  const task = ctx.done.find((t) => t.id === id);
  if (!task) return;
  try {
    await toast.withSaveState(() => tasksData.setDone(task, false), { success: '拿回來了' });
    await renderGroup(ctx.el, ctx.group);
  } catch {
    /* 已處理 */
  }
}

/**
 * 刪掉一筆。**只有已完成的那幾列有這顆** —— 還沒做的要刪就先勾掉再刪，
 * 兩步比誤刪好（同隨手記那一頁）。走軟刪除，設定 → 已刪除項目 還原得回來。
 */
async function dropTask(ctx, id) {
  const task = ctx.done.find((t) => t.id === id);
  if (!task) return;
  try {
    await toast.withSaveState(() => tasksData.remove(id, '在待辦裡刪掉'), { success: '刪掉了' });
    await renderGroup(ctx.el, ctx.group);
  } catch {
    /* 已處理 */
  }
}

/**
 * 一次清掉這一頁全部已完成的。破壞性操作，走二次確認並講出筆數（SPEC 第 6.5 節）。
 *
 * 一筆一個 commit，中間失敗就停下來講清楚刪了幾筆 —— 已經刪掉的不退回去
 * （第 6.1 節，跟隨手記那一頁同一個作法）。
 */
async function clearDoneTasks(ctx) {
  const rows = ctx.done;
  if (!rows.length) return;

  const ok = await confirmAction({
    title: `清掉 ${rows.length} 筆已完成的待辦`,
    consequences: [
      `這 ${rows.length} 筆會從這一頁消失`,
      '刪除只是標記，設定 → 已刪除項目裡還原得回來',
      '做過的事本身沒有被改掉 —— 清掉的只是這一列',
    ],
    confirmLabel: '清掉',
    danger: true,
  });
  if (!ok) return;

  let n = 0;
  try {
    for (const row of rows) {
      // eslint-disable-next-line no-await-in-loop
      await tasksData.remove(row.id, '清掉已完成的待辦');
      n += 1;
    }
    toast.saved(`清掉了 ${n} 筆`);
  } catch (err) {
    toast.failed(`刪到第 ${n + 1} 筆時失敗了（已經刪掉 ${n} 筆）：${err.message}`);
  }
  await renderGroup(ctx.el, ctx.group);
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
  // 課程主檔是為了那張「已確認」卡片上那幾句「接著會發生什麼」
  //（`domain/consequences.js`）—— 哪幾張登記待辦會長出來、要不要簽療程單，
  // 兩件都看課程。含已刪除的：主檔把課程刪掉，不代表已經排出去的那幾筆
  // 就不用去掛號了（同 `data/visits.js` 的 taskOps）。
  const [pending, settings, courses] = await Promise.all([
    visitsData.listByStatus('pending_confirm'),
    config.getSettings(),
    config.listAll('courses', { includeDeleted: true }),
  ]);
  const today = todayISO();
  paintConfirm({
    el,
    pending: visitsToConfirm(pending, today),
    settings,
    today,
    coursesById: Object.fromEntries(courses.map((c) => [c.id, c])),
  });
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
        ${visits.map((v) => `
          <span class="badge"><span class="num">${esc(shortDate(v.date))}</span>&nbsp;${
            esc(visitCourseLabel(v))}</span>`).join('')}
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

  // 同一句話已經在隨手記上而且還沒勾掉就不再寫一筆（她改了字又改回來、
  // 或者連按兩下「記」，都不該長出第二筆）。讀失敗就當沒有 ——
  // 多一筆重複的隨手記，比因為讀不到而整個不記好。
  const remember = trimmed
    && !sameOpenNote(await openNotesFor(customerId), { customerId, text: trimmed });

  try {
    await toast.withSaveState(
      async () => {
        await visitsData.setFollowupNote(visits.map((v) => v.id), trimmed);
        if (remember) {
          await notesData.create({
            text: trimmed,
            customerId,
            customerName: visits[0].customerName ?? null,
            // 日期留空：那一句沒有死線，掛了日期它就會跑到日曆上（ADR-0044），
            // 而「禮拜一再問問」不是一件排在哪一天的事。
            date: null,
          });
        }
      },
      {
        success: trimmed
          ? (remember ? '記下了，也放進隨手記' : '記下了，這一列還留著')
          : '收掉了',
        // 兩個 commit 的動作給不出正確的復原（見 data/repo.js 的 withUndo）。
        // 只寫來訪那一個時照舊給得出來。
        undoable: !remember,
      },
    );
    await renderConfirm(ctx.el);
  } catch {
    /* 已處理 */
  }
}

/** 這位客戶身上還沒勾掉的隨手記。讀不到就當空的 —— 去重是體貼，不是正確性。 */
async function openNotesFor(customerId) {
  try {
    return await notesData.listByCustomer(customerId);
  } catch {
    return [];
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

  // 畫面上要講的話在寫入之前先算好 —— 存完之後 `visits` 已經不在待確認清單裡了。
  const summary = describeConfirmed(visits, rejected);
  const said = confirmConsequences(
    writes.filter((v) => v.status === 'confirmed'),
    ctx.coursesById ?? {},
    isConfigured(ctx.settings),
  );

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
    showConfirmed(summary, said);
  } catch {
    /* 已處理 */
  }
}

/**
 * 加進日曆之後那張置中的卡片。
 *
 * 右下角那條 toast 只說得出「已排進日曆」，而她剛剛才逐段點掉了其中幾段 ——
 * **這是這條動線唯一一次不可逆的寫入**（狀態轉 confirmed、登記任務長出來），
 * 所以最後成立的是哪幾段要攤開來看得見。她的原話是「簡潔的說，誰，幾月幾號
 * 幾點做什麼，加入日曆」。
 *
 * 走既有的 `openCard()`，不新開一種浮層 —— 這個 app 的浮層已經有三種了
 *（抽屜、卡片、對話框，ADR-0048）。
 */
function showConfirmed(summary, said = []) {
  if (!summary.rows.length) return; // 整批都退掉了，toast 那一句已經講完了

  const card = openCard({
    // **不是「加進日曆」** —— 那幾筆壓表的時候就已經在日曆上了，這一步改的是
    // 顏色不是有沒有。寫成「加進日曆」會讓她以為在這之前日曆上是空的。
    title: `${summary.name}・已確認`,
    subtitle: `${summary.rows.length} 段`,
    body: `
      <ul class="link-list">
        ${summary.rows.map((r) => `
          <li><span class="link-list__label num">${esc(shortDate(r.date))}
            ${esc(timeLabel(r.slot))}
            <span class="muted">${esc(r.slot.courseName ?? '')}</span></span></li>`).join('')}
      </ul>
      ${said.length ? `
        <ul class="dialog__list" style="margin: var(--space-3) 0 0">
          ${said.map((line) => `<li>${esc(line)}</li>`).join('')}
        </ul>` : ''}
      ${summary.rejected
        ? `<p class="muted" style="margin: var(--space-3) 0 0">
             退掉 ${summary.rejected} 段（客人說不行）。那幾段的時間已經還回去了。</p>`
        : ''}`,
    actions: '<button class="btn btn--primary btn--wide" type="button" data-ok>好</button>',
  });

  card.el.querySelector('[data-ok]')?.addEventListener('click', () => card.close());
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
      ? `<div class="stack">${rows.map((v) => closeRow(v, coursesById, today)).join('')}</div>`
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

function closeRow(visit, coursesById, today) {
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
        ? '身上還有次數、這個月還沒排到的人。點一位就去壓他的表。'
        : '這個月每一位都排過了。'}</p>
    </div>

    <div class="stack">
      ${section('Examine', '直接去 Examine', '健檢不佔 Abovee 的格子，直接在 Examine 上登記。')}
      ${section('Abovee', '去 Abovee', '在 Abovee 上把時段佔住。壓完回 app 記錄。')}
    </div>

    ${rows.length ? `
      <div class="form__actions" style="margin-top: var(--space-4)">
        <a class="btn btn--primary" href="#/schedule">去壓表</a>
      </div>` : ''}`;

  el.querySelectorAll('[data-book-who]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const row = rows.find((r) => r.customerId === btn.dataset.bookWho);
      askBookMonth(btn.dataset.bookWho, row?.customerName, today);
    }),
  );
}

/**
 * 一位客戶。**點下去是去壓他的表**，不是去看他的資料。
 *
 * 以前這一列連到客戶詳情，而她在那一頁要做的下一件事就是「去壓這個人的表」——
 * 而客戶詳情上沒有任何一條路通到壓表（她的原話：「跳到客戶資訊那邊很怪」）。
 */
function bookRow(row, system, terms) {
  const pools = row.systems.find((x) => x.system === system)?.pools ?? [];

  return `
    <button class="grouprow" type="button" data-book-who="${esc(row.customerId)}">
      <span class="grouprow__main">
        <span class="grouprow__label" style="display: block">${esc(row.customerName ?? '（沒有名字）')}</span>
        ${flagsUi.blockChips({ flags: row.flags ?? [], terms })}
        <span class="poolchips" style="margin-top: var(--space-1)">
          ${pools.map((p) => `<span class="poolchip ${p.remaining <= 2 ? 'poolchip--low' : ''}">${
            esc(p.label)}<b class="num">${p.remaining}</b></span>`).join('')}
        </span>
      </span>
      ${icon('right', { size: 18 })}
    </button>`;
}

/**
 * 點了一位之後先問月份，選完直接進壓表的卡片牆並停在那一位身上。
 *
 * 只有兩顆：她壓的永遠是這個月或下個月。不做月份選擇器 ——
 * 那是一個為了「以防萬一」而多出來的畫面。
 */
function askBookMonth(customerId, name, today) {
  const months = [today.slice(0, 7), addMonths(today, 1).slice(0, 7)];

  const sheet = openSheet({
    title: name ?? '要壓哪個月',
    note: '選完直接進壓表，停在這一位身上。',
    body: `
      <div class="chips" role="group" style="margin-top: var(--space-2)">
        ${months.map((m, i) => `
          <button class="chip" type="button" data-book-month="${esc(m)}">
            ${esc(monthLabel(m))}${i ? '（下個月）' : ''}</button>`).join('')}
      </div>`,
  });

  sheet.el.querySelectorAll('[data-book-month]').forEach((btn) =>
    btn.addEventListener('click', () => {
      scheduleView.openFor({ month: btn.dataset.bookMonth, customerId });
      // **不要自己 close()。** 換頁時 `sheet.js` 的 hashchange 會收掉它，
      // 而自己關會 `history.back()`（非同步）把緊接著的換頁退掉。
      go('/schedule');
    }),
  );
}

// ---------- 隨手記那一頁 ----------
//
// **這一頁是看的，不是記的**（2026-08-24）。記東西有兩個更快的入口
// （右下角泡泡、首頁那一格），而她點「全部」進來是為了看有哪些、勾掉、
// 或者清掉已經做完的。原本最上面那一整張新增表單她九成用不到。
//
// 右下角那顆泡泡留著，所以「在這一頁想記一筆」還是三秒做得到。

/** 未完成／已完成。存在模組裡不進網址 —— 它是看法，不是位置（同首頁的分頁）。 */
let notesTab = 'open';

async function renderNotes(el) {
  const notes = await notesData.listAll();
  paintNotes({ el, notes });
}

function paintNotes(ctx) {
  const { el, notes } = ctx;
  const live = sortNotes(notes);
  const open = live.filter((n) => !n.done);
  const done = live.filter((n) => n.done);
  const rows = notesTab === 'done' ? done : open;

  el.innerHTML = `
    ${backLink()}
    <div class="page">
      <h1 class="page__title">隨手記</h1>
    </div>

    <div class="seg" role="group" style="margin-bottom: var(--space-4)">
      <button class="seg__item" type="button" aria-pressed="${notesTab === 'open'}"
              data-notes-tab="open">未完成${open.length ? ` ${open.length}` : ''}</button>
      <button class="seg__item" type="button" aria-pressed="${notesTab === 'done'}"
              data-notes-tab="done">已完成${done.length ? ` ${done.length}` : ''}</button>
    </div>

    <div class="notelist">
      ${rows.map((n) => note.row(n, { trash: true })).join('')
        || `<p class="muted" style="padding: var(--space-3) 0">${
          notesTab === 'done' ? '還沒有勾掉的。' : '沒有未處理的。客人臨時說的小要求記在這裡。'}</p>`}
    </div>

    ${notesTab === 'done' && done.length ? `
      <p style="margin-top: var(--space-4)">
        <button class="btn btn--danger" type="button" data-clear-done>清掉這 ${done.length} 筆</button>
      </p>` : ''}

    ${quickFab()}`;

  el.querySelectorAll('[data-notes-tab]').forEach((btn) =>
    btn.addEventListener('click', () => {
      notesTab = btn.dataset.notesTab;
      paintNotes(ctx);
    }),
  );

  el.querySelectorAll('[data-note]').forEach((btn) =>
    btn.addEventListener('click', () => tickNote(el, notes, btn.dataset.note)),
  );

  el.querySelectorAll('[data-note-del]').forEach((btn) =>
    btn.addEventListener('click', () => removeNote(el, notes, btn.dataset.noteDel)),
  );

  el.querySelector('[data-clear-done]')?.addEventListener('click', () => clearDone(el, done));

  wireQuickCapture({ el, render: renderNotes });
}

/**
 * 勾掉／拿回來。**勾掉的不會消失**，它劃掉之後沉到「已完成」那一格
 * （`sortNotes()` 早就這樣排了，只是 data 層一直沒把它們撈回來）。
 */
async function tickNote(el, notes, id) {
  const n = notes.find((x) => x.id === id);
  if (!n) return;
  try {
    await toast.withSaveState(() => notesData.setDone(id, !n.done), {
      success: n.done ? '拿回來了' : '勾掉了',
    });
    await renderNotes(el);
  } catch {
    /* 已處理 */
  }
}

/**
 * 刪掉一筆。**只有勾掉的那幾筆才有這顆** —— 還沒做的要刪就先勾掉再刪，
 * 兩步比誤刪好。
 *
 * 走軟刪除（SPEC 第 6.1 節）：設定頁的「已刪除項目」還原得回來，
 * 而且 `withSaveState` 讓她當場復原得掉（第 6.3 節）。
 */
async function removeNote(el, notes, id) {
  const n = notes.find((x) => x.id === id);
  if (!n) return;
  try {
    await toast.withSaveState(() => notesData.remove(id, '在隨手記裡刪掉'), { success: '刪掉了' });
    await renderNotes(el);
  } catch {
    /* 已處理 */
  }
}

/**
 * 一次清掉全部已完成。破壞性操作，走二次確認並講出筆數（SPEC 第 6.5 節）。
 *
 * 一筆一個 commit，中間失敗就停下來講清楚刪了幾筆 —— 已經刪掉的不退回去
 * （第 6.1 節，跟批次建客戶同一個作法）。
 */
async function clearDone(el, done) {
  const ok = await confirmAction({
    title: `清掉 ${done.length} 筆已完成的隨手記`,
    consequences: [
      `這 ${done.length} 筆會從隨手記裡消失`,
      '刪除只是標記，設定 → 已刪除項目裡還原得回來',
    ],
    confirmLabel: '清掉',
    danger: true,
  });
  if (!ok) return;

  let n = 0;
  try {
    for (const row of done) {
      // 一筆一個 commit：中間失敗時前面那幾筆已經刪掉了，那是可以接受的，
      // 但要講清楚刪到哪裡。
      // eslint-disable-next-line no-await-in-loop
      await notesData.remove(row.id, '清掉已完成的隨手記');
      n += 1;
    }
    toast.saved(`清掉了 ${n} 筆`);
  } catch (err) {
    toast.failed(`刪到第 ${n + 1} 筆時失敗了（已經刪掉 ${n} 筆）：${err.message}`);
  }
  await renderNotes(el);
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
