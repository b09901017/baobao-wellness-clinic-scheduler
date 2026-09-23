// 來訪的批次取消專區。
//
// 她 2026-09-08：
//
// > 於壓表頁右上角增設專屬功能按鈕…頂部支援客戶姓名搜尋，查詢後預設呈現該
// > 客戶在當前月份的所有預約，並支援平滑切換上個月、當月、下個月及未來月份。
// > 支援雙模式切換：清單模式、月曆模式（點選日期可展開當日預約清單供單獨
// > 勾選取消；支援長按進入多選模式，可連續點選複數日期進行整日批次取消
// > ——因應出國、突發請假情境）。
//
// ## 它推翻了 ADR-0056 的一半，而那是刻意的
//
// ADR-0056 說「改得動一筆來訪的只有日曆」，而且「留一條繞過去的路，等於那個
// 決定只做了一半」。那一支擋的是**不小心改到**：待辦中心、客戶詳情、進度追蹤
// 那三頁的列順手加一支鉛筆。
//
// 這一頁不是那一種。它是一個**明確的、只做一件事的入口** —— 她知道自己是來
// 取消的，跟日曆的長按選單是同一種東西。真正的情境是出國或請假：一次十幾段，
// 走日曆要點三十幾下。
//
// **但只給取消，不給改。** 改一筆仍然只有日曆。見 `docs/adr/0082`。
//
// ## 一份 picked，兩種模式
//
// 選了什麼只有一個來源：`state.picked`（`visitId:第幾段`）。月曆模式的
// 「整天選起來」是把那一天所有取消得掉的段丟進同一個 Set —— 兩份狀態的話，
// 她在月曆選完切到清單就會看到不一樣的數字。

import * as customersData from '../../data/customers.js';
import * as visitsData from '../../data/visits.js';
import * as config from '../../data/config.js';
import * as tasksData from '../../data/tasks.js';
import { isConfigured } from '../../data/sheetSync.js';
import {
  cancellableSlots, applyStatus, describeStatus, statusClass, slotStatus,
} from '../../domain/visits.js';
import { cancelConsequences } from '../../domain/consequences.js';
import { slotName, nameOf } from '../../domain/naming.js';
import { monthWeeks, WEEKDAY_HEADERS } from '../../domain/calendar.js';
import { todayISO, addMonths, shortDate, monthLabel } from '../../domain/dates.js';
import { timeLabel } from '../../domain/visitTime.js';
import { esc } from '../components/form.js';
import { confirmAction } from '../components/dialog.js';
import { wireLongPress } from '../components/actions.js';
import { pushLayer } from '../nav.js';
import { icon } from '../icons.js';
import { tip } from '../components/tip.js';
import * as toast from '../toast.js';
import { saveEach } from '../saveEach.js';

/** 她挑的那一位、在看哪個月、選了哪幾段。換人就整個重來。 */
const state = {
  customerId: null,
  month: null,
  mode: 'list',
  /** `visitId:第幾段`。**兩種模式共用這一份**，切過去數字才會一樣。 */
  picked: new Set(),
  /** 月曆模式下攤開的是哪一天（`null` = 都收著）。 */
  openDay: null,
  /** 長按進來的多選：點一天就是整天選起來／整天放掉。 */
  multi: false,
};

let ctx = null;

/**
 * 從別的畫面帶著一位客戶、一個月份進來。刪客戶被擋下來時用（`customerDetail.js`，
 * prelaunch-audit-2026-09-23/issues/08）—— 她要去收的就是那一位那幾天。
 */
export function openFor(customerId, month) {
  state.customerId = customerId;
  state.month = month;
  state.mode = 'list';
  state.picked.clear();
  state.openDay = null;
}

/**
 * 多選那一層。**畫面上多出來一層東西，就多一筆返回鍵退得掉的紀錄**
 * （`ui/nav.js` 的整個前提）—— 沒有它的話，她長按進了多選，按返回鍵是
 * 整個跳出這一頁，剛剛點的十幾天全部沒了。
 *
 * 存起來的 handle 一律問 `.active`，不問它是不是 null（`tests/nav.test.js`
 * 有一條原始碼掃描盯著）。
 */
let multiLayer = null;

const keyOf = (visitId, index) => `${visitId}:${index}`;

