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
  visitCourseLabel, describeConfirmed, applyConfirmation, statusForCard, NOTE_MAX,
  focusFor, slotStatus, slotsToClose, pendingSlotsOf, asPending,
} from '../../domain/visits.js';
import { waitState, followupNoteOf } from '../../domain/confirmations.js';
import {
  sortNotes, openCount, groupByCustomer, sameOpenNote, noteActions,
  MAX_LENGTH as NOTE_TEXT_MAX,
} from '../../domain/notes.js';
import {
  customersToAsk, customersToAskForMonth, customersToBook, monthRange,
} from '../../domain/scheduling.js';
import {
  groupByStage, nextStage, isRetired, RETIRED_KINDS, groupByDoneDay, taskLine, taskSlots,
} from '../../domain/todoFlow.js';
import { clinicalTerms } from '../../domain/masterData.js';
import { slotName } from '../../domain/naming.js';
import * as playbooksData from '../../data/playbooks.js';
import { hintForVisits } from '../components/playbookHint.js';
import * as flagsUi from '../components/flags.js';
import { splitByMonth, formLink } from '../../domain/availabilityForm.js';
import {
  todayISO, shortDate, daysBetween, addDays, addMonths, monthLabel, weekdayLabel,
} from '../../domain/dates.js';
import { wireDrag, openSheet } from '../components/sheet.js';
import { confirmConsequences, closeConsequences, cancelConsequences } from '../../domain/consequences.js';
import {
  FOLLOWUP_TASK_KIND, REPORT_TASK_KIND, bookingStateForTask, pairsOf,
} from '../../domain/followups.js';
import * as sheetSync from '../../data/sheetSync.js';
import { isConfigured } from '../../data/sheetSync.js';
import * as auditData from '../../data/audit.js';
import {
  reviewOf, visitIdsIn, dayTitle, NOBODY, NOTHING as REVIEW_NOTHING,
} from '../../domain/dayReview.js';
import { describeSync } from '../../domain/sheetReport.js';
import { openCard } from '../components/card.js';
import { timeLabel } from '../../domain/visitTime.js';
import * as f from '../components/form.js';
import * as slotNote from '../components/slotNote.js';
import * as message from '../components/message.js';
import * as note from '../components/note.js';
import { taskRow as sharedTaskRow, wayRow, confirmUntick } from '../components/tasklist.js';
import { openActions, wireLongPress } from '../components/actions.js';
import { monthNav, steppedMonth } from '../components/monthnav.js';
import { givableBags } from '../../domain/products.js';
import { icon } from '../icons.js';
import { tip } from '../components/tip.js';
import { confirmAction } from '../components/dialog.js';
import * as toast from '../toast.js';
import { saveEach } from '../saveEach.js';
import { go } from '../router.js';
import * as scheduleView from './schedule.js';
import { visitReadHtml, wireReadSlots } from './calendar.js';
import { fillMirror } from '../components/taskMirror.js';

const esc = f.esc;

// 勾選的任務只活在這一次畫面裡。重畫（勾完送出、復原）就清空。
let picked = new Set();

// 總覽 / 依客戶。切換不進網址 —— 它是看法，不是位置。
let tab = 'all';

// 確認畫面。開著的是哪一位、哪幾段被客人退掉。
//
// **`shown` 記的是「進場動畫播過了沒」。** 這一頁的兩張抽屜都是自己畫的
// （它們要跟著整頁重畫），而 `paintClose()` / `paintConfirm()` 在抽屜開著的
// 時候還會跑好幾次 —— 補那句「會多一張追蹤健檢報告」、逐段勾選、逐筆退回。
// 每一次都重播 `playIn()` 的話，症狀就是抽屜在她眼前一直往上跳
// （`.scratch/quick-actions-and-supplements/issues/01`）。
let drawer = null;

// 「問這輪的時間」那一列。null = 還沒載完（見 loadAsk）。
let askRows = null;

// 「客戶填好的時間」那一列。null = 還沒載完，跟 askRows 同一個道理。
let inboxRows = null;

// 「壓表登記」那一列。null = 還沒載完，跟 askRows 同一個道理。
let bookRows = null;

// 「問這輪的時間」那一頁的分段切換：還沒發連結 / 已經發出。
// 存在模組裡而不是網址裡 —— 它是看法，不是位置（同首頁的「總覽／依客戶」）。
let askTab = 'todo';

// 那一頁現在在看哪個月。`null` = 還沒進去過，進去時填成**下個月**。
//
// 同樣不進網址：它是看法不是位置。但它跟 `askTab` 有一個差別 ——
// **換月份要重新讀資料**（那一頁三份資料都是照月份挑的），而換分段不用。
let askMonth = null;

// ---------- 總覽 ----------

