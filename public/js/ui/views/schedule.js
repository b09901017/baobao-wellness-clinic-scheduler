// 壓表模式。SPEC 第 8.2 節。核心畫面。
//
// 兩層：**綜覽**（一次看到多位客戶，自己決定先處理誰）→ **工單**（資訊攤開 + 快速記錄）。
// 綜覽不是大螢幕的加值，是主動線 —— 她有一半時間拿的是手機。
// `< 900px` 兩層是兩個畫面，`≥ 900px` 用 .split 並存。
//
// 這一頁**不出建議時段**（ADR-0002）。它的工作是把判斷所需的資訊一次攤開，
// 她自己決定後在 Abovee 填，再回這裡記錄。
//
// 佇列順序在批次建立當下凍結（ADR-0001 的 Consequences）——
// 換裝置回來不會發現順序跳掉。但每一列的即時資訊仍然現算。

import * as config from '../../data/config.js';
import * as customersData from '../../data/customers.js';
import * as visitsData from '../../data/visits.js';
import * as batchesData from '../../data/batches.js';
import {
  buildQueue, newBatch, progressOf, markInQueue, nextPending, monthRange, strongestReason,
} from '../../domain/scheduling.js';
import { dayStatus } from '../../domain/availability.js';
import { INITIAL_STATUS, validateVisit, isActive } from '../../domain/visits.js';
import { annotateOptions } from '../../domain/contraindications.js';
import { roomSlots, roomsForCourse } from '../../domain/masterData.js';
import { endOf, isValidTime } from '../../domain/visitTime.js';
import { todayISO, addMonths, shortDate, weekdayLabel, addDays } from '../../domain/dates.js';
import * as f from '../components/form.js';
import { confirmAction } from '../components/dialog.js';
import * as toast from '../toast.js';
import { go } from '../router.js';

const esc = f.esc;

// 開著的批次與選中的客戶留在模組層：從客戶詳情繞回來時，她想接著剛剛那一位。
const view = { batchId: null, customerId: null };

export async function render(el) {
  el.innerHTML = '<p class="muted">載入中…</p>';
  try {
    if (view.batchId) await paintBatch(el);
    else await paintStart(el);
  } catch (err) {
    el.innerHTML = `<div class="card"><p>讀取失敗：${esc(err.message)}</p></div>`;
  }
}

// ---------- 起點：選課程與月份 ----------

async function paintStart(el) {
  const [all, active] = await Promise.all([config.loadAll(), batchesData.listActive()]);
  const courses = all.courses.filter((c) => c.active !== false);
  const today = todayISO();
  const months = [today.slice(0, 7), addMonths(today, 1).slice(0, 7)];

  el.innerHTML = `
    <section class="card">
      <h2 class="card__title">壓表</h2>
      <p class="muted">先選課程與月份。整頁只會顯示與這個課程有關的資訊 ——
        壓復能的時候只要看到復能的剩餘次數就好。</p>

      <form data-form>
        ${f.select({
          name: 'courseId', label: '課程', value: courses[0]?.id ?? null,
          options: courses.map((c) => ({ value: c.id, label: c.name })),
        })}
        ${f.select({
          name: 'targetMonth', label: '月份', value: months[1],
          options: months.map((m) => ({ value: m, label: `${m.replace('-', ' 年 ')} 月` })),
        })}
        <div class="form__actions">
          <button class="btn btn--primary" type="submit">開始這一批</button>
        </div>
      </form>
    </section>

    <section class="card">
      <h2 class="card__title">臨時空出一格？</h2>
      <p class="muted">輸入日期、時間與課程，把補得上的人列出來 ——
        有人取消、或 Abovee 上突然空一格時用。</p>
      <p><a class="btn" href="#/schedule/backfill">時段反查</a></p>
    </section>

    ${active.length
      ? `<section class="card">
           <h2 class="card__title">還沒壓完的<span class="muted"> ${active.length}</span></h2>
           <ul class="link-list">
             ${active.map(batchRow).join('')}
           </ul>
           <p class="muted">進度存在雲端，換一台裝置打開就接著上次的位置繼續。</p>
         </section>`
      : ''}`;

  el.querySelector('[data-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = f.readForm(e.target);
    await startBatch(el, courses.find((c) => c.id === v.courseId), v.targetMonth);
  });

  el.querySelectorAll('[data-open-batch]').forEach((btn) =>
    btn.addEventListener('click', () => {
      view.batchId = btn.dataset.openBatch;
      view.customerId = null;
      render(el);
    }),
  );
}

