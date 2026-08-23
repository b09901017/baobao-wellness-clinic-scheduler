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
import {
  buildCustomerQueue, newBatch, progressOf, markInQueue, nextPending, monthRange,
  strongestReason, sortQueueRows, QUEUE_SORTS,
} from '../../domain/scheduling.js';
import { dayStatus, partLabel, partOfTime } from '../../domain/availability.js';
import { blockedDates } from '../../domain/events.js';
import {
  INITIAL_STATUS, validateVisit, isActive, coursesForEntitlement, NOTE_MAX,
} from '../../domain/visits.js';
import { annotateOptions, contraindicationTerms } from '../../domain/contraindications.js';
import * as flagsUi from '../components/flags.js';
import { roomSlots, roomsForCourse } from '../../domain/masterData.js';
import { endOf, isValidTime, timeLabel, nextStart, toMinutes, toHHMM } from '../../domain/visitTime.js';
import {
  todayISO, addMonths, addDays, shortDate, lastDayOf, monthLabel,
} from '../../domain/dates.js';
import * as f from '../components/form.js';
import { confirmAction } from '../components/dialog.js';
import { icon } from '../icons.js';
import { chip as markChip } from '../components/marks.js';
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

function resetPicks() {
  Object.assign(view, {
    day: null, entitlementId: null, startsAt: null,
    equipmentId: null, therapistId: null, roomKey: null,
  });
}

/** 換課程時要跟著清掉的：器材、治療師、診間都是綁著課程的。時間留著。 */
function resetCourseBoundPicks() {
  Object.assign(view, { equipmentId: null, therapistId: null, roomKey: null });
}