export async function render(el) {
  el.innerHTML = '<p class="muted">載入中…</p>';
  picked = new Set();
  drawer = null;
  askRows = null;
  inboxRows = null;
  bookRows = null;
  // **回到這一頁一律是收起來的。** `reviewOpen` 撐得過 `paint()`（在抽屜裡
  // 勾一筆會重畫底下這一頁），但撐不過重新進來 —— 那一塊「展開才載入」的
  // 理由就是她一天開這一頁十幾次，而看回顧是收工前一次的事（ADR-0062）。
  reviewOpen = false;
  reviewDay = null;
  reviewHidden = false;
  // **來訪的快取跟著清掉**（名字的不用）。她一天改好幾次日期，而一筆改過的
  // 來訪印出舊日期是這一塊最不該犯的錯 —— 名字幾乎不會變，日期是這個
  // app 的主業。重讀的代價接近零：這一塊展開才載入，而展開是收工前一次的事。
  reviewVisits = new Map();

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
 */
async function loadAsk(ctx) {
  try {
    const [customers, entitlementsBy, availabilityBy] = await Promise.all([
      customersData.list(),
      customersData.entitlementsByCustomer(),
      customersData.availabilityByCustomer(),
    ]);
    askRows = customersToAsk({ customers, entitlementsBy, availabilityBy, today: ctx.today });
    // **連結不必在這裡讀了**（2026-09-04）：那一列只剩標題與數字，而數字
    // 本來就不減掉已經發出的那幾位（ADR-0033）。「其中 N 位在等他填」搬到
    // 點進去那一頁的「已經發出」那一區 —— 那一區本來就要讀邀請。
    // 少一次 collection query，而首頁是她一天開十幾次的那一頁。
  } catch {
    // 讀不到就當這一列不存在。它是提醒，不是這一頁的主體 ——
    // 為了它把已經畫好的待辦換成一句錯誤訊息，代價比看不到這一列大。
    askRows = [];
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
      <div class="page__row">
        <h1 class="page__title num">${esc(longDate(today))}</h1>
        ${/* 備忘錄的入口。跟客戶頁的「看這個月的進度」同一顆、同一個位置 ——
             她指名要這個做法。導覽列一個字都不動（ADR-0067）。 */''}
        <span class="footlinks footlinks--inline">
          <a class="footlink" href="#/playbook">${icon('manual', { size: 15 })}備忘錄</a>
        </span>
      </div>
      ${nothing ? '<p class="page__lead">今天沒有待辦。</p>' : ''}
    </div>

    <div class="seg" role="group" style="margin-bottom: var(--space-4)">
      <button class="seg__item" type="button" aria-pressed="${tab === 'all'}" data-tab="all">總覽</button>
      <button class="seg__item" type="button" aria-pressed="${tab === 'who'}" data-tab="who">依客戶</button>
    </div>

    ${tab === 'all' ? overviewHtml(ctx, { overdue, dueToday, tomorrow, waiting, toClose })
                    : byCustomerHtml(ctx, waiting, toClose)}

    ${notesCard(notes)}

    ${reviewSection()}

    ${quickFab()}`;

  wireOverview(ctx);
  wireQuickCapture(ctx);
  wireReview(ctx);
  markNext(el);
}

// ---------- 看今天做了什麼 ----------
//
// 她的原話：「我需要一個能回顧今天操作紀錄的介面…目的：確認是否有遺漏登記
// （例如忘記把某個紀錄同步到試算表）。」
//
// **它是稽核紀錄的白話版，不是第二份紀錄**（ADR-0062）。歸類的規則全部在
// `domain/dayReview.js`，這裡只負責畫。
//
// 做成**展開才載入**，跟客戶詳情的「變更紀錄」同一種（她指名的那一個）：
// 她一天開這一頁十幾次，而看回顧是收工前一次的事。

/** 往前最多翻幾天。再遠她會去查 `#/settings/audit`。 */
const REVIEW_BACK = 7;

/** 現在看的是哪一天。存在模組裡不進網址 —— 它是看法，不是位置。 */
let reviewDay = null;

/**
 * 照人還是照流程。同上，是看法不是位置。
 *
 * **預設照人**（2026-09-01 她指定的）：她收工前問的是「這個人今天處理完了沒」。
 * 照流程那一格留著回答另一個問題 —— 「哪一類整個漏了」（ADR-0062、0043）。
 */
let reviewBy = 'person';

/**
 * 那一天撈回來的稽核與客戶名單。
 *
 * 存在模組裡是為了**換看法不重打一次網路**：切「照人／照流程」是同一批資料的
 * 兩種排法，翻日子才要重讀。名單只讀一次，之後翻幾天都用同一份。
 */
let reviewCache = null;
let reviewNames = null;

/**
 * 勾掉的那幾張任務對應的來訪。id → 來訪。
 *
 * 勾掉一張任務的那一句要講得出「誰的、哪一天的、哪一項」，而任務身上只有
 * `visitId`（來訪日與課程名不該存在任務上 —— `domain/audit.js` 的檔頭）。
 * 跟客戶名單同一條規矩：**讀不到不擋這一塊**，少幾個日期不是少一塊畫面。
 *
 * 存在模組裡是為了**翻日子不重讀同一筆**：她一天勾十幾張，翻七天很容易碰到
 * 同一場（一場來訪身上兩三張任務是常態）。
 */
let reviewVisits = new Map();

/**
 * 「另外 N 則」攤開了沒。跟 `reviewBy` 一樣是看法不是位置，所以存在模組裡。
 * **翻一天要收回去** —— 那個數字換了，攤開的內容也換了。
 */
let reviewHidden = false;

/**
 * 展開了沒。**存在模組裡，因為這一頁重畫的次數變多了**（2026-09-02）——
 * 在「依客戶」的抽屜裡勾一筆會讓底下這一頁重畫，而重畫出來的
 * `<details>` 預設是收起來的。她剛剛才展開的東西在她眼前收起來，
 * 看起來像按錯了什麼。
 *
 * 換分頁（總覽／依客戶）也重畫，所以這一條順便把那個老毛病一起修掉。
 */
let reviewOpen = false;

function reviewSection() {
  return `
    <details class="card" data-review ${reviewOpen ? 'open' : ''} style="margin-top: var(--space-4)">
      <summary class="card__title">看今天做了什麼</summary>
      <div data-review-body><p class="muted">展開時才載入。</p></div>
    </details>`;
}

function wireReview(ctx) {
  const box = ctx.el.querySelector('[data-review]');
  if (!box) return;
  const body = box.querySelector('[data-review-body]');
  let loaded = false;

  const load = async () => {
    if (!box.open || loaded) return;
    loaded = true;
    reviewDay ??= ctx.today;
    // **失敗要能再試一次，所以把旗標放回去**（同 `views/audit.js` 的
    // `wireSection()`）—— 那一句「收起來再展開一次就會重試」以前是假的。
    if (!await loadReview(ctx, body)) loaded = false;
  };

  box.addEventListener('toggle', () => {
    reviewOpen = box.open;
    load();
  });

  // 重畫之前就是展開的：`toggle` 不會為了「一出生就 open」而觸發，
  // 所以這裡自己叫一次 —— 少了它，重畫之後那一塊會停在「展開時才載入」。
  if (box.open) load();

  // 換一天、換看法都**只重畫這一塊**（ADR-0038）—— 重畫整頁的代價是閃一下
  // 加捲回最上面，而她人在這一頁的最底下。
  body.addEventListener('click', (e) => {
    const step = e.target.closest('[data-review-step]');
    if (step) {
      const next = addDays(reviewDay ?? ctx.today, Number(step.dataset.reviewStep));
      if (next > ctx.today) return;
      if (daysBetween(next, ctx.today) > REVIEW_BACK) return;
      reviewDay = next;
      // 翻一天就把「另外 N 則」收回去 —— 那個數字換了，攤開的內容也換了。
      reviewHidden = false;
      // 翻日子失敗也一樣：收起來再展開才重試得了
      loadReview(ctx, body).then((ok) => { if (!ok) loaded = false; });
      return;
    }

    // 「另外 N 則」攤開／收起來。**不重畫這一塊**（ADR-0038）——
    // 重畫會把那一段的過場吃掉，而她要看的就是它長出來的那一下。
    const more = e.target.closest('[data-review-hidden]');
    if (more) {
      reviewHidden = !reviewHidden;
      more.setAttribute('aria-expanded', String(reviewHidden));
      more.textContent = reviewHidden ? '收起來' : '攤開';
      const box = body.querySelector('.reviewmore__box');
      if (box) {
        box.dataset.open = String(reviewHidden);
        // 收起來的時候連讀螢幕的人也讀不到 —— 它只是被裁掉，不是不存在。
        box.toggleAttribute('inert', !reviewHidden);
      }
      return;
    }

    // 換看法**不重新讀資料**：那一天的稽核已經在手上了，兩種只是排法不同。
    const by = e.target.closest('[data-review-by]');
    if (by && by.dataset.reviewBy !== reviewBy) {
      reviewBy = by.dataset.reviewBy;
      paintReview(ctx, body);
    }
  });
}

/**
 * 撈那一天的稽核，順便把客戶名單準備好。
 *
 * 名單只是用來把 id 換成名字（額度與本輪可用性身上沒有名字，只有路徑上有 id）。
 * **它讀不到不可以擋住這一塊** —— 少了名字那幾則會落進「沒有掛客戶」，
 * 那是 `describeParts()` 本來就有的退路。名單只讀一次，翻日子不再讀。
 *
 * @returns {Promise<boolean>} 稽核撈到了沒。撈不到的話呼叫端要把「載過了」
 *   那個旗標放回去，不然那一句「收起來再展開一次就會重試」是假的。
 */
async function loadReview(ctx, body) {
  const day = reviewDay ?? ctx.today;
  body.innerHTML = '<p class="muted">載入中…</p>';
  reviewCache = null;

  let events;
  try {
    [events] = await Promise.all([
      auditData.listOnDay(day),
      reviewNames ? Promise.resolve() : loadReviewNames(),
    ]);
  } catch (err) {
    body.innerHTML = `<p class="muted">讀不到：${esc(err.message)}
      <br>收起來再展開一次就會重試。</p>`;
    return false;
  }
  // 她可能在讀回來之前又翻了一天
  if ((reviewDay ?? ctx.today) !== day) return true;

  reviewCache = { day, events };
  // 先畫再補來訪：這一塊已經等過一輪網路了，不要為了幾個日期再等一輪。
  // 補回來之後只重畫這一塊（同 `loadTaskVisits()` 的作法）。
  paintReview(ctx, body);
  loadReviewVisits(ctx, body, events, day);
  return true;
}

/**
 * 勾掉的那幾張任務對應的來訪。**讀不到就算了** —— 那幾列會退回
 * 「勾掉 客戶A・Examine」，那是 `describeParts()` 本來就有的退路。
 *
 * 要讀哪幾筆由 `visitIdsIn()` 決定（規則在 domain，畫面不自己認）。
 * 已經在手上的不重讀。
 */
async function loadReviewVisits(ctx, body, events, day) {
  const wanted = visitIdsIn(events).filter((id) => !reviewVisits.has(id));
  if (!wanted.length) return;

  let visits;
  try {
    visits = await visitsData.getMany(wanted);
  } catch {
    return;
  }
  // 她可能在讀回來之前又翻了一天。**讀回來的照樣收進快取** ——
  // 那幾筆之後翻回來還是用得到，只是這一次不重畫。
  for (const [id, visit] of visits) reviewVisits.set(id, visit);
  if ((reviewDay ?? ctx.today) !== day) return;
  paintReview(ctx, body);
}

async function loadReviewNames() {
  try {
    const customers = await customersData.list();
    const byId = new Map(customers.map((c) => [c.id, c.name]));
    reviewNames = (id) => byId.get(id) ?? null;
  } catch {
    // 讀不到就當它不存在：少幾個名字，不是少一塊畫面。
    reviewNames = null;
  }
}

function paintReview(ctx, body) {
  if (!reviewCache) return;
  const review = reviewOf(reviewCache.events, {
    limit: 300,
    nameOf: reviewNames,
    // **問不到就不講**（同 `nameOf`）：還沒讀回來、讀失敗、那一筆被刪了，
    // 三種都回 null，而那一列退回「勾掉 客戶A・Examine」。
    visitOf: (id) => reviewVisits.get(id) ?? null,
  });
  body.innerHTML = reviewHtml(review, reviewCache.day, ctx.today, ctx.settings);
}

function reviewHtml(review, day, today, settings) {
  const back = daysBetween(addDays(day, -1), today) <= REVIEW_BACK;

  return `
    <div class="row" style="align-items: baseline; margin-bottom: var(--space-2)">
      <span class="row__main" style="font-weight: 600">${esc(dayTitle(day, today))}</span>
      <button class="chip chip--sm" type="button" data-review-step="-1"
              ${back ? '' : 'disabled'}>‹ 前一天</button>
      <button class="chip chip--sm" type="button" data-review-step="1"
              ${day < today ? '' : 'disabled'}>後一天 ›</button>
    </div>

    ${/* 兩種看法問的是兩件事：照人問「這個人處理完了沒」，
          照流程問「哪一類整個漏了」。同一批資料，切換不重讀。 */''}
    <div class="seg" role="group" aria-label="怎麼分組" style="margin-bottom: var(--space-3)">
      <button class="seg__item" type="button" data-review-by="person"
              aria-pressed="${reviewBy === 'person'}">照人</button>
      <button class="seg__item" type="button" data-review-by="stage"
              aria-pressed="${reviewBy === 'stage'}">照流程</button>
    </div>

    ${review.tiles.length ? `
      <p class="reviewtiles">
        ${review.tiles.map((t) => `
          <span class="reviewtiles__one">${esc(t.label)}
            <b class="num">${t.n}</b>${esc(t.unit)}</span>`).join('')}
      </p>` : ''}

    <div class="reviewlist">
      ${review.total === 0 ? `<p class="muted">${REVIEW_NOTHING}</p>` : ''}
      ${reviewBy === 'person'
        ? review.people.map(reviewPersonHtml).join('')
        : review.groups.map(reviewGroupHtml).join('')}
    </div>

    ${hiddenHtml(review)}

    ${review.truncated ? `
      <p class="muted dim" style="margin-top: var(--space-2)">
        這一天太多了，只列得出最近的 ${review.total} 則。更早的到
        <a href="#/settings/audit">稽核紀錄</a>看。</p>` : ''}

    ${day === today ? syncLine(settings) : ''}

    <p class="muted dim" style="margin: var(--space-3) 0 0; font-size: var(--text-2xs)">
      這裡是稽核紀錄的白話版 —— 要看某一筆到底改了哪個欄位，去
      <a href="#/settings/audit">稽核紀錄</a>。</p>`;
}

/**
 * 一位客戶一組。**抬頭是名字，所以那幾列不再印一次名字**
 * （`domain/dayReview.js` 給的就是不含名字的那一半）。
 *
 * 中間那一欄是流程分段的名字，淡一級 —— 它是分類不是內容。
 * 不印編號：編號講的是流程的第幾步，在照人的排法裡沒有意義。
 */
function reviewPersonHtml(person) {
  return `
    <div class="reviewgroup">
      <p class="reviewwho">
        <span class="reviewwho__name">${esc(person.who ?? NOBODY)}</span>
        <span class="reviewwho__n num">${person.n}</span>
      </p>
      ${person.rows.map((row) => `
        <p class="reviewrow">
          <span class="reviewrow__at num">${esc(reviewTime(row.at))}</span>
          <span class="reviewrow__stage">${esc(row.stage)}</span>
          <span class="reviewrow__what">${esc(row.text)}</span>
          ${row.times > 1 ? `<span class="reviewrow__x num">×${row.times}</span>` : ''}
        </p>`).join('')}
    </div>`;
}

function reviewGroupHtml(group) {
  return `
    <div class="reviewgroup">
      <p class="reviewgroup__head">
        <span class="reviewgroup__n">${group.stage.n}</span>${esc(group.stage.label)}
      </p>
      ${group.rows.map((row) => `
        <p class="reviewrow">
          <span class="reviewrow__at num">${esc(reviewTime(row.at))}</span>
          <span class="reviewrow__what">${esc(row.text)}</span>
          ${row.times > 1 ? `<span class="reviewrow__x num">×${row.times}</span>` : ''}
        </p>`).join('')}
    </div>`;
}

/**
 * 被份量閘門濾掉的那幾則（ADR-0071）。
 *
 * **一則都不可以安靜地消失。** 這一行就是那條規矩的全部：不列出來可以，
 * 不說有幾則不行 —— 她開這一頁是為了確認沒有漏掉東西，而一個安靜消失的
 * 項目正好是最該被看到的那一種。
 *
 * 點得開，而且**不重讀資料**：那幾則本來就在手上。攤開的那幾列比一般的列
 * 再淡一級 —— 它們是「可以不看的那些」，不是第二份清單。
 *
 * **不叫「其他」**：那三個字是流程分段最後一段的名字（`STAGES` 的 `other`），
 * 同一塊畫面上兩個「其他」會被當成同一件事（`NOBODY` 同一條理由）。
 */
function hiddenHtml(review) {
  if (!review.hidden) return '';

  return `
    <p class="reviewmore">
      <span class="reviewmore__say">另外 ${review.hidden} 則沒列出來 —— 改欄位、對帳這種</span>
      <button class="chip chip--sm" type="button" data-review-hidden
              aria-expanded="${reviewHidden}">${reviewHidden ? '收起來' : '攤開'}</button>
    </p>
    ${/* 收合走 grid 0fr→1fr（同 `.pbsearch`）—— `height: auto` 沒有動畫，
          而猜一個 max-height 在三則跟三十則的時候會是兩種速度。 */''}
    <div class="reviewmore__box" data-open="${reviewHidden}"
         ${reviewHidden ? '' : 'inert'}>
      <div class="reviewmore__rows">
        ${review.hiddenRows.map((row) => `
          <p class="reviewrow">
            <span class="reviewrow__at num">${esc(reviewTime(row.at))}</span>
            <span class="reviewrow__what">${esc(row.text)}</span>
            ${row.times > 1 ? `<span class="reviewrow__x num">×${row.times}</span>` : ''}
          </p>`).join('')}
      </div>
    </div>`;
}

function reviewTime(at) {
  const ms = auditData.millisOf(at);
  if (!ms) return '—';
  return new Date(ms).toLocaleTimeString('zh-TW', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

/**
 * 最底下那一行試算表。**她點名要的那一句**：
 * 「確認是否有遺漏登記（例如忘記把某個紀錄同步到試算表）」。
 *
 * 判斷全部在 `domain/sheetReport.js` 的 `describeSync()`（設定頁那一段用的是
 * 同一支）—— 這裡只把它收成一行，細節按進去看。
 *
 * **只在「今天」那一格出現**：`sheetSync` 存的是「上次」，不是每一天的歷史，
 * 翻到昨天時那一行會在講今天的事。
 */
function syncLine(settings) {
  const failure = sheetSync.lastError();
  const { tone } = describeSync({
    configured: isConfigured(settings),
    lastAtLabel: sheetSync.lastSyncedAt(),
    dirty: sheetSync.isDirty(),
    error: failure?.error ?? null,
    skipped: sheetSync.lastSkipped()?.names ?? [],
  });

  const SAY = {
    off: { text: '沒有設定自動推送', cls: 'muted' },
    ok: { text: '推過了', cls: 'muted' },
    waiting: { text: '還有東西沒推上去', cls: 'reviewsync--soon' },
    partial: { text: '有分頁沒更新', cls: 'reviewsync--soon' },
    failed: { text: '上次推失敗了', cls: 'reviewsync--bad' },
  };
  const say = SAY[tone] ?? SAY.ok;
  const at = sheetSync.lastSyncedAt();

  return `
    <p class="reviewsync ${say.cls}">
      <span>試算表：${esc(say.text)}${at && tone !== 'off' ? `・上次 ${esc(reviewTime(at))}` : ''}</span>
      <a href="#/settings/report">看細節</a>
    </p>`;
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
 * **一列只有標題與數字**（2026-09-04，ADR-0072）。她的原話：「總攬的那 7 個
 * 步驟中的每個子項目都有說明，其實不用，就留標題……會讓畫面很亂」。
 *
 * 十三句說明沒有消失，它們搬到**她真的要操作的那一頁**（`GROUPS[].lead` 與
 * `renderGroup()` 的 `meta.lead`）：「Examine：預約作業 → 查核 → 已報到」
 * 在她按下去之後才有用，在總覽上只是噪音。同一組字另外還住在
 * `docs/操作手冊.md` 與 `CONTEXT.md`。
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
    { id: 'book', html: `<div data-book>${bookGroupRow()}</div>` },
    { id: 'confirm', html: waiting.size ? groupRow({
      href: '#/todo/confirm', label: '跟客人確認時間', n: waiting.size,
    }) : '' },
    { id: 'close', html: toClose.length ? groupRow({
      href: '#/todo/close', label: '簽療程單', n: toClose.length,
    }) : '' },
    ...kinds.map((k) => ({ id: k, html: groupRow({
      href: `#/todo/${encodeURIComponent(k)}`,
      label: k,
      // 已經取消的種類：一整句換成一顆小丸子。一顆丸子講的是「這一列跟別列
      // 不同」，一整行講的是「讓我解釋給你聽」—— 她要的是前者，完整版在
      // 點進去那一頁的第一句（`renderGroup()` 的 `meta.lead`）。
      tag: isRetired(k) ? '舊資料' : '',
      n: tasks.filter((t) => t.kind === k).length,
      faded: isRetired(k),
    }) })),
    { id: 'cancel', html: cancels.length ? groupRow({
      href: '#/todo/cancel', label: '改時間／取消', n: cancels.length, danger: true,
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

  // 數字**不減掉**已經發出連結的那幾位：這一輪的時間確實還沒問到，
  // 把數字做小會讓她以為進度比實際好（ADR-0033）。
  //
  // 那一句「其中 N 位已經發出連結」2026-09-04 拿掉了（ADR-0072）。
  // **要解釋的事沒有變，變的是解釋它的地方**：點進去那一頁分三區
  //（還沒發連結／已經發出／這個月已經問到了），「已經發出」那一區每一列
  // 還帶著三顆狀態徽章之一 —— 那一區是那句話的完整版，就在一次點擊處。
  // 同一件事在 `docs/常見問題.md` 也有一條。
  return groupRow({
    href: '#/todo/ask',
    label: '問這輪的時間',
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
function bookGroupRow() {
  if (!bookRows?.length) return '';

  return groupRow({
    href: '#/todo/book',
    label: '壓表登記',
    reminder: true,
  });
}

/**
 * 一種任務怎麼做。**2026-09-04 起只印在點進去那一頁的第一行**
 *（`renderGroup()` 的 `meta.lead`），不再印在總覽上 —— 「預約作業 → 查核 →
 * 已報到」在她按下去之後才有用（ADR-0072）。
 *
 * 這一份**不要刪**：它是那一頁的來源。同一組字另外還住在
 * `docs/操作手冊.md` 與 `CONTEXT.md` 的「Examine」「耀聖」兩條。
 */
const KIND_NOTES = {
  打電話: '來訪前一天提醒',
  Abovee: '壓表登記',
  Examine: '預約作業 → 查核 → 已報到',
  // 客人走了之後才長出來的那一族（ADR-0066）。死線是來訪那一天，
  // 不是它的前一天 —— 這件事是當天做的。
  寫紀錄: '客人走了，去把紀錄補上',
  耀聖: '右下角 → 未報到 → V',
  // 健檢做完了 → 先追蹤報告（兩三週才出來）→ 拿到了才約二返。
  // 兩張的死線都不是來訪日前一天，間隔在設定頁調，見 ADR-0042。
  追蹤健檢報告: '健檢做完了，報告通常兩三週出來',
  // 報告到手的那一刻要做兩件事，兩張的死線一樣（ADR-0065）
  寄報告給醫師: '報告拿到了，寄一份給要看報告的那位醫師',
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
 *
 * **沒有 `note` 這個參數，這是刻意的**（2026-09-04，ADR-0072）。留著它就是
 * 留著一條路，而這一頁就是這樣長出十三句說明的。`tag` 收不下一整句
 *（它是一顆小丸子），那個限制本身就是護欄。
 */
function groupRow({ href, label, tag = '', n, danger = false, faded = false, reminder = false }) {
  return `
    <a class="grouprow ${faded ? 'grouprow--faded' : ''} ${reminder ? 'grouprow--reminder' : ''}"
       href="${href}">
      <span class="grouprow__main">
        <span class="grouprow__label" ${danger ? 'style="color: var(--overdue)"' : ''}>${esc(label)}</span>
        ${tag ? `<span class="grouprow__tag">${esc(tag)}</span>` : ''}
      </span>
      ${reminder ? '' : `
        <span class="grouprow__n" ${danger ? 'style="color: var(--overdue)"' : ''}>${n}</span>`}
      ${icon('right', { size: 18 })}
    </a>`;
}

/**
 * 依客戶：一位客戶一列，看得出「這個人身上還有幾件事」。
 *
 * **點一列不換頁**（2026-09-02）。以前這裡是 `<a href="#/customers/:id">`，
 * 於是她要處理一位客戶得走五步：點 → 捲到任務那一段 → 勾 → 返回 →
 * 再把「依客戶」切回來（`tab` 沒有存進網址）。二十幾位就是一百步。
 * 她的原話是「打斷批次處理待辦事項的操作節奏」。
 *
 * **那顆數字是三種相加**（2026-09-02 她決定的）：任務、跟客人確認時間、
 * 簽療程單。清單比數字多一項她會以為數字壞了，所以抽屜裡列什麼，
 * 這裡就要算什麼 —— 兩邊只有 `whoRows()` 一支在決定，不要在抽屜那側
 * 自己再挑一次。
 */
function byCustomerHtml(ctx, waiting, toClose) {
  const rows = [...whoRows(ctx, waiting, toClose).values()];
  if (!rows.length) return '<p class="muted">沒有待辦。</p>';

  return `
    <div class="stack">
      ${rows
        .sort((a, b) => b.n - a.n || String(a.name).localeCompare(String(b.name), 'zh-TW'))
        .map((r) => `
          <button class="card row whorow" type="button" data-who="${esc(r.id)}">
            <span class="row__main">
              <span class="row__title">${esc(r.name)}</span>
              <span class="muted">${esc([...r.whats].join('・'))}</span>
            </span>
            <span class="badge ${r.tasks.length ? 'badge--soon' : 'badge--ok'}">${r.n}</span>
            ${icon('right', { size: 18 })}
          </button>`).join('')}
    </div>`;
}

const NO_NAME = '（沒有名字）';

/**
 * 一位客戶身上還有哪些事。**清單與數字的唯一來源** ——
 * 卡片那一列與抽屜裡的內容都問這一支。
 *
 * @returns {Map<string, {id:string, name:string, whats:Set<string>, n:number,
 *   tasks:object[], confirm:object[], close:object[]}>}
 */
function whoRows(ctx, waiting, toClose = []) {
  const rows = new Map();
  const at = (id, name) => {
    if (!rows.has(id)) {
      rows.set(id, { id, name: name || NO_NAME, whats: new Set(), n: 0, tasks: [], confirm: [], close: [] });
    }
    const row = rows.get(id);
    // 名字兩邊都是快照，可能其中一份是空的。有名字的那一份贏 ——
    // 「（沒有名字）」不該蓋掉一個真的有的名字。
    if (name && row.name === NO_NAME) row.name = name;
    return row;
  };

  for (const t of ctx.tasks) {
    const row = at(t.customerId, t.customerName);
    row.whats.add(t.kind);
    row.tasks.push(t);
    row.n += 1;
  }

  for (const [id, visits] of waiting) {
    const row = at(id, visits[0].customerName);
    row.whats.add('跟客人確認時間');
    row.confirm.push(...visits);
    row.n += visits.length;
  }

  for (const v of toClose ?? []) {
    const row = at(v.customerId, v.customerName);
    row.whats.add('簽療程單');
    row.close.push(v);
    row.n += 1;
  }

  return rows;
}

// ---------- 依客戶：原地展開的那張抽屜 ----------
//
// 她在這張抽屜裡做的事只有一件：**把這個人身上勾得掉的勾掉**。
// 另外兩種（跟客人確認時間、簽療程單）在這裡只是一條路 —— 它們都不是布林值，
// 一個要把所有時段攤開逐筆退回，一個要逐段記結果（ADR-0025）。
// 做成勾選框的話她點一下就會以為完成了。
//
// 抽屜走 `components/sheet.js`（全站共用那一支）：它自己接返回鍵（ADR-0048）、
// 自己吃往下甩、≥900px 自己變成置中對話框。**不要在這一頁再刻一張** ——
// 這一頁已經有兩張自己畫的抽屜（確認動線與收尾），那兩張是因為要跟著整頁
// 重畫才自己畫的，這一張不是。

/**
 * 現在開著哪一位。`tasks` 是**這張抽屜自己的一份快照**，不是 `ctx.tasks` 的參照：
 * 勾掉的那幾筆要留在抽屜裡（劃掉、點得回來，同隨手記與任務那幾頁的判斷），
 * 但要從 `ctx.tasks` 裡拿掉，底下那張卡片的數字才會跟著減。
 */
let whoDrawer = null;

function openWhoDrawer(ctx, customerId, waiting, toClose) {
  const row = whoRows(ctx, waiting, toClose).get(customerId);
  if (!row) return;

  const d = {
    customerId,
    row,
    tasks: row.tasks.map((t) => ({ ...t })),
    visits: null,
    rooms: {},
    staff: {},
    bookings: new Map(),
    sheet: null,
  };
  whoDrawer = d;

  d.sheet = openSheet({
    title: row.name,
    note: whoNote(),
    body: whoBodyHtml(ctx),
    onMount: () => wireWhoDrawer(ctx),
    onClose: () => { if (whoDrawer === d) whoDrawer = null; },
  });

  loadWhoDetails(ctx);
}

/** 抬頭底下那一句。勾掉之後要跟著換 —— 留著上一句比沒有說明更糟。 */
function whoNote() {
  const d = whoDrawer;
  if (!d) return '';
  const open = d.tasks.filter((t) => !t.done).length;
  const ways = d.row.confirm.length + d.row.close.length;
  if (!open && !ways) return '這個人身上的事都做完了。';
  const parts = [];
  if (open) parts.push(`${open} 件可以在這裡勾`);
  if (ways) parts.push(`${ways} 件要去別的地方做`);
  return parts.join('・');
}

function whoBodyHtml(ctx) {
  const d = whoDrawer;
  if (!d) return '';

  const rows = d.tasks.map((t) => sharedTaskRow(t, d.visits?.get(t.visitId) ?? null, {
    booking: d.bookings.get(t.id) ?? null,
    // 那一列的名字走顯示名稱（`SIS(60)`），跟日曆同一種寫法（ADR-0078）
    master: d.master ?? null,
    // 「去壓表」只有「約二返」那幾列有：項目與「哪一次健檢的」都先選好，
    // 她只要挑日期跟時間（同任務那一頁那一顆，共用 `bookFollowup()`）。
    actions: t.kind === FOLLOWUP_TASK_KIND && t.customerId && !t.done
      ? `<button class="btn btn--sm" type="button" data-who-book="${esc(t.id)}"
                 style="align-self: center; margin-right: var(--space-1)">去壓表</button>`
      : '',
  }));

  const ways = [
    ...(d.row.confirm.length ? [wayRow({
      label: '跟客人確認時間',
      count: d.row.confirm.length,
      note: d.row.confirm.map((v) => shortDate(v.date)).join('、'),
      hint: '客人可能只答應其中幾天，要逐筆過 —— 在那一頁做',
      href: '#/todo/confirm',
    })] : []),
    ...(d.row.close.length ? [wayRow({
      label: '簽療程單',
      count: d.row.close.length,
      note: d.row.close.map((v) => shortDate(v.date)).join('、'),
      hint: '次數是收尾時才扣的，哪幾段做了要逐段記 —— 在那一頁做',
      href: '#/todo/close',
    })] : []),
  ];

  return `
    ${rows.length ? `<div class="tasklist">${rows.join('')}</div>`
                  : '<p class="muted" style="margin: 0">沒有可以在這裡勾的任務。</p>'}
    ${ways.length ? `
      <div class="tasklist__way">
        <p class="tasklist__waylead">這幾件在別的地方做</p>
        ${ways.join('')}
      </div>` : ''}`;
}

function wireWhoDrawer(ctx) {
  const el = whoDrawer?.sheet?.el;
  if (!el) return;

  el.querySelectorAll('[data-task]').forEach((btn) =>
    btn.addEventListener('click', () => toggleWhoTask(ctx, btn.dataset.task)),
  );

  el.querySelectorAll('[data-task-visit]').forEach((btn) =>
    btn.addEventListener('click', () => openWhoVisit(btn.dataset.taskVisit, btn.dataset.tasklistTask)),
  );

  el.querySelectorAll('[data-who-book]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const tasks = whoDrawer?.tasks ?? [];
      whoDrawer?.sheet?.close();
      bookFollowup({ ...ctx, open: tasks }, btn.dataset.whoBook);
    }),
  );
}

/**
 * 那一列上的「哪一天・哪一場」與「約二返約了沒」。
 *
 * **抽屜先開，這一段等資料回來再補**（同 `loadTaskVisits()` / `loadAsk()`）——
 * 她點下去要的是「這個人身上有什麼」，不是等三次查詢跑完。
 * 讀不到就當這一段不存在：少一行字，不是少一張抽屜。
 */
async function loadWhoDetails(ctx) {
  const d = whoDrawer;
  if (!d) return;

  const ids = d.tasks.map((t) => t.visitId).filter(Boolean);

  try {
    // 課程、器材與品項是給讀取卡片上「那一段叫什麼」用的（`domain/naming.js`）——
    // 四個畫面共用同一支 `visitReadHtml()`，少帶的話這一頁會寫「復能」
    // 而日曆上寫「SIS(60)」。**三份都要帶**：少了品項那一段點滴這一頁會寫
    // 「營養點滴」而別頁寫「雪」。
    const [visits, rooms, staff, courses, equipment, ivProducts] = await Promise.all([
      ids.length ? visitsData.getMany(ids) : Promise.resolve(new Map()),
      config.listAll('rooms'),
      config.listAll('staff'),
      config.listAll('courses', { includeDeleted: true }),
      config.listAll('equipment', { includeDeleted: true }),
      config.listAll('ivProducts', { includeDeleted: true }),
    ]);
    if (whoDrawer !== d) return;   // 她已經關掉、或換了一位
    d.visits = visits;
    d.rooms = byId(rooms);
    d.staff = byId(staff);
    d.master = { courses, equipment, ivProducts };
  } catch {
    return;
  }

  // 「約二返」那幾列各自約了沒。一位客戶讀一次，不是一列讀一次。
  const mine = d.tasks.filter((t) => t.kind === FOLLOWUP_TASK_KIND && t.visitId);
  if (mine.length) {
    try {
      const [courses, entitlements, hers] = await Promise.all([
        config.listAll('courses', { includeDeleted: true }),
        customersData.listEntitlements(d.customerId),
        visitsData.listByCustomer(d.customerId),
      ]);
      if (whoDrawer !== d) return;
      const coursesById = byId(courses);
      for (const t of mine) {
        const state = bookingStateForTask(t, { entitlements, coursesById, visits: hers });
        // 算不出來的不寫進去 —— 斷言「還沒約」會讓她照著去多約一場。
        if (state) d.bookings.set(t.id, state);
      }
    } catch {
      /* 少一顆丸子，不是少一張抽屜 */
    }
  }

  if (whoDrawer !== d) return;
  d.sheet.update(whoBodyHtml(ctx));
}

/**
 * 抽屜裡那顆「詳情 ›」。**唯讀，沒有鉛筆**（ADR-0056）。
 *
 * **先給那一天有哪幾段，點某一段才看那一段**（ADR-0080）。這一頁點的是人名，
 * 列的是整筆來訪，所以第一張沒帶 `focus` —— 那時候每一段自己是一列，
 * 點下去用同一支再開一張只有那一段的。
 *
 * **那一張只是目錄**（2026-09-12）：待辦與 SOP 都等她點進某一段才出現。
 * 一天只有一段時 `focusFor()` 直接解成那一段 —— 一張只有一列的目錄
 * 是講不通的。
 */
function openWhoVisit(visitId, taskId = null) {
  const d = whoDrawer;
  const visit = d?.visits?.get(visitId);
  if (!visit) {
    toast.info(d?.visits
      ? '找不到這一天的來訪，可能已經刪掉了'
      : '那一天的資料還在讀，等一下再按一次');
    return;
  }

  // 她點到哪一段了。這一頁點的是人名，所以進來沒有段落 —— 但那一天只有一段
  // 的時候，那一段就是那一天（`focusFor()`），不然會畫成一張只有一列的空目錄。
  //
  // **在卡片裡就地換掉**，不是關掉再開一張 —— `openCard()` 第一行就是
  // `closeCard()`，重開等於畫面閃一下（ADR-0073 為那個閃爍付過帳）。
  //
  // **只開這一張講的那幾段**（`taskSlots()`，issues/08）：一段就直接是那一段，兩段以上目錄只列那幾段
  const task = taskId ? (d.tasks ?? []).find((t) => t.id === taskId) : null;
  const only = task ? taskSlots(task, visit, byId(d.master?.courses ?? [])) : null;
  let focus = focusFor(visit, null, only);
  let tasks;
  let extra = {};

  const paint = () => visitReadHtml(visit, {
    ...extra,
    only,
    roomsById: d.rooms,
    staffById: d.staff,
    master: d.master,
    // 少了這一份，那一塊會一律說「簽療程單」（見 `progress.js` 那一段的說明）
    coursesById: byId(d.master?.courses ?? []),
    tasks,
    today: todayISO(),
    focusSlot: focus,
  });

  // 整筆那一個是推導出來的 —— 加一段沒問過客人的進去就會退回「待確認」，
  // 而她點的可能是早上那段已經談定的（ADR-0085）。
  const sub = () => esc(describeStatus(statusForCard(visit, focus)));

  const html = (nextTasks, nextExtra = {}) => {
    tasks = nextTasks;
    extra = nextExtra;
    return paint();
  };

  // 先畫，那一場的待辦讀回來再補進去（`fillMirror()` 的檔頭）
  const card = openCard({
    title: `${visit.customerName ?? ''}・${shortDate(visit.date)}`,
    subtitle: sub(),
    body: html(undefined),
    // 每重畫一次都要重掛：`card.update()` 換掉整塊 body，舊節點連同監聽一起沒了。
    onMount: (cardEl) => wireReadSlots(cardEl, (i) => {
      focus = i;
      card.update(paint(), { subtitle: sub() });
    }),
  });

  fillMirror(card, visit, html);
}

/**
 * 在抽屜裡勾掉／拿回來一張任務。
 *
 * **樂觀更新**：畫面先動，寫入失敗再翻回來（SPEC 第 6.9 節「樂觀更新要誠實」）。
 * 寫入本身一律走 `toast.withSaveState()` —— 離線時 Firestore 的寫入 Promise
 * 既不 resolve 也不 reject，那條路只有它處理得了（`ui/toast.js` 的檔頭）。
 *
 * `key` 一定要傳：抽屜裡連點兩下會送兩次 `setDone`，而第二次會把 `doneAt`
 * 蓋成另一個時間 —— 「今天做了什麼」與已完成那一格都照 `doneAt` 分組。
 *
 * ## 勾掉「追蹤健檢報告」會讓事情變多，不是變少
 *
 * `data/tasks.js` 的 `setDone()` 會連著把「約二返」與「寄報告給醫師」寫在
 * 同一個 commit 裡（ADR-0042、0065）。所以那一種勾完之後要重讀一次
 * `listOpen()`，不然她會看到數字從 3 減成 2、關掉抽屜再打開又變回 4。
 * 其餘的走就地更新不重讀 —— 重讀會讓底下那一頁的三份補資料
 *（問時間、壓表、收件匣）整組再跑一次。
 */
async function toggleWhoTask(ctx, id) {
  const d = whoDrawer;
  const task = d?.tasks.find((t) => t.id === id);
  if (!task) return;

  const to = !task.done;

  // 拿回鏈上那兩種會**收掉別的張**，先問一句（三個入口共用 `confirmUntick()`）。
  // **問話在樂觀更新之前**：先動畫面再問，她按「取消」時畫面已經翻過去了。
  if (!(await confirmUntick(task, to))) return;
  // 問的那段時間她可能已經關掉抽屜或換了一頁
  if (whoDrawer !== d) return;

  const before = ctx.tasks;
  const beforeAt = task.doneAt ?? null;
  const saved = { ...task };

  // 1. 畫面先動
  task.done = to;
  task.doneAt = to ? new Date().toISOString() : null;
  ctx.tasks = to
    ? ctx.tasks.filter((t) => t.id !== id)
    : [...ctx.tasks, { ...task }];
  d.sheet.update(whoBodyHtml(ctx));
  d.sheet.setNote(whoNote());
  paint(ctx);

  try {
    await toast.withSaveState(
      () => tasksData.setDone(saved, to),
      { success: to ? '勾掉了' : '拿回來了', key: `task:done:${id}:${to}` },
    );
  } catch {
    // 2. 失敗就翻回來。**這是樂觀更新唯一誠實的收尾** ——
    //    畫面留在「已完成」而資料庫沒有，比一開始就不動更糟。
    task.done = !to;
    task.doneAt = beforeAt;
    ctx.tasks = before;
    if (whoDrawer === d) {
      d.sheet.update(whoBodyHtml(ctx));
      d.sheet.setNote(whoNote());
    }
    paint(ctx);
    return;
  }

  // 3. 健檢那條鏈：報告勾掉了會多兩張（約二返、寄報告給醫師），兩張都要看得見
  if (task.kind === REPORT_TASK_KIND) await refreshChain(ctx, d);
}

/**
 * 勾掉「追蹤健檢報告」之後，把新長出來的那幾張撈回抽屜裡。
 *
 * **撈的是「這位客戶所有新出現的」而不是某一種**，所以 ADR-0065 多的那一張
 * 不用改這裡一個字 —— 之後鏈條再長出第三種也一樣。
 */
async function refreshChain(ctx, d) {
  let fresh;
  try {
    fresh = await tasksData.listOpen();
  } catch {
    return;   // 讀不到就維持就地更新的結果，下次打開會對
  }
  if (whoDrawer !== d) return;

  ctx.tasks = fresh;
  const added = fresh.filter(
    (t) => t.customerId === d.customerId && !d.tasks.some((x) => x.id === t.id),
  );
  d.tasks.push(...added.map((t) => ({ ...t })));
  d.row.tasks = fresh.filter((t) => t.customerId === d.customerId);
  d.sheet.update(whoBodyHtml(ctx));
  d.sheet.setNote(whoNote());
  paint(ctx);
  // 新長出來的那一張要有「哪一天・哪一場」與「約了沒」
  if (added.length) loadWhoDetails(ctx);
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

      <div class="groups" data-notes>
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
      <span data-quickwho>${note.who()}</span>
      ${note.give()}
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

  // 「給營養品」那一顆捷徑（ADR-0059、issue 12）。選了之後：
  //   - 文字自動填好（`noteTextFor()`）—— 她自己打的那一行沒有 entitlementId，
  //     勾掉時就不會問「給了哪些」，那筆交付紀錄會靜靜沒了
  //   - 「掛給誰」那一排收起來 —— 客戶已經由那一包決定了，兩個地方各講一次
  //     會出現「掛給客戶B、內容是給客戶A營養品」這種東西
  const give = note.wireGive(drawer, {
    load: () => loadGivableBags(),
    onPick: (picked) => {
      const box = drawer.querySelector('[data-quickwho]');
      if (box) box.hidden = Boolean(picked);
      if (picked && input()) input().value = picked.text;
    },
  });

  const save = async () => {
    const text = String(input()?.value ?? '').trim();
    if (!text) {
      input()?.focus();
      return;
    }
    // 選了一包營養品的話，掛的人與 `entitlementId` 由那一包決定 ——
    // 「掛給誰」那一排這時候是收起來的。
    const bag = note.readGive(drawer);

    try {
      await toast.withSaveState(
        () => notesData.create({
          text,
          date: note.read(drawer),
          ...(bag
            ? {
              customerId: bag.customerId,
              customerName: bag.customerName,
              entitlementId: bag.entitlementId,
            }
            : note.readWho(drawer)),
        }),
        // **`key` 不可以少。** `#/todo/notes` 那一頁的 `addNote()` 一直都有，
        // 這顆泡泡沒有 —— 而這顆是最順手的那一個入口，而且它刻意不重畫面板、
        // 焦點留在輸入框，所以按下去畫面幾乎沒有變化，最容易多按一下。
        // key 帶上文字：連續記三件不同的事不可以被當成同一件擋掉。
        { success: '記下來了', key: `note:create:${text}` },
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
    give.set(null);
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

  // 「依客戶」那一列。**點下去不換頁**，原地展開抽屜（見 byCustomerHtml()）。
  // waiting 與 toClose 在這裡重算而不是從 paint() 傳進來：這一支的簽名是
  // 全頁共用的，多兩個只有一種看法用得到的參數，另一種看法也得跟著傳。
  el.querySelectorAll('[data-who]').forEach((btn) =>
    btn.addEventListener('click', () => openWhoDrawer(
      ctx,
      btn.dataset.who,
      byCustomer(visitsToConfirm(ctx.pending, ctx.today)),
      visitsToClose(ctx.unclosed ?? [], ctx.today),
    )),
  );

  el.querySelectorAll('[data-note]').forEach((btn) =>
    btn.addEventListener('click', () => toggleNote(ctx, btn.dataset.note)),
  );

  note.wire(el);
  note.wireWho(el, { load: () => customersData.list() });
  wireNoteLongPress(el, ctx.notes, () => render(ctx.el));

  el.querySelector('[data-newnote]')?.addEventListener('submit', (e) => {
    e.preventDefault();
    addNote(ctx, e.target);
  });
}

async function toggleNote(ctx, id) {
  // **不要叫它 `note`** —— 這一頁把 `components/note.js` 也 import 成 `note`，
  // 同名的區域變數會把整支模組蓋掉。
  const row = ctx.notes.find((n) => n.id === id);
  if (!row) return;

  // 掛了額度的那幾筆是營養品的提醒 —— 勾掉之前先問「給了哪些」。
  // 問話那一段刻意在 withSaveState 外面：包進去的話，她按了「先不要」
  // 也會跳一句「勾掉了」（四個入口共用 `note.prepareToggle()`）。
  const plan = await note.prepareToggle(row, noteDeps());
  if (!plan) return;

  try {
    await toast.withSaveState(plan.run, { success: plan.success });
    await render(ctx.el);
  } catch {
    /* 已處理 */
  }
}

/**
 * 「給營養品」那一顆點開之後要列的東西。
 *
 * 三份資料一次讀完：客戶、全部客戶的額度（一次 collection group 查詢，
 * 客戶總覽已經在用）、還沒勾掉的隨手記（用來標「9/3 已經約了」）。
 * **點開才會被呼叫，而且只呼叫一次**（`note.wireGive()` 的規矩）——
 * 她十次有九次不是在記營養品。
 *
 * 誰有貨、哪幾包還沒給完，規則全部在 `domain/products.js` 的 `givableBags()`。
 */
async function loadGivableBags() {
  const [customers, entitlementsBy, notes, products] = await Promise.all([
    customersData.list(),
    customersData.entitlementsByCustomer(),
    notesData.listOpen(),
    config.listAll('products'),
  ]);
  return givableBags({ customers, entitlementsBy, notes, master: { products } });
}

/** 勾一筆隨手記要用到的那幾支。五個入口的形狀一樣，只有這一份。 */
function noteDeps() {
  return {
    update: (id, changes) => notesData.update(id, changes),
    remove: (id, reason) => notesData.remove(id, reason),
    setDone: (id, done) => notesData.setDone(id, done),
    loadEntitlements: (cid) => customersData.listEntitlements(cid),
    recordDelivery: (n, e, d) => notesData.recordDelivery(n, e, d),
    loadCustomers: () => customersData.list(),
    // 舊資料的 `items[].name` 是空字串，靠主檔認回名字 ——
    // 沒有的話「給了什麼？」那張面板每一列都是空白（`issues/10`）。
    loadProducts: () => config.listAll('products'),
    today: todayISO(),
    // 問話那一段刻意在 withSaveState 外面（`note.prepareToggle()` 的檔頭），
    // 所以這裡收的是「真的會寫的那一下」。
    save: (run, opts) => toast.withSaveState(run, opts),
  };
}

/**
 * 長按一列隨手記＝直接做（ADR-0060）。點一下勾掉的行為一個字都沒有變。
 *
 * **委派掛在那一塊清單上，不是掛在 `el` 上。** `paint()` / `paintNotes()`
 * 換的是 `el.innerHTML`，`el` 本身留著 —— 掛在它上面的話每重畫一次就多一組，
 * 而這一頁光是切一次「總覽／依客戶」就會重畫。
 *
 * 「改文字」沒有現成的編輯器可以開（隨手記除了勾掉之外只有日曆上那一張，
 * 見 ADR-0044 的 Consequences），所以這裡先講出來 —— 靜靜不動更糟。
 *
 * @param {HTMLElement} el 那一頁的容器
 * @param {object[]} notes 現在畫出來的那幾筆
 * @param {Function} after 寫完之後重畫哪一頁
 */
function wireNoteLongPress(el, notes, after) {
  wireLongPress(el.querySelector('[data-notes]'), '[data-note]', (btn) => {
    const n = (notes ?? []).find((x) => x.id === btn.dataset.note);
    if (!n) return;

    openActions({
      title: n.text,
      subtitle: [n.date ? shortDate(n.date) : '沒有日期', n.customerName]
        .filter(Boolean).join('・'),
      items: noteActions(n, { today: todayISO() }),
      onPick: async (action) => {
        try {
          // **不傳 `onEdit`** —— 這一頁沒有自己的編輯器，`runAction()` 會用
          // 內建的那一張小卡片。以前這裡回一句「先勾掉再記一筆新的」，
          // 那是在解釋一個限制而不是在做事。
          const changed = await note.runAction(action, n, {
            ...noteDeps(),
            onBag: () => {
              if (n.customerId) go(`/customers/${n.customerId}`);
              else toast.info('這一筆沒有掛客戶，找不到是哪一包');
            },
          });
          if (changed) await after();
        } catch {
          /* 已處理 */
        }
      },
    });
  });
}

async function addNote(ctx, form) {
  const text = form.elements.text.value.trim();
  if (!text) return;
  try {
    await toast.withSaveState(
      () => notesData.create({ text, date: note.read(form), ...note.readWho(form) }),
      { success: '記下來了', key: `note:create:${text}` },
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
    // 每次從待辦中心點進來都回到下個月 —— 那是她問時間的常態節奏
    //（月底那一兩個禮拜問下個月，ADR-0053）。上次看到十月不該黏著。
    askMonth = null;
    return renderAsk(el);
  }
  if (group === 'forms') return formInbox.render(el);
  if (group === 'book') return renderBook(el);

  if (group !== taskTabGroup) {
    taskTab = 'open';
    taskTabGroup = group;
  }

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
  loadFollowupBookings(ctx);
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
    const [visits, rooms, staff, courses, equipment, ivProducts] = await Promise.all([
      visitsData.getMany(ids),
      config.listAll('rooms'),
      config.listAll('staff'),
      config.listAll('courses', { includeDeleted: true }),
      config.listAll('equipment', { includeDeleted: true }),
      // 那一段印的是品項不是課程（2026-09-08，`slotName()`）
      config.listAll('ivProducts', { includeDeleted: true }),
    ]);
    taskVisits = {
      visits,
      // 「哪一天的什麼」那一行要那一張任務本身：帶 `slotIndexes` 的只講它掛的那幾段（issues/21）
      tasks: byId([...ctx.open, ...ctx.done]),
      roomsById: byId(rooms),
      staffById: byId(staff),
      master: { courses, equipment, ivProducts },
    };
  } catch {
    // 讀不到就當這一段不存在：少一個數字，不是少一頁。
    return;
  }

  fillVisitInfo(ctx.el);
}

/**
 * 把「N 項」與「哪一天的什麼」填進那幾列。
 *
 * **每次重畫都要再叫一次** —— `paintTasks()` 換分頁時把那幾列整個重畫，
 * 而重畫出來的節點又是 hidden 的。讀回來的東西存在 `taskVisits` 裡不會掉，
 * 但畫面上的節點是新的。
 *
 * 兩件事一起填：它們要的是同一筆來訪，分兩支只會有一支被忘記叫。
 */
function fillVisitInfo(el) {
  if (!taskVisits) return;
  // 讀回來之前是 hidden 的 —— 空的丸子與空的一行都看起來像壞掉的東西。
  // 「N 項」數的是**這一張講的那幾段**，不是整天（`taskSlots()`，issues/08）。key 是任務 id
  const coursesById = byId(taskVisits.master?.courses ?? []);
  for (const node of el.querySelectorAll('[data-slots]')) {
    const task = taskVisits.tasks[node.dataset.slots];
    const visit = taskVisits.visits.get(task?.visitId);
    if (!visit) continue;
    node.textContent = `${taskSlots(task, visit, coursesById).length} 項`;
    node.hidden = false;
  }

  // 底下那幾行小字（一段一行，`lines`）。日期是**來訪那一天**不是死線
  //（`domain/todoFlow.js` 的 `taskLine()`，客戶詳情與試算表讀同一支）——
  // 死線是它的前一天，兩個差一天最容易看錯人。
  for (const node of el.querySelectorAll('[data-taskwhen]')) {
    // key 是**任務 id** 不是來訪 id：同一天兩張 Examine 各自掛不同的段，印的也要不同（issues/21）
    const task = taskVisits.tasks[node.dataset.taskwhen];
    const visit = taskVisits.visits.get(task?.visitId);
    if (!visit) continue;
    // 第三個參數帶了主檔才講得出「那天做了什麼」（`SIS(30)`）——
    // 不帶的話底下那一支 `visitCourseLabel` 退回快照，會寫成「復能」（ADR-0078）
    const line = taskLine(task, visit, taskVisits.master);
    if (!line.lines.length) continue;
    // 一行一段：`.row__lines` 是 `white-space: pre-line`，不用拼 HTML
    node.textContent = line.lines.join('\n');
    node.hidden = false;
  }
}

/**
 * 「約二返」那幾列各自約了沒。task id → `{booked, text}`。
 *
 * 跟 `taskVisits` 一樣存在模組裡：`paintTasks()` 會重畫好幾次，
 * 而重畫不該把已經讀回來的東西丟掉。
 */
let followupBookings = new Map();

/**
 * 那幾張「約二返」對應的健檢，二返到底約了沒。
 *
 * 她的原話：「我發現這個預約二返我可以直接勾掉但是其實沒有還沒預約」。
 * 勾掉之後那一次健檢整條鏈就結束了，所以「其實還沒約」這件事會就這樣消失。
 *
 * **照客戶收攏再讀**：一位客戶讀一次額度與來訪，不是一列讀一次 ——
 * 同一個人身上兩張「約二返」是正常的（買了 3 次健檢）。
 *
 * 跟 `loadTaskVisits()` 同一個作法：頁面先畫出來，這一段等資料回來再補上去。
 */
async function loadFollowupBookings(ctx) {
  const mine = ctx.open.filter((t) => t.kind === FOLLOWUP_TASK_KIND && t.customerId && t.visitId);
  if (!mine.length) return;

  const byCust = new Map();
  for (const t of mine) {
    if (!byCust.has(t.customerId)) byCust.set(t.customerId, []);
    byCust.get(t.customerId).push(t);
  }

  try {
    const courses = await config.listAll('courses', { includeDeleted: true });
    const coursesById = byId(courses);

    await Promise.all([...byCust.entries()].map(async ([customerId, tasks]) => {
      const [entitlements, visits] = await Promise.all([
        customersData.listEntitlements(customerId),
        visitsData.listByCustomer(customerId),
      ]);
      for (const t of tasks) {
        const state = bookingStateForTask(t, { entitlements, coursesById, visits });
        // 算不出來的不寫進去 —— 那一列就照舊什麼都不說。斷言「還沒約」
        // 會讓她照著去多約一場。
        if (state) followupBookings.set(t.id, state);
      }
    }));
  } catch {
    // 讀不到就當這一段不存在：少一句話，不是少一頁。
    return;
  }

  fillBookingStates(ctx.el);
}

/** 把「已約 9/3 14:00」填進那幾顆徽章。每次重畫都要再叫一次（同 fillVisitInfo）。 */
function fillBookingStates(el) {
  for (const node of el.querySelectorAll('[data-booked]')) {
    const state = followupBookings.get(node.dataset.booked);
    if (!state) continue;
    node.textContent = state.text;
    node.className = `badge ${state.booked ? 'badge--ok' : 'badge--overdue'}`;
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
/**
 * `taskTab` 是哪一個分類的。**換到別的分類、或離開再回來就回到未完成**：Examine 那一頁切到
 * 已完成之後點耀聖（或去日曆繞一圈再回來），不可以直接停在已完成、把還沒做的那一張藏起來
 * （prelaunch-audit-2026-09-23/issues/11）。同一個分類重畫（拿回來、刪一張、清掉、復原之後）
 * 照樣留著 —— 那幾條路不換網址，所以換網址就忘掉。
 */
let taskTabGroup = null;
window.addEventListener('hashchange', () => { taskTabGroup = null; });

function paintTasks(ctx) {
  const { el, today, meta } = ctx;
  const rows = taskTab === 'done' ? ctx.done : ctx.open;

  el.innerHTML = `
    ${backLink()}
    <div class="page">
      <h1 class="page__title">${esc(meta.title)}${tip(meta.lead)}</h1>
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
    btn.addEventListener('click', () => openTaskVisit(btn.dataset.visit, btn.dataset.taskId)),
  );

  el.querySelectorAll('[data-book-followup]').forEach((btn) =>
    btn.addEventListener('click', () => bookFollowup(ctx, btn.dataset.bookFollowup)),
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
  fillVisitInfo(el);
  fillBookingStates(el);
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
          ${/* 勾掉之後長得不一樣會讓她以為那是另一種東西，所以這一格也補 */''}
          ${t.visitId ? `<span class="note__lines" data-taskwhen="${esc(t.id)}" hidden></span>` : ''}
        </span>
        <span class="notetags">
          ${/* key 是任務 id：「N 項」數的是這一張的段（`taskSlots()`，issues/08） */''}
          ${t.visitId ? `<span class="notetag" data-slots="${esc(t.id)}" hidden></span>` : ''}
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
 * 這一頁那兩張自己畫的抽屜共用的手勢接線。
 *
 * **進場動畫只播一次。** 兩張抽屜都跟著整頁重畫（`paintClose()` /
 * `paintConfirm()` 換掉 `el.innerHTML`），而抽屜開著的時候那兩支還會跑好幾次：
 * 補那句「會多一張追蹤健檢報告」（先畫再補，同 `loadTaskVisits()`）、
 * 逐段勾「這段沒做」、逐筆退回。每一次都 `playIn()` 的話，抽屜會在她眼前
 * 從螢幕外重新滑上來 —— 她點一下打勾就看到它跳兩次，一筆來訪三段就跳四次
 * （`.scratch/quick-actions-and-supplements/issues/01`）。
 *
 * 播過了沒記在 `drawer` 上而不是這裡：那個物件就是「現在開著哪一張」的
 * 唯一真相，關掉時整個換成 null，下一次開啟自然又是還沒播過。
 *
 * @param {HTMLElement} el 那一頁的容器
 * @param {Function} close 收起來之後做什麼
 */
function mountDrawerGesture(el, close) {
  const box = el.querySelector('.drawer');
  if (!box) return;

  const drag = wireDrag(box, close, { backdrop: el.querySelector('[data-backdrop]') });
  if (drawer && !drawer.shown) {
    drawer.shown = true;
    drag.playIn();
  }
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
          ${/* **三行**（她 2026-09-24，issues/09）：「一行名字 一行標籤 一行小字說是甚麼幾點的什麼」。
                標籤接在名字後面的話，窄的時候從名字後面斷行 —— 標籤自己一行、放不下才換。 */''}
          <span class="row__title">${esc(t.customerName ?? '（沒有名字）')}</span>
          <span class="row__tags">
            <span class="badge">${esc(t.kind)}</span>${
              /* 系統自己寫的那一句收進 ?：標題已經寫了「取消 Abovee」，底下再講一次「有一段取消了…」
                 她說「妥妥的多餘」。她自己寫的照舊印在底下。`tip()` 在 <label> 裡跟 `form.js` 的欄位標籤
                 同一種放法（它的 click 走 capture 而且 preventDefault，不會勾到那一格） */''}${t.autoGenerated ? tip(t.note ?? '') : ''}
            ${t.visitId ? `<span class="badge" data-slots="${esc(t.id)}" hidden></span>` : ''}
            <span class="badge ${badgeClass(state)}">${esc(dueLabel(t.dueDate, today))}</span>
            ${t.kind === FOLLOWUP_TASK_KIND
              ? `<span class="badge" data-booked="${esc(t.id)}" hidden></span>` : ''}
          </span>
          ${/* 「這是哪一天的什麼」，**一段一行**（`taskLine()` 的 `lines`）。等來訪讀回來才填得上
                （同「N 項」，`fillVisitInfo()`），讀回來之前是 hidden —— 空的一行看起來像壞掉的東西。 */''}
          ${t.visitId ? `<span class="row__sub row__lines" data-taskwhen="${esc(t.id)}" hidden></span>` : ''}
          ${t.note && !t.autoGenerated ? `<span class="muted">${esc(t.note)}</span>` : ''}
        </span>
      </label>
      ${t.kind === FOLLOWUP_TASK_KIND && t.customerId
        // 她的原話：「希望這邊有可以點了直接連結到壓表……然後會自動選好二返」。
        // 項目與「哪一次健檢的」都先選好，她只要挑日期跟時間。
        ? `<button class="btn" type="button" data-book-followup="${esc(t.id)}"
                   style="min-height: 40px">去壓表</button>`
        : ''}
      ${t.visitId ? `<button class="btn" type="button" data-visit="${esc(t.visitId)}"
                             data-task-id="${esc(t.id)}" style="min-height: 40px">詳情</button>` : ''}
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
function openTaskVisit(visitId, taskId = null) {
  const visit = taskVisits?.visits.get(visitId);
  if (!visit) {
    // 以前這裡是 `go('/visits/:id')`。那條路現在通到一個她不該落在的地方，
    // 而無聲什麼都不發生更糟 —— 講出來是哪一種情況。
    toast.info(taskVisits
      ? '找不到這一天的來訪，可能已經刪掉了'
      : '那一天的資料還在讀，等一下再按一次');
    return;
  }

  // 她點的是哪一張待辦 → **只開它講的那幾段**（`taskSlots()`，issues/08）。以前這裡寫著
  // 「任務綁的是一整天」，而取消類、掛號類、寫紀錄早就逐段了 —— 她 2026-09-24：「為甚麼不是只呈現
  // 真的被取消的那幾段?」。一段就直接是那一段，兩段以上目錄只列那幾段。
  // 就地換掉，不重開一張 —— 同 `openWhoVisit()` 那一段的說明。
  const task = taskId ? taskVisits.tasks[taskId] : null;
  const only = task ? taskSlots(task, visit, byId(taskVisits.master?.courses ?? [])) : null;
  let focus = focusFor(visit, null, only);
  let tasks;
  let extra = {};

  const paint = () => visitReadHtml(visit, {
    ...extra,
    only,
    roomsById: taskVisits.roomsById,
    staffById: taskVisits.staffById,
    master: taskVisits.master,
    // 少了這一份，那一塊會一律說「簽療程單」（見 `progress.js` 那一段的說明）
    coursesById: byId(taskVisits.master?.courses ?? []),
    tasks,
    today: todayISO(),
    // 沒帶就是那一天全部，而每一段自己是一列（ADR-0080）。同 `openWhoVisit()`。
    focusSlot: focus,
  });

  // 整筆那一個是推導出來的（ADR-0085），同 `openWhoVisit()` 那一段的說明。
  const sub = () => esc(describeStatus(statusForCard(visit, focus)));

  const html = (nextTasks, nextExtra = {}) => {
    tasks = nextTasks;
    extra = nextExtra;
    return paint();
  };

  const card = openCard({
    title: `${visit.customerName ?? ''}・${shortDate(visit.date)}`,
    subtitle: sub(),
    body: html(undefined),
    onMount: (cardEl) => wireReadSlots(cardEl, (i) => {
      focus = i;
      card.update(paint(), { subtitle: sub() });
    }),
  });

  fillMirror(card, visit, html);
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

  // 還沒看到那一場二返的那幾張，單獨講一句。**不擋**（ADR-0002：app 記錄決定，
  // 不做決定）—— 她可能在別的地方約好了還沒回來記，或者客人當場就約了下一次。
  // 已經約到的就不要多問，多問一次她會學會閉著眼睛按。
  const unbooked = rows.filter((t) => followupBookings.get(t.id)?.booked === false);

  const ok = await confirmAction({
    title: `把 ${rows.length} 筆標成完成？`,
    consequences: [
      // 逃脫由 `components/dialog.js` 負責，這裡傳純文字就好
      ...rows.slice(0, 8).map((t) => `${t.customerName ?? '（沒有名字）'}・${t.kind}`),
      ...(rows.length > 8 ? [`⋯還有 ${rows.length - 8} 筆`] : []),
      ...(unbooked.length ? [
        `⚠️ 其中 ${unbooked.length} 筆還沒看到二返的預約`
          + `（${unbooked.slice(0, 3).map((t) => t.customerName ?? '（沒有名字）').join('、')}）`,
        '勾掉之後那幾次健檢就不會再出現在待辦上了',
        '如果只是還沒回來記，先去壓表比較安全',
      ] : []),
      '它們會移到「已完成」，不會消失',
      '勾錯了在那一格點回來就好',
    ],
    confirmLabel: unbooked.length ? '還是標成完成' : '標成完成',
    danger: unbooked.length > 0,
  });
  if (!ok) return;

  try {
    // 一批寫在同一個 commit 裡，所以復原是整批一起退回去
    await toast.withSaveState(() => tasksData.setDone(rows, true), {
      success: `${rows.length} 筆移到已完成`,
    });
    picked = new Set();
    followupBookings = new Map();
    await renderGroup(ctx.el, ctx.group);
  } catch {
    /* 已處理 */
  }
}

/**
 * 從「約二返」那一列跳到壓表，項目與「哪一次健檢的」都先選好。
 *
 * 要先問一次額度才知道要選哪一筆 —— 待辦身上只有那一次**健檢**的來訪 id，
 * 沒有二返那一筆額度的 id（任務刻意不存那個，見 ADR-0004 的同一條判斷：
 * 第二份資料一定會對不起來）。
 *
 * 月份用**這個月**：她約二返通常就是最近的事，而壓表那一頁的日期本來就換得動。
 */
async function bookFollowup(ctx, taskId) {
  const t = ctx.open.find((x) => x.id === taskId);
  if (!t?.customerId) return;

  let entitlementId = null;
  try {
    const [entitlements, courses] = await Promise.all([
      customersData.listEntitlements(t.customerId),
      config.listAll('courses', { includeDeleted: true }),
    ]);
    const visits = await visitsData.listByCustomer(t.customerId);
    const exam = visits.find((v) => v.id === t.visitId) ?? null;
    const coursesById = byId(courses);

    for (const pair of pairsOf(entitlements, coursesById)) {
      if (!pair.followup || !exam) continue;
      if (!(exam.slots ?? []).some((sl) => sl.entitlementId === pair.source.id)) continue;
      entitlementId = pair.followup.id;
      break;
    }
  } catch {
    // 讀不到就照樣跳過去，只是少選好那兩顆 —— 少兩下點擊，不是少一頁。
  }

  scheduleView.openFor({
    month: ctx.today.slice(0, 7),
    customerId: t.customerId,
    entitlementId,
    followupForVisitId: entitlementId ? t.visitId : null,
  });
  go('/schedule');
}

/** 勾錯了點回來。已完成那一格點一列就是這個。 */
async function untickTask(ctx, id) {
  const task = ctx.done.find((t) => t.id === id);
  if (!task) return;
  // 鏈上那兩種拿回來會收掉別的張，先問一句
  if (!(await confirmUntick(task, false))) return;
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

async function renderAsk(el, { focus = null, slide = null } = {}) {
  const today = todayISO();
  // 預設下個月：她問時間的節奏是月底那一兩個禮拜問下個月（ADR-0053）。
  // 但那是**預設不是限制** —— 客人月中打來說「我這個月 20 號之後出國」時，
  // 她要有地方記；想提早開始問十月也一樣。以前這一行是寫死的。
  askMonth ??= addMonths(today, 1).slice(0, 7);

  el.innerHTML = '<p class="muted">載入中…</p>';

  const [customers, entitlementsBy, availabilityBy, invites, responses, templates] =
    await Promise.all([
      customersData.list(),
      customersData.entitlementsByCustomer(),
      customersData.availabilityByCustomer(),
      invitesData.list(),
      // **全部回覆，含已經收下的。** 收件匣那一支濾掉了收下的那幾份，
      // 而這一頁要靠它們標出「已確認排定」（她的原話：「都不要消失」）。
      responsesData.list(),
      // 她改過的 LINE 模板（有行程內快取，讀不到就用預設值）
      config.getTemplates(),
    ]);

  const byId = Object.fromEntries(customers.map((c) => [c.id, c]));

  paintAsk({
    el, byId, invites, responses, today, focus, slide, templates,
    month: askMonth,
    rows: customersToAskForMonth({ customers, entitlementsBy, availabilityBy, month: askMonth }),
  });
}

/**
 * 三塊，而且**沒有人會憑空消失**。
 *
 * | 塊 | 是誰 | 她在那裡要做什麼 |
 * |---|---|---|
 * | 還沒發連結 | 那個月既沒有連結、也沒有時間 | 產生一條那個月的連結，或者自己去問 |
 * | 已經發出 | 那個月發過連結 | 看走到哪一步了；「已填寫時段」那幾位要去收下 |
 * | 這個月已經問到了 | 沒發連結、但那個月已經有時間 | 沒事 —— 摺疊起來，只給一個數字 |
 *
 * 第三塊是 2026-09-02 補的。整個藏掉最乾淨，但「東西不見了而畫面上什麼都沒說」
 * 是這個 app 反覆踩過的錯（ADR-0009、0053 都在講同一件事）。
 *
 * 分區的規則一條都不在這裡：全部在 `domain/availabilityForm.js` 的
 * `splitByMonth()` 與 `inviteProgress()`。
 */
function paintAsk(ctx) {
  const { el, rows, invites, responses, month, today, focus, slide } = ctx;
  const groups = splitByMonth({ rows, invites, responses, month, today });
  const label = monthLabel(`${month}-01`);

  el.innerHTML = `
    ${backLink()}
    <div class="page">
      <h1 class="page__title">問這輪的時間${tip(
        '發一條連結讓客戶自己點，或者照舊自己問、問到之後記進客戶頁的「不能的時間」。'
        + '看的是那個月問到了沒，跟他身上還剩幾次無關。')}</h1>
    </div>

    ${/* 月份切換。排版照客戶詳情的「不能的時間」（她指名的參考）：
           一條 `.section`，抬頭印月份、右邊兩顆箭頭。 */''}
    <div class="section">
      <h2 class="section__title">${esc(label)}</h2>
      <span class="section__n">${rows.length} 位客戶</span>
      ${monthNav()}
    </div>

    ${/* 換月份之後這一整塊淡入，方向跟著箭頭走 —— 那一下是在回答
           「往哪個方向走了」。只有這一塊會動，抬頭與切換器不動（ADR-0038）。 */''}
    <div class="${slide ? `monthslide--${slide}` : ''}">
    ${rows.length ? `
      <div class="seg" role="group" style="margin-bottom: var(--space-4)">
        <button class="seg__item" type="button" data-asktab="todo"
                aria-pressed="${askTab === 'todo'}">還沒發連結 ${groups.todo.length}</button>
        <button class="seg__item" type="button" data-asktab="sent"
                aria-pressed="${askTab === 'sent'}">已經發出 ${groups.sent.length}</button>
      </div>

      ${askTab === 'sent'
        ? (askSection(`${label}發出的連結`, groups.sent, ctx,
            '連結給出去了就留在這裡 —— 他填好、你收下了都不會消失，狀態寫在每一列右邊。')
          || `<p class="muted">${esc(label)}還沒發出任何連結。</p>`)
        : (askSection(`還沒發${label}的連結`, groups.todo, ctx,
            '這幾位還沒有這個月的時間，也還沒發過連結。')
          || `<p class="muted">${esc(label)}的連結都發出去了。</p>`)}

      ${doneBlock(groups.done, label)}`
      : '<p class="muted">還沒有客戶。</p>'}
    </div>`;

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

/**
 * 「這個月已經問到了」那一塊。**摺疊，只給一個數字。**
 *
 * 她自己在 LINE 問完、直接記進「不能的時間」的那幾位不屬於上面任何一格。
 * 攤開來會把真的要做的事推到看不見的地方，整個藏掉又會讓她答不出
 * 「我到底問到幾個人了」。
 */
function doneBlock(rows, label) {
  if (!rows.length) return '';

  return `
    <details class="pastavail" style="margin-top: var(--space-5)">
      <summary class="muted">${esc(label)}已經問到了 ${rows.length} 位</summary>
      ${rows.map((r) => `
        <div class="askdone">
          <span class="askdone__name">${esc(r.customerName ?? NO_NAME)}</span>
          <span class="muted num">${esc(r.collection?.collectedAt
            ? `${shortDate(r.collection.collectedAt)} 記的`
            : '不知道哪天記的')}</span>
          <a class="footlink" href="#/customers/${esc(r.customerId)}">看</a>
        </div>`).join('')}
    </details>`;
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

/**
 * 一位客戶一張卡。
 *
 * **剩幾次只是一行灰字，不是門檻**（2026-09-02）—— 她的原話是「不用看他身上
 * 還有沒有次數」。它留著是因為那是她判斷「要不要順便提醒他加購」的線索。
 */
function askCard(row, { byId, month, templates = {} }) {
  const customer = byId[row.customerId];
  const name = row.customerName ?? NO_NAME;
  const link = row.invite ? formLink(location.origin, row.invite.id) : '';
  const label = monthLabel(`${month}-01`);

  return `
    <div class="card" style="margin: 0" data-card="${esc(row.customerId)}">
      <div class="row" style="align-items: flex-start">
        <div class="row__main">
          <div class="row__title">${esc(name)}
            ${row.progress ? `<span class="badge ${
              row.progress.tone ? `badge--${row.progress.tone}` : ''
            }">${esc(row.progress.label)}</span>` : ''}
          </div>
          <div class="muted num">${esc(askWhen(row, label))}・還剩 ${row.remaining} 次</div>
        </div>
        <a class="footlink" href="#/customers/${esc(row.customerId)}">去記錄</a>
      </div>

      ${link ? `
        ${message.box({
          id: `ask-${row.customerId}`,
          text: askAvailabilityMessage(customer ?? { name }, { month, link, templates }),
          collapsed: true,
          buttonLabel: '複製 LINE 訊息',
        })}
        <p style="margin: var(--space-1) 0 0">
          <button class="btn btn--sm" type="button"
                  data-resend="${esc(row.customerId)}">重發一條新連結</button></p>`
        // 還沒產生連結就只有這一顆。訊息框要等連結出來才有意義 ——
        // 先把它畫在上面，她按完「產生」還得往下捲才找得到「複製」。
        //
        // 按鈕上要印月份：這一頁換得動月份，而「產生表單連結」五個字
        // 說不出它會產生哪一個月的。
        : `<p style="margin: var(--space-3) 0 0">
             <button class="btn btn--primary btn--wide" type="button"
                     data-makelink="${esc(row.customerId)}">產生${esc(label)}的連結</button></p>`}
    </div>`;
}

/**
 * 那一行灰字。三種列各自要講的話不一樣：
 *
 * - 發過連結的：走到哪一步了、哪天發的
 * - 還沒發的：上次是什麼時候問的（**任何月份**都算）—— 她要判斷的是
 *   「這個人我多久沒聯絡了」
 */
function askWhen(row, label) {
  if (row.progress) {
    const sent = row.invite?.sentAt ? `${shortDate(row.invite.sentAt)} 發出` : '不知道哪天發的';
    const tail = row.progress.expired ? '・連結已過期' : '';
    const at = row.progress.at && row.progress.state === 'settled'
      ? `・${shortDate(row.progress.at)} 收下`
      : '';
    return `${sent}${at}${tail}`;
  }

  if (row.state === 'never') return '從來沒問過';
  // sentAt / collectedAt 壞掉或缺了就不要編一個日期出來 —— 「不知道哪天」跟
  // 「今天」是兩件事，而她看這一行就是為了判斷「等多久了，該不該催」。
  return row.lastAskedAt
    ? `還沒問${label}・上次 ${shortDate(row.lastAskedAt)} 問的`
    : `還沒問${label}`;
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

  // 換月份。**這一顆要重新讀資料** —— 那一頁的三份都是照月份挑的
  //（`collectionFor()` 與邀請的 `month` 欄位），不像換分段是同一批資料換個分法。
  el.querySelectorAll('[data-month-step]').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      const stepped = steppedMonth(e.target, month, addMonths);
      if (!stepped) return;
      askMonth = stepped;
      renderAsk(el, { slide: stepped > month ? 'next' : 'prev' });
    }));

  // 切換**不重新讀資料**，就地重畫 —— 那幾份資料剛剛才讀過，再讀一次只是讓她等。
  el.querySelectorAll('[data-asktab]').forEach((btn) =>
    btn.addEventListener('click', () => {
      askTab = btn.dataset.asktab;
      paintAsk({ ...ctx, focus: null });
    }));

  el.querySelectorAll('[data-makelink]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const customerId = btn.dataset.makelink;
      // **`key` 不可以少。** 客戶詳情那個入口（`views/customerDetail.js`）
      // 一直都有，這一個沒有 —— 而這一個是她一輪連按十幾次的那個。
      // 連點兩下 = 客戶手上兩條連結，而一條連結只有一份答案（id 就是 token），
      // 所以他填了其中一條，另一條會永遠掛在「已發出」那一格。
      //
      // **月份帶的是她現在看的那個月**，不是寫死的下個月。
      await toast.withSaveState(
        () => invitesData.create({ customerId, customerName: nameOf(customerId), month, sentAt: today }),
        { pending: '產生中…', success: '連結好了，複製訊息貼到 LINE', key: `invite:create:${customerId}:${month}` },
      );
      askTab = 'sent';
      renderAsk(el, { focus: customerId });
    }));

  el.querySelectorAll('[data-resend]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const customerId = btn.dataset.resend;
      // **只作廢那個月的。** 她可能同時開著九月與十月兩條，重發九月那一條
      // 不該把十月那一條一起收掉 —— 客戶手上那條會突然打不開，而畫面上
      // 什麼都不會說。
      const old = invites.filter(
        (i) => i.customerId === customerId && !i.deletedAt && i.month === month,
      );

      const ok = await confirmAction({
        title: `重發一條新的${monthLabel(`${month}-01`)}連結？`,
        consequences: [
          // 逃脫由 `components/dialog.js` 負責，這裡傳純文字就好
          `${nameOf(customerId)}手上那條連結會作廢`,
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
  const [pending, settings, courses, equipment, ivProducts, playbooks, templates, customers] =
    await Promise.all([
    visitsData.listByStatus('pending_confirm'),
    config.getSettings(),
    config.listAll('courses', { includeDeleted: true }),
    // 貼給客戶那一句只講**課程**（`復能`、`靜脈雷射`，ADR-0077），
    // 但「跟客人確認時間」那一排丸子印的是那天做了什麼（`SIS(60)`），
    // 而那一半是從器材主檔來的。
    config.listAll('equipment', { includeDeleted: true }),
    // 那一排丸子上營養點滴印的是**品項**（2026-09-08，`slotName()`）
    config.listAll('ivProducts', { includeDeleted: true }),
    // 備忘錄的「事前」那一節（ADR-0067）。**這一頁是「飯後打針」真正該出現
    // 的地方** —— 她按下那一列的時候，正在打那則訊息。
    // 讀不到就不畫那一塊，跟這一頁其他幾份補資料同一個判斷。
    playbooksData.list().catch(() => []),
    // 她改過的 LINE 模板。有行程內快取，所以一個 session 只真的讀一次；
    // 讀不到就用預設值（`config.getTemplates()` 自己吞掉錯誤）。
    config.getTemplates(),
    // 掛合作機構的那幾份備忘錄要靠客戶身上的標記（ADR-0076）。
    // 讀不到就只浮課程配到的那幾份。
    customersData.list().catch(() => []),
  ]);
  const today = todayISO();
  paintConfirm({
    el,
    pending: visitsToConfirm(pending, today),
    settings,
    today,
    playbooks,
    master: { courses, equipment, ivProducts },
    customersById: Object.fromEntries(customers.map((c) => [c.id, c])),
    templates,
    coursesById: Object.fromEntries(courses.map((c) => [c.id, c])),
  });
}

function paintConfirm(ctx) {
  const { el, pending, settings, today, playbooks, templates, master, customersById } = ctx;
  // 一段還沒問過的都沒有的那一位不列（ADR-0097）。`visitsToConfirm()` 讀的是
  // 整筆那一格，而它是**推導出來又存起來的** —— 對不起來的舊資料會在這裡
  // 變成一張「壓了 0 段」的空卡。那種資料由資料健檢的「整筆的狀態跟時段
  // 對不起來」那一列負責，不是這一頁。
  const groups = [...byCustomer(pending).entries()]
    .filter(([, visits]) => visits.some((v) => pendingSlotsOf(v).length));
  const noReplyDays = settings.noReplyDays ?? 3;

  el.innerHTML = `
    ${backLink()}
    <div class="page">
      <h1 class="page__title">跟客人確認時間${tip('問完回來按打勾。')}</h1>
      ${/* 數字是資料不是說明，留在畫面上（`tests/fewer-words.test.js` 的判準）。 */''}
      <p class="page__lead num">壓好了、還沒問過本人的有 ${groups.length} 位。</p>
    </div>

    ${groups.length ? `
      <div class="stack">
        ${groups.map(([id, visits]) => confirmCard(
          id, visits, today, noReplyDays, playbooks ?? [], templates ?? {}, master ?? {},
          customersById?.[id] ?? null,
        )).join('')}
      </div>`
      : '<p class="muted">都問過了。</p>'}

    ${drawer ? drawerHtml(ctx) : ''}`;

  wireConfirm(ctx);
}

function confirmCard(
  customerId, visits, today, noReplyDays,
  playbooks = [], templates = {}, master = {}, customer = null,
) {
  const name = visits[0].customerName ?? '（沒有名字）';
  const state = waitState(visits, today, noReplyDays);
  // **只算還沒問過的那幾段**（ADR-0097）。她在日曆上確認掉的那一段從這一頁收掉，
  // 而那一天照樣留著 —— 另一段還沒問。
  const pending = visits.map(asPending).filter((v) => (v.slots ?? []).length);
  const slots = pending.flatMap((v) => v.slots ?? []);

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
        ${pending.map((v) => `
          <span class="badge"><span class="num">${esc(shortDate(v.date))}</span>&nbsp;${
            esc(visitCourseLabel(v, master))}</span>`).join('')}
      </div>

      ${/* 擺在那一句話與訊息範本中間：她的動線是
             「看一眼要提醒什麼 → 打字 → 送出」。 */''}
      ${hintForVisits({ playbooks, visits, customer })}

      ${followupForm(customerId, name, state.note)}

      ${message.box({
        id: customerId,
        // 貼給客人的那一句也只講還沒問的那幾段 —— 已經談定的再問一次，
        // 客人會以為她記錯了。
        text: confirmMessage({ name }, pending, { templates, master }),
        collapsed: true,
        buttonLabel: '複製 LINE 確認訊息',
      })}
    </div>`;
}

/**
 * 「問過了，在等」那一句。
 *
 * 寫完那一列看得出問過了：卡片換一個底、天數改成從問的那天算。
 * **但它還在清單上** —— 事情還沒完，移走就等於忘記。
 *
 * ## 2026-09-09：收進一顆夾板後面
 *
 * 她：「一樣，有需要的時候點一個 icon 或是什麼再展開填就好，不然感覺會很占版面。」
 *
 * **這推翻了它原本的理由**，而原本那個理由是她自己給的（2026-08 那一輪）：
 * 「直接是一個輸入框，不是一顆『加備註』按鈕 —— 她人在 LINE 裡，多一次點擊
 * 就會變成『算了等一下再記』，然後就忘了。」
 *
 * 兩件事都成立，差別是**現在這一列上有幾樣東西**：那時候一列只有名字與天數，
 * 現在還有課程、段數與那幾顆動作。她看到的是一頁二十列各帶一個空輸入框。
 *
 * 展開的行為與那一句話的樣子跟時段那一句**共用同一支**
 * （`ui/components/slotNote.js`）—— 兩份的話遲早有一邊忘了改 `aria-expanded`。
 *
 * **這一句仍然是整天的**（`visit.followupNote`，一位客戶好幾天共用一句），
 * 跟時段身上那一句（ADR-0084）是兩回事：這一句記的是「這通電話追到哪了」，
 * 而電話一天打一通。
 */
function followupForm(customerId, name, note) {
  return `
    <div class="fnote">
      ${slotNote.toggle({ name: `fnote-${customerId}`, on: Boolean(String(note ?? '').trim()) })}
      ${slotNote.disclosure({
        name: `fnote-${customerId}`,
        peek: note ?? '',
        body: `
          <form class="slotnote__box fnote__form" data-followup="${esc(customerId)}" hidden>
            <input type="text" name="text" maxlength="${NOTE_MAX}" value="${esc(note ?? '')}"
                   placeholder="問了還沒回？記一句…"
                   aria-label="${esc(name)}・問過了要記的一句話" />
            <button class="btn" type="submit">${note ? '改' : '記'}</button>
          </form>`,
      })}
    </div>`;
}

/**
 * 確認畫面。把這個人還沒問過的時段攤開，逐段按 ✓（可以）或 ✗（不行）。
 *
 * 不做整批一次確認 —— 客人常常是「這兩天可以、那天不行」，整批只能全對或全錯，
 * 等於逼她重壓。
 *
 * **預設兩顆都沒按 = 還沒回**（她 2026-09-24：「能不能預設還沒回，然後可以的選勾，
 * 不能的選叉之類的」，ADR-0110）。沒按的那幾段一個字都不動、那一位留在清單上 ——
 * 「先同意其中一項，其他先不確定」。以前預設全部「可以」、一按就是全部。
 */
function drawerHtml(ctx) {
  const visits = byCustomer(ctx.pending).get(drawer.customerId) ?? [];
  const name = visits[0]?.customerName ?? '';
  // **只列還沒問過的那幾段**（ADR-0097）。`key` 裡的數字是**原本那個陣列**的
  // 索引，不是列出來的第幾列 —— `applyConfirm()` 拿它去組 `applyConfirmation()`
  // 的 `asked` 與 `rejected`，重編號的話她按「不行」的會是別段。
  const rows = confirmRows(visits);
  const ok = rows.filter((r) => drawer.picks.get(r.key) === true).length;
  const no = rows.filter((r) => drawer.picks.get(r.key) === false).length;
  const note = followupNoteOf(visits);

  return `
    <div class="drawer-backdrop" data-backdrop>
      <div class="drawer" role="dialog" aria-modal="true" aria-label="確認 ${esc(name)} 的時段">
        <button class="drawer__grip" type="button" data-close-drawer aria-label="關閉"></button>
        <div class="drawer__head row" style="align-items: center">
          <h2 class="drawer__title row__main">${esc(name)} 的 ${rows.length} 段${tip(
            '確認之後會自動排進日曆，並且產生該做的登記。')}</h2>
          ${pickAllButton(rows.length)}
        </div>
        ${note
          // 這一張面板蓋住了底下那張卡，她自己寫的那一句要跟著進來，
          // 否則「上次問到哪」在最需要它的那一刻反而看不到。
          ? `<p class="card__asked" style="margin-top: 0">上次問過：${esc(note)}</p>`
          : ''}
        ${/* 「哪一段客人說不行就點它一下」2026-09-24 拿掉了：每一段兩顆圖示按鈕自己講完了
               （她：「不用說明」），而底下那顆按鈕的字講會發生什麼（ADR-0110）。 */''}

        <div class="drawer__body">
        ${rows.map((r) => pickRow({
          key: r.key,
          when: `${shortDate(r.visit.date)} ${timeLabel(r.slot)}`,
          what: slotName(r.slot, ctx.master, 'short'),
          note: r.visit.note ? `<span class="muted dim">備註：${esc(r.visit.note)}</span>` : '',
          pick: drawer.picks.get(r.key),
          yes: '可以',
          no: '不行',
        })).join('')}
        </div>

        <div class="drawer__actions">
          <button class="btn btn--primary" type="button" data-apply ${ok || no ? '' : 'disabled'}>
            ${confirmLabel(ok, no, rows.length)}</button>
          <button class="btn" type="button" data-close-drawer>先不要，回去</button>
        </div>
      </div>
    </div>`;
}

/** 抽屜上那幾列：這位客戶每一天還沒問過的那幾段。`key` 是 `來訪 id:原本的索引`。 */
function confirmRows(visits) {
  return visits.flatMap((v) =>
    pendingSlotsOf(v).map(({ slot, index }) => ({ visit: v, slot, index, key: `${v.id}:${index}` })),
  );
}

/**
 * 那一顆按鈕講會發生什麼。**只有 ✗ 時講實話：這是取消**（標成取消、長「取消 Abovee」）——
 * prelaunch-audit-2026-09-23/issues/12：以前寫「全部退回未確認」，讀起來像「先放回去之後再問」。
 */
function confirmLabel(ok, no, total) {
  if (ok && no) return `確認 ${ok} 段・取消 ${no} 段`;
  if (ok) return `確認 ${ok} 段`;
  if (no) return `${no === total ? '客人都不行' : '客人不行'}，取消這 ${no} 段`;
  return '確認';
}

function wireConfirm(ctx) {
  const { el } = ctx;

  message.wire(el, toast.info);

  el.querySelectorAll('[data-open]').forEach((btn) =>
    btn.addEventListener('click', () => {
      // shown：進場動畫播過了沒（見 `mountDrawerGesture()`）
      drawer = { customerId: btn.dataset.open, picks: new Map(), shown: false };
      paintConfirm(ctx);
    }),
  );

  wirePicks(el, {
    parse: (key) => key,
    keys: () => confirmRows(byCustomer(ctx.pending).get(drawer.customerId) ?? []).map((r) => r.key),
    repaint: () => paintConfirm(ctx),
  });

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
  mountDrawerGesture(el, close);

  el.querySelectorAll('[data-followup]').forEach((form) =>
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      saveFollowupNote(ctx, form.dataset.followup, form.querySelector('[name=text]').value);
    }),
  );

  // 展開那一句話。這一塊每次重畫都換掉整個 `el` 底下的內容，所以不必給 signal。
  slotNote.wire(el);

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
 * - 按了 ✗ 的那幾段 → 標成取消（ADR-0081），**時段留著不刪** ——
 *   當初壓了什麼是要留下來的紀錄，而且 Rules 也不收沒有時段的來訪。
 *   一整天都被取消 → 那一筆推成 cancelled。任務會跟著收（`domain/taskRules.js`）。
 * - 按了 ✓ 的那幾段 → 已確認，掛號那一族這時候才長。
 * - **沒按的那幾段一個字都不動**（還沒回，ADR-0110）—— 那一天留在清單上。
 * - 只有 ✗、沒有 ✓ → 全部是取消，而且給不出復原，所以先問一次。
 */
async function applyConfirm(ctx) {
  const visits = byCustomer(ctx.pending).get(drawer.customerId) ?? [];
  const picks = drawer.picks;
  // 有按的那幾段（`asked`）與按了 ✗ 的那幾段（`rejected`）。key 是 `來訪 id:原本的索引`
  const asked = new Set(picks.keys());
  const rejected = new Set([...picks].filter(([, yes]) => yes === false).map(([key]) => key));
  if (!asked.size) return;
  const at = new Date().toISOString();

  // 每一天這一次問到的是哪幾段（原本的索引）
  const askedIn = (v) => pendingSlotsOf(v).map(({ index }) => index).filter((i) => asked.has(`${v.id}:${i}`));

  // **一段 ✓ 都沒有就是取消**（不是退回待確認），而這一下給不出復原（`undoable: false`）——
  // 先問一次（prelaunch-audit-2026-09-23/issues/12）。後果走 `cancelConsequences()`，
  // 同批次取消那一頁的作法（逐筆算完去重），不在這裡另寫一份（ADR-0070）。
  if (asked.size === rejected.size) {
    const said = new Set();
    for (const v of visits) {
      const mine = askedIn(v);
      if (!mine.length) continue;
      // 讀不到任務就少講那幾句，不擋（同日曆的取消那一道）
      const tasks = await tasksData.listByVisitForSync(v.id).catch(() => []);
      const lines = cancelConsequences({
        visit: v, coursesById: ctx.coursesById ?? {}, tasks, slotIndex: mine,
        sheetSyncOn: isConfigured(ctx.settings),
      });
      for (const line of lines) said.add(line);
    }
    const ok = await confirmAction({
      title: `客人不行，取消這 ${rejected.size} 段？`,
      consequences: [...said],
      confirmLabel: `取消這 ${rejected.size} 段`,
      danger: true,
    });
    if (!ok) return;
  }

  let customerVisits = await visitsData.listByCustomer(drawer.customerId);

  // 規則在 `domain/visits.js` 的 `applyConfirmation()`（SPEC 第 10 節）。
  // 這裡只把畫面上的 key（`v.id:i`）換成那一筆自己的段落編號。
  //
  // **客人說不行的那一段標成取消，不是從陣列裡刪掉**（ADR-0081）——
  // 刪掉的話沒有紀錄它曾經被壓過，也不會長出「取消 Abovee」，
  // 而她真的在 Abovee 上壓過那一格。
  //
  // **套在剛讀回來的那一份上**（prelaunch-audit-2026-09-23/issues/19），而且只動她按了的
  // 那幾段 —— 沒按的、另一台在抽屜打開之後接在尾巴的都不動。她按了的有一段在新的那一份裡
  // 已經不是待確認（別的地方談定或取消了），整張抽屜就是舊的：不寫，重畫。
  const writes = [];
  const touched = [];
  for (const v of visits) {
    const mine = askedIn(v);
    if (!mine.length) continue;
    const fresh = customerVisits.find((x) => x.id === v.id);
    if (!fresh || mine.some((i) => !fresh.slots?.[i]
        || slotStatus(fresh, fresh.slots[i]) !== 'pending_confirm')) {
      toast.info('這幾段剛剛在別的地方改過了，換成最新的樣子');
      drawer = null;
      await renderConfirm(ctx.el);
      return;
    }
    touched.push(v);
    writes.push(applyConfirmation(
      fresh,
      new Set(mine.filter((i) => rejected.has(`${v.id}:${i}`))),
      at,
      new Set(mine),
    ));
  }

  // 畫面上要講的話在寫入之前先算好 —— 存完之後 `visits` 已經不在待確認清單裡了。
  // **兩支收的都是寫入之前的那幾筆**，而且只講她按了的那幾段（ADR-0097、0110）：
  // 早上那一段在日曆上早就談定時，它的登記早就長了，不可以再說一次「會多一張」；
  // 還沒回的那幾段也還不會長。
  const summary = describeConfirmed(visits, rejected, asked);
  // 「待辦會多一張 Examine」要跟真的會長的那一張對得上（ADR-0070）—— 掛號逐段長，
  // 早就掛過的段不再多講，所以要那幾筆身上的任務（讀不到就當沒有，只會多講一句）
  const tasksByVisit = Object.fromEntries(await Promise.all(touched.map(async (v) => [
    v.id, await tasksData.listByVisitForSync(v.id).catch(() => []),
  ])));
  const said = confirmConsequences(
    touched,
    ctx.coursesById ?? {},
    isConfigured(ctx.settings),
    rejected,
    tasksByVisit,
    asked,
  );

  // 存好的那幾筆，重試時跳過（`saveEach()`，issues/18）
  const saved = new Set();
  try {
    await toast.withSaveState(
      // **存完一筆就把它換進手上那一份**（同 `bulkCancel.js`）：下一筆算次數讀的就是它。
      // 不換的話，先存的那一天被退掉時，存第二天看到的第一天還佔著一次，
      // 錯的數字就寫回額度上（prelaunch-audit-2026-09-23/issues/03）。
      () => saveEach(writes, async (v) => {
        await visitsData.save(v, customerVisits);
        customerVisits = [...customerVisits.filter((x) => x.id !== v.id), v];
      }, saved),
      {
        success: summary.rows.length
          ? (summary.waiting ? `確認了，還有 ${summary.waiting} 段還沒回` : '確認了，已排進日曆')
          : '記好了，客人說不行的那幾段已經取消',
        // 跨多個 commit 的動作給不出正確的復原（見 data/repo.js 的 withUndo）
        undoable: false,
        // **這一顆特別需要 key。** 上面那段註解自己寫著「這是這條動線唯一一次
        // 不可逆的寫入」，而它沒有二次確認框擋著，又是一個 for 迴圈一筆一筆存 ——
        // 連點兩下等於整批各存兩次，中間那幾筆的登記任務會長出兩份。
        key: `confirm:${drawer.customerId}`,
      },
    );
    drawer = null;
    await renderConfirm(ctx.el);
    showConfirmed(summary, said, ctx.master);
  } catch {
    /* 已處理 */
  }
}

/**
 * 加進日曆之後那張置中的卡片。
 *
 * 右下角那條 toast 只說得出「已排進日曆」，而她剛剛才逐段按了 ✓ 與 ✗ ——
 * **這是這條動線唯一一次不可逆的寫入**（狀態轉 confirmed、登記任務長出來），
 * 所以最後成立的是哪幾段要攤開來看得見。她的原話是「簡潔的說，誰，幾月幾號
 * 幾點做什麼，加入日曆」。
 *
 * 走既有的 `openCard()`，不新開一種浮層 —— 這個 app 的浮層已經有三種了
 *（抽屜、卡片、對話框，ADR-0048）。
 */
function showConfirmed(summary, said = [], master = {}) {
  if (!summary.rows.length) return; // 只有取消，toast 那一句已經講完了

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
            <span class="muted">${esc(slotName(r.slot, master, 'short'))}</span></span></li>`).join('')}
      </ul>
      ${said.length ? `
        <ul class="dialog__list" style="margin: var(--space-3) 0 0">
          ${said.map((line) => `<li>${esc(line)}</li>`).join('')}
        </ul>` : ''}
      ${summary.rejected
        ? `<p class="muted" style="margin: var(--space-3) 0 0">
             取消 ${summary.rejected} 段（客人說不行）。那幾段的時間已經還回去了。</p>`
        : ''}
      ${summary.waiting
        ? `<p class="muted" style="margin: var(--space-3) 0 0">
             還有 ${summary.waiting} 段還沒回，留在清單上。</p>`
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
  const [unclosed, courses, equipment, ivProducts, settings] = await Promise.all([
    visitsData.listUnclosed(today),
    // 含已刪除的：她停用一個課程，那幾筆還沒結案的來訪照樣要問得出「要不要簽單」
    config.listAll('courses', { includeDeleted: true }),
    // 那幾排丸子印的是「那天做了什麼」（`SIS(30)`、`雪`）——
    // 只讀課程的話卡片上會寫「復能」，而月曆上同一段寫的是 SIS(30)（ADR-0078）
    config.listAll('equipment', { includeDeleted: true }),
    config.listAll('ivProducts', { includeDeleted: true }),
    config.getSettings(),
  ]);
  paintClose({
    el,
    rows: visitsToClose(unclosed, today),
    coursesById: Object.fromEntries(courses.map((c) => [c.id, c])),
    master: { courses, equipment, ivProducts },
    today,
    settings,
    // 「這一筆會不會長出『追蹤健檢報告』」要問額度（`pairsOf()`）。
    // 開啟抽屜時才讀那一位的 —— 這一頁上可能有十幾筆，全部先讀是白費的。
    entitlements: [],
  });
}

function paintClose(ctx) {
  const { el, rows, coursesById, master, today } = ctx;

  // 「天」不是「筆」（ADR-0087）。後半句收進 `?`（她 2026-09-24：「太占版面了」）——
  // 數字是資料，留在畫面上。
  el.innerHTML = `
    ${backLink()}
    <div class="page">
      <h1 class="page__title">簽療程單${tip('客人來了、療程單簽了就打勾，沒來就打叉 —— 次數是這時候才扣的。')}</h1>
      <p class="page__lead num">${rows.length ? `還有 ${rows.length} 天沒結案。` : '都結案了。'}</p>
    </div>

    ${rows.length
      ? `<div class="stack">${
        rows.map((v) => closeRow(v, coursesById, today, master)).join('')}</div>`
      : ''}

    ${drawer ? closeDrawerHtml(ctx) : ''}`;

  wireClose(ctx);
}

/**
 * 這一筆來訪**還開著的那幾段**裡（`slotsToClose()`，ADR-0110），哪幾段要標「不用簽療程單」
 * （目前只有二返）。
 *
 * **反過來標的理由**：一整天四段裡通常四段都要簽，四顆標記等於沒有標記；
 * 真正要她看到的是「這一段是例外」。
 *
 * **全部都不用簽時回空的** —— 那時候底下那一句已經講完了（「不用簽療程單 ——
 * 來了就打勾」），逐段再標一次是同一件事講兩遍。卡片與收尾抽屜共用這一支，
 * 兩邊各寫一次的話遲早有一邊忘了那個例外。
 *
 * 只看還開著的段：取消的、已經結案的不在這一頁上（她 2026-09-24：「已經取消的還可以簽療程單?」）。
 */
function formMarks(visit, coursesById) {
  const open = slotsToClose(visit).map(({ index }) => index);
  const need = new Set(formSlotIndexes(visit, coursesById));
  const skip = open.filter((i) => !need.has(i));
  return {
    /** 要標「不用簽」的那幾段 */
    mark: new Set(skip.length === open.length ? [] : skip),
    /** 開著的每一段都不用簽 */
    none: skip.length === open.length,
    /** 要簽的有幾段 */
    count: open.length - skip.length,
  };
}

function closeRow(visit, coursesById, today, master = {}) {
  const late = daysBetween(visit.date, today);
  // **只列還開著的段**（ADR-0110）。取消的、已經結案的一段都不列 —— 以前全部列出來，
  // 抽屜上預設「做了」，按下去未到那段被蓋成已完成
  const open = slotsToClose(visit);
  const form = formMarks(visit, coursesById);
  // 那一段到現在還是「待確認」：那天過了，來了就打勾、沒來就打叉。
  // 2026-09-24 收進「請客人簽療程單」旁邊的 `?`（她：「這一大段話就可以用tooltip放在
  // 請客人簽療程單的旁邊，不然太占版面了」）。問的是**還開著的那幾段**，不是整筆
  const unasked = open.some(({ slot }) => slotStatus(visit, slot) === 'pending_confirm');

  return `
    <div class="card" style="margin: 0">
      <div class="row" style="align-items: flex-start">
        <div class="row__main">
          <div class="row__title">${esc(visit.customerName ?? '（沒有名字）')}</div>
          <div class="muted num">${esc(shortDate(visit.date))}・${open.length} 段${
            late > 0 ? `・過了 ${late} 天` : ''}</div>
        </div>
        <button class="fab__main" type="button" data-open="${esc(visit.id)}"
                style="width: 46px; height: 46px"
                aria-label="${esc(visit.customerName ?? '')}・結案">
          ${icon('check', { size: 22, width: 2.6 })}
        </button>
      </div>

      <div class="chips" style="margin-top: var(--space-3)">
        ${open.map(({ slot: sl, index: i }) => `<span class="badge num">${esc(timeLabel(sl))}　${
          esc(slotName(sl, master, 'short'))}${
          form.mark.has(i) ? '<span class="badge__aside">不用簽</span>' : ''}</span>`).join('')}
      </div>

      <p class="card__note" style="margin-top: var(--space-2)">${form.none
        ? '不用簽療程單 —— 來了就打勾'
        : `請客人簽療程單（${form.count} 段）`}${unasked
        ? tip(`有幾段到現在還是「${describeStatus('pending_confirm')}」—— 那天過了，來了就打勾、沒來就打叉。`)
        : ''}</p>
    </div>`;
}

/**
 * 收尾畫面。把那一天**還開著的那幾段**攤開，逐段按 ✓（做了）或 ✗（沒來）。
 *
 * **預設兩顆都沒按 = 先不結**（她 2026-09-24：「預設先不結做了打勾未到打叉之類的，
 * 可以用可愛的icon之類的不用說明」，ADR-0110）。沒按的那一段一個字都不動、
 * 那一天留在清單上等她下次再來。以前預設全部「做了」而且一按就是整天。
 *
 * 上面那一顆「全部 ✓」是十次有九次的那條路（整天照排的做完了）——
 * 預設改成先不結之後，不留它的話一天四段要點四下。
 */
function closeDrawerHtml(ctx) {
  const visit = ctx.rows.find((v) => v.id === drawer.visitId);
  if (!visit) return '';

  const open = slotsToClose(visit);
  const form = formMarks(visit, ctx.coursesById);
  const picks = picksOf(visit);
  const done = picks.filter((p) => p === true).length;
  const missed = picks.filter((p) => p === false).length;

  return `
    <div class="drawer-backdrop" data-backdrop>
      <div class="drawer" role="dialog" aria-modal="true"
           aria-label="替 ${esc(visit.customerName ?? '')} 結案">
        <button class="drawer__grip" type="button" data-close-drawer aria-label="關閉"></button>
        <div class="drawer__head row" style="align-items: center">
          <h2 class="drawer__title row__main">${esc(visit.customerName ?? '')}・${esc(shortDate(visit.date))}</h2>
          ${pickAllButton(open.length)}
        </div>

        <div class="drawer__body">
          ${open.map(({ slot: sl, index: i }) => pickRow({
            key: String(i),
            when: timeLabel(sl),
            what: slotName(sl, ctx.master, 'short'),
            aside: form.mark.has(i) ? '<span class="slotrow__form">不用簽療程單</span>' : '',
            pick: drawer.picks.get(i),
            yes: '做了',
            no: '沒來',
          })).join('')}

          ${visit.note ? `<p class="card__note" style="margin-top: var(--space-3)">
            壓表時記的：${esc(visit.note)}</p>` : ''}
        </div>

        ${done || missed ? `
          <ul class="dialog__list" style="margin: var(--space-3) var(--gutter) 0">
            ${closeConsequences({
              visit,
              picks,
              entitlements: ctx.entitlements ?? [],
              coursesById: ctx.coursesById,
              sheetSyncOn: isConfigured(ctx.settings),
            }).map((line) => `<li>${esc(line)}</li>`).join('')}
          </ul>` : ''}

        <div class="drawer__actions">
          <button class="btn btn--primary" type="button" data-apply ${done || missed ? '' : 'disabled'}>
            ${['記下來', done ? `${done} 段做了` : '', missed ? `${missed} 段沒來` : '']
              .filter(Boolean).join('・')}</button>
          <button class="btn" type="button" data-close-drawer>先不要，回去</button>
        </div>
      </div>
    </div>`;
}

/** 「全部 ✓」。只有一段時不畫 —— 那一顆就是那一段的 ✓。兩張抽屜共用。 */
function pickAllButton(n) {
  return n > 1
    ? `<button class="btn btn--sm" type="button" data-pick-all>全部 ${
      icon('check', { size: 14, width: 3 })}</button>`
    : '';
}

/**
 * 抽屜上逐段的那一列：左邊時間與項目，右邊 ✓／✗ 兩顆。**兩張抽屜共用**（確認、收尾）——
 * 各畫一份的話遲早有一邊的 `aria-pressed` 或觸控區不一樣。
 *
 * `key` 講的是**原本那一格**，不是畫出來的第幾列（同 `slotsToClose()` 與 `pendingSlotsOf()`
 * 的規矩：重編號的話會記到別段）。收尾抽屜一天一筆，所以是索引；確認抽屜一位客戶好幾天，
 * 所以是 `來訪 id:第幾段`。
 */
function pickRow({ key, when, what, aside = '', note = '', pick, yes, no }) {
  const state = pick === true ? 'slotrow--yes' : pick === false ? 'slotrow--no' : '';
  return `
    <div class="slotrow slotrow--pick ${state}">
      <span class="slotrow__main">
        <span class="slotrow__when">${esc(when)}</span>
        <span class="slotrow__what">${esc(what)}${aside}</span>
        ${note}
      </span>
      <span class="slotpick">
        <button class="slotpick__btn slotpick__btn--yes" type="button" data-pick="${esc(key)}" data-to="1"
                aria-pressed="${pick === true}" aria-label="${esc(`${when} ${what}・${yes}`)}">
          ${icon('check', { size: 20, width: 3 })}</button>
        <button class="slotpick__btn slotpick__btn--no" type="button" data-pick="${esc(key)}" data-to="0"
                aria-pressed="${pick === false}" aria-label="${esc(`${when} ${what}・${no}`)}">
          ${icon('close', { size: 18, width: 3 })}</button>
      </span>
    </div>`;
}

/** 按一下：換成那一邊；再按同一顆：回到還沒決定。兩張抽屜共用。 */
function togglePick(picks, key, want) {
  if (picks.get(key) === want) picks.delete(key);
  else picks.set(key, want);
}

/**
 * ✓／✗ 與「全部 ✓」的接線。**兩張抽屜共用**，差別只有鍵長什麼樣（收尾是索引、確認是
 * `來訪 id:索引`）、全部有哪幾個鍵、按完重畫哪一頁。
 */
function wirePicks(el, { parse, keys, repaint }) {
  el.querySelectorAll('[data-pick]').forEach((btn) =>
    btn.addEventListener('click', () => {
      togglePick(drawer.picks, parse(btn.dataset.pick), btn.dataset.to === '1');
      repaint();
    }),
  );
  el.querySelector('[data-pick-all]')?.addEventListener('click', () => {
    for (const key of keys()) drawer.picks.set(key, true);
    repaint();
  });
}

/** 抽屜上按了什麼 → `closeVisit()` 收的那一份（逐段 `true`／`false`／`null`）。 */
function picksOf(visit) {
  return (visit?.slots ?? []).map((_, i) => (drawer?.picks?.has(i) ? drawer.picks.get(i) : null));
}

function wireClose(ctx) {
  const { el } = ctx;

  el.querySelectorAll('[data-open]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      // shown：進場動畫播過了沒（見 `mountDrawerGesture()`）
      drawer = { visitId: btn.dataset.open, picks: new Map(), shown: false };
      paintClose(ctx);

      // 那一句「會多一張追蹤健檢報告」要問額度。**先畫再補** —— 同
      // `loadTaskVisits()` 的作法：不要為了一句話讓抽屜多等一輪。
      const visit = ctx.rows.find((v) => v.id === drawer?.visitId);
      if (!visit?.customerId || ctx.entitlements?.length) return;
      try {
        ctx.entitlements = await customersData.listEntitlements(visit.customerId);
      } catch {
        return; // 讀不到就少一句話，不是少一頁
      }
      if (drawer?.visitId === visit.id) paintClose(ctx);
    }),
  );

  wirePicks(el, {
    parse: Number,
    keys: () => slotsToClose(ctx.rows.find((v) => v.id === drawer?.visitId)).map(({ index }) => index),
    repaint: () => paintClose(ctx),
  });

  const close = () => {
    drawer = null;
    // 換一位客戶時不要沿用上一位的額度 —— 那會讓「會多一張追蹤健檢報告」
    // 出現在一個根本沒買健檢的人身上。
    ctx.entitlements = [];
    paintClose(ctx);
  };
  el.querySelectorAll('[data-close-drawer]').forEach((b) => b.addEventListener('click', close));
  el.querySelector('[data-backdrop]')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) close();
  });

  // 手勢跟全站一樣 —— 只有一張拖不動的話，她會以為那張壞了
  mountDrawerGesture(el, close);

  el.querySelector('[data-apply]')?.addEventListener('click', () => applyClose(ctx));
}

/**
 * 結案。一次只動一筆來訪，所以是單一個 commit —— 復原退得回去。
 *
 * 規則本身在 `domain/visits.js` 的 `closeVisit()`，這裡只負責把畫面上按了什麼
 * 翻成逐段的 `true`／`false`／`null`（先不結）。
 */
async function applyClose(ctx) {
  const visit = ctx.rows.find((v) => v.id === drawer.visitId);
  if (!visit || !drawer.picks.size) return;

  const customerVisits = await visitsData.listByCustomer(visit.customerId);
  // **套在剛讀回來的那一份上**（prelaunch-audit-2026-09-23/issues/19）。她按了的那幾段
  // 在別的地方已經結案或取消了 —— 這張抽屜就是舊的：不寫，重畫。沒按的段、別台剛接上的段
  // 本來就不會被動到（`closeVisit()` 只動 true／false）。
  const fresh = customerVisits.find((v) => v.id === visit.id);
  const stillOpen = new Set(slotsToClose(fresh).map(({ index }) => index));
  if (!fresh || [...drawer.picks.keys()].some((i) => !stillOpen.has(i))) {
    toast.info('這一天剛剛在別的地方改過了，換成最新的樣子');
    drawer = null;
    await renderClose(ctx.el);
    return;
  }
  const next = closeVisit(fresh, picksOf(fresh));
  const left = slotsToClose(next).length;
  // 講**這一次**扣了幾次 —— 整筆推成已完成不代表這一次有扣（前面那段早就做完、這一次只按了 ✗）
  const did = [...drawer.picks.values()].filter(Boolean).length;

  try {
    // 結案就是扣次數的那一下，做兩次會多扣一次
    await toast.withSaveState(() => visitsData.save(next, customerVisits), {
      success: [
        did ? `記好了，扣掉 ${did} 次` : '記好了，沒來的不扣次數',
        left ? `還有 ${left} 段留著` : '',
      ].filter(Boolean).join('，'),
      key: `visit:save:${next.id}`,
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
  const [rows, clinicalFlags] = await Promise.all([
    loadBookRows(today),
    config.listAll('clinicalFlags'),
  ]);

  // 姓名底下那一排要畫哪幾個字：警示那一層（ADR-0074）。
  // **算一次就好** —— 二十幾張卡各算一次是白費的。
  const alerts = clinicalTerms(clinicalFlags);

  const section = (system, title, note) => {
    const mine = rows.filter((r) => r.systems.some((x) => x.system === system));
    if (!mine.length) return '';
    return `
      <section class="card">
        <h2 class="card__title">${esc(title)}<span class="muted"> ${mine.length}</span></h2>
        <p class="card__note">${esc(note)}</p>
        <div class="groups" style="margin-top: var(--space-3)">
          ${mine.map((r) => bookRow(r, system, alerts, clinicalFlags)).join('')}
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
function bookRow(row, system, alerts, clinicalRows) {
  const pools = row.systems.find((x) => x.system === system)?.pools ?? [];

  return `
    <button class="grouprow" type="button" data-book-who="${esc(row.customerId)}">
      <span class="grouprow__main">
        <span class="grouprow__label" style="display: block">${esc(row.customerName ?? '（沒有名字）')}</span>
        ${flagsUi.alertChips({ flags: row.flags ?? [], alerts, rows: clinicalRows })}
        ${flagsUi.partnerChips(row.partners ?? [])}
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

    <div class="notelist" data-notes>
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

  wireNoteLongPress(el, notes, () => renderNotes(el));
  wireQuickCapture({ el, render: renderNotes });
}

/**
 * 勾掉／拿回來。**勾掉的不會消失**，它劃掉之後沉到「已完成」那一格
 * （`sortNotes()` 早就這樣排了，只是 data 層一直沒把它們撈回來）。
 *
 * **走 `note.prepareToggle()`，跟另外三個入口同一支。** 這一頁曾經直接呼叫
 * `notesData.setDone()`，於是從這裡勾掉營養品的提醒不會問「給了哪些」——
 * 那筆要進試算表的交付紀錄靜靜地沒了，而她再按一下「清掉這 N 筆已完成的」，
 * 連提醒本身都不見（`ui/components/note.js` 的檔頭寫的正是這一種）。
 */
async function tickNote(el, notes, id) {
  const n = notes.find((x) => x.id === id);
  if (!n) return;

  // 問話刻意在 withSaveState 外面：包進去的話她按了「先不要」也會跳一句
  // 「勾掉了」，而那是在說一件沒有發生的事。
  const plan = await note.prepareToggle(n, noteDeps());
  if (!plan) return;

  try {
    await toast.withSaveState(plan.run, { success: plan.success });
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

// 「還沒問過的那幾段」（`pendingSlotsOf()`／`asPending()`）搬到 `domain/visits.js`：
// 客戶詳情的 LINE 訊息問的是同一件事（`.scratch/asks-2026-09-24/issues/12`）。

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