export async function render(el) {
  el.innerHTML = `${backLink()}<p class="muted">載入中…</p>`;

  try {
    const [customers, master] = await Promise.all([
      customersData.list(),
      config.loadAll(),
    ]);
    ctx = { el, customers, master, visits: [], settings: await config.getSettings() };
  } catch (err) {
    el.innerHTML = `${backLink()}
      <div class="card"><p>讀取失敗：${esc(err.message)}</p></div>`;
    return;
  }

  state.month ??= todayISO().slice(0, 7);
  // `state` 活得比這一頁久（她從別的畫面繞回來時想接著剛剛那一位），
  // 但**多選那一層活不過換頁** —— nav 換頁時會把 stack 清光。留著 `multi`
  // 的話，回來看到的是多選中的橫幅，而返回鍵按了沒反應。
  setMulti(false);
  if (state.customerId) await loadVisits();
  paint();
}

const backLink = () =>
  `<a class="backlink" href="#/schedule">${icon('left', { size: 17 })}壓表</a>`;

/** 那一位的全部來訪。**點一位才讀** —— 這一頁一開始只需要名字。 */
async function loadVisits() {
  try {
    ctx.visits = await visitsData.listByCustomer(state.customerId);
  } catch {
    ctx.visits = [];
  }
}

// ---------- 這個月有哪幾段 ----------

/**
 * 那一位在這個月、**現在取消得掉**的那幾段，照日期與時間排。
 *
 * 「取消得掉」只寫在 `domain/visits.js` 的 `cancellableSlots()` ——
 * 畫面不自己比狀態（同 `visitActions()` 的規矩，ADR-0006）。
 */
function rowsOfMonth() {
  const out = [];
  for (const visit of ctx.visits) {
    if (!String(visit.date ?? '').startsWith(state.month)) continue;
    for (const { slot, index } of cancellableSlots(visit)) {
      out.push({ visit, slot, index, key: keyOf(visit.id, index) });
    }
  }
  return out.sort((a, b) => String(a.visit.date).localeCompare(String(b.visit.date))
    || String(a.slot.startsAt ?? '').localeCompare(String(b.slot.startsAt ?? '')));
}

/** 那幾段照日期分組。清單與月曆都要。 */
function byDate(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.visit.date)) map.set(row.visit.date, []);
    map.get(row.visit.date).push(row);
  }
  return map;
}

/** 這一段那天做什麼、在哪、跟誰。跟日／週那一列同一種寫法（`slotName()`）。 */
function slotLine(row) {
  const { slot } = row;
  const room = ctx.master.rooms?.find((r) => r.id === slot.roomId);
  const who = ctx.master.staff?.find((s) => s.id === slot.therapistId);
  const where = [room ? nameOf(room, 'short') : null, who?.name].filter(Boolean).join('・');
  const what = slotName(slot, ctx.master, 'short') || '（沒有課程）';
  return `${timeLabel(slot)}　${what}${where ? `・${where}` : ''}`;
}

// ---------- 畫面 ----------

function paint() {
  const picked = state.customerId ? rowsOfMonth().filter((r) => state.picked.has(r.key)) : [];

  // 整頁包一層是為了底下那一條：`.bulkbar` 是 `position: sticky; bottom: 0`，
  // 而 **sticky 不會把元素往下推** —— 只勾一天時整頁撐不滿一個視窗，它就停在
  // 內容正下方，底下還有半個螢幕空白卻帶著邊線與往上打的陰影。
  // 她 2026-09-10：「這個區域很突兀，有種懸空的感覺」。
  //
  // `.bulkpage` 是 `min-height: 100dvh` 的直排，底下那一條 `margin-top: auto`
  // 就排到底了；捲得動的時候 sticky 照樣把它釘住。
  ctx.el.innerHTML = `
    <div class="bulkpage">
      ${backLink()}

      <div class="page">
        <h1 class="page__title">批次取消${tip(
          '出國或請假的時候，一次把那幾段收掉。這一頁只取消，要改時間去日曆。')}</h1>
      </div>

      ${state.customerId ? pickedHtml() : searchHtml()}
      ${picked.length ? barHtml(picked) : ''}
    </div>`;

  wire();
}