function batchRow(b) {
  const p = progressOf(b);
  return `<li><button class="row-link" type="button" data-open-batch="${esc(b.id)}">
    ${esc(b.courseName ?? '?')} · ${esc(b.targetMonth ?? '?')}
    <span class="link-list__label">
      <span class="badge">已處理 ${p.handled} / ${p.total}</span>
      ${b.lastDeviceHint ? `<span class="badge">上次在${esc(b.lastDeviceHint)}</span>` : ''}
    </span>
  </button></li>`;
}

async function startBatch(el, course, targetMonth) {
  if (!course || !monthRange(targetMonth)) return;
  el.innerHTML = '<p class="muted">算佇列中…</p>';

  const data = await loadAll(course, targetMonth);
  const rows = buildQueue({ ...data.queueInput, course, targetMonth });

  if (!rows.length) {
    el.innerHTML = `
      <section class="card">
        <h2 class="card__title">${esc(course.name)} · ${esc(targetMonth)}</h2>
        <p>這個月沒有人要排這個課程。</p>
        <p class="muted">佇列只放「還有剩餘次數、而且這個月還沒排過這個課程」的人。</p>
        <p><button class="btn" type="button" data-back>回上一步</button></p>
      </section>`;
    el.querySelector('[data-back]').addEventListener('click', () => render(el));
    return;
  }

  try {
    const id = await toast.withSaveState(
      () => batchesData.create(newBatch({ course, targetMonth, rows })),
      { success: `${rows.length} 位待排` },
    );
    view.batchId = id;
    view.customerId = null;
    render(el);
  } catch {
    /* withSaveState 已顯示錯誤與重試 */
  }
}

// ---------- 讀資料 ----------

async function loadAll(course, targetMonth) {
  const range = monthRange(targetMonth);
  const today = todayISO();
  // 距上次上課要往回看一段，但不用看到天荒地老 —— 超過就一律算「很久沒來」
  const from = addDays(today, -180) < range.from ? addDays(today, -180) : range.from;

  const [all, customers, entitlementsBy, availabilityBy, visits, settings] = await Promise.all([
    config.loadAll(),
    customersData.list(),
    customersData.entitlementsByCustomer(),
    customersData.availabilityByCustomer(),
    visitsData.listBetween(from, range.to),
    config.getSettings(),
  ]);

  const visitsBy = {};
  for (const v of visits) (visitsBy[v.customerId] ??= []).push(v);

  return {
    all, settings, today, range,
    queueInput: {
      customers, entitlementsBy, visitsBy, availabilityBy, today,
      weights: settings.sortWeights,
    },
  };
}

// ---------- 批次：綜覽 + 工單 ----------

