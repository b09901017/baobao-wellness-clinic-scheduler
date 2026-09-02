// 壓表模式。SPEC 第 8.2 節、ADR-0014。核心畫面。
//
// **一批是一個月的一串客戶，不是一個課程。** 她面對的是公司系統上的一張時段表，
// 看到空的就搶，而且習慣把一個客人的所有課程壓完再換下一個人。
//
// 兩層：**客戶卡片牆**（一次看到多位，自己決定先處理誰）→ **記錄**（挑日子、記下來）。
// 記錄不是另一個畫面，是疊在牆上面的一張置中卡片，左右滑就是下一位 ——
// 見 docs/adr/0017-recording-happens-in-a-card-deck.md。三個斷點共用同一份，
// 寬螢幕只是卡片更寬、旁邊多露一點，不是另一套版型。
//
// 這一頁**不出建議時段**（ADR-0002）。它的工作是把判斷所需的資訊攤開、
// 把結果記下來。排序只是預設順序，她隨時可以跳著點，也可以整個換一種排法
//（ADR-0037）。
//
// 佇列順序在批次建立當下凍結（ADR-0001 的 Consequences）——
// 換裝置回來不會發現順序跳掉。但每一列的即時資訊仍然現算。
//
// ## 這一頁為什麼長這樣：**只重畫真的變了的那一塊**
//
// 她點一顆丸子（做什麼、幾點、哪一台器材）是這一頁最高頻的動作，一位客戶要點五六次。
// 原本每點一下都重畫整頁，代價是整張卡閃一下、捲動位置回到最上面 ——
// 一個晚上要發生幾百次。所以這一支的規矩是：
//
// - **DOM 事件一律用委派**（`[data-page]` 與 `[data-deck]` 各一組），
//   任何一塊重畫之後都不必重新掛監聽，也就不會有「漏掛」這種 bug。
// - **選了什麼就只改 `aria-pressed`**，不重畫任何 HTML。
// - 只有真的會換掉內容的動作才重畫，而且只重畫那一塊：
//   換課程 → `[data-entfields]`；換日子 → `[data-daypanel]`；
//   存好一筆 → 那張卡的內容（捲動位置自己接回去）。
// - 換人是把**那兩張卡換掉**，不是重畫整個卡片組 —— 軌道的捲動位置要留著，
//   不然滑到一半會被拉回去。
//
// 見 docs/adr/0038-picking-an-option-does-not-repaint-the-page.md。

import * as config from '../../data/config.js';
import * as customersData from '../../data/customers.js';
import * as visitsData from '../../data/visits.js';
import * as batchesData from '../../data/batches.js';
import * as eventsData from '../../data/events.js';
import { isConfigured } from '../../data/sheetSync.js';
import {
  buildCustomerQueue, newBatch, progressOf, markInQueue, nextPending, monthRange,
  strongestReason, sortQueueRows, QUEUE_SORTS,
} from '../../domain/scheduling.js';
import { dayStatus, partLabel, partOfTime } from '../../domain/availability.js';
import { blockedDates, coversDate, isLeave } from '../../domain/events.js';
import {
  INITIAL_STATUS, validateVisit, isActive, coursesForEntitlement, NOTE_MAX,
  acceptsMoreSlots, withExtraSlot,
} from '../../domain/visits.js';
import { bookingConsequences } from '../../domain/consequences.js';
import { pairsOf, examChoicesFor } from '../../domain/followups.js';
import {
  nthLabel, nextNthFor, examChoicesForNth, courseIdForNth, secondFollowupIds,
  nthSlotFields, MIN_NTH, MAX_NTH,
} from '../../domain/nthFollowup.js';
import { annotateOptions, contraindicationTerms } from '../../domain/contraindications.js';
import * as flagsUi from '../components/flags.js';
import * as banUi from '../components/ban.js';
import { WEEKDAY_HEADERS } from '../../domain/calendar.js';
import {
  roomSlots, roomsForCourse, picksDoctor, staffWithRole, THERAPIST_ROLE, DOCTOR_ROLE,
} from '../../domain/masterData.js';
import { endOf, isValidTime, timeLabel, nextStart, toMinutes, toHHMM } from '../../domain/visitTime.js';
import {
  todayISO, addMonths, addDays, shortDate, lastDayOf, monthLabel,
} from '../../domain/dates.js';
import * as f from '../components/form.js';
import { confirmAction } from '../components/dialog.js';
import { icon } from '../icons.js';
import { chip as markChip } from '../components/marks.js';
import { pushLayer } from '../nav.js';
import * as toast from '../toast.js';
import { go } from '../router.js';

const esc = f.esc;

// 開著的批次、選中的客戶與那一位的記錄狀態留在模組層：
// 從客戶詳情繞回來時，她想接著剛剛那一位。
const view = {
  batchId: null,
  customerId: null,
  // 預設看全部。「還沒壓」是她最常要的視角，但月中打開時多半是 0 位，
  // 一進來就看到「這個篩選底下沒有人」是死路 —— 篩選要是主動收窄，不是預設收窄。
  filter: 'all',
  // 排序與搜尋字是**看**的方式，不是進度，所以留在這裡而不是存進 batch ——
  // 她在 iPad 上搜尋「王」，不該讓手機那邊也只剩姓王的（ADR-0037）。
  sort: 'default',
  search: '',
  // 記錄面板的暫存選擇。換人就清掉 —— 帶著上一位的選擇進來太容易記錯。
  day: null,
  entitlementId: null,
  startsAt: null,
  equipmentId: null,
  therapistId: null,
  roomKey: null,
};

/**
 * 這一批的資料與畫面狀態。放在模組層是因為畫面現在是一塊一塊重畫的 ——
 * 事件委派的處理器要拿到的是**當下**這一份，不是它被掛上去那一刻的那一份。
 */
let ctx = null;

/**
 * 從別的畫面指定「進去就打開這一位」。待辦中心的「壓表登記」點一個人名走這條路
 * （`.scratch/todo-declutter/issues/04`）。
 *
 * **存在模組層而不是網址裡。** 進網址要嘛多一層路由參數（router 只支援一層，
 * 而這裡要帶月份與客戶兩個值），要嘛把月份塞進去而讓她重整時看到一個
 * 半生不熟的狀態。放在這裡的代價是「中途重整就回到卡片牆」——
 * 而她不會在那三秒中間重整。
 */
let pendingOpen = null;

/**
 * @param {object} spec
 * @param {string} spec.month 'YYYY-MM'
 * @param {string} [spec.customerId]
 * @param {string} [spec.entitlementId] 要先選好的那一筆額度
 * @param {string} [spec.followupForVisitId] 二返要接的那一次健檢
 */
export function openFor({ month, customerId, entitlementId = null, followupForVisitId = null }) {
  pendingOpen = { month, customerId, entitlementId, followupForVisitId };
}

function resetPicks() {
  Object.assign(view, {
    day: null, entitlementId: null, startsAt: null,
    equipmentId: null, therapistId: null, roomKey: null, doctorId: null,
    followupForVisitId: null, nth: null,
  });
}

/**
 * 換課程時要跟著清掉的：器材、治療師、診間、醫師，還有「這是哪一次健檢的」——
 * 五個都是綁著課程的。時間留著。
 */
function resetCourseBoundPicks() {
  Object.assign(view, {
    equipmentId: null, therapistId: null, roomKey: null, doctorId: null,
    // **返數也要清。** 少了這一行，她點了「n返」再改回「復能」，
    // `view.nth` 會留著，而下一次她選回 n返 時看到的是上一次的返數。
    // 更糟的是那一段存進去時可能同時帶著額度與返數。
    followupForVisitId: null, nth: null,
  });
}

export async function render(el) {
  el.innerHTML = '<p class="muted">載入中…</p>';
  try {
    if (pendingOpen) {
      const spec = pendingOpen;
      pendingOpen = null;
      await openPending(el, spec);
    } else if (view.batchId) await paintBatch(el);
    else await paintStart(el);
  } catch (err) {
    el.innerHTML = `<div class="card"><p>讀取失敗：${esc(err.message)}</p></div>`;
  }
}

/**
 * 別的畫面指名要壓某一位的某一個月。
 *
 * **那個月已經有一批在跑就接著用**，不要再開一批 —— 兩批同一個月會讓
 * 「已壓 5 / 23」變成兩個各自算的數字，而進度是存在雲端跨裝置接續的
 * （SPEC 第 1 節）。沒有的話才開一批。
 */
async function openPending(el, { month, customerId, entitlementId, followupForVisitId }) {
  const active = await batchesData.listActive();
  const found = active.find((b) => b.targetMonth === month);

  resetPicks();
  view.customerId = customerId ?? null;
  // 從「約二返」那一列點進來的：項目與「哪一次健檢的」都先選好，
  // 她只要挑日期跟時間。**日期不猜** —— 那是她要跟客人談的事。
  view.entitlementId = entitlementId ?? null;
  view.followupForVisitId = followupForVisitId ?? null;

  if (found) {
    view.batchId = found.id;
    await paintBatch(el);
    return;
  }
  await startBatch(el, month, { keepCustomer: true });
}

// ---------- 起點：選月份 ----------

async function paintStart(el) {
  const active = await batchesData.listActive();
  const today = todayISO();
  const months = [today.slice(0, 7), addMonths(today, 1).slice(0, 7)];

  el.innerHTML = `
    <div class="page">
      <h1 class="page__title">壓表</h1>
      <p class="page__lead">一個人壓完再換下一個</p>
    </div>

    <section class="card">
      <h2 class="card__title">要壓哪個月</h2>
      <p class="card__note">開始之後會照「限制多的先看」排好，但那只是預設順序 ——
        想先弄誰就點誰，也可以整個換一種排法。</p>
      <div class="chips" role="group">
        ${months.map((m, i) => `
          <button class="chip" type="button" role="button"
                  aria-pressed="${i === 0}" data-month="${esc(m)}">${esc(monthLabel(m))}
            <span class="num dim">&nbsp;${esc(m)}</span></button>`).join('')}
      </div>
      <p style="margin-top: var(--space-4)">
        <button class="btn btn--primary btn--wide" type="button" data-start>開始這一批</button>
      </p>
    </section>

    ${active.length ? `
      <section class="card">
        <h2 class="card__title">還沒壓完的<span class="muted"> ${active.length}</span></h2>
        <ul class="link-list">${active.map(openRow).join('')}</ul>
        <p class="card__note">進度存在雲端，換一台裝置打開就接著上次的位置繼續。</p>
      </section>` : ''}

    <section class="card">
      <h2 class="card__title">臨時空出一格？</h2>
      <p class="card__note">輸入日期、時間與課程，把補得上的人列出來 ——
        用的是跟這裡同一套順序，不會兩個畫面給你兩種答案。</p>
      <a class="btn" href="#/schedule/backfill">時段反查</a>
    </section>`;

  let picked = months[0];
  el.querySelectorAll('[data-month]').forEach((btn) =>
    btn.addEventListener('click', () => {
      picked = btn.dataset.month;
      el.querySelectorAll('[data-month]').forEach((b) =>
        b.setAttribute('aria-pressed', String(b === btn)));
    }),
  );

  el.querySelector('[data-start]').addEventListener('click', () => startBatch(el, picked));

  el.querySelectorAll('[data-open-batch]').forEach((btn) =>
    btn.addEventListener('click', () => {
      view.batchId = btn.dataset.openBatch;
      view.customerId = null;
      resetPicks();
      render(el);
    }),
  );
}

