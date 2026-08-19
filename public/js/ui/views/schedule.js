// 壓表模式。SPEC 第 8.2 節、ADR-0014。核心畫面。
//
// **一批是一個月的一串客戶，不是一個課程。** 她面對的是公司系統上的一張時段表，
// 看到空的就搶，而且習慣把一個客人的所有課程壓完再換下一個人。
//
// 兩層：**客戶卡片牆**（一次看到多位，自己決定先處理誰）→ **記錄**（挑日子、記下來）。
// `< 900px` 是兩個畫面，`≥ 900px` 用 .split 並存。純 CSS 切換，不偵測裝置型號。
//
// 這一頁**不出建議時段**（ADR-0002）。它的工作是把判斷所需的資訊攤開、
// 把結果記下來。排序只是預設順序，她隨時可以跳著點。
//
// 佇列順序在批次建立當下凍結（ADR-0001 的 Consequences）——
// 換裝置回來不會發現順序跳掉。但每一列的即時資訊仍然現算。

import * as config from '../../data/config.js';
import * as customersData from '../../data/customers.js';
import * as visitsData from '../../data/visits.js';
import * as batchesData from '../../data/batches.js';
import * as eventsData from '../../data/events.js';
import {
  buildCustomerQueue, newBatch, progressOf, markInQueue, nextPending, monthRange, strongestReason,
} from '../../domain/scheduling.js';
import { dayStatus } from '../../domain/availability.js';
import { blockedDates } from '../../domain/events.js';
import { INITIAL_STATUS, validateVisit, isActive, coursesForEntitlement } from '../../domain/visits.js';
import { annotateOptions } from '../../domain/contraindications.js';
import { roomSlots, roomsForCourse } from '../../domain/masterData.js';
import { endOf, isValidTime, timeLabel, nextStart, toMinutes, toHHMM } from '../../domain/visitTime.js';
import { todayISO, addMonths, addDays, shortDate, weekdayLabel, lastDayOf } from '../../domain/dates.js';
import * as f from '../components/form.js';
import { confirmAction } from '../components/dialog.js';
import { icon } from '../icons.js';
import * as toast from '../toast.js';
import { go } from '../router.js';

const esc = f.esc;

// 開著的批次、選中的客戶與那一位的記錄狀態留在模組層：
// 從客戶詳情繞回來時，她想接著剛剛那一位。
const view = {
  batchId: null,
  customerId: null,
  filter: 'todo',
  // 記錄面板的暫存選擇。換人就清掉 —— 帶著上一位的選擇進來太容易記錯。
  day: null,
  entitlementId: null,
  startsAt: null,
  equipmentId: null,
  therapistId: null,
  roomKey: null,
};