/** 還沒挑人：一個搜尋框，打字才列名字。 */
function searchHtml() {
  const q = (ctx.q ?? '').trim();
  const hits = q
    ? ctx.customers.filter((c) => !c.deletedAt && String(c.name ?? '').includes(q)).slice(0, 20)
    : [];

  return `
    <section class="card">
      <label class="field">
        <span class="visually-hidden">找人</span>
        <input type="text" data-q value="${esc(q)}" style="width: 100%"
               placeholder="找人：打名字" enterkeyhint="search" autocomplete="off" />
      </label>

      ${q && !hits.length
        ? '<p class="muted">沒有這個名字。</p>'
        : ''}
      ${hits.length ? `
        <ul class="link-list">
          ${hits.map((c) => `
            ${/* 箭頭由 `.row-link::after` 畫。這裡再手寫一顆就是兩顆 ——
                   她 2026-09-10 看到的就是那個（同一個坑 8 月在「要壓哪個月」
                   那三顆上踩過一次，見 app.css 的 `.monthpick` 那一段）。 */''}
            <li><button class="row-link" type="button" data-pick="${esc(c.id)}">
              <span class="link-list__label">${esc(c.name)}</span>
            </button></li>`).join('')}
        </ul>` : ''}
      ${q ? '' : '<p class="muted">打名字找人，這裡會列出他那個月的來訪。</p>'}
    </section>`;
}

/** 挑好人之後：換月、換模式，底下是那個月的那幾段。 */
function pickedHtml() {
  const customer = ctx.customers.find((c) => c.id === state.customerId);
  const rows = rowsOfMonth();

  return `
    <section class="card">
      <div class="page__row" style="margin-bottom: var(--space-3)">
        <h2 class="card__title" style="margin: 0">${esc(customer?.name ?? '')}</h2>
        <button class="btn btn--sm" type="button" data-clear>換人</button>
      </div>

      <div class="calbar calbar--tight">
        <button class="calbar__nav" type="button" data-move="-1" aria-label="上個月">
          ${icon('left', { size: 18 })}</button>
        <h3 class="calbar__title">${esc(monthLabel(state.month))}
          <span class="num dim">${esc(state.month)}</span></h3>
        <button class="calbar__nav" type="button" data-move="1" aria-label="下個月">
          ${icon('right', { size: 18 })}</button>
      </div>

      <div class="seg seg--tabs" role="tablist" aria-label="怎麼看">
        <button class="seg__btn" type="button" role="tab" data-mode="list"
                aria-selected="${state.mode === 'list'}">清單</button>
        <button class="seg__btn" type="button" role="tab" data-mode="month"
                aria-selected="${state.mode === 'month'}">月曆</button>
      </div>

      ${rows.length
        ? (state.mode === 'list' ? listHtml(rows) : monthHtml(rows))
        : `<p class="muted">${esc(customer?.name ?? '')}${
            esc(monthLabel(state.month))}沒有可以取消的來訪。換個月看看。</p>`}
    </section>`;
}

/** 清單模式：一天一小段，底下一段一列。比照客戶那邊「看這個月的進度」。 */
function listHtml(rows) {
  return [...byDate(rows)].map(([date, items]) => `
    <div class="bulkday">
      <div class="bulkday__head">
        <span class="bulkday__date num">${esc(shortDate(date))}</span>
        <button class="bulkday__all" type="button" data-day-all="${esc(date)}">
          ${allPicked(items) ? '取消勾選' : '整天選起來'}</button>
      </div>
      ${items.map(slotRow).join('')}
    </div>`).join('');
}

/** 一段一列，點一下就是選／不選。 */
function slotRow(row) {
  const on = state.picked.has(row.key);
  const status = slotStatus(row.visit, row.slot);
  return `
    <button class="bulkrow ${on ? 'is-on' : ''}" type="button"
            data-slot="${esc(row.key)}" aria-pressed="${on}">
      <span class="bulkrow__box" aria-hidden="true">${on ? icon('check', { size: 14 }) : ''}</span>
      <span class="bulkrow__what">${esc(slotLine(row))}</span>
      <span class="badge ${esc(statusClass(status))}">${esc(describeStatus(status))}</span>
    </button>`;
}

/**
 * 月曆模式：一格一天，有預約的那幾天標一個點。
 *
 * 點一天 → 攤開那一天讓她逐段勾。
 * **長按一天 → 多選**：那之後點一天就是整天選起來／整天放掉，
 * 因為「出國那五天全部取消」是這一頁存在的理由。
 */