async function paintBatch(el) {
  const batch = await batchesData.get(view.batchId);
  if (!batch) {
    view.batchId = null;
    return render(el);
  }

  const data = await loadAll({ id: batch.courseId }, batch.targetMonth);
  const course = data.all.courses.find((c) => c.id === batch.courseId) ?? null;
  if (!course) {
    el.innerHTML = `<div class="card"><p>這批的課程已經被刪除了，沒辦法繼續。</p>
      <p><button class="btn" type="button" data-back>回壓表</button></p></div>`;
    el.querySelector('[data-back]').addEventListener('click', () => {
      view.batchId = null;
      render(el);
    });
    return;
  }

  // 順序凍結：照 batch.queue 的順序排，不重新排序。即時資訊照樣現算。
  const ids = new Set((batch.queue ?? []).map((q) => q.customerId));
  const live = new Map(
    buildQueue({
      ...data.queueInput,
      course,
      targetMonth: batch.targetMonth,
      customers: data.queueInput.customers.filter((c) => ids.has(c.id)),
      includeNotPending: true,
    }).map((r) => [r.customerId, r]),
  );

  const rows = (batch.queue ?? []).map((q) => ({
    ...q,
    ...(live.get(q.customerId) ?? { customerName: q.customerName, reasons: [] }),
  }));

  const ctx = { el, batch, course, rows, ...data };
  paint(ctx);
}

function paint(ctx) {
  const { el, batch, course, rows } = ctx;
  // 每次重畫都重新認一次選中的是誰 —— 用 ctx 上的舊值會畫出上一位
  ctx.selected = rows.find((r) => r.customerId === view.customerId) ?? null;
  const selected = ctx.selected;
  const p = progressOf(batch);

  el.innerHTML = `
    <section class="card">
      <div class="row">
        <div class="row__main">
          <div class="row__title">
            ${esc(course.name)} · ${esc(batch.targetMonth)}
            <span class="badge">已處理 ${p.handled} / ${p.total}</span>
          </div>
          <div class="muted">排序只是預設順序，可以跳著點。判斷是你的，這一頁不出建議時段。</div>
        </div>
        <div class="pool__actions">
          <a class="btn" href="#/schedule/backfill">時段反查</a>
          <button class="btn" type="button" data-close>結束這批</button>
        </div>
      </div>
    </section>

    <div class="split ${selected ? 'split--focused' : ''}">
      <div class="split__list">
        ${rows.map((r) => overviewRow(r, r.customerId === view.customerId)).join('')}
      </div>
      <div class="split__detail">
        ${selected ? workOrder(ctx, selected) : '<p class="muted">選一位開始。</p>'}
      </div>
    </div>`;

  wire(ctx);
}

// ---------- 綜覽的一列 ----------

function overviewRow(row, isSelected) {
  const strongest = strongestReason(row);
  const stateBadge = {
    done: '<span class="badge badge--ok">已壓表</span>',
    skipped: '<span class="badge">跳過</span>',
  }[row.state] ?? '';

  return `
    <button class="card row queue-row ${isSelected ? 'queue-row--on' : ''}"
            type="button" data-pick="${esc(row.customerId)}">
      <span class="row__main">
        <span class="row__title">
          ${esc(row.customerName ?? '?')}
          ${row.priority ? `<span class="badge badge--ok">★ ${row.priority}</span>` : ''}
          ${stateBadge}
          ${(row.flags ?? []).map((x) => `<span class="flag">${esc(x)}</span>`).join('')}
        </span>
        <span class="muted">
          剩 ${row.remaining ?? '?'} / ${row.total ?? '?'}
          ${row.availableDays === null ? '・還沒問時間' : `・可用 ${row.availableDays} 天`}
        </span>
        ${strongest ? `<span class="muted">${esc(strongest.label)}</span>` : ''}
      </span>
    </button>`;
}

// ---------- 工單 ----------