function resetPicks() {
  Object.assign(view, {
    day: null, entitlementId: null, startsAt: null,
    equipmentId: null, therapistId: null, roomKey: null,
  });
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
      <p class="card__note">開始之後會照「限制多的、快到期的先看」排好，但那只是預設順序 ——
        想先弄誰就點誰。</p>
      <div class="chips" role="group">
        ${months.map((m, i) => `
          <button class="chip" type="button" role="button"
                  aria-pressed="${i === 0}" data-month="${esc(m)}">${esc(m)}</button>`).join('')}
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

function openRow(b) {
  const p = progressOf(b);
  return `<li><button class="row-link" type="button" data-open-batch="${esc(b.id)}">
    <span class="link-list__label">${esc(b.targetMonth)}</span>
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

// ---------- 批次 ----------

async function paintBatch(el) {
  const batch = await batchesData.get(view.batchId);
  if (!batch) {
    view.batchId = null;
    return render(el);
  }

  const data = await loadAll(batch.targetMonth);

  // 順序凍結：照 batch.queue 的順序排，不重新排序。即時資訊照樣現算。
  const ids = new Set((batch.queue ?? []).map((q) => q.customerId));
  const live = new Map(
    buildCustomerQueue({
      ...data.queueInput,
      targetMonth: batch.targetMonth,
      customers: data.queueInput.customers.filter((c) => ids.has(c.id)),
      includeUsedUp: true,
    }).map((r) => [r.customerId, r]),
  );

  const rows = (batch.queue ?? []).map((q) => ({
    ...q,
    ...(live.get(q.customerId) ?? { customerName: q.customerName, reasons: [], pools: [] }),
  }));

  paint({ el, batch, rows, ...data });
}

const FILTERS = [
  { id: 'todo', label: '還沒壓', match: (r) => r.state !== 'done' && r.scheduledThisMonth === 0 },
  { id: 'all', label: '全部', match: () => true },
  { id: 'noask', label: '沒問過時間', match: (r) => r.needsAvailability },
  { id: 'expiring', label: '快到期', match: (r) => r.daysToExpiry !== null && r.daysToExpiry <= 60 },
];

function paint(ctx) {
  const { el, batch, rows } = ctx;
  // 每次重畫都重新認一次選中的是誰 —— 用 ctx 上的舊值會畫出上一位
  ctx.selected = rows.find((r) => r.customerId === view.customerId) ?? null;
  const selected = ctx.selected;
  const p = progressOf(batch);
  const filter = FILTERS.find((x) => x.id === view.filter) ?? FILTERS[1];
  const shown = rows.filter(filter.match);

  el.innerHTML = `
    <div class="page">
      <div class="page__row">
        <div>
          <h1 class="page__title">壓表</h1>
          <p class="page__lead num">${esc(batch.targetMonth)}・一個人壓完再換下一個</p>
        </div>
        <button class="btn" type="button" data-close>結束這批</button>
      </div>
    </div>

    <section class="card card--flat">
      <div class="row">
        <span class="row__main" style="font-size: var(--text-sm); font-weight: 700; color: var(--text-dim)">
          這個月已壓
        </span>
        <span class="num ser" style="font-size: var(--text-lg); font-weight: 700">
          ${p.handled} <span class="dim" style="font-weight: 500">/ ${p.total} 位</span>
        </span>
      </div>
      <div class="meter"><span class="meter__done" style="width: ${pct(p.handled, p.total)}"></span></div>
    </section>

    <div class="split ${selected ? 'split--focused' : ''}">
      <div class="split__list">
        <div class="chips" style="margin-bottom: var(--space-3)">
          ${FILTERS.map((x) => `
            <button class="chip" type="button" aria-pressed="${x.id === view.filter}"
                    data-filter="${x.id}">${esc(x.label)}
              <span class="num">&nbsp;${rows.filter(x.match).length}</span></button>`).join('')}
        </div>
        <p class="muted" style="margin: 0 0 var(--space-3)">
          順序是算出來的預設值 —— 限制多的、快到期的排前面。想先弄誰就點誰。</p>
        ${shown.length
          ? shown.map((r) => custCard(r, r.customerId === view.customerId)).join('')
          : '<p class="muted">這個篩選底下沒有人。</p>'}
      </div>
      <div class="split__detail">
        ${selected ? recordPanel(ctx, selected) : '<p class="muted">選一位開始。</p>'}
      </div>
    </div>`;

  wire(ctx);
}

const pct = (n, total) => `${total ? Math.round((n / total) * 100) : 0}%`;

// ---------- 客戶卡片 ----------

/**
 * 卡片上最大的一塊是「不能的時間」 —— 那是她在公司系統上挑格子時
 * 唯一需要一直對照的東西（SPEC 第 8.2 節）。
 */
function custCard(row, isSelected) {
  const strongest = strongestReason(row);
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
      <span class="row" style="align-items: flex-start">
        <span class="row__main">
          <span class="row__title">
            ${esc(row.customerName ?? '?')}
            ${row.priority ? `<span class="stars">${'★'.repeat(row.priority)}</span>` : ''}
            ${(row.flags ?? []).map((x) => `<span class="flag">${esc(x)}</span>`).join('')}
          </span>
          ${strongest ? `<span class="muted dim">${esc(strongest.label)}</span>` : ''}
        </span>
        ${state}
      </span>

      ${banBlock(row)}

      <span class="poolchips">
        ${(row.pools ?? []).slice(0, 6).map(poolChip).join('')
          || '<span class="muted">沒有剩餘次數了</span>'}
      </span>

      <span class="custcard__meta">
        <span>這個月 ${row.scheduledThisMonth} 次・上個月 ${row.visitsPrevMonth} 次${
          row.daysSinceLast === null ? '・還沒上過課' : `・距上次 ${row.daysSinceLast} 天`}</span>
      </span>

      ${row.selfNote ? `
        <span class="selfnote">
          ${icon('alert', { size: 16 })}
          <span>${esc(row.selfNote)}</span>
        </span>` : ''}
    </button>`;
}

/** 不能的時間。解析出來的條件在上面，原文在下面而且比較大（SPEC 第 4.3 節）。 */
function banBlock(row) {
  if (row.needsAvailability) {
    return `
      <span class="ban ban--unknown" style="display: block">
        <span class="ban__head"><span>還沒問這輪的時間</span>
          <span class="ban__when">${row.collectedAt ? `上次 ${esc(row.collectedAt)}` : ''}</span></span>
        <span class="ban__raw">不知道他這個月哪幾天可以 —— 先傳訊息問。</span>
      </span>`;
  }

  const chips = (row.rules ?? [])
    .filter((r) => r.kind !== 'prefer')
    .map((r) => `<span class="ban__chip">${esc(describeShort(r))}</span>`)
    .join('');

  return `
    <span class="ban" style="display: block">
      <span class="ban__head"><span>不能的時間</span>
        <span class="ban__when">${row.collectedAt ? `${esc(row.collectedAt)} 收集` : ''}</span></span>
      ${chips ? `<span class="ban__chips">${chips}</span>` : ''}
      ${row.rawText ? `<span class="ban__raw">「${esc(row.rawText)}」</span>` : ''}
      <span class="ban__chips" style="margin-top: var(--space-2)">
        <span class="ban__chip">可用 ${row.availableDays} 天</span>
      </span>
    </span>`;
}

/** 卡片上的一行塞不下完整句子，這裡只給日期本身。完整的在原文裡。 */
function describeShort(rule) {
  if (rule.kind === 'exclude_weekday') return `每週${weekdayLabelOf(rule.weekday)}${partLabel(rule)}`;
  if (rule.kind === 'exclude_date') return `${short(rule.date)}${partLabel(rule)}`;
  if (rule.kind === 'exclude_range') return `${short(rule.from)}–${short(rule.to)}`;
  return '';
}

const WD = ['日', '一', '二', '三', '四', '五', '六'];
const weekdayLabelOf = (n) => WD[n] ?? '?';
const short = (iso) => (typeof iso === 'string' ? iso.slice(5).replace('-', '/') : '');
const partLabel = (r) => (r.partOfDay === 'am' ? '上午' : r.partOfDay === 'pm' ? '下午' : '');

function poolChip(pool) {
  return `<span class="poolchip ${pool.remaining <= 2 ? 'poolchip--low' : ''}">${esc(pool.label)}<b class="num">${pool.remaining}</b></span>`;
}

// ---------- 記錄面板 ----------

function recordPanel(ctx, row) {
  const entry = ctx.batch.queue.find((q) => q.customerId === row.customerId);
  const recorded = recordedSlots(ctx, row);

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
      ${row.rawText
        ? `<p class="card__note" style="margin-top: var(--space-2)">「${esc(row.rawText)}」<span class="dim">・${esc(row.collectedAt ?? '')} 收集</span></p>`
        : `<p class="card__note" style="margin-top: var(--space-2)">還沒問過這輪的時間。
            <button class="btn" type="button" data-ask="${esc(row.customerId)}"
                    style="min-height: 36px; margin-left: var(--space-2)">去記一次</button></p>`}
      ${blockedNote(ctx, row)}
    </section>

    <section class="card">
      <h3 class="card__title">挑日子</h3>
      ${miniCal(ctx, row)}
    </section>

    ${view.day ? dayPanel(ctx, row) : ''}

    <section class="card">
      <h3 class="card__title">這次壓好的<span class="muted"> ${recorded.length}</span></h3>
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
        <div class="form__actions">
          <button class="btn" type="button" data-skip>跳過</button>
          <button class="btn" type="button" data-back-list>回卡片牆</button>
        </div>
      </div>
      <p class="card__note" style="margin: var(--space-3) 0 0">
        按下去之後，${esc(row.customerName)} 會出現在待辦的「跟客人確認時間」。</p>
      ${entry?.skippedReason ? `<p class="muted">跳過的理由：${esc(entry.skippedReason)}</p>` : ''}
    </section>`;
}

function blockedNote(ctx, row) {
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
 * 挑日子。她說不行的日子劃掉不能點，已經記過的標起來。
 *
 * 用整月的格子而不是 chip 列表：這裡要挑的是「哪一天」，而月曆的形狀本身
 * 就帶著「這是禮拜幾」「離月底還有多久」兩個她需要的資訊。
 * 每格 46px 高，手機上按得到。
 */
function miniCal(ctx, row) {
  const { range, today, away } = ctx;
  const [y, m] = range.from.split('-').map(Number);
  const first = range.from;
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const has = recordedDays(ctx, row);

  const cells = [];
  for (let i = 0; i < lead; i += 1) {
    cells.push('<span class="minical__cell minical__cell--empty"></span>');
  }

  for (let d = 1; d <= lastDayOf(y, m); d += 1) {
    const iso = addDays(first, d - 1);
    const status = row.needsAvailability ? { available: true, reasons: [] } : dayStatus(row.rules ?? [], iso);
    const isAway = away.has(iso);
    const past = iso < today;
    const off = !status.available || isAway || past;

    const why = isAway ? '你這天休假' : past ? '已經過去了' : status.reasons.join('、');
    const classes = [
      'minical__cell',
      off ? 'minical__cell--off' : '',
      has.has(iso) ? 'minical__cell--has' : '',
      iso === view.day ? 'minical__cell--on' : '',
    ].filter(Boolean).join(' ');

    cells.push(`
      <button class="${classes}" type="button" data-day="${iso}" ${off ? 'disabled' : ''}
              title="${esc(why)}">
        ${d}<span class="minical__dot"></span>
      </button>`);
  }

  return `
    <div class="minical__head">
      <span class="minical__month num">${esc(range.from.slice(0, 7))}</span>
    </div>
    <div class="minical__grid">
      ${WD.map((w) => `<span class="minical__wd">${w}</span>`).join('')}
      ${cells.join('')}
    </div>
    <div class="minical__legend">
      <span><i class="minical__swatch"></i>可以排</span>
      <span><i class="minical__swatch minical__swatch--has"></i>已經記了</span>
      <span><i class="minical__swatch minical__swatch--off"></i>不能排</span>
    </div>`;
}

/** 這位客戶這個月已經被記在哪幾天。 */
function recordedDays(ctx, row) {
  const out = new Set();
  for (const v of ctx.queueInput.visitsBy[row.customerId] ?? []) {
    if (isActive(v) && v.date >= ctx.range.from && v.date <= ctx.range.to) out.add(v.date);
  }
  return out;
}

/** 這位客戶這個月已經記了哪些時段。 */
function recordedSlots(ctx, row) {
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

function dayPanel(ctx, row) {
  const { all } = ctx;
  const options = courseOptions(ctx, row);
  const picked = options.find((o) => o.entitlementId === view.entitlementId) ?? null;
  const course = picked?.course ?? null;
  const sameDay = sameDayVisit(ctx, row, view.day);

  return `
    <section class="card card--on">
      <div class="row" style="align-items: baseline">
        <h3 class="card__title row__main" style="margin: 0">
          ${esc(shortDate(view.day))}</h3>
        <span class="muted">${sameDay ? `這天已經記了 ${sameDay.slots.length} 段` : '這天還沒排東西'}</span>
      </div>

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

      ${course ? `
        <div class="fieldgroup">
          <span class="fieldgroup__label">幾點開始${course.durationMin ? `　${course.durationMin} 分鐘` : ''}</span>
          <div class="chips">
            ${timeChoices().map((t) => `
              <button class="chip" type="button" aria-pressed="${t === view.startsAt}"
                      data-time="${t}"><span class="num">${t}</span></button>`).join('')}
          </div>
          <label class="field" style="margin: var(--space-3) 0 0">
            <span class="field__label">上面沒有的時間</span>
            <input type="time" data-othertime value="${esc(view.startsAt ?? '')}" step="300" />
          </label>
        </div>

        ${course.requiresEquipment ? equipmentField(ctx, row, picked) : ''}
        ${course.requiresIvProduct ? ivField(all) : ''}
        ${course.assigns === 'therapist' ? therapistField(all) : ''}
        ${course.assigns === 'room' ? roomField(all, course) : ''}

        <label class="field">
          <span class="field__label">備註　這一天的</span>
          <input type="text" data-note maxlength="200"
                 value="${esc(sameDay?.note ?? '')}"
                 placeholder="例：她說下午比較好" />
        </label>

        <div class="errors" data-errors hidden></div>
        <button class="btn btn--primary btn--wide" type="button" data-add>加這一筆</button>
        <p class="card__note" style="margin: var(--space-3) 0 0">
          ${sameDay
            ? '這一段會併進同一天已經有的來訪裡 —— 排班的單位是「某人某天來一次」。'
            : '存下去會記成「已壓表，等客戶回覆」，並產生該做的系統登記。'}</p>
      ` : ''}
    </section>`;
}

/**
 * 這位客戶身上還排得動的課程。
 *
 * 擇一池沒有 courseId（ADR-0005），它對應的是「需要選器材的課程」，
 * 所以這裡走 coursesForEntitlement() 而不是自己判斷。
 */
function courseOptions(ctx, row) {
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

function equipmentField(ctx, row, picked) {
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

function sameDayVisit(ctx, row, date) {
  return (ctx.queueInput.visitsBy[row.customerId] ?? [])
    .find((v) => v.date === date && isActive(v)) ?? null;
}

// ---------- 事件 ----------

function wire(ctx) {
  const { el } = ctx;

  el.querySelector('[data-close]')?.addEventListener('click', () => closeBatch(ctx));

  el.querySelectorAll('[data-filter]').forEach((btn) =>
    btn.addEventListener('click', () => {
      view.filter = btn.dataset.filter;
      paint(ctx);
    }),
  );

  el.querySelectorAll('[data-pick]').forEach((btn) =>
    btn.addEventListener('click', () => {
      view.customerId = btn.dataset.pick;
      resetPicks();
      paint(ctx);
      el.querySelector('.split__detail')?.scrollIntoView({ block: 'start' });
    }),
  );

  el.querySelector('[data-back-list]')?.addEventListener('click', () => {
    view.customerId = null;
    resetPicks();
    paint(ctx);
  });

  el.querySelector('[data-ask]')?.addEventListener('click', (e) =>
    go(`/customers/${e.currentTarget.dataset.ask}`),
  );

  el.querySelectorAll('[data-day]').forEach((btn) =>
    btn.addEventListener('click', () => {
      view.day = btn.dataset.day;
      // 換一天就把時間清掉，其餘保留 —— 同一個人連著排兩天，
      // 課程與治療師通常一樣，時間才是要重挑的那一個。
      view.startsAt = defaultStart(ctx, ctx.selected, view.day);
      paint(ctx);
    }),
  );

  const pickInto = (attr, key) =>
    el.querySelectorAll(`[data-${attr}]`).forEach((btn) =>
      btn.addEventListener('click', () => {
        view[key] = btn.dataset[attr] === view[key] ? null : btn.dataset[attr];
        paint(ctx);
      }),
    );

  pickInto('ent', 'entitlementId');
  pickInto('time', 'startsAt');
  pickInto('equipment', 'equipmentId');
  pickInto('ivproduct', 'equipmentId');
  pickInto('therapist', 'therapistId');
  pickInto('room', 'roomKey');

  el.querySelector('[data-othertime]')?.addEventListener('change', (e) => {
    view.startsAt = e.target.value || null;
    paint(ctx);
  });

  el.querySelector('[data-skip]')?.addEventListener('click', () => mark(ctx, 'skipped'));
  el.querySelector('[data-done]')?.addEventListener('click', () => mark(ctx, 'done'));
  el.querySelector('[data-add]')?.addEventListener('click', () => addSlot(ctx));
}

/** 那天已經有來訪就接在最後一段後面，中間留設定裡的間隔。 */
function defaultStart(ctx, row, date) {
  const visit = row ? sameDayVisit(ctx, row, date) : null;
  const last = (visit?.slots ?? []).filter((s) => isValidTime(s.endsAt)).sort(
    (a, b) => toMinutes(b.endsAt) - toMinutes(a.endsAt),
  )[0];
  return last ? nextStart(last.endsAt, ctx.settings.slotGapMin) : null;
}

// ---------- 記一筆 ----------

async function addSlot(ctx) {
  const { el, selected, all } = ctx;
  if (!selected || !view.day) return;

  const errBox = el.querySelector('[data-errors]');
  const options = courseOptions(ctx, selected);
  const picked = options.find((o) => o.entitlementId === view.entitlementId);

  const show = (errors) => {
    if (!errBox) return;
    errBox.hidden = !errors.length;
    errBox.innerHTML = errors.length
      ? `<ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`
      : '';
  };

  if (!picked) return show(['先選要做什麼']);
  if (!isValidTime(view.startsAt)) return show(['先選幾點開始']);

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

  const note = el.querySelector('[data-note]')?.value?.trim() || null;

  // 同一天已經有來訪就併進去 —— 排班的原子單位是來訪（SPEC 第 4.4 節）
  const sameDay = sameDayVisit(ctx, selected, view.day);
  const visit = sameDay
    ? { ...sameDay, note, slots: [...(sameDay.slots ?? []), slot] }
    : {
        customerId: selected.customerId,
        customerName: selected.customerName,
        date: view.day,
        status: INITIAL_STATUS,
        confirmedAt: null, cancelledAt: null, cancelReason: null, released: null,
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

  show(errors);
  if (errors.length) return;

  // SPEC 第 7 節規則 10：app 看不到 Abovee，這道確認就是她手寫的那兩個驚嘆號
  const ok = await confirmAction({
    title: '已經在 Abovee 壓好表了嗎？',
    consequences: [
      `${selected.customerName}・${shortDate(view.day)} ${slot.startsAt}–${slot.endsAt} ${course.name}`,
      sameDay ? '這一段會併進同一天已經有的來訪裡' : '這會建立一筆新的來訪',
      '會記成「已壓表，等客戶回覆」，並自動產生該做的系統登記任務',
    ],
    confirmLabel: '已確認，記錄',
  });
  if (!ok) return;

  try {
    await toast.withSaveState(() => visitsData.save(visit, customerVisits), { success: '記好了' });
    // 記完把時段相關的選擇清掉，日期留著 —— 同一天常常要連記兩三段
    view.startsAt = null;
    view.entitlementId = null;
    render(el);
  } catch {
    /* 已處理 */
  }
}

// ---------- 進度 ----------

async function mark(ctx, state) {
  const { batch, selected } = ctx;
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
    render(ctx.el);
  } catch {
    /* 已處理 */
  }
}

async function closeBatch(ctx) {
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