function monthHtml(rows) {
  const days = byDate(rows);
  const open = state.openDay && days.has(state.openDay) ? state.openDay : null;

  return `
    ${state.multi ? `
      <p class="bulkhint">
        <span>多選中 —— 點日期整天選起來</span>
        <button class="btn btn--sm" type="button" data-multi-off>完成</button>
      </p>` : ''}

    <div class="bulkcal" role="grid">
      ${WEEKDAY_HEADERS.map((w) => `<span class="bulkcal__wd">${esc(w)}</span>`).join('')}
      ${monthWeeks(state.month).flat().map((cell) => dayCell(cell, days)).join('')}
    </div>

    ${open ? `
      <div class="bulkday bulkday--open">
        <div class="bulkday__head">
          <span class="bulkday__date num">${esc(shortDate(open))}</span>
          <button class="bulkday__all" type="button" data-day-all="${esc(open)}">
            ${allPicked(days.get(open)) ? '取消勾選' : '整天選起來'}</button>
        </div>
        ${days.get(open).map(slotRow).join('')}
      </div>` : ''}`;
}

function dayCell(cell, days) {
  const items = days.get(cell.date) ?? [];
  const n = items.length;
  const on = n > 0 && allPicked(items);
  const some = !on && items.some((r) => state.picked.has(r.key));

  return `
    <button class="bulkcal__day ${cell.inMonth ? '' : 'is-out'} ${on ? 'is-on' : ''}
                   ${some ? 'is-some' : ''} ${state.openDay === cell.date ? 'is-open' : ''}"
            type="button" role="gridcell"
            ${n ? `data-day="${esc(cell.date)}" data-longpress` : 'disabled'}
            aria-pressed="${on}"
            aria-label="${esc(shortDate(cell.date))}${n ? `，${n} 段` : '，沒有來訪'}">
      <span class="bulkcal__n num">${Number(cell.date.slice(-2))}</span>
      ${n ? `<span class="bulkcal__dot" aria-hidden="true">${n > 1 ? n : ''}</span>` : ''}
    </button>`;
}

const allPicked = (items) => Boolean(items?.length) && items.every((r) => state.picked.has(r.key));

/** 底下那一條：選了幾段、按下去取消。**沒選就整條不畫。** */
function barHtml(picked) {
  const days = new Set(picked.map((r) => r.visit.date)).size;
  return `
    <div class="bulkbar">
      <span class="bulkbar__count">選了 ${picked.length} 段<span class="dim">（${days} 天）</span></span>
      <button class="btn btn--primary btn--danger" type="button" data-go>
        取消這 ${picked.length} 段</button>
    </div>`;
}

// ---------- 互動 ----------

function wire() {
  const { el } = ctx;

  el.querySelector('[data-q]')?.addEventListener('input', (ev) => {
    ctx.q = ev.target.value;
    // 只重畫那一張卡，游標留在輸入框裡
    const card = el.querySelector('.card');
    if (!card) return;
    card.outerHTML = searchHtml();
    const box = el.querySelector('[data-q]');
    if (box) {
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    }
    wire();
  });

  el.querySelectorAll('[data-pick]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      state.customerId = btn.dataset.pick;
      state.picked.clear();
      state.openDay = null;
      setMulti(false);
      await loadVisits();
      paint();
    }),
  );

  el.querySelector('[data-clear]')?.addEventListener('click', () => {
    state.customerId = null;
    state.picked.clear();
    setMulti(false);
    ctx.visits = [];
    paint();
  });

  el.querySelectorAll('[data-move]').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.month = addMonths(`${state.month}-01`, Number(btn.dataset.move)).slice(0, 7);
      // **換月不清掉已經選的** —— 她可能要一次收掉月底加月初那幾天
      state.openDay = null;
      paint();
    }),
  );

  el.querySelectorAll('[data-mode]').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.mode = btn.dataset.mode;
      state.openDay = null;
      // 清單模式沒有多選這回事，那一層留著的話返回鍵會按不出東西
      setMulti(false);
      paint();
    }),
  );

  el.querySelectorAll('[data-slot]').forEach((btn) =>
    btn.addEventListener('click', () => {
      toggle(btn.dataset.slot);
      repaintPick(btn.dataset.slot);
    }),
  );

  el.querySelectorAll('[data-day-all]').forEach((btn) =>
    btn.addEventListener('click', () => {
      toggleDay(btn.dataset.dayAll);
      paint();
    }),
  );

  el.querySelectorAll('[data-day]').forEach((btn) =>
    btn.addEventListener('click', () => {
      // 多選模式下點一天＝整天選起來；平常是攤開那一天讓她逐段勾
      if (state.multi) toggleDay(btn.dataset.day);
      else state.openDay = state.openDay === btn.dataset.day ? null : btn.dataset.day;
      paint();
    }),
  );

  // 長按一天 → 進多選，而且那一天先選起來（她長按的就是第一天）
  const grid = el.querySelector('.bulkcal');
  if (grid) {
    wireLongPress(grid, '[data-day]', (btn) => {
      setMulti(true);
      state.openDay = null;
      toggleDay(btn.dataset.day);
      paint();
    });
  }

  el.querySelector('[data-multi-off]')?.addEventListener('click', () => {
    setMulti(false);
    paint();
  });

  el.querySelector('[data-go]')?.addEventListener('click', () => run());
}

