// 進度追蹤。SPEC 第 8.5 節底下的第二種看法，入口在客戶頁。
//
// **這一頁是唯讀的。** 使用者的原話：「進度追蹤那頁是唯讀的不能修改」。
// 所以它沒有任何會寫入的控制項 —— 點一筆浮出來的是讀取模式的卡片，
// 連鉛筆都沒有（ADR-0020：她點一筆的十次有九次只是要確認那天幾點、誰、做什麼）。
//
// 資料的整理在 domain/progress.js，狀態的顏色與說明在 domain/visits.js 的
// STATUS_VIEW。這一層一個規則都不寫 —— 她說「這一頁要和 todo 日曆對的上」，
// 而那件事只有在兩邊讀同一份定義時才保證成立。

import * as customersData from '../../data/customers.js';
import * as visitsData from '../../data/visits.js';
import * as config from '../../data/config.js';
import { buildProgress, PROGRESS_STATUSES } from '../../domain/progress.js';
import { statusClass, shortStatus, markFor, describeStatus } from '../../domain/visits.js';
import { monthRange } from '../../domain/scheduling.js';
import { todayISO, shortDate, addMonths } from '../../domain/dates.js';
import { timeLabel } from '../../domain/visitTime.js';
import { openCard } from '../components/card.js';
import { visitReadHtml } from './calendar.js';
import { esc } from '../components/form.js';
import { icon } from '../icons.js';

/** 看哪一個月。留在模組層：從別的頁回來時她想看到剛剛那個月。 */
let month = null;

/**
 * 這一次進來讀過的月份。她會來回翻，翻回去不該再查一次。
 *
 * **每次進這一頁都清掉**（見 `render()`）—— 這一頁最重要的保證是
 * 「和待辦、日曆對得上」，而她要改東西一定得離開這一頁，
 * 回來時看到的必須是改完的樣子。用一份跨頁存活的快取換一次查詢，
 * 換到的是一頁會騙人的畫面。
 */
const cache = new Map();

export async function render(el) {
  el.innerHTML = '<p class="muted">載入中…</p>';
  cache.clear();

  const today = todayISO();
  month ??= today.slice(0, 7);

  let customers;
  let master;
  try {
    [customers, ...master] = await Promise.all([
      customersData.list(),
      config.listAll('rooms'),
      config.listAll('staff'),
    ]);
  } catch (err) {
    el.innerHTML = `${backLink()}
      <div class="card"><p>讀取失敗：${esc(err.message)}</p></div>`;
    return;
  }

  const ctx = {
    el,
    today,
    // 已停用的不列 —— 客戶頁把他們收在另一顆切換底下，這裡跟著同一個規矩
    customers: customers.filter((c) => c.active !== false),
    roomsById: byId(master[0]),
    staffById: byId(master[1]),
  };

  await paint(ctx);
}

const byId = (rows) => Object.fromEntries((rows ?? []).map((r) => [r.id, r]));

/**
 * 最後一次要求畫的是哪一輪。
 *
 * 她會連按三下箭頭往回翻三個月，而三次查詢回來的順序不保證跟按的順序一樣 ——
 * 沒有這個號碼，畫面有機會停在中間那個月，而抬頭寫的是最後那個月。
 */
let painting = 0;

async function paint(ctx) {
  const { el } = ctx;
  const round = (painting += 1);
  const target = month;

  // 讀過的月份直接畫，不要閃一下「載入中」—— 她翻回去看的那一下最不需要等待感
  if (!cache.has(target)) el.innerHTML = `${backLink()}<p class="muted">載入中…</p>`;

  let visits;
  try {
    visits = await visitsOf(target);
  } catch (err) {
    if (round !== painting) return;
    el.innerHTML = `${backLink()}
      <div class="card"><p>讀取失敗：${esc(err.message)}</p>
        <p class="muted">如果訊息裡有建立索引的連結，點它建好之後再回來。</p></div>`;
    return;
  }

  // 有人在這中間又按了箭頭，讓他畫 —— 這一輪的結果已經過期了
  if (round !== painting) return;

  const data = buildProgress({ customers: ctx.customers, visits, month: target });
  el.innerHTML = bodyHtml(data, ctx, target);
  wire(ctx, data, visits);
}

async function visitsOf(target) {
  if (cache.has(target)) return cache.get(target);
  const range = monthRange(target);
  const rows = range ? await visitsData.listBetween(range.from, range.to) : [];
  cache.set(target, rows);
  return rows;
}

// ---------- 版面 ----------

function bodyHtml(data, ctx, target) {
  const thisMonth = ctx.today.slice(0, 7);

  return `
    ${backLink()}

    <div class="calbar calbar--tight">
      <button class="calbar__nav" type="button" data-move="-1" aria-label="上個月">
        ${icon('left', { size: 15 })}</button>
      <h1 class="calbar__title">${esc(monthTitle(target))}</h1>
      <button class="calbar__nav" type="button" data-move="1" aria-label="下個月">
        ${icon('right', { size: 15 })}</button>
      ${target === thisMonth ? '' : `
        <button class="chip chip--sm" type="button" data-this-month
                style="flex: 0 0 auto">這個月</button>`}
    </div>

    <p class="callegend">
      ${PROGRESS_STATUSES.map((s) => `
        <span class="callegend__item ${esc(statusClass(s))}">
          <span class="callegend__swatch" aria-hidden="true"></span>
          <span>${esc(markFor(s))} ${esc(shortStatus(s))}</span>
        </span>`).join('')}
    </p>

    <p class="muted" style="margin: 0 0 var(--space-3)">${esc(summaryLine(data))}</p>

    ${data.rows.length
      ? `<div class="cardgrid">${data.rows.map(customerCard).join('')}</div>`
      : ''}

    ${idleHtml(data.idle)}

    <p class="footnote">
      ${icon('info', { size: 14 })}
      <span>這一頁只給看的，改東西要到日曆。
        取消掉的時段不畫 —— 跟日曆一樣，時段已經還回去了。</span>
    </p>`;
}