function workOrder(ctx, row) {
  const { course, all, range, today } = ctx;
  const entry = ctx.batch.queue.find((q) => q.customerId === row.customerId);
  const scheduled = scheduledVisits(ctx, row);

  return `
    <section class="card">
      <div class="row__title">
        ${esc(row.customerName)}
        ${row.priority ? `<span class="badge badge--ok">★ ${row.priority}</span>` : ''}
        ${(row.flags ?? []).map((x) => `<span class="flag">${esc(x)}</span>`).join('')}
      </div>
      <p class="muted">${esc(row.entitlementLabel ?? course.name)}
        剩 ${row.remaining} / ${row.total}
        ${row.reasons.map((x) => `・${esc(x.label)}`).join('')}</p>
      ${blockedNote(row, all.equipment)}
    </section>

    <section class="card">
      <h3 class="card__title">這輪問到的時間</h3>
      ${row.rawText
        ? `<p>${esc(row.rawText)}</p>
           <p class="muted">${esc(row.collectedAt ?? '')} 問的。解析錯了以這段原文為準。</p>
           ${dayPicker(row, range, today)}`
        : `<p class="muted">還沒問過這輪的時間。</p>
           <p><button class="btn" type="button" data-ask="${esc(row.customerId)}">去記一次詢問結果</button></p>`}
    </section>

    <section class="card">
      <h3 class="card__title">已排<span class="muted"> ${scheduled.length}</span></h3>
      ${scheduled.length
        ? `<ul class="link-list">${scheduled
            .map((s) => `<li><a href="#/visits/${esc(s.visitId)}">${esc(s.label)}</a></li>`)
            .join('')}</ul>`
        : '<p class="muted">還沒排。在 Abovee 壓完之後回來記一筆。</p>'}
      ${quickForm(ctx, row)}
    </section>

    <section class="card">
      <div class="form__actions">
        <button class="btn" type="button" data-skip>跳過</button>
        <button class="btn" type="button" data-back-list>回綜覽</button>
        <button class="btn btn--primary" type="button" data-done>
          ${entry?.state === 'done' ? '下一位 →' : '已壓表 →'}
        </button>
      </div>
      ${entry?.skippedReason ? `<p class="muted">跳過的理由：${esc(entry.skippedReason)}</p>` : ''}
    </section>`;
}

function blockedNote(row, equipment) {
  const blocked = annotateOptions({ flags: row.flags ?? [] }, equipment).filter((e) => e.blocked);
  if (!blocked.length) return '';
  return `<p class="muted">${blocked
    .map((e) => `${esc(e.name)} 不可使用 —— ${esc(e.reasons.join('、'))}禁忌`)
    .join('；')}</p>`;
}

/** 這位客戶這個月、這個課程已經排了哪幾筆。 */
function scheduledVisits(ctx, row) {
  const visits = ctx.queueInput.visitsBy[row.customerId] ?? [];
  const out = [];
  for (const v of visits) {
    if (!isActive(v) || v.date < ctx.range.from || v.date > ctx.range.to) continue;
    for (const s of v.slots ?? []) {
      if (s.courseId !== ctx.course.id) continue;
      const who = ctx.all.staff.find((x) => x.id === s.therapistId)?.name
        ?? ctx.all.rooms.find((x) => x.id === s.roomId)?.name ?? '';
      out.push({ visitId: v.id, label: `${shortDate(v.date)} ${s.startsAt}–${s.endsAt} ${who}`.trim() });
    }
  }
  return out;
}

/**
 * 可用日。`< 900px` 用 chip 列表，31 格日期條只在 iPad 橫式出現 ——
 * 手機寬度下每格只有 9px，看不清（SPEC 第 8.2 節）。兩者都由 CSS 切換，
 * 不偵測裝置型號。
 */
function dayPicker(row, range, today) {
  const free = new Set(row.availableDates ?? []);
  const days = [];
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) days.push(d);

  const chips = days
    .filter((d) => free.has(d) && d >= today)
    .map((d) => `<span class="chip">${Number(d.slice(8))}<small> ${weekdayLabel(d)}</small></span>`)
    .join('');

  const grid = days
    .map((d) => {
      const status = dayStatus(row.rules ?? [], d);
      const off = !free.has(d);
      return `<span class="day ${off ? 'day--off' : 'day--free'}"
                    title="${esc(status.reasons.join('、'))}">${Number(d.slice(8))}</span>`;
    })
    .join('');

  return `
    <p class="muted">可用日<span class="muted"> ${free.size} 天</span></p>
    <div class="chips daychips">${chips || '<span class="muted">這個月剩下的日子都不行。</span>'}</div>
    <div class="daygrid" aria-hidden="true">${grid}</div>`;
}