/**
 * 進／出多選，**而且同時管那一層**。
 *
 * 三條出去的路都走它：右上角那顆「完成」、返回鍵、以及換人／換月／換模式
 * （那時候多選已經沒有意義了）。各寫一次的話，總有一條會把層留在那裡，
 * 而症狀是「返回鍵按了一下沒反應」。
 */
function setMulti(on) {
  state.multi = on;
  if (on) {
    if (!multiLayer?.active) {
      multiLayer = pushLayer(() => {
        state.multi = false;
        paint();
      });
    }
    return;
  }
  multiLayer?.pop();
  multiLayer = null;
}

function toggle(key) {
  if (state.picked.has(key)) state.picked.delete(key);
  else state.picked.add(key);
}

/**
 * 勾一段**只換真的變了的那三塊**，不整頁重來（ADR-0038）。
 *
 * 她一次要點十幾下，而整頁重畫的代價是閃一下加捲回最上面。還有第二個代價：
 * **節點是新的，CSS 的過場根本跑不起來** —— `.bulkrow__box` 上那條
 * `transition` 寫了也等於沒寫，瀏覽器沒有起點可以動。
 *
 * 三塊：那一列自己、它那一天的格子（月曆模式下的半選／全選要跟著變）、
 * 底下那一條。整天選起來（`toggleDay()`）仍然走 `paint()` —— 那一下本來就
 * 換掉一整天，而且只有一下。
 */
function repaintPick(key) {
  const row = rowsOfMonth().find((r) => r.key === key);
  if (!row) return;
  const on = state.picked.has(key);

  // 屬性比對不用選擇器 —— key 裡有冒號，湊選擇器要另外跳脫
  const btn = [...ctx.el.querySelectorAll('[data-slot]')].find((b) => b.dataset.slot === key);
  if (btn) {
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', String(on));
    const box = btn.querySelector('.bulkrow__box');
    if (box) box.innerHTML = on ? icon('check', { size: 14 }) : '';
  }

  repaintDayCell(row.visit.date);
  repaintBar();
}

/** 月曆上那一格的全選／半選。清單模式下沒有那一格，那就什麼都不用做。 */
function repaintDayCell(date) {
  const cell = [...ctx.el.querySelectorAll('[data-day]')].find((b) => b.dataset.day === date);
  if (!cell) return;
  const items = rowsOfMonth().filter((r) => r.visit.date === date);
  const all = allPicked(items);
  cell.classList.toggle('is-on', all);
  cell.classList.toggle('is-some', !all && items.some((r) => state.picked.has(r.key)));
  cell.setAttribute('aria-pressed', String(all));
}

/** 底下那一條。**沒選就整條拿掉** —— 留一條寫著 0 的比不畫還吵。 */
function repaintBar() {
  const picked = rowsOfMonth().filter((r) => state.picked.has(r.key));
  const old = ctx.el.querySelector('.bulkbar');

  if (!picked.length) {
    old?.remove();
    return;
  }
  if (old) old.remove();
  // **插在 `.bulkpage` 裡面，跟 `paint()` 同一個位置。** 以前插在 `ctx.el`
  // 最後面：勾一段走這裡、整天選起來走 `paint()`，同一條橫幅兩種 DOM ——
  // 外面那一種排不到 `margin-top: auto` 的底（`.scratch/asks-2026-09-13/issues/01`）。
  (ctx.el.querySelector('.bulkpage') ?? ctx.el).insertAdjacentHTML('beforeend', barHtml(picked));
  // 重畫過的節點沒有監聽器了，這一顆要自己接回去
  ctx.el.querySelector('[data-go]')?.addEventListener('click', () => run());
}

/** 整天選起來／整天放掉。已經全選就是放掉，其餘一律變成全選。 */
function toggleDay(date) {
  const items = rowsOfMonth().filter((r) => r.visit.date === date);
  if (!items.length) return;
  const off = allPicked(items);
  for (const row of items) {
    if (off) state.picked.delete(row.key);
    else state.picked.add(row.key);
  }
}