/** 「還沒壓完的」那一段裡的一列。 */
function openRow(b) {
  const p = progressOf(b);
  return `<li><button class="row-link" type="button" data-open-batch="${esc(b.id)}">
    <span class="link-list__label">${esc(monthLabel(b.targetMonth))}壓表
      <span class="num dim">${esc(b.targetMonth)}</span></span>
    <span class="badge">已壓 ${p.handled} / ${p.total}</span>
    ${b.lastDeviceHint ? `<span class="badge">上次在${esc(b.lastDeviceHint)}</span>` : ''}
  </button></li>`;
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.keepCustomer] 別的畫面指名了要打開誰，開完不要把它清掉
 */
async function startBatch(el, targetMonth, { keepCustomer = false } = {}) {
  el.innerHTML = '<p class="muted">算佇列中…</p>';
  const data = await loadAll(targetMonth);
  const rows = buildCustomerQueue({ ...data.queueInput, targetMonth });

  if (!rows.length) {
    el.innerHTML = `<div class="card">
      <h2 class="card__title">沒有人要壓</h2>
      <p class="card__note">所有在服務中的客戶身上都沒有剩餘次數了。
        先去客戶那邊看看是不是該加購，或是有額度沒展開。</p>
      <button class="btn" type="button" data-back>回上一步</button></div>`;
    el.querySelector('[data-back]').addEventListener('click', () => render(el));
    return;
  }

  try {
    const id = await toast.withSaveState(
      () => batchesData.create(newBatch({ targetMonth, rows })),
      { success: '開始了', key: `batch:create:${targetMonth}` },
    );
    view.batchId = id;
    if (!keepCustomer) view.customerId = null;
    resetPicks();
    render(el);
  } catch {
    /* 已處理 */
  }
}

// ---------- 讀資料 ----------

async function loadAll(targetMonth) {
  const range = monthRange(targetMonth);
  const today = todayISO();
  // 距上次上課要往回看一段，但不用看到天荒地老 —— 超過就一律算「很久沒來」
  const back = addDays(today, -180);
  const from = back < range.from ? back : range.from;

  const [all, customers, entitlementsBy, availabilityBy, visits, events, settings] =
    await Promise.all([
      config.loadAll(),
      customersData.list(),
      customersData.entitlementsByCustomer(),
      customersData.availabilityByCustomer(),
      visitsData.listBetween(from, range.to),
      eventsData.listInRange(range.from, range.to),
      config.getSettings(),
    ]);

  const visitsBy = {};
  for (const v of visits) (visitsBy[v.customerId] ??= []).push(v);

  return {
    all, settings, today, range, events,
    // 她休假那幾天人不在，排了也是白排 —— 小日曆要一起劃掉（ADR-0015）
    away: blockedDates(events, range.from, range.to),
    queueInput: {
      customers, entitlementsBy, visitsBy, availabilityBy, today,
      weights: settings.sortWeights,
    },
  };
}

/**
 * 把凍結的佇列與現算的即時資訊疊起來。
 *
 * 順序凍結：照 batch.queue 的順序排，不重新排序。即時資訊照樣現算 ——
 * 剩幾次、這個月排了幾天、那個月問到的時間，每次打開都要是真的。
 */
function rowsOf(batch, data) {
  const ids = new Set((batch.queue ?? []).map((q) => q.customerId));
  const live = new Map(
    buildCustomerQueue({
      ...data.queueInput,
      targetMonth: batch.targetMonth,
      customers: data.queueInput.customers.filter((c) => ids.has(c.id)),
      includeUsedUp: true,
    }).map((r) => [r.customerId, r]),
  );

  return (batch.queue ?? []).map((q) => ({
    ...q,
    ...(live.get(q.customerId) ?? { customerName: q.customerName, reasons: [], pools: [] }),
  }));
}

// ---------- 批次 ----------

async function paintBatch(el) {
  const batch = await batchesData.get(view.batchId);
  if (!batch) {
    view.batchId = null;
    return render(el);
  }

  // 批次的月份壞掉就走不下去了。與其吐一句 null 的錯誤訊息，不如講清楚
  // 發生什麼事並給一條回頭路 —— 她手上這台是唯一看得到進度的裝置。
  if (!monthRange(batch.targetMonth)) {
    el.innerHTML = `
      <div class="card">
        <h2 class="card__title">這一批的月份壞掉了</h2>
        <p class="card__note">批次上的月份是「${esc(String(batch.targetMonth ?? '空的'))}」，
          讀不出是哪一個月，所以算不出佇列。已經記下的來訪與任務都不受影響。</p>
        <button class="btn" type="button" data-back>回壓表</button>
      </div>`;
    el.querySelector('[data-back]').addEventListener('click', () => {
      view.batchId = null;
      render(el);
    });
    return;
  }

  const data = await loadAll(batch.targetMonth);
  ctx = { el, batch, rows: rowsOf(batch, data), shown: [], ...data };
  mount();
}

/**
 * 重讀一次並把畫面接回去。存好一筆、或標記某位處理完之後用。
 *
 * **不重新 mount**：卡片組還開著的時候整個重畫，等於把她捲到的位置洗掉一次。
 */
async function reload() {
  const batch = await batchesData.get(view.batchId);
  if (!batch || !monthRange(batch.targetMonth)) {
    // 這一批在別的裝置上被結束或刪掉了。整頁重來是對的 ——
    // 回傳 true 讓呼叫端知道「別再往下畫了」。
    view.batchId = null;
    await render(ctx.el);
    return true;
  }
  const data = await loadAll(batch.targetMonth);
  ctx = { ...ctx, batch, rows: rowsOf(batch, data), ...data };
  return false;
}

const selectedRow = () => ctx.rows.find((r) => r.customerId === view.customerId) ?? null;

/**
 * 卡片牆上的篩選。刻意很少。
 *
 * 原本有一個「快到期」—— 拿掉了。它講的是會籍，而實務上沒有會籍這件事
 *（ADR-0019）；額度自己的到期日仍然是排序分數的一部分，只是不再自成一個分類。
 */
const FILTERS = [
  { id: 'all', label: '全部', match: () => true },
  { id: 'todo', label: '還沒壓', match: (r) => r.state !== 'done' && r.scheduledThisMonth === 0 },
  { id: 'noask', label: '沒問過時間', match: (r) => r.needsAvailability },
];

/** 搜尋只比姓名 —— 她找人的時候腦子裡是名字。 */
function matchesSearch(row) {
  const q = view.search.trim();
  return !q || String(row.customerName ?? '').includes(q);
}

/** 現在牆上（與卡片組裡）有哪幾位，照她選的排法排。 */
function computeShown() {
  const filter = FILTERS.find((x) => x.id === view.filter) ?? FILTERS[0];
  // 選中的那位一定留在卡片組裡，就算她剛剛把篩選切成別的、或搜尋了別的字 ——
  // 正在處理的人從畫面上消失是最難懂的一種畫面
  const kept = ctx.rows.filter(
    (r) => (filter.match(r) && matchesSearch(r)) || r.customerId === view.customerId,
  );
  ctx.shown = sortQueueRows(kept, view.sort);
  return ctx.shown;
}

// ---------- 整頁 ----------

function mount() {
  const { el } = ctx;
  deckLayer = null; // 整頁重畫，上一次那一層的節點與紀錄都不在了
  el.innerHTML = '<div data-page></div>';

  const page = el.querySelector('[data-page]');
  // 事件委派：這一層以下不管重畫幾次，監聽都還在（見檔頭）
  page.addEventListener('click', onPageClick);
  page.addEventListener('input', onPageInput);

  paintPage();
  if (selectedRow()) openDeck();
}

function paintPage() {
  const { batch } = ctx;
  const p = progressOf(batch);

  ctx.el.querySelector('[data-page]').innerHTML = `
    <div class="page">
      <h1 class="page__title">${esc(monthLabel(batch.targetMonth))}壓表</h1>
      <p class="page__lead num">${esc(batch.targetMonth)}・已壓 ${p.handled} / ${p.total} 位</p>
      <div class="meter" style="margin-top: var(--space-2)">
        <span class="meter__done" style="width: ${pct(p.handled, p.total)}"></span>
      </div>
    </div>

    <label class="field" style="margin-bottom: var(--space-2)">
      <span class="visually-hidden">找人</span>
      <input type="text" data-search value="${esc(view.search)}" style="width: 100%"
             placeholder="找人：打名字" />
    </label>

    <div class="chiprow noscroll-bar" role="group" aria-label="篩選與排序">
      ${FILTERS.map((x) => `
        <button class="chip chip--sm" type="button" aria-pressed="${x.id === view.filter}"
                data-filter="${x.id}">${esc(x.label)}
          <span class="num dim">${ctx.rows.filter(x.match).length}</span></button>`).join('')}
      <span class="chiprow__sep" aria-hidden="true"></span>
      <span class="chiprow__lead">排序</span>
      ${QUEUE_SORTS.map((s) => `
        <button class="chip chip--sm" type="button" aria-pressed="${s.id === view.sort}"
                data-sort="${esc(s.id)}">${esc(s.label)}</button>`).join('')}
    </div>

    <p class="muted" data-sortnote style="margin: 0 0 var(--space-3)">${sortNote()}</p>

    <div class="cardgrid" data-wall></div>

    <div class="footlinks">
      <button class="footlink" type="button" data-close>結束這一批</button>
    </div>`;

  paintWall();
}