// ---------- 快速記錄 ----------

function quickForm(ctx, row) {
  const { course, all } = ctx;
  const equipment = poolEquipment(ctx, row);

  return `
    <form data-quick>
      <div class="errors" data-errors hidden></div>
      ${f.date({ name: 'date', label: '日期', value: firstUsableDay(ctx, row) })}
      ${f.time({ name: 'startsAt', label: '開始時間', value: '09:00' })}

      ${course.requiresEquipment
        ? f.select({
            name: 'equipmentId', label: '器材', value: null,
            options: [
              { value: null, label: '（請選擇）' },
              ...annotateOptions({ flags: row.flags ?? [] }, equipment).map((e) => ({
                value: e.id,
                label: e.blocked ? `✕ ${e.name}（${e.reasons.join('、')}，不可使用）` : e.name,
              })),
            ],
          })
        : ''}

      ${course.requiresIvProduct
        ? f.select({
            name: 'ivProductId', label: '營養點滴品項', value: null,
            options: [{ value: null, label: '（請選擇）' }, ...all.ivProducts.map((p) => ({ value: p.id, label: p.name }))],
          })
        : ''}

      ${course.assigns === 'therapist'
        ? f.select({
            name: 'therapistId', label: '治療師', value: null,
            options: [{ value: null, label: '（請選擇）' },
              ...all.staff.filter((s) => s.active !== false).map((s) => ({ value: s.id, label: s.name }))],
          })
        : ''}

      ${course.assigns === 'room' ? roomField(all, course) : ''}

      <div class="form__actions">
        <button class="btn btn--primary" type="submit">記一筆</button>
      </div>
      <p class="muted">時長依課程自動算。同一天已經有來訪的話，這一筆會併進去 ——
        排班的單位是「某人某天來一次」，不是一格一格分開的預約。</p>
    </form>`;
}

/** 預設帶她的第一個可用日 —— 省一次點選，但仍然改得動。 */
function firstUsableDay(ctx, row) {
  return (row.availableDates ?? []).find((d) => d >= ctx.today) ?? '';
}

function poolEquipment(ctx, row) {
  const ent = (ctx.queueInput.entitlementsBy[row.customerId] ?? [])
    .find((e) => e.id === row.entitlementId);
  if (ent?.type !== 'pool') return ctx.all.equipment;
  return (ent.optionEquipmentIds ?? [])
    .map((id) => ctx.all.equipment.find((e) => e.id === id))
    .filter(Boolean);
}

function roomField(all, course) {
  const allowed = new Set(roomsForCourse(course, all.rooms).map((r) => r.id));
  const options = roomSlots(all.rooms)
    .slice()
    .sort((a, b) => Number(allowed.has(b.roomId)) - Number(allowed.has(a.roomId)))
    .map((s) => ({
      value: `${s.roomId}|${s.bed ?? ''}`,
      label: allowed.has(s.roomId) ? s.label : `${s.label}（不是這個課程常用的）`,
    }));
  return f.select({ name: 'room', label: '診間', value: null, options: [{ value: null, label: '（請選擇）' }, ...options] });
}

// ---------- 事件 ----------

function wire(ctx) {
  const { el } = ctx;

  el.querySelector('[data-close]').addEventListener('click', () => closeBatch(ctx));

  el.querySelectorAll('[data-pick]').forEach((btn) =>
    btn.addEventListener('click', () => {
      view.customerId = btn.dataset.pick;
      paint(ctx);
      el.querySelector('.split__detail')?.scrollIntoView({ block: 'start' });
    }),
  );

  el.querySelector('[data-back-list]')?.addEventListener('click', () => {
    view.customerId = null;
    paint(ctx);
  });

  el.querySelector('[data-ask]')?.addEventListener('click', (e) =>
    go(`/customers/${e.target.dataset.ask}`),
  );

  el.querySelector('[data-skip]')?.addEventListener('click', () => mark(ctx, 'skipped'));
  el.querySelector('[data-done]')?.addEventListener('click', () => mark(ctx, 'done'));

  el.querySelector('[data-quick]')?.addEventListener('submit', (e) => {
    e.preventDefault();
    quickRecord(ctx, e.target);
  });
}

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
      { success: state === 'done' ? '這位處理完了' : '已跳過' },
    );
    view.customerId = next?.customerId ?? null;
    render(ctx.el);
  } catch {
    /* 已處理 */
  }
}