function summaryLine(data) {
  const { totals } = data;
  // 空月份只講一次 —— 摘要與清單各講一遍同一句話，看起來像畫面卡住了
  // 底下那一排名字已經把人數講了，這裡不要再講一次
  if (!totals.slots) return totals.idle ? '這個月還沒有排任何人。' : '還沒有客戶。';
  const parts = PROGRESS_STATUSES
    .filter((s) => totals.tally[s])
    .map((s) => `${markFor(s)} ${totals.tally[s]}`);
  return `${totals.customers} 位・${totals.slots} 段　${parts.join('　')}`;
}

function customerCard(row) {
  return `
    <section class="card" style="margin: 0">
      <div class="row" style="align-items: flex-start">
        <div class="row__main">
          <div class="row__title">${esc(row.customerName)}${
            row.orphan ? ' <span class="badge badge--overdue">找不到這位客戶</span>' : ''}</div>
          <div class="muted num">${row.days.length} 天・${row.slotCount} 段</div>
        </div>
        <span class="chips" style="justify-content: flex-end">${tallyHtml(row.tally)}</span>
      </div>

      <div class="progdays">${row.days.map(progressDayHtml).join('')}</div>
    </section>`;
}

/** 那幾顆狀態小徽章（`△ 1`、`✓ 3`）。客戶詳情共用。 */
export function tallyHtml(tally) {
  return PROGRESS_STATUSES
    .filter((s) => tally[s])
    .map((s) => `
      <span class="badge ${esc(statusClass(s))}" title="${esc(describeStatus(s))}">
        ${esc(markFor(s))} ${tally[s]}</span>`)
    .join('');
}

/**
 * 一天一組、一段一列。**客戶詳情的「這個月」也用這一支**
 *
 * 名字帶 `progress` 前綴是為了跟 `views/calendar.js` 的 `dayHtml()` 分開 ——
 * 那一支吃的是 `(data, date, today)`、畫的是一整天的議程；這一支吃的是
 * 一位客戶的一天。客戶詳情同時 import 兩邊，撞名會讓人以為是同一件事。
 * （`.scratch/customer-detail-rework/issues/02`）—— 她要的就是「跟看這個月的
 * 進度那邊呈現的一樣」，而同一件事畫成兩種樣子會讓她以為是兩份資料。
 */
export function progressDayHtml(day) {
  return `
    <button class="progday" type="button" data-visit="${esc(day.visitId)}">
      <span class="progday__head">
        <span class="progday__date num">${esc(shortDate(day.date))}</span>
        ${day.statusAt
          ? `<span class="progday__at num">${esc(whenLabel(day.statusAt))} 更新</span>`
          : ''}
      </span>
      ${day.slots.map(slotHtml).join('')}
    </button>`;
}

function slotHtml(slot) {
  return `
    <span class="progslot ${esc(statusClass(slot.status))}">
      <span class="progslot__bar" aria-hidden="true"></span>
      <span class="progslot__when num">${esc(timeLabel(slot))}</span>
      <span class="progslot__what">${esc(slot.courseName ?? '（沒有課程）')}</span>
      <span class="progslot__state">${esc(markFor(slot.status))} ${
        esc(shortStatus(slot.status))}</span>
    </span>`;
}

/**
 * 這個月還沒排的人。
 *
 * 收成一排名字而不是一位一張卡：那是「還沒發生的事」，佔滿畫面會把真正
 * 要看的東西推下去。但也不能不列 —— 「誰這個月還沒排」正是她要掌握的一半。
 */
function idleHtml(idle) {
  if (!idle.length) return '';
  return `
    <div class="section">
      <h2 class="section__title">這個月還沒排</h2>
      <span class="section__n num">${idle.length} 位</span>
    </div>
    <div class="chips">
      ${idle.map((c) => `<span class="badge">${esc(c.name)}</span>`).join('')}
    </div>`;
}

/** `8/9`。她要的是「小小地記一下」，不是完整時間戳。 */
function whenLabel(iso) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return `${at.getMonth() + 1}/${at.getDate()}`;
}

function monthTitle(target) {
  const [y, m] = String(target).split('-');
  return `${y} 年 ${Number(m)} 月`;
}

function backLink() {
  return `<a class="backlink" href="#/customers">${icon('left', { size: 19 })}客戶</a>`;
}

// ---------- 互動（只有換月與看一筆，沒有任何會寫入的東西） ----------

function wire(ctx, data, visits) {
  ctx.el.querySelectorAll('[data-move]').forEach((btn) =>
    btn.addEventListener('click', () => {
      month = addMonths(`${month}-01`, Number(btn.dataset.move)).slice(0, 7);
      paint(ctx);
    }),
  );

  ctx.el.querySelector('[data-this-month]')?.addEventListener('click', () => {
    month = ctx.today.slice(0, 7);
    paint(ctx);
  });

  ctx.el.querySelectorAll('[data-visit]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const visit = visits.find((v) => v.id === btn.dataset.visit);
      if (!visit) return;
      // canEdit 是 false：這一頁不給改。要改她會自己去日曆（2026-08-25 起那是
      // 唯一的入口，ADR-0056），而那是一個明確的決定，不是在對帳的時候手滑。
      openCard({
        title: visit.customerName ?? '（沒有名字）',
        subtitle: `${esc(shortDate(visit.date))}・${esc(describeStatus(visit.status))}`,
        body: visitReadHtml(visit, ctx),
        canEdit: false,
      });
    }),
  );
}