export async function render(el) {
  el.innerHTML = '<p class="muted">載入中…</p>';
  try {
    if (view.batchId) await paintBatch(el);
    else await paintStart(el);
  } catch (err) {
    el.innerHTML = `<div class="card"><p>讀取失敗：${esc(err.message)}</p></div>`;
  }
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

async function startBatch(el, targetMonth) {
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
      { success: '開始了' },
    );
    view.batchId = id;
    view.customerId = null;
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

function closeDeck() {
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
 * 不能的時間。**只放解析出來的條件丸子**，原文收在摺疊裡（記錄面板才有，牆上沒有）。
 *
 * 原本原文是這一塊最大的一段。現在幾乎每一份都是客戶自己在表單上填的，
 * 而那份原文是系統照她的答案產生的 —— 把同一件事講第二次，佔掉的是她在公司電腦前
 * 一眼要掃到的位置。見 docs/adr/0035-the-wall-shows-rules-not-the-raw-answer.md。
 *
 * @param {object} row
 * @param {{raw?: boolean}} [options] raw：要不要附上「看原文」那一摺
 */
function banBlock(row, { raw = false } = {}) {
  const month = monthLabel(ctx.range.from.slice(0, 7));

  if (row.needsAvailability) {
    return `
      <span class="ban ban--unknown" style="display: block">
        <span class="ban__head"><span>還沒問${esc(month)}的時間</span>
          <span class="ban__when">${row.collectedAt ? `上次 ${esc(row.collectedAt)}` : ''}</span></span>
        <span class="ban__raw">不知道他${esc(month)}哪幾天可以 —— 先傳訊息問。</span>
      </span>`;
  }

  const rules = (row.rules ?? []).filter((r) => r.kind !== 'prefer');
  const chips = rules.map((r) => `<span class="ban__chip">${esc(describeShort(r))}</span>`).join('');

  // 問過了、而且她沒說哪天不行 —— 那是好消息，不要用紅色講出來。
  // 紅色在這一頁的意思是「有東西擋著」，沒有限制卻紅著會讓她每次都停下來確認。
  const none = rules.length === 0;

  return `
    <span class="ban ${none ? 'ban--none' : ''}" style="display: block">
      <span class="ban__head"><span>${none ? '沒有說哪天不行' : '不能的時間'}</span>
        <span class="ban__when">${row.collectedAt ? `${esc(row.collectedAt)} 收集` : ''}</span></span>
      ${chips ? `<span class="ban__chips">${chips}</span>` : ''}
      <span class="ban__chips" style="margin-top: var(--space-2)">
        <span class="ban__chip">可用 ${row.availableDays} 天</span>
      </span>
      ${raw && row.rawText ? `
        <details class="ban__more">
          <summary>他原本是怎麼說的</summary>
          <span class="ban__raw">「${esc(row.rawText)}」</span>
        </details>` : ''}
    </span>`;
}

/** 卡片上的一行塞不下完整句子，這裡只給日期本身。完整的在原文裡。 */
function describeShort(rule) {
  if (rule.kind === 'exclude_weekday') return `每週${weekdayLabelOf(rule.weekday)}${partLabel(rule.partOfDay)}`;
  if (rule.kind === 'exclude_date') return `${short(rule.date)}${partLabel(rule.partOfDay)}`;
  if (rule.kind === 'exclude_range') return `${short(rule.from)}–${short(rule.to)}`;
  return '';
}

const WD = ['日', '一', '二', '三', '四', '五', '六'];
const weekdayLabelOf = (n) => WD[n] ?? '?';
const short = (iso) => (typeof iso === 'string' ? iso.slice(5).replace('-', '/') : '');

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
        : '<p class="muted">還沒記。在 Abovee 壓完之後回來記一筆。</p>'}
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
 * 三種都點不下去，但原因完全不同，而她只有在「為什麼這天不能點」上會停下來 ——
 * 一種顏色講三件事，等於每次都要把 title 叫出來看。顏色的分工跟全站一致：
 * 紅是擋住的，霧藍是她的行事備註（ADR-0015），淡的是已經不用管的。
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
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
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
      kind ? 'minical__cell--off' : '',
      kind ? `minical__cell--${kind}` : '',
      half ? `minical__cell--half minical__cell--half-${half}` : '',
      has.has(iso) ? 'minical__cell--has' : '',
      iso === view.day ? 'minical__cell--on' : '',
    ].filter(Boolean).join(' ');

    cells.push(`
      <button class="${classes}" type="button" data-day="${iso}" ${kind ? 'disabled' : ''}
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
      ${WD.map((w) => `<span class="minical__wd">${w}</span>`).join('')}
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

  return `
    <section class="card card--on">
      <div class="row" style="align-items: baseline">
        <h3 class="card__title row__main" style="margin: 0">
          ${esc(shortDate(view.day))}</h3>
        <span class="muted">${sameDay ? `這天已經記了 ${sameDay.slots.length} 段` : '這天還沒排東西'}</span>
      </div>
      ${halfNote(row)}

      <div class="fieldgroup" style="margin-top: var(--space-4)">
        <span class="fieldgroup__label">做什麼</span>
        <div class="chips">
          ${options.length
            ? options.map((o) => `
                <button class="chip" type="button" aria-pressed="${o.entitlementId === view.entitlementId}"
                        data-ent="${esc(o.entitlementId)}">${esc(o.label)}
                  <span class="num dim">&nbsp;剩 ${o.remaining}</span></button>`).join('')
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
      <p class="card__note" style="margin: var(--space-3) 0 0">
        ${sameDay
          ? '這一段會併進同一天已經有的來訪裡 —— 排班的單位是「某人某天來一次」。'
          : '存下去會記成「已壓表，等客戶回覆」。系統登記等客人說可以之後才長出來。'}</p>
    </section>`;
}

/**
 * 選中的那一天只有半天不行時的那一句。
 *
 * 小日曆上已經標出來了，這裡還要再講一次 —— 她點進來是要挑時間的，
 * 而時間丸子就在這句話底下。在挑時間的那一刻不講，等於沒講。
 *
 * 用 `.warn` 不用 `.warn--hard`：硬的那一種在這一頁只有醫療禁忌用得起
 * （見 `blockedNote()`），而這一條是提醒，不擋。
 */
function halfNote(row) {
  const half = halfBlocked(row, view.day);
  if (!half) return '';
  return `
    <div class="warn" style="margin-top: var(--space-3)">
      ${icon('info', { size: 16 })}
      <span>他說這天<b>${esc(partLabel(half))}不行</b> ——
        底下${half === 'am' ? '上午' : '下午'}的時間會標起來，但沒有擋。</span>
    </div>`;
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
    ${course.assigns === 'room' ? roomField(all, course) : ''}`;
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
  return out;
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
  return `
    <div class="fieldgroup">
      <span class="fieldgroup__label">治療師</span>
      <div class="chips">
        ${all.staff.filter((s) => s.active !== false).map((s) => `
          <button class="chip" type="button" aria-pressed="${s.id === view.therapistId}"
                  data-therapist="${esc(s.id)}">${esc(s.name)}</button>`).join('')}
      </div>
    </div>`;
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

function sameDayVisit(row, date) {
  return (ctx.queueInput.visitsBy[row.customerId] ?? [])
    .find((v) => v.date === date && isActive(v)) ?? null;
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

  const time = e.target.closest('[data-time]');
  if (time) return pickTime(time.dataset.time === view.startsAt ? null : time.dataset.time);

  for (const [attr, key] of [['equipment', 'equipmentId'], ['ivproduct', 'equipmentId'],
    ['therapist', 'therapistId'], ['room', 'roomKey']]) {
    const hit = e.target.closest(`[data-${attr}]`);
    if (hit) return pickOne(attr, key, hit.dataset[attr]);
  }

  if (e.target.closest('[data-add]')) return addSlot();
  if (e.target.closest('[data-skip]')) return mark('skipped');
  if (e.target.closest('[data-done]')) return mark('done');
  return null;
}

function onDeckChange(e) {
  if (e.target.matches('[data-othertime]')) pickTime(e.target.value || null, { fromInput: true });
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
  fields.innerHTML = entFields(row, picked);

  const add = deckEl()?.querySelector('[data-add]');
  if (add) add.disabled = !picked;
  showErrors([]);
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

  const course = picked.course;
  const [roomId, bed] = String(view.roomKey ?? '').split('|');

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
    attended: null,
  };

  const note = deckEl()?.querySelector('[data-note]')?.value?.trim() || null;

  // 同一天已經有來訪就併進去 —— 排班的原子單位是來訪（SPEC 第 4.4 節）
  const sameDay = sameDayVisit(selected, view.day);
  const visit = sameDay
    ? { ...sameDay, note, slots: [...(sameDay.slots ?? []), slot] }
    : {
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

  // SPEC 第 7 節規則 10：app 看不到 Abovee，這道確認就是她手寫的那兩個驚嘆號
  const ok = await confirmAction({
    title: '已經在 Abovee 壓好表了嗎？',
    consequences: [
      `${selected.customerName}・${shortDate(view.day)} ${slot.startsAt}–${slot.endsAt} ${course.name}`,
      sameDay ? '這一段會併進同一天已經有的來訪裡' : '這會建立一筆新的來訪',
      '會記成「已壓表，等客戶回覆」—— 系統登記等客人確認之後才產生',
    ],
    confirmLabel: '已確認，記錄',
  });
  if (!ok) return;

  try {
    await toast.withSaveState(() => visitsData.save(visit, customerVisits), { success: '記好了' });
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