async function quickRecord(ctx, form) {
  const { selected, course, all, batch } = ctx;
  const v = f.readForm(form);

  const entitlementId = selected.entitlementId;
  const ent = (ctx.queueInput.entitlementsBy[selected.customerId] ?? [])
    .find((e) => e.id === entitlementId);
  const durationMin = ent?.durationMin ?? course.durationMin ?? 60;
  const [roomId, bed] = String(v.room ?? '').split('|');

  const slot = {
    entitlementId,
    courseId: course.id,
    courseName: course.name,
    equipmentId: course.requiresEquipment ? (v.equipmentId ?? null) : null,
    ivProductId: course.requiresIvProduct ? (v.ivProductId ?? null) : null,
    startsAt: v.startsAt,
    endsAt: isValidTime(v.startsAt) ? endOf(v.startsAt, durationMin) : null,
    roomId: course.assigns === 'room' ? (roomId || null) : null,
    bed: course.assigns === 'room' ? (bed || null) : null,
    therapistId: course.assigns === 'therapist' ? (v.therapistId ?? null) : null,
    attended: null,
  };

  // 同一天已經有來訪就併進去 —— 排班的原子單位是來訪（SPEC 第 4.4 節）
  const sameDay = (ctx.queueInput.visitsBy[selected.customerId] ?? [])
    .find((x) => x.date === v.date && isActive(x));

  const visit = sameDay
    ? { ...sameDay, slots: [...(sameDay.slots ?? []), slot] }
    : {
        customerId: selected.customerId,
        customerName: selected.customerName,
        date: v.date,
        status: INITIAL_STATUS,
        confirmedAt: null, cancelledAt: null, cancelReason: null, released: null,
        slots: [slot],
      };

  const customerVisits = await visitsData.listByCustomer(selected.customerId);
  const { errors } = validateVisit(visit, {
    customer: { flags: selected.flags ?? [] },
    entitlements: ctx.queueInput.entitlementsBy[selected.customerId] ?? [],
    courses: all.courses, equipment: all.equipment, rooms: all.rooms,
    staff: all.staff, ivProducts: all.ivProducts,
    customerVisits,
    sameDayVisits: await visitsData.listByDate(v.date),
  });

  f.showErrors(form, errors);
  if (errors.length) return;

  // SPEC 第 7 節規則 10：app 看不到 Abovee，這道確認就是她手寫的那兩個驚嘆號
  const ok = await confirmAction({
    title: '已經在 Abovee 壓好表了嗎？',
    consequences: [
      `${selected.customerName}・${shortDate(v.date)} ${slot.startsAt}–${slot.endsAt} ${course.name}`,
      sameDay ? '這一筆會併進同一天已經有的來訪裡' : '這會建立一筆新的來訪',
      '會記成「已壓表，等客戶回覆」，並自動產生該做的系統登記任務',
    ],
    confirmLabel: '已確認，記錄',
  });
  if (!ok) return;

  try {
    await toast.withSaveState(() => visitsData.save(visit, customerVisits), { success: '已記錄' });
    // 記完自動把這位標成已壓表：她回來記錄就代表壓完了
    const queue = markInQueue(batch, selected.customerId, 'done');
    await batchesData.saveProgress(batch.id, queue, selected.customerId);
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
      `已處理 ${p.handled} / ${p.total}，還有 ${p.pending} 位沒處理`,
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
    render(ctx.el);
  } catch {
    /* 已處理 */
  }
}