function sortNote() {
  if (view.sort === 'default') {
    return '順序是算出來的預設值 —— 限制多的排前面。想先弄誰就點誰。';
  }
  const label = QUEUE_SORTS.find((s) => s.id === view.sort)?.label ?? '';
  return `照「${esc(label)}」排。一樣的那幾位仍然照預設順序。`;
}

/** 只重畫牆。搜尋框在外面，所以打字的游標不會被洗掉。 */
function paintWall() {
  const shown = computeShown();
  const wall = ctx.el.querySelector('[data-wall]');
  if (!wall) return;

  wall.innerHTML = shown.length
    ? shown.map((r) => custCard(r, r.customerId === view.customerId)).join('')
    : `<p class="muted">${view.search.trim()
        ? '沒有這個名字。清掉搜尋看整批。'
        : '這個篩選底下沒有人。點上面的「全部」看整批。'}</p>`;
}

function pressChips() {
  const page = ctx.el.querySelector('[data-page]');
  page.querySelectorAll('[data-filter]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.filter === view.filter)));
  page.querySelectorAll('[data-sort]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.sort === view.sort)));
  const note = page.querySelector('[data-sortnote]');
  if (note) note.innerHTML = sortNote();
}

function onPageClick(e) {
  const filter = e.target.closest('[data-filter]');
  if (filter) {
    view.filter = filter.dataset.filter;
    pressChips();
    return paintWall();
  }

  const sort = e.target.closest('[data-sort]');
  if (sort) {
    view.sort = sort.dataset.sort;
    pressChips();
    return paintWall();
  }

  const pick = e.target.closest('[data-pick]');
  if (pick) return openDeckAt(pick.dataset.pick);

  if (e.target.closest('[data-close]')) return closeBatch();
  return null;
}

function onPageInput(e) {
  if (e.target.matches('[data-search]')) {
    view.search = e.target.value;
    paintWall();
  }
}

const pct = (n, total) => `${total ? Math.round((n / total) * 100) : 0}%`;

// ---------- 置中的客戶卡片組 ----------

/**
 * 卡片組現在佔著的那一層瀏覽器紀錄（`ui/nav.js`）。
 *
 * **整個卡片組只推一層**，換人與點丸子都不推 —— ADR-0048 當初把這一頁排除在外，
 * 就是因為她一個晚上要開關面板幾百次，而 Safari 的 `pushState` 有頻率上限。
 * 一位客戶推一筆還會有第二個更糟的後果：按返回鍵要倒著走過二十幾位才回得到牆上。
 * 見 docs/adr/0052-the-deck-is-one-layer.md。
 */
let deckLayer = null;

/**
 * 點一位客戶不換頁，而是把她疊在卡片牆上面，左右滑就是下一位（ADR-0017）。
 *
 * 左右滑交給 CSS 的 scroll-snap，不自己接 touch 事件 —— 自己接會失去慣性、
 * 邊緣回彈與跨裝置的手感，滑起來就會「怪」，而這是她整晚都在做的動作。
 *
 * 旁邊那幾張只畫認得出是誰的資訊。全部都畫完整的記錄面板，
 * 二十三位客戶就是二十三份小日曆。
 */
function openDeck() {
  const node = document.createElement('div');
  node.className = 'deck';
  node.dataset.deck = '';
  node.setAttribute('role', 'dialog');
  node.setAttribute('aria-modal', 'true');
  node.setAttribute('aria-label', `${selectedRow()?.customerName ?? ''}的壓表記錄`);

  node.addEventListener('click', onDeckClick);
  node.addEventListener('change', onDeckChange);

  ctx.el.appendChild(node);
  // 返回鍵要關掉這一層，不是跳走整頁（ADR-0048）
  deckLayer = pushLayer(() => closeDeck({ fromBack: true }));
  fillDeck();
}

function openDeckAt(customerId) {
  view.customerId = customerId;
  resetPicks();
  if (deckEl()) fillDeck();
  else openDeck();
}

const deckEl = () => ctx.el.querySelector('[data-deck]');
const trackEl = () => ctx.el.querySelector('[data-track]');
const fullCardEl = () => ctx.el.querySelector('.deck__card:not(.deck__card--peek)');

/** 整個卡片組重畫。只有「換了哪幾位在裡面」的時候才需要（例如壓完一位換下一位）。 */
function fillDeck() {
  const deck = deckEl();
  const shown = ctx.shown.length ? ctx.shown : computeShown();
  const selected = selectedRow();
  if (!deck || !selected) return;

  deck.innerHTML = `
    ${deckHead(shown, selected)}
    <div class="deck__track noscroll-bar" data-track>
      ${shown.map((r) => (r.customerId === selected.customerId
        ? fullCardHtml(r)
        : peekCardHtml(r))).join('')}
    </div>`;

  wireTrack();
  centerDeck();
}

function deckHead(shown, selected) {
  const i = shown.findIndex((r) => r.customerId === selected.customerId);
  return `
    <div class="deck__head" data-deckhead>
      <button class="deck__btn" type="button" data-step="-1" aria-label="上一位"
              ${i <= 0 ? 'disabled' : ''}>${icon('left', { size: 17, width: 2 })}</button>
      <span class="deck__who">${esc(selected.customerName ?? '?')}
        <span class="deck__count">${i + 1} / ${shown.length}</span></span>
      <button class="deck__btn" type="button" data-step="1" aria-label="下一位"
              ${i >= shown.length - 1 ? 'disabled' : ''}>${icon('right', { size: 17, width: 2 })}</button>
      <button class="deck__btn" type="button" data-deck-close aria-label="回卡片牆">
        ${icon('close', { size: 17, width: 2 })}</button>
    </div>`;
}

const fullCardHtml = (row) =>
  `<div class="deck__card" data-card="${esc(row.customerId)}">${recordPanel(row)}</div>`;

// 旁邊半露的那兩張：姓名與紅丸，跟卡片牆一致（ADR-0046）。
// 剩餘次數拿掉了 —— 那一張只有一半露在外面，四顆泡泡在那個寬度只是色塊。
const peekCardHtml = (row) => `
  <button class="deck__card deck__card--peek" type="button"
          data-card="${esc(row.customerId)}" data-goto="${esc(row.customerId)}">
    <span class="row__title" style="justify-content: center">${esc(row.customerName ?? '?')}</span>
    <span style="display: flex; justify-content: center">${blockChips(row)}</span>
  </button>`;

/**
 * @param {{fromBack?: boolean}} [options] fromBack：返回鍵按的。
 *   那一層瀏覽器紀錄已經被退掉了，再 `pop()` 一次會多退一筆、把她踢出這一頁。
 */
function closeDeck({ fromBack = false } = {}) {
  if (!fromBack) deckLayer?.pop();
  deckLayer = null;
  deckEl()?.remove();
  view.customerId = null;
  resetPicks();
  paintWall();
}

/**
 * 把選中的那張推到正中間。
 *
 * 只有在**整個軌道被重畫**之後才需要（重畫會把 scrollLeft 歸零）。
 * 換人現在是換掉那兩張卡，軌道本身沒有被重畫，所以不會走這裡 ——
 * 那正是滑到一半不會被拉回去的原因。
 */
function centerDeck({ smooth = false } = {}) {
  const track = trackEl();
  const card = fullCardEl();
  if (!track || !card) return;
  const left = card.offsetLeft - (track.clientWidth - card.offsetWidth) / 2;
  if (smooth && typeof track.scrollTo === 'function') track.scrollTo({ left, behavior: 'smooth' });
  else track.scrollLeft = left;
}

/** 滑停之後看正中間是誰。scrollend 是新的，沒有就用去抖動的 scroll 頂替。 */
function wireTrack() {
  const track = trackEl();
  if (!track) return;

  const settle = () => {
    const mid = track.scrollLeft + track.clientWidth / 2;
    let best = null;
    let bestGap = Infinity;
    for (const card of track.querySelectorAll('[data-card]')) {
      const gap = Math.abs(card.offsetLeft + card.offsetWidth / 2 - mid);
      if (gap < bestGap) {
        bestGap = gap;
        best = card;
      }
    }
    const id = best?.dataset.card;
    // 已經滑到定位了，不要再捲一次 —— 那會跟她的手指打架
    if (id && id !== view.customerId) goTo(id, { scroll: false });
  };

  if ('onscrollend' in window) {
    track.addEventListener('scrollend', settle);
  } else {
    let timer = null;
    track.addEventListener('scroll', () => {
      clearTimeout(timer);
      timer = setTimeout(settle, 140);
    });
  }
}

/**
 * 換人。**只換掉那兩張卡**：舊的變成 peek、新的展開成完整面板。
 *
 * 不重畫整個軌道，所以捲動位置留著；用鈕換人時才自己捲過去。
 */
function goTo(customerId, { scroll = true } = {}) {
  const track = trackEl();
  const previous = view.customerId;
  if (!track || customerId === previous) return;

  const next = ctx.shown.find((r) => r.customerId === customerId);
  if (!next) return;

  view.customerId = customerId;
  resetPicks();

  const before = ctx.shown.find((r) => r.customerId === previous);
  if (before) swapCard(previous, peekCardHtml(before));
  swapCard(customerId, fullCardHtml(next));

  const head = ctx.el.querySelector('[data-deckhead]');
  if (head) head.outerHTML = deckHead(ctx.shown, next);
  deckEl()?.setAttribute('aria-label', `${next.customerName ?? ''}的壓表記錄`);

  if (scroll) centerDeck({ smooth: true });
}

/** 換掉軌道上的一張卡。整條軌道的寬度沒變，所以捲動位置仍然對得上。 */
function swapCard(customerId, html) {
  const old = trackEl()?.querySelector(`[data-card="${cssEscape(customerId)}"]`);
  if (!old) return;
  const holder = document.createElement('template');
  holder.innerHTML = html.trim();
  const node = holder.content.firstElementChild;
  if (node) old.replaceWith(node);
}

const cssEscape = (value) =>
  (globalThis.CSS?.escape ? globalThis.CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&'));

/** 重畫選中那一位的面板內容（存好一筆之後）。捲到哪裡要自己接回去。 */
function paintRecord() {
  const card = fullCardEl();
  const row = selectedRow();
  if (!card || !row) return;

  const top = card.scrollTop;
  card.innerHTML = recordPanel(row);
  card.scrollTop = top;

  // 旁邊那幾張的剩餘次數也可能變了。換內容不換節點，軌道不會動。
  for (const peek of trackEl()?.querySelectorAll('.deck__card--peek') ?? []) {
    const other = ctx.shown.find((r) => r.customerId === peek.dataset.card);
    if (!other) continue;
    const holder = document.createElement('template');
    holder.innerHTML = peekCardHtml(other).trim();
    peek.innerHTML = holder.content.firstElementChild.innerHTML;
  }
}

// ---------- 客戶卡片 ----------

/**
 * 卡片牆上一張卡只回答一個問題：**下一個處理誰。**
 *
 * 所以它只剩三樣東西：姓名、醫療禁忌、壓了沒。其餘七塊（不能的時間、
 * 剩餘次數、這個月上個月、備註、排序理由、喜好星星）全部搬進記錄面板 ——
 * 那幾塊是她**點進去之後**要一直對照的東西，在牆上只是把二十幾位客戶
 * 拉成三次捲動。理由見 docs/adr/0046-the-wall-only-answers-who-is-next.md。
 *
 * **醫療禁忌反而變得更明顯**（SPEC 第 4.3 節：任何畫面都不可摺疊隱藏）——
 * 一張卡上原本十個永久限制全是紅字淡底，等於全都不紅。
 */
function custCard(row, isSelected) {
  const state = {
    done: '<span class="badge badge--ok">已壓好</span>',
    skipped: '<span class="badge">跳過</span>',
  }[row.state] ?? (row.scheduledThisMonth
    ? `<span class="badge badge--ok">壓了 ${row.scheduledThisMonth} 天</span>`
    : '<span class="badge badge--soon">還沒壓</span>');

  return `
    <button class="card queue-row ${isSelected ? 'queue-row--on' : ''}"
            type="button" data-pick="${esc(row.customerId)}"
            style="display: block; text-align: left">
      <span class="row" style="align-items: center">
        <span class="row__main">
          <span class="row__title">${esc(row.customerName ?? '?')}</span>
          ${blockChips(row)}
        </span>
        ${state}
      </span>
    </button>`;
}

/**
 * 會真的擋掉器材的那幾個永久限制，加上一句「所以還剩什麼」。
 *
 * 畫法在 `ui/components/flags.js`，跟待辦的「壓表登記」那一頁共用（ADR-0046）——
 * 一邊紅一邊灰的話，那一顆的整個意義（掃過去一眼分得出誰被硬性擋住）就沒了。
 * 這裡只負責把這位客戶的擇一池換算成器材物件。
 */
function blockChips(row) {
  const equipment = ctx?.all?.equipment ?? [];
  const pool = (row.pools ?? []).find((p) => p.type === 'pool');
  const options = pool
    ? (pool.optionEquipmentIds ?? []).map((id) => equipment.find((e) => e.id === id)).filter(Boolean)
    : null;

  return flagsUi.blockChips({ flags: row.flags ?? [], terms: blockingTerms(), options });
}

/**
 * 會擋掉器材的那幾個字。**一批算一次**，不是一張卡算一次 ——
 * 卡片牆一次畫二十幾張，而器材主檔在一批之內不會變。
 */
function blockingTerms() {
  ctx.terms ??= contraindicationTerms(ctx?.all?.equipment ?? []);
  return ctx.terms;
}

/**
 * 不能的時間。畫法在 `ui/components/ban.js`，客戶詳情共用同一份 ——
 * 同一件事在兩個畫面長得不一樣，她會以為是兩種東西（2026-08-24）。
 *
 * **哪一份算數是這裡決定的**：壓表綁月份，所以用的是這一批那個月的那一份
 * （`buildCustomerQueue()` 已經照 `collectionFor()` 挑好了，ADR-0036）。
 *
 * @param {object} row
 * @param {{raw?: boolean}} [options] raw：要不要附上「看原文」那一摺
 */
function banBlock(row, { raw = false } = {}) {
  return banUi.banBlock(row, { month: monthLabel(ctx.range.from.slice(0, 7)), raw });
}


function poolChip(pool) {
  return `<span class="poolchip ${pool.remaining <= 2 ? 'poolchip--low' : ''}">${esc(pool.label)}<b class="num">${pool.remaining}</b></span>`;
}

// ---------- 記錄面板 ----------

function recordPanel(row) {
  const entry = ctx.batch.queue.find((q) => q.customerId === row.customerId);
  const recorded = recordedSlots(row);
  const month = monthLabel(ctx.range.from.slice(0, 7));

  return `
    <section class="card">
      <div class="row" style="align-items: flex-start">
        <div class="row__main">
          <div class="row__title" style="font-size: var(--text-xl)">
            ${esc(row.customerName)}
            ${row.priority ? `<span class="stars">${'★'.repeat(row.priority)}</span>` : ''}
            ${(row.flags ?? []).map((x) => `<span class="flag">${esc(x)}</span>`).join('')}
          </div>
        </div>
        <span class="badge badge--ok">已記 ${recorded.length} 筆</span>
      </div>
      ${banBlock(row, { raw: true })}
      ${row.needsAvailability ? `<p class="card__note" style="margin: var(--space-2) 0 0">
          <button class="btn btn--sm" type="button"
                  data-ask="${esc(row.customerId)}">去記${esc(month)}問到的時間</button></p>` : ''}
      <div class="poolchips">
        ${(row.pools ?? []).map(poolChip).join('') || '<span class="muted">沒有剩餘次數了</span>'}
      </div>

      <div class="custcard__meta">
        <span>這個月排 ${row.scheduledThisMonth} 次・上個月 ${row.visitsPrevMonth} 次${
          row.daysSinceLast === null ? '・還沒上過課' : `・距上次 ${row.daysSinceLast} 天`}</span>
      </div>

      ${(row.marks ?? []).length
        ? `<div class="marks" style="margin-top: var(--space-2)">
            ${row.marks.map(markChip).join('')}</div>`
        : ''}

      ${strongestReason(row)
        ? `<p class="muted dim" style="margin: var(--space-2) 0 0">排在這裡的理由：${
            esc(strongestReason(row).label)}</p>`
        : ''}
      ${blockedNote(row)}
    </section>

    <section class="card">
      <h3 class="card__title">挑日子</h3>
      ${miniCal(row)}
    </section>

    <div data-daypanel>${view.day ? dayPanel(row) : ''}</div>

    <section class="card">
      <h3 class="card__title">這個月壓好的<span class="muted"> ${recorded.length}</span></h3>
      ${recorded.length
        ? `<ul class="link-list">${recorded.map((s) => `
            <li><a href="#/visits/${esc(s.visitId)}">
              <span class="link-list__label num">${esc(s.label)}</span></a></li>`).join('')}</ul>`
        : '<p class="muted">還沒記。在 Abovee 或 Examine 壓完之後回來記一筆。</p>'}
    </section>

    <section class="card card--flat">
      <div class="stack">
        <button class="btn btn--dark btn--wide" type="button" data-done>
          ${entry?.state === 'done' ? '下一位 →' : '這位壓完了，下一位 →'}</button>
        <button class="btn btn--wide" type="button" data-skip>跳過</button>
      </div>
      <p class="card__note" style="margin: var(--space-3) 0 0">
        按下去之後，${esc(row.customerName)} 會出現在待辦的「跟客人確認時間」。</p>
      ${entry?.skippedReason ? `<p class="muted">跳過的理由：${esc(entry.skippedReason)}</p>` : ''}
    </section>`;
}

function blockedNote(row) {
  const blocked = annotateOptions({ flags: row.flags ?? [] }, ctx.all.equipment).filter((e) => e.blocked);
  if (!blocked.length) return '';
  return `
    <div class="warn warn--hard">
      ${icon('alert', { size: 18 })}
      <span>${blocked.map((e) => `${esc(e.name)}不可使用`).join('、')} ——
        ${esc([...new Set(blocked.flatMap((e) => e.reasons))].join('、'))}禁忌。
        這是唯一會直接鎖住選項的檢查。</span>
    </div>`;
}

// ---------- 小日曆 ----------

/**
 * 這一天他是不是只有半天不行，是哪半天。
 *
 * `dayStatus()` 早就算得出來了（`blockedPart`），只是以前沒有人接。
 * 整天不行的那幾天回 null —— 那是 `--ban` 在管的，不是這裡。
 *
 * 這個月沒問過就是不知道，不要拿別的月份那一份硬算（ADR-0036）。
 */
function halfBlocked(row, iso) {
  if (!iso || row.needsAvailability) return null;
  return dayStatus(row.rules ?? [], iso).blockedPart;
}

/**
 * 挑日子。**他說不行的日子用紅色劃掉**，她自己休假的用霧藍，已經過去的只是變淡。
 *
 * 三種的原因完全不同，而她只有在「為什麼這天不能點」上會停下來 ——
 * 一種顏色講三件事，等於每次都要把 title 叫出來看。顏色的分工跟全站一致：
 * 紅是擋住的，霧藍是她的行事備註（ADR-0015），淡的是已經不用管的。
 *
 * **只有「已經過去了」點不下去。** 那不是判斷，是事實。另外兩種照樣點得下去，
 * 點了在面板最上面出一條提醒（`dayWarnings()`）：
 *
 * - 「他說不行」是**解析出來的**（SPEC 第 4.3 節：原文永遠比解析結果大）。
 *   原文寫「9/22 那個禮拜盡量不要」會被讀成整週不行，而她電話裡問到
 *   「其實禮拜三可以」時，得有辦法照樣排下去。
 * - 「我休假」是她自己記的行事備註，她隨時可以改主意（ADR-0002：
 *   app 記錄決定，不做決定）。
 *
 * 這一頁**唯一會鎖住選項的是醫療禁忌**（SPEC 第 4.7 節，`blockedNote()`）。
 * 時段丸子那一段早就是這樣寫的了，只是整天那一格漏掉了。
 *
 * **只擋半天的日子是第四種，而且它點得下去。** 那天真的排得進去，只是要挑另外
 * 半天（`availableDates()` 也是這樣算的），所以它不是 `--off` 的第四個成員，
 * 是疊在正常格子上的一層：被擋的那半邊塗紅、劃線、寫「上午」或「下午」。
 * 畫法跟客戶自己填的那一頁同一招（`form.css` 的 `.cell--am`）——
 * 他點的時候看到什麼樣子，她壓表時就該看到什麼樣子。
 *
 * 用整月的格子而不是 chip 列表：這裡要挑的是「哪一天」，而月曆的形狀本身
 * 就帶著「這是禮拜幾」「離月底還有多久」兩個她需要的資訊。
 */
function miniCal(row) {
  const { range, today, away } = ctx;
  const [y, m] = range.from.split('-').map(Number);
  const first = range.from;
  // 月初那一格前面要空幾格。週一起算，所以週日（0）要空六格（`weekStart()`）。
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const has = recordedDays(row);

  const cells = [];
  for (let i = 0; i < lead; i += 1) {
    cells.push('<span class="minical__cell minical__cell--empty"></span>');
  }

  for (let d = 1; d <= lastDayOf(y, m); d += 1) {
    const iso = addDays(first, d - 1);
    const status = row.needsAvailability ? { available: true, reasons: [] } : dayStatus(row.rules ?? [], iso);
    const isAway = away.has(iso);
    const past = iso < today;
    const banned = !status.available;

    // **已經過去的優先於他說不行。** 月中打開時前面半個月本來就不能點了，
    // 那幾天再標成紅色，紅色就從「這天他不行」變成「這半頁都是紅的」——
    // 紅要留給「本來排得進去、但他不行」的那幾天才有意義。
    const kind = past ? 'past' : banned ? 'ban' : isAway ? 'away' : null;

    // 點得下去的日子裡，還有一種「只有半天不行」。它不是第四個 kind ——
    // 那幾天排得進去，只是要挑另外半天。
    const half = kind ? null : status.blockedPart;

    const why = past ? '已經過去了'
      : banned ? (status.reasons.join('、') || '他說這天不行')
      : isAway ? '你這天休假'
      : half ? (status.reasons.join('、') || `他說這天${partLabel(half)}不行`)
      : '';

    const classes = [
      'minical__cell',
      kind ? `minical__cell--${kind}` : '',
      half ? `minical__cell--half minical__cell--half-${half}` : '',
      has.has(iso) ? 'minical__cell--has' : '',
      iso === view.day ? 'minical__cell--on' : '',
    ].filter(Boolean).join(' ');

    cells.push(`
      <button class="${classes}" type="button" data-day="${iso}" ${past ? 'disabled' : ''}
              title="${esc(why)}">
        ${d}
        ${half ? `<span class="minical__half">${partLabel(half)}</span>` : ''}
        <span class="minical__dot"></span>
      </button>`);
  }

  return `
    <div class="minical__head">
      <span class="minical__month num">${esc(range.from.slice(0, 7))}</span>
    </div>
    <div class="minical__grid" data-minical>
      ${WEEKDAY_HEADERS.map((w) => `<span class="minical__wd">${esc(w)}</span>`).join('')}
      ${cells.join('')}
    </div>
    <div class="minical__legend">
      <span><i class="minical__swatch"></i>可以排</span>
      <span><i class="minical__swatch minical__swatch--has"></i>已經記了</span>
      <span><i class="minical__swatch minical__swatch--ban"></i>他不行</span>
      <span><i class="minical__swatch minical__swatch--half"></i>只有半天</span>
      <span><i class="minical__swatch minical__swatch--away"></i>你休假</span>
    </div>`;
}

/** 這位客戶這個月已經被記在哪幾天。 */
function recordedDays(row) {
  const out = new Set();
  for (const v of ctx.queueInput.visitsBy[row.customerId] ?? []) {
    if (isActive(v) && v.date >= ctx.range.from && v.date <= ctx.range.to) out.add(v.date);
  }
  return out;
}

/** 這位客戶這個月已經記了哪些時段。 */
function recordedSlots(row) {
  const out = [];
  for (const v of ctx.queueInput.visitsBy[row.customerId] ?? []) {
    if (!isActive(v) || v.date < ctx.range.from || v.date > ctx.range.to) continue;
    for (const s of v.slots ?? []) {
      const who = ctx.all.staff.find((x) => x.id === s.therapistId)?.name
        ?? ctx.all.rooms.find((x) => x.id === s.roomId)?.name ?? '';
      out.push({
        visitId: v.id,
        date: v.date,
        label: `${shortDate(v.date)} ${timeLabel(s)} ${s.courseName ?? ''}${who ? `・${who}` : ''}`.trim(),
      });
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

// ---------- 選中那一天要記什麼 ----------

/** 看得到的預設時段。不是限制 —— 底下永遠有一個時間輸入可以打別的。 */
function timeChoices() {
  const out = [];
  for (let t = 9 * 60; t <= 18 * 60; t += 30) out.push(toHHMM(t));
  return out;
}

/**
 * 選中那一天的面板。
 *
 * 版面切成兩塊是為了讓「換課程」只重畫該重畫的那一塊：
 * `[data-entfields]` 裡面是**跟著課程走**的欄位（幾點、器材、治療師、診間），
 * 外面是不跟著課程走的（這一次記一句、加這一筆）——
 * 她打到一半的備註不可以因為換了課程就不見。
 */
function dayPanel(row) {
  const options = courseOptions(row);
  const picked = options.find((o) => o.entitlementId === view.entitlementId) ?? null;
  const sameDay = sameDayVisit(row, view.day);
  const closed = sameDayClosed(row, view.day);

  return `
    <section class="card card--on">
      <div class="row" style="align-items: baseline">
        <h3 class="card__title row__main" style="margin: 0">
          ${esc(shortDate(view.day))}</h3>
        <span class="muted">${dayTally(sameDay, closed)}</span>
      </div>
      ${dayWarnings(row)}

      <div class="fieldgroup" style="margin-top: var(--space-4)">
        <span class="fieldgroup__label">做什麼</span>
        <div class="chips">
          ${options.length
            ? options.map((o) => `
                <button class="chip" type="button" aria-pressed="${o.entitlementId === view.entitlementId}"
                        data-ent="${esc(o.entitlementId)}">${esc(o.label)}
                  ${/* n返 沒有次數這件事，所以那一格不印「剩 0」——
                        0 看起來像「用完了」，而它根本不是一筆額度 */''}
                  ${o.isNth ? '<span class="chip__note">不扣次數</span>'
                            : `<span class="num dim">&nbsp;剩 ${o.remaining}</span>`}</button>`).join('')
            : '<span class="muted">這位客戶身上沒有還有剩的課程了。</span>'}
        </div>
      </div>

      <div data-entfields>${entFields(row, picked)}</div>

      <label class="field">
        <span class="field__label">這一次記一句</span>
        <input type="text" data-note maxlength="${NOTE_MAX}"
               value="${esc(sameDay?.note ?? '')}"
               placeholder="例：她說下午比較好" />
      </label>

      <div class="errors" data-errors hidden></div>
      <button class="btn btn--primary btn--wide" type="button" data-add
              ${picked ? '' : 'disabled'}>加這一筆</button>
      <p class="card__note" style="margin: var(--space-3) 0 0">${addNote(sameDay, closed)}</p>
    </section>`;
}

/** 這天已經有什麼。已經結案的那幾筆要單獨講 —— 它們併不進去，會另開一筆。 */
function dayTally(sameDay, closed) {
  const parts = [];
  if (sameDay) parts.push(`這天已經記了 ${sameDay.slots.length} 段`);
  if (closed.length) {
    parts.push(`另有 ${closed.reduce((n, v) => n + (v.slots?.length ?? 0), 0)} 段已經結案`);
  }
  return parts.length ? esc(parts.join('・')) : '這天還沒排東西';
}

/**
 * 「加這一筆」底下那一句。**講會發生的事，不要講不會發生的事。**
 *
 * 以前那一句是「系統登記等客人說可以之後才長出來」—— 她說看不懂，而且它
 * 講的是一件不會發生的事。詳細的後果在按下去之後那一道確認裡
 *（`domain/consequences.js`），這裡只給最短的一句。
 */
function addNote(sameDay, closed) {
  if (sameDay && sameDay.status === 'confirmed') {
    return '這一段會併進同一天那一筆，那一筆會退回「等客戶回覆」—— 這一段還沒問過客人。';
  }
  if (sameDay) return '這一段會併進同一天已經有的來訪裡 —— 排班的單位是「某人某天來一次」。';
  if (closed.length) return '這天那一筆已經結案了，所以這一段會另開一筆新的來訪。';
  return '存下去會記到日曆上，標成「待確認」，待辦會多一張「跟客人確認時間」。';
}

/**
 * 選中的那一天上面那幾條提醒。
 *
 * 小日曆上已經用顏色標出來了，這裡還要再講一次 —— 她點進來是要挑時間的，
 * 而時間丸子就在這幾句話底下。在挑時間的那一刻不講，等於沒講。
 *
 * 三種都用 `.warn` 不用 `.warn--hard`：硬的那一種在這一頁只有醫療禁忌用得起
 * （見 `blockedNote()`），這幾條是提醒，不擋。
 */
function dayWarnings(row) {
  const iso = view.day;
  if (!iso) return '';

  const out = [];
  const status = row.needsAvailability ? null : dayStatus(row.rules ?? [], iso);

  if (status && !status.available) {
    out.push(`他說<b>這天不行</b>${
      status.reasons.length ? ` —— ${esc(status.reasons.join('、'))}` : ''
    }。還是排得下去，但先跟他確認過。`);
  } else if (status?.blockedPart) {
    const half = status.blockedPart;
    out.push(`他說這天<b>${esc(partLabel(half))}不行</b> ——
      底下${half === 'am' ? '上午' : '下午'}的時間會標起來，但沒有擋。`);
  }

  if (ctx.away.has(iso)) {
    const why = leaveTitles(iso);
    out.push(`<b>你這天休假</b>${why ? ` —— ${esc(why)}` : ''}。
      排得下去，但那天你不在院裡。`);
  }

  return out.map((text) => `
    <div class="warn" style="margin-top: var(--space-3)">
      ${icon('info', { size: 16 })}
      <span>${text}</span>
    </div>`).join('');
}

/** 那天的休假叫什麼。認不出來回空字串 —— 印一個猜的比不印糟。 */
function leaveTitles(iso) {
  return (ctx.events ?? [])
    .filter((e) => isLeave(e) && coversDate(e, iso))
    .map((e) => e.title)
    .filter(Boolean)
    .join('、');
}

/** 跟著課程走的那幾欄。沒選課程時只留一句話，不留一堆空欄位。 */
function entFields(row, picked) {
  if (!picked) return '<p class="muted" style="margin: 0 0 var(--space-4)">先選上面要做什麼。</p>';

  const { all } = ctx;
  const course = picked.course;
  const half = halfBlocked(row, view.day);

  return `
    <div class="fieldgroup">
      <span class="fieldgroup__label">幾點開始${course.durationMin ? `　${course.durationMin} 分鐘` : ''}</span>
      <div class="chiprow noscroll-bar">
        ${timeChoices().map((t) => {
          // 落在他說不行的那半天。標起來，但**不 disable** —— 唯一會鎖住選項的
          // 是醫療禁忌（SPEC 第 4.7 節），而原文永遠比解析結果大（第 4.3 節）：
          // 解析錯的時候她要有辦法照樣排下去。
          const off = half && partOfTime(t) === half;
          return `
          <button class="chip chip--sm ${off ? 'chip--halfoff' : ''}" type="button"
                  aria-pressed="${t === view.startsAt}"
                  data-time="${t}" title="${esc(off ? `他說這天${partLabel(half)}不行` : '')}">
            <span class="num">${t}</span></button>`;
        }).join('')}
      </div>
      <label class="field" style="margin: var(--space-3) 0 0">
        <span class="field__label">上面沒有的時間</span>
        <input type="time" data-othertime value="${esc(view.startsAt ?? '')}" step="300" />
      </label>
    </div>

    ${course.requiresEquipment ? equipmentField(row, picked) : ''}
    ${course.requiresIvProduct ? ivField(all) : ''}
    ${course.assigns === 'therapist' ? therapistField(all) : ''}
    ${course.assigns === 'room' ? roomField(all, course) : ''}
    ${picksDoctor(course) ? doctorField(all) : ''}
    ${picked.isNth ? nthFields(row) : examField(row, picked)}`;
}

/**
 * n返 的兩排：第幾返、哪一次健檢的。
 *
 * 跟二返那一排（`examField()`）只有一個地方刻意不一樣：**一個候選都不會被
 * 鎖住**。二返是一對一，所以被別的二返認領掉的那幾次點不下去；n返 沒有上限，
 * 每一次健檢都可以再約一場。已經有幾返照樣標出來 —— 她要對照的正是那個。
 *
 * 也**不自動幫她選**（二返有 `pickExamIfObvious()`）：二返是「一定要約的
 * 那一次」，自動選省她一下點擊；n返 是她特地要加的一場，替她決定接哪一次
 * 健檢會讓她漏看。
 */
function nthFields(row) {
  const exams = nthExamChoices(row);
  const numbers = [];
  for (let n = MIN_NTH; n <= MAX_NTH; n += 1) numbers.push(n);

  return `
    <div class="nthfields">
    <div class="fieldgroup">
      <span class="fieldgroup__label">第幾返</span>
      <div class="chiprow noscroll-bar">
        ${numbers.map((n) => `
          <button class="chip chip--sm" type="button" aria-pressed="${n === view.nth}"
                  data-nth="${n}">${esc(nthLabel(n))}</button>`).join('')}
      </div>
      <span class="field__hint">二返是健檢做完一定會有的那一次，在上面那一排選它的額度。這裡是加約的。</span>
    </div>

    <div class="fieldgroup">
      <span class="fieldgroup__label">這是哪一次健檢的　一定要選</span>
      <div class="chips">
        ${exams.map((c) => `
          <button class="chip" type="button"
                  aria-pressed="${c.visitId === view.followupForVisitId}"
                  data-exam="${esc(c.visitId)}">
            <span class="num">${esc(shortDate(c.date))}</span>
            ${c.note ? `<span class="chip__note">${esc(c.note)}</span>` : ''}</button>`).join('')}
      </div>
      <span class="field__hint">沒有它，試算表上這一場沒有位置可以印。</span>
    </div>
    </div>`;
}

/**
 * 這位客戶身上還排得動的課程。
 *
 * 擇一池沒有 courseId（ADR-0005），它對應的是「需要選器材的課程」，
 * 所以這裡走 coursesForEntitlement() 而不是自己判斷。
 */
function courseOptions(row) {
  const ents = ctx.queueInput.entitlementsBy[row.customerId] ?? [];
  const out = [];

  for (const pool of row.pools ?? []) {
    if (pool.remaining <= 0) continue;
    const ent = ents.find((e) => e.id === pool.entitlementId);
    if (!ent) continue;
    const course = coursesForEntitlement(ent, ctx.all.courses)[0] ?? null;
    if (!course) continue;
    out.push({
      entitlementId: pool.entitlementId,
      label: pool.label,
      remaining: pool.remaining,
      durationMin: ent.durationMin ?? course.durationMin ?? 60,
      course,
      entitlement: ent,
    });
  }

  // **n返 不是一筆額度**（`domain/nthFollowup.js` 的檔頭）—— 它沒有被買、
  // 沒有次數、扣不掉。它排在同一排是因為她在這裡問的是「這一段要做什麼」，
  // 而那一排就是回答那個問題的地方。
  //
  // **一個做完的健檢都沒有時整顆不畫。** 畫成 disabled 的話她每次都會試一下。
  const exams = nthExamChoices(row);
  if (exams.length) {
    const course = ctx.all.courses.find((c) => c.id === nthCourseId(row, exams)) ?? null;
    if (course) {
      out.push({
        entitlementId: NTH_PICK,
        label: '＋ n返',
        // 剩餘次數那一格印的是「—」不是 0：0 看起來像「用完了」，
        // 而 n返 根本沒有次數這件事。
        remaining: '—',
        durationMin: course.durationMin ?? 30,
        course,
        entitlement: null,
        isNth: true,
      });
    }
  }

  return out;
}

/**
 * 額度那一排上「n返」那一顆的值。**不是任何一筆額度的 id** ——
 * Firestore 的自動 id 是 20 個 [A-Za-z0-9] 字元，撞不到這兩條底線。
 */
const NTH_PICK = '__nth__';

/** 這位客戶有哪幾次健檢接得了 n返。 */
function nthExamChoices(row) {
  return examChoicesForNth({
    entitlements: ctx.queueInput.entitlementsBy[row.customerId] ?? [],
    coursesById: Object.fromEntries(ctx.all.courses.map((c) => [c.id, c])),
    visits: ctx.queueInput.visitsBy[row.customerId] ?? [],
  });
}

/**
 * n返 借的是哪一個課程 —— 那一次健檢配的二返課程（ADR-0022 的同一條連結）。
 *
 * 已經選好健檢就用那一次的；還沒選就拿第一個候選的 —— 幾乎所有客戶身上
 * 的健檢都配到同一個二返課程，而她選完之後這個值會重算。
 */
function nthCourseId(row, exams) {
  const visits = ctx.queueInput.visitsBy[row.customerId] ?? [];
  const ents = ctx.queueInput.entitlementsBy[row.customerId] ?? [];
  const coursesById = Object.fromEntries(ctx.all.courses.map((c) => [c.id, c]));
  const wanted = view.followupForVisitId ?? exams[0]?.visitId ?? null;
  const exam = visits.find((v) => v.id === wanted) ?? null;
  return exam ? courseIdForNth(exam, ents, coursesById) : null;
}

function equipmentField(row, picked) {
  const ids = picked.entitlement?.optionEquipmentIds ?? [];
  const pool = ids.length
    ? ids.map((id) => ctx.all.equipment.find((e) => e.id === id)).filter(Boolean)
    : ctx.all.equipment;
  const annotated = annotateOptions({ flags: row.flags ?? [] }, pool);

  return `
    <div class="fieldgroup">
      <span class="fieldgroup__label">器材　擇一</span>
      <div class="chips">
        ${annotated.map((e) => `
          <button class="chip" type="button"
                  aria-pressed="${e.id === view.equipmentId && !e.blocked}"
                  ${e.blocked ? 'disabled aria-disabled="true"' : ''}
                  data-equipment="${esc(e.id)}"
                  title="${esc(e.blocked ? `${e.reasons.join('、')}禁忌` : '')}">${esc(e.name)}</button>`).join('')}
      </div>
    </div>`;
}

function ivField(all) {
  return `
    <div class="fieldgroup">
      <span class="fieldgroup__label">營養點滴品項</span>
      <div class="chips">
        ${all.ivProducts.filter((p) => p.active !== false).map((p) => `
          <button class="chip" type="button" aria-pressed="${p.id === view.equipmentId}"
                  data-ivproduct="${esc(p.id)}">${esc(p.name)}</button>`).join('')}
      </div>
    </div>`;
}

function therapistField(all) {
  // 治療師的選單只列治療師 —— 跑出三位醫師來的話，她要點到第三個字才發現
  // 點錯人（ADR-0026，`staffWithRole()` 是唯一的入口）。
  const therapists = staffWithRole(all.staff, THERAPIST_ROLE);
  return `
    <div class="fieldgroup">
      <span class="fieldgroup__label">治療師</span>
      <div class="chips">
        ${therapists.length
          ? therapists.map((s) => `
              <button class="chip" type="button" aria-pressed="${s.id === view.therapistId}"
                      data-therapist="${esc(s.id)}">${esc(s.name)}</button>`).join('')
          : '<span class="muted">主檔裡還沒有治療師，到「設定 → 治療師與醫師」新增。</span>'}
      </div>
    </div>`;
}

/**
 * 醫師。**跟治療師是兩個各自獨立的選單**，同一段可以兩個都有 ——
 * 二返同時要診間和醫師（ADR-0026）。哪些課程有這一排只寫在
 * `domain/masterData.js` 的 `picksDoctor()`（A 類一律有）。
 *
 * 以前這一排只有日曆的來訪編輯器有，所以她壓完二返之後那一段的醫師一定是空的，
 * 而試算表的二返註記括號裡讀的就是它 —— 括號因此永遠是空的。
 */
function doctorField(all) {
  const doctors = staffWithRole(all.staff, DOCTOR_ROLE);
  return `
    <div class="fieldgroup">
      <span class="fieldgroup__label">醫師　還沒定也存得下去</span>
      <div class="chips">
        ${doctors.length
          ? doctors.map((d) => `
              <button class="chip" type="button" aria-pressed="${d.id === view.doctorId}"
                      data-doctor="${esc(d.id)}">${esc(d.name)}</button>`).join('')
          : '<span class="muted">主檔裡還沒有醫師，到「設定 → 治療師與醫師」新增。</span>'}
      </div>
    </div>`;
}

/**
 * 「這是哪一次健檢的二返」。**只有二返那一筆額度會冒出這一排。**
 *
 * 她的原話：「就是想要二返和健檢是一對一連結的」「期待我在壓表壓二返的時候，
 * 可以顯示這是聯結幾號的健檢」。
 *
 * 只有一個候選就自動選好（`pickExamIfObvious()`）—— 大部分時候她身上只有一次
 * 還沒約的健檢，多一下點擊沒有換到任何資訊。
 *
 * 已經被別的二返認領掉的那幾次照樣列出來但按不下去：藏掉的話她看不出
 * 「另外那一次已經約過了」，而那正是她要對照的東西。
 */
function examField(row, picked) {
  const choices = examChoicesOf(row, picked);
  if (!choices) return '';

  if (!choices.length) {
    return `
      <div class="fieldgroup">
        <span class="fieldgroup__label">這是哪一次健檢的</span>
        <p class="muted" style="margin: 0">還沒有做完的健檢可以接。先把那一次健檢結案。</p>
      </div>`;
  }

  return `
    <div class="fieldgroup">
      <span class="fieldgroup__label">這是哪一次健檢的</span>
      <div class="chips">
        ${choices.map((c) => `
          <button class="chip" type="button"
                  aria-pressed="${c.visitId === view.followupForVisitId}"
                  ${c.taken ? 'disabled aria-disabled="true"' : ''}
                  data-exam="${esc(c.visitId)}"
                  title="${esc(c.taken ? `已經約在 ${shortDate(c.bookedOn)} 了` : '')}">
            <span class="num">${esc(shortDate(c.date))}</span>
            ${c.taken ? '<span class="chip__note">已約</span>' : ''}</button>`).join('')}
      </div>
    </div>`;
}

/**
 * 這一筆額度的健檢候選。**不是二返就回 `null`**（跟「是二返但沒有候選」不一樣，
 * 那一種要印一句話）。
 *
 * 來訪讀的是這一頁載進來的那一份（`loadAll()`：往回 180 天）。超過那個範圍的
 * 健檢在這裡列不出來 —— 而那沒關係，鏈條本來就是「健檢 +21 天拿到報告、
 * 再 +7 天約掉」。真的要接一場半年前的健檢時，日曆的來訪編輯器讀的是
 * `listByCustomer()`（完整的一份），那裡選得到。
 */
function examChoicesOf(row, picked) {
  const ent = picked?.entitlement;
  if (!ent?.followupForEntitlementId) return null;

  const ents = ctx.queueInput.entitlementsBy[row.customerId] ?? [];
  const coursesById = Object.fromEntries(ctx.all.courses.map((c) => [c.id, c]));
  const pair = pairsOf(ents, coursesById).find((x) => x.followup?.id === ent.id);
  if (!pair) return null;

  return examChoicesFor(pair, ctx.queueInput.visitsBy[row.customerId] ?? [], {
    selected: view.followupForVisitId,
  });
}

/**
 * 只有一個選得下去的候選時就先幫她選好。
 *
 * 換課程之後才叫得動（候選是跟著額度走的），所以它跟 `resetCourseBoundPicks()`
 * 是一組的 —— 先清乾淨，再看要不要自動填。
 */
function pickExamIfObvious(row, picked) {
  const open = (examChoicesOf(row, picked) ?? []).filter((c) => !c.taken);
  view.followupForVisitId = open.length === 1 ? open[0].visitId : null;
}

/**
 * 診間。這個課程常用的放前面當泡泡，其餘的收在底下 ——
 * 十五間全部攤開會把整個面板推得很長，但也不能不給，例外是真的會發生的。
 */
function roomField(all, course) {
  const allowed = new Set(roomsForCourse(course, all.rooms).map((r) => r.id));
  const slots = roomSlots(all.rooms);
  const chip = (s) => `
    <button class="chip" type="button" aria-pressed="${keyOf(s) === view.roomKey}"
            data-room="${esc(keyOf(s))}">${esc(s.label)}</button>`;

  const primary = slots.filter((s) => allowed.has(s.roomId));
  const rest = slots.filter((s) => !allowed.has(s.roomId));

  return `
    <div class="fieldgroup">
      <span class="fieldgroup__label">診間</span>
      <div class="chips">${primary.map(chip).join('')}</div>
      ${rest.length ? `
        <details style="margin-top: var(--space-2)">
          <summary class="muted">其他診間 ${rest.length}</summary>
          <div class="chips" style="margin-top: var(--space-2)">${rest.map(chip).join('')}</div>
        </details>` : ''}
    </div>`;
}

const keyOf = (s) => `${s.roomId}|${s.bed ?? ''}`;

/**
 * 同一天那一筆**收得下新時段**的來訪。
 *
 * 已完成／未到的那幾筆不算 —— 那一天已經結案了，再併進去那一段會當場
 * 被算成做完或沒來（`acceptsMoreSlots()` 的檔頭寫了為什麼）。
 * 收不下就是回 `null`，呼叫端照「新的一筆」那條路走。
 */
function sameDayVisit(row, date) {
  return (ctx.queueInput.visitsBy[row.customerId] ?? [])
    .find((v) => v.date === date && isActive(v) && acceptsMoreSlots(v.status)) ?? null;
}

/** 同一天已經結案的那幾筆。只拿來在畫面上講一句，不是併入的對象。 */
function sameDayClosed(row, date) {
  return (ctx.queueInput.visitsBy[row.customerId] ?? [])
    .filter((v) => v.date === date && isActive(v) && !acceptsMoreSlots(v.status));
}

// ---------- 卡片組裡的事件 ----------

/**
 * 一組委派處理所有事。**選了什麼只改 aria-pressed，一個字的 HTML 都不重畫** ——
 * 她一位客戶要點五六次，每點一下重畫一次的代價是整張卡閃一下、捲回最上面。
 */
function onDeckClick(e) {
  const step = e.target.closest('[data-step]');
  if (step) {
    const i = ctx.shown.findIndex((r) => r.customerId === view.customerId);
    const next = ctx.shown[i + Number(step.dataset.step)];
    if (next) goTo(next.customerId);
    return;
  }

  if (e.target.closest('[data-deck-close]')) return closeDeck();

  const goto = e.target.closest('[data-goto]');
  if (goto) return goTo(goto.dataset.goto);

  const ask = e.target.closest('[data-ask]');
  if (ask) return go(`/customers/${ask.dataset.ask}`);

  const day = e.target.closest('[data-day]');
  if (day) return pickDay(day.dataset.day);

  const ent = e.target.closest('[data-ent]');
  if (ent) return pickCourse(ent.dataset.ent);

  const nth = e.target.closest('[data-nth]');
  if (nth) return pickNth(Number(nth.dataset.nth));

  const time = e.target.closest('[data-time]');
  if (time) return pickTime(time.dataset.time === view.startsAt ? null : time.dataset.time);

  for (const [attr, key] of [['equipment', 'equipmentId'], ['ivproduct', 'equipmentId'],
    ['therapist', 'therapistId'], ['room', 'roomKey'], ['doctor', 'doctorId'],
    ['exam', 'followupForVisitId']]) {
    const hit = e.target.closest(`[data-${attr}]`);
    if (hit) {
      pickOne(attr, key, hit.dataset[attr]);
      // 換了「哪一次健檢」之後返數要跟著重算 —— 兩次健檢各自有各自的第幾返，
      // 而她選完健檢之後看到的那個數字如果還是上一次的，她會直接按下去。
      if (attr === 'exam' && view.nth != null) refreshNth();
      return null;
    }
  }

  if (e.target.closest('[data-add]')) return addSlot();
  if (e.target.closest('[data-skip]')) return mark('skipped');
  if (e.target.closest('[data-done]')) return mark('done');
  return null;
}

function onDeckChange(e) {
  if (e.target.matches('[data-othertime]')) pickTime(e.target.value || null, { fromInput: true });
}

/** 換了「哪一次健檢」之後把返數重算一次，並且只改那一排的 aria-pressed。 */
function refreshNth() {
  const row = selectedRow();
  if (!row) return;
  view.nth = view.followupForVisitId
    ? nextNthFor(
      view.followupForVisitId,
      ctx.queueInput.visitsBy[row.customerId] ?? [],
      secondFollowupIds(ctx.queueInput.entitlementsBy[row.customerId] ?? []),
    )
    : MIN_NTH;
  deckEl()?.querySelectorAll('[data-nth]').forEach((b) =>
    b.setAttribute('aria-pressed', String(Number(b.dataset.nth) === view.nth)));
}

/** 選一顆丸子：只改按下去的樣子。再點一次同一顆就取消。 */
function pickOne(attr, key, value) {
  view[key] = view[key] === value ? null : value;
  press(`[data-${attr}]`, attr, view[key]);
}

function press(selector, attr, value) {
  deckEl()?.querySelectorAll(selector).forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset[attr] === value)));
}

function pickTime(value, { fromInput = false } = {}) {
  view.startsAt = value;
  press('[data-time]', 'time', value);
  if (fromInput) return;
  const input = deckEl()?.querySelector('[data-othertime]');
  if (input) input.value = value ?? '';
}

/** 換課程只重畫跟著課程走的那幾欄，她打到一半的備註留著。 */
function pickCourse(entitlementId) {
  view.entitlementId = view.entitlementId === entitlementId ? null : entitlementId;
  resetCourseBoundPicks();
  press('[data-ent]', 'ent', view.entitlementId);

  const row = selectedRow();
  const fields = deckEl()?.querySelector('[data-entfields]');
  if (!row || !fields) return;

  const picked = courseOptions(row).find((o) => o.entitlementId === view.entitlementId) ?? null;
  // 候選是跟著額度走的，所以要在畫之前先算 —— 只有一個選得下去的就先幫她選好。
  if (picked?.isNth) pickDefaultNth(row);
  else pickExamIfObvious(row, picked);
  fields.innerHTML = entFields(row, picked);

  const add = deckEl()?.querySelector('[data-add]');
  if (add) add.disabled = !picked;
  showErrors([]);
}

/** 選第幾返。跟別的丸子一樣只改 aria-pressed，不重畫（ADR-0038）。 */
function pickNth(n) {
  view.nth = view.nth === n ? null : n;
  deckEl()?.querySelectorAll('[data-nth]').forEach((b) =>
    b.setAttribute('aria-pressed', String(Number(b.dataset.nth) === view.nth)));
}

/**
 * 剛選到「n返」時給一個預設返數。
 *
 * **只有一個健檢候選時才算得準** —— 返數是跟著「哪一次健檢」走的
 *（同一次健檢底下最大的 + 1）。有好幾次健檢時先給最小值，等她選了健檢
 * 再算一次（`pickOne()` 那條路走 `onDeckClick` 的 `exam`，見底下）。
 */
function pickDefaultNth(row) {
  const exams = nthExamChoices(row);
  const only = exams.length === 1 ? exams[0].visitId : view.followupForVisitId;
  if (exams.length === 1) view.followupForVisitId = only;
  view.nth = only
    ? nextNthFor(
      only,
      ctx.queueInput.visitsBy[row.customerId] ?? [],
      secondFollowupIds(ctx.queueInput.entitlementsBy[row.customerId] ?? []),
    )
    : MIN_NTH;
}

/** 換日子只重畫那一天的面板，小日曆本身只改哪一格被選中。 */
function pickDay(iso) {
  const row = selectedRow();
  if (!row) return;

  view.day = iso;
  // 換一天就把時間清掉，其餘保留 —— 同一個人連著排兩天，
  // 課程與治療師通常一樣，時間才是要重挑的那一個。
  view.startsAt = defaultStart(row, iso);

  deckEl()?.querySelectorAll('[data-day]').forEach((b) =>
    b.classList.toggle('minical__cell--on', b.dataset.day === iso));

  const panel = deckEl()?.querySelector('[data-daypanel]');
  if (!panel) return;
  panel.innerHTML = dayPanel(row);
  panel.querySelector('.card')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function showErrors(errors) {
  const box = deckEl()?.querySelector('[data-errors]');
  if (!box) return;
  box.hidden = !errors.length;
  box.innerHTML = errors.length
    ? `<ul>${errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
    : '';
}

/** 那天已經有來訪就接在最後一段後面，中間留設定裡的間隔。 */
function defaultStart(row, date) {
  const visit = row ? sameDayVisit(row, date) : null;
  const last = (visit?.slots ?? []).filter((s) => isValidTime(s.endsAt)).sort(
    (a, b) => toMinutes(b.endsAt) - toMinutes(a.endsAt),
  )[0];
  return last ? nextStart(last.endsAt, ctx.settings.slotGapMin) : null;
}

// ---------- 記一筆 ----------

async function addSlot() {
  const selected = selectedRow();
  if (!selected || !view.day) return;

  const { all } = ctx;
  const options = courseOptions(selected);
  const picked = options.find((o) => o.entitlementId === view.entitlementId);

  if (!picked) return showErrors(['先選要做什麼']);
  if (!isValidTime(view.startsAt)) return showErrors(['先選幾點開始']);
  // n返 的兩格在這裡先擋，不要等 `validateVisit()` ——
  // 那一支講的是「第 1 個時段：……」，而她在這一頁看到的是一張卡片，
  // 沒有「第幾個時段」這個概念。
  if (picked.isNth && !view.nth) return showErrors(['先選第幾返']);
  if (picked.isNth && !view.followupForVisitId) {
    return showErrors(['先選這是哪一次健檢的 —— 沒有它，試算表上這一場沒有位置可以印']);
  }

  const course = picked.course;
  const [roomId, bed] = String(view.roomKey ?? '').split('|');

  // n返 的三樣東西（沒有額度、返數、哪一次健檢）由 `nthSlotFields()` 給 ——
  // 兩個入口共用同一支，各自組一次的話遲早有一個忘了把 `entitlementId`
  // 設成 null，而那一段會被算進某一筆額度的次數裡。
  const nthPart = picked.isNth
    ? nthSlotFields({
      nth: view.nth,
      examVisitId: view.followupForVisitId,
      courseId: courseIdForNth(
        (ctx.queueInput.visitsBy[selected.customerId] ?? [])
          .find((x) => x.id === view.followupForVisitId) ?? null,
        ctx.queueInput.entitlementsBy[selected.customerId] ?? [],
        Object.fromEntries(all.courses.map((c) => [c.id, c])),
      ) ?? course.id,
    })
    : null;

  const slot = {
    entitlementId: picked.entitlementId,
    courseId: course.id,
    courseName: course.name,
    equipmentId: course.requiresEquipment ? (view.equipmentId ?? null) : null,
    ivProductId: course.requiresIvProduct ? (view.equipmentId ?? null) : null,
    startsAt: view.startsAt,
    endsAt: endOf(view.startsAt, picked.durationMin),
    roomId: course.assigns === 'room' ? (roomId || null) : null,
    bed: course.assigns === 'room' ? (bed || null) : null,
    therapistId: course.assigns === 'therapist' ? (view.therapistId ?? null) : null,
    doctorId: picksDoctor(course) ? (view.doctorId ?? null) : null,
    // 這一段二返接在哪一次健檢後面。不是二返就一定是 null ——
    // 帶著一個不相干的 id 會讓試算表把註記寫到別人底下。
    followupForVisitId: picked.entitlement?.followupForEntitlementId
      ? (view.followupForVisitId ?? null)
      : null,
    attended: null,
    // n返 覆蓋掉上面那幾樣。**放在最後不是隨便放的** —— 上面那一份是
    // 「一段普通的來訪」的形狀，這一份只換掉真的不一樣的三樣。
    ...(nthPart ?? {}),
  };

  const note = deckEl()?.querySelector('[data-note]')?.value?.trim() || null;

  // 同一天已經有來訪就併進去 —— 排班的原子單位是來訪（SPEC 第 4.4 節）。
  // 規則在 `domain/visits.js`：收不收得下、要不要退回等客戶回覆，都不在這一頁判斷。
  const sameDay = sameDayVisit(selected, view.day);
  const merged = sameDay ? withExtraSlot(sameDay, slot, { note }) : null;
  const visit = merged?.visit ?? {
    customerId: selected.customerId,
    customerName: selected.customerName,
    date: view.day,
    status: INITIAL_STATUS,
    confirmedAt: null, cancelledAt: null, statusAt: null, cancelReason: null, released: null,
    note,
    slots: [slot],
  };

  const customerVisits = await visitsData.listByCustomer(selected.customerId);
  const { errors } = validateVisit(visit, {
    customer: { flags: selected.flags ?? [] },
    entitlements: ctx.queueInput.entitlementsBy[selected.customerId] ?? [],
    courses: all.courses, equipment: all.equipment, rooms: all.rooms,
    staff: all.staff, ivProducts: all.ivProducts,
    customerVisits,
    sameDayVisits: await visitsData.listByDate(view.day),
  });

  showErrors(errors);
  if (errors.length) return;

  // SPEC 第 7 節規則 11：app 看不到 Abovee，這道確認就是她手寫的那兩個驚嘆號。
  // 抬頭壓在哪個系統、底下會發生什麼，全部由 `domain/consequences.js` 算 ——
  // 這一頁與來訪編輯器以前各自寫死了「Abovee」，而健檢壓的是 Examine。
  const coursesById = Object.fromEntries(all.courses.map((c) => [c.id, c]));
  const said = bookingConsequences({
    visit,
    coursesById,
    merge: merged ? { reopened: merged.reopened } : null,
    sheetSyncOn: isConfigured(ctx.settings),
  });

  // 「這一段接在哪一次健檢後面」要講出來 —— 她的原話是「期待我在壓表壓二返的時候，
  // 可以顯示這是聯結幾號的健檢」。順便講出那一張待辦會自己收掉，
  // 不然她會回待辦中心找一張已經不在的東西。
  const linkedExam = slot.followupForVisitId
    ? (customerVisits.find((v) => v.id === slot.followupForVisitId) ?? null)
    : null;

  const ok = await confirmAction({
    title: said.title,
    consequences: [
      `${selected.customerName}・${shortDate(view.day)} ${slot.startsAt}–${slot.endsAt} ${course.name}`,
      ...(linkedExam ? [
        `接在 ${shortDate(linkedExam.date)} 那一次健檢後面`,
        '待辦上那一張「約二返」會自己收掉',
      ] : []),
      ...said.lines,
    ],
    confirmLabel: '已確認，記錄',
  });
  if (!ok) return;

  try {
    await toast.withSaveState(() => visitsData.save(visit, customerVisits), {
      success: '記好了',
      key: `visit:save:${visit.id ?? `${visit.customerId}:${visit.date}`}`,
    });
    // 記完把時段相關的選擇清掉，日期留著 —— 同一天常常要連記兩三段
    view.startsAt = null;
    view.entitlementId = null;
    resetCourseBoundPicks();

    // 重讀之後只換掉這張卡的內容：她捲到哪裡就留在哪裡
    if (await reload()) return;
    paintPage();
    paintRecord();
  } catch {
    /* 已處理 */
  }
}

// ---------- 進度 ----------

async function mark(state) {
  const { batch } = ctx;
  const selected = selectedRow();
  if (!selected) return;

  let reason = null;
  if (state === 'skipped') {
    const ok = await confirmAction({
      title: `跳過 ${selected.customerName}？`,
      consequences: [
        '這批裡他會標成跳過，但還是看得到，隨時可以回來處理',
        '他的額度與來訪都不會被動到',
      ],
      confirmLabel: '跳過',
    });
    if (!ok) return;
    reason = '手動跳過';
  }

  const queue = markInQueue(batch, selected.customerId, state, reason);
  const next = nextPending({ ...batch, queue }, selected.customerId);

  try {
    await toast.withSaveState(
      () => batchesData.saveProgress(batch.id, queue, next?.customerId ?? selected.customerId),
      { success: state === 'done' ? '這位壓完了' : '已跳過' },
    );
    view.customerId = next?.customerId ?? null;
    resetPicks();

    if (await reload()) return;
    paintPage();
    // 換人之後卡片組裡有誰可能整個變了（例如篩選是「還沒壓」），
    // 這種時候才整個重畫 —— 但外框留著，所以不會再淡入一次。
    if (view.customerId) fillDeck();
    else deckEl()?.remove();
  } catch {
    /* 已處理 */
  }
}

async function closeBatch() {
  const p = progressOf(ctx.batch);
  const ok = await confirmAction({
    title: '結束這一批？',
    consequences: [
      `已壓 ${p.handled} / ${p.total}，還有 ${p.pending} 位沒處理`,
      '已經記下的來訪與任務都會留著，不受影響',
      '結束之後不會再出現在「還沒壓完的」清單裡',
    ],
    confirmLabel: '結束',
    danger: p.pending > 0,
  });
  if (!ok) return;

  try {
    await toast.withSaveState(() => batchesData.finish(ctx.batch.id), { success: '這批結束了' });
    view.batchId = null;
    view.customerId = null;
    resetPicks();
    render(ctx.el);
  } catch {
    /* 已處理 */
  }
}