// ---------- 真的取消 ----------

/**
 * 確認 → 一筆一筆存。
 *
 * **不開新的批次寫入 API**：走既有的 `visitsData.save()`，一筆來訪一次。
 * 每一次都要重算次數與任務，硬塞進同一個 commit 會超過 Firestore
 * 一批 500 個操作的上限（同待辦中心確認動線那一段的理由）。
 *
 * **中途失敗不回滾**：已經取消掉的那幾筆是真的取消了，退回去只會讓資料
 * 跟 Abovee 上的更對不起來。講出「成功幾筆、剩幾筆」比假裝什麼都沒發生好
 * （SPEC 第 6.9 節）。
 */
async function run() {
  const picked = rowsOfMonth().filter((r) => state.picked.has(r.key));
  if (!picked.length) return;

  const coursesById = Object.fromEntries((ctx.master.courses ?? []).map((c) => [c.id, c]));

  // 一筆來訪可能被選了好幾段 —— 收成「這一筆要取消哪幾段」
  const byVisit = new Map();
  for (const row of picked) {
    if (!byVisit.has(row.visit.id)) byVisit.set(row.visit.id, { visit: row.visit, at: [] });
    byVisit.get(row.visit.id).at.push(row.index);
  }

  // 會被收掉哪幾張要問那幾筆的任務。**點下去才讀**，讀不到就少講那幾句。
  let tasks = [];
  try {
    tasks = (await Promise.all([...byVisit.keys()].map((id) => tasksData.listByVisitForSync(id)))).flat();
  } catch {
    /* 少講幾句，不擋 */
  }

  // 後果那幾句**一個字都不自己寫**：走 `cancelConsequences()`，逐筆算完去重
  // （同一種只講一次）。那正是「提醒集中派生」要的東西。
  //
  // **那一筆要取消哪幾段一起傳進去。** 只傳第一段的話，「剩下的 N 段」會把
  // 同一批要取消的其他段也算成剩下的 —— 她看到「剩下的 2 段不受影響」，
  // 存完只剩 1 段。挑滿整天要講整天那種話，也由 domain 判斷（這裡比一次
  // `at.length === slots.length` 就是第二份會分岔的規則）。
  //
  // 試算表那一句也走它：`sheetSyncOn` 進去，`SHEET_LINE` 出來。在這裡自己
  // 寫一次的話，`data/sheetSync.js` 的 QUIET_MS 改了這一頁不會跟著改。
  const said = new Set();
  for (const { visit, at } of byVisit.values()) {
    const lines = cancelConsequences({
      visit, coursesById, tasks, slotIndex: at, sheetSyncOn: isConfigured(ctx.settings),
    });
    for (const line of lines) said.add(line);
  }

  const ok = await confirmAction({
    title: `取消這 ${picked.length} 段？`,
    consequences: [
      ...picked.map((r) => `${shortDate(r.visit.date)}　${slotLine(r)}`),
      '——',
      ...said,
    ],
    confirmLabel: `取消這 ${picked.length} 段`,
    danger: true,
  });
  if (!ok) return;

  // 存好的那幾筆，toast 的重試跳過（`saveEach()`，prelaunch-audit-2026-09-23/issues/18）
  const saved = new Set();
  try {
    await toast.withSaveState(() => saveEach([...byVisit.values()], async ({ visit, at }) => {
      // 逐段套用，整筆的狀態由 `applyStatus()` 自己推（ADR-0081）
      let next = visit;
      for (const slotIndex of at) next = applyStatus(next, 'cancelled', { slotIndex });
      // 手上那一份要跟著更新：下一筆算次數時讀的就是它
      ctx.visits = [...ctx.visits.filter((v) => v.id !== next.id), next];
      await visitsData.save(next, ctx.visits);
    }, saved), {
      success: `取消了 ${picked.length} 段`,
      // 跨多個 commit 的動作給不出正確的復原（見 data/repo.js 的 withUndo）
      undoable: false,
      key: `bulkCancel:${state.customerId}:${state.month}`,
    });
    state.picked.clear();
  } catch {
    // 已經成功的那幾筆**留著**，講出還剩幾筆
    if (saved.size) toast.info(`取消了 ${saved.size} 筆來訪，還有 ${byVisit.size - saved.size} 筆沒成功，再試一次`);
  }

  await loadVisits();
  paint();
}
