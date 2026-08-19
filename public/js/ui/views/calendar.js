// 日曆。SPEC 第 8.6 節、ADR-0015。取代 TimeTree（第 4.9 節）。
//
// 這是**可以直接編輯的第一線畫面**，不是唯讀的檢視。上面有兩種各自獨立的東西：
//
//   來訪     —— 綁客戶，產生任務，扣次數，走第 4.1 節的狀態機
//   個人行程 —— 公出、休假、演講。不綁客戶、不產生任務、不扣次數，可以跨天
//
// 月檢視上跨天的東西畫成橫跨格子的色條而不是圓點 —— 看不出從哪天到哪天的話，
// 那條資訊等於沒給。排版計算在 domain/events.js 的 layoutMonth()。
//
// 這一頁只顯示她自己排的來訪。同事在 Abovee 上壓的東西這裡看不到
//（SPEC 第 4.7 節），所以「空的格子」不代表那個時段真的空著 ——
// 畫面上要講明這件事，不然她會拿這一頁當可用時段表用。

import * as config from '../../data/config.js';
import * as visitsData from '../../data/visits.js';
import * as eventsData from '../../data/events.js';
import * as customersData from '../../data/customers.js';
import {
  VIEWS, VIEW_LABELS, WEEKDAY_HEADERS,
  rangeOf, moveBy, titleOf, weekDays, monthWeeks, agendaFor, summaryByDate,
} from '../../domain/calendar.js';
import { layoutMonth, dayEvents, countByDate } from '../../domain/events.js';
import { describeStatus } from '../../domain/visits.js';
import { todayISO, shortDate, weekdayLabel } from '../../domain/dates.js';
import { toMinutes, isValidTime } from '../../domain/visitTime.js';
import { esc } from '../components/form.js';
import { openSheet, closeSheet } from '../components/sheet.js';
import { icon } from '../icons.js';
import { go } from '../router.js';

// 看到哪一天留在模組層：點進一筆來訪再退回來，她要回到原本那一頁而不是今天。
// day 是「剛剛打開過哪一天」，關掉面板之後那一格還會標著 —— 她才知道自己看到哪裡。
const state = { view: 'month', date: null, day: null, hidden: new Set(), fab: false };

/** 頂端那一排可勾選的篩選。一種一個顏色，關掉就不顯示。 */
const KINDS = [
  { id: 'visit', label: '來訪', cls: 'kind-visit' },
  { id: 'personal', label: '個人行程', cls: 'kind-personal' },
  { id: 'leave', label: '休假', cls: 'kind-leave' },
];

const shows = (id) => !state.hidden.has(id);

export async function render(el) {
  state.date ??= todayISO();
  el.innerHTML = '<p class="muted">載入中…</p>';

  const range = rangeOf(state.view, state.date);
  let data;
  try {
    const [visits, events, rooms, staff] = await Promise.all([
      visitsData.listBetween(range.from, range.to),
      eventsData.listInRange(range.from, range.to),
      config.listAll('rooms'),
      config.listAll('staff'),
    ]);
    data = {
      visits,
      events,
      roomsById: Object.fromEntries(rooms.map((r) => [r.id, r])),
      staffById: Object.fromEntries(staff.map((s) => [s.id, s])),
    };
  } catch (err) {
    el.innerHTML = `<div class="card"><p>讀取失敗：${esc(err.message)}</p>
      <p class="muted">如果訊息裡有建立索引的連結，點它建好之後再回來。</p></div>`;
    return;
  }

  paint(el, data);
}

function paint(el, data) {
  const today = todayISO();

  // 控制項全部收成兩列。原本月份切換、日週月、篩選各佔一列，
  // 三列加起來就把格子推到螢幕外 —— 而她開這一頁是為了看格子。
  el.innerHTML = `
    <div class="calbar">
      <button class="calbar__nav" type="button" data-move="-1" aria-label="上一頁">
        ${icon('left', { size: 15 })}</button>
      <h1 class="calbar__title">${esc(titleOf(state.view, state.date))}</h1>
      <button class="calbar__nav" type="button" data-move="1" aria-label="下一頁">
        ${icon('right', { size: 15 })}</button>
      <div class="seg" role="group" style="flex: 0 0 auto">
        ${VIEWS.map((v) => `
          <button class="seg__item" type="button" data-view="${v}"
                  aria-pressed="${v === state.view}"
                  style="min-width: 30px">${VIEW_LABELS[v]}</button>`).join('')}
      </div>
    </div>

    <div class="calfilter noscroll-bar">
      <button class="chip chip--sm" type="button" data-today>今天</button>
      <span class="chiprow__sep" aria-hidden="true"></span>
      ${KINDS.map((k) => `
        <button class="calfilter__item ${k.cls}" type="button"
                aria-pressed="${shows(k.id)}" data-kind="${k.id}">
          <span class="calfilter__box">${icon('check', { size: 9, width: 3.6 })}</span>
          <span>${esc(k.label)}</span>
        </button>`).join('')}
    </div>

    <p class="muted" style="margin: 0 0 var(--space-2)">${countLine(data)}</p>

    ${bodyHtml(data, today)}

    <p class="footnote">
      ${icon('info', { size: 14 })}
      <span>這裡只有你自己排的。同事在 Abovee 壓的看不到 ——
        空的格子不代表那個時段真的空著。</span>
    </p>

    ${fabHtml()}`;

  wire(el, data);
}

function countLine(data) {
  const visits = shows('visit') ? data.visits.length : 0;
  const events = data.events.filter((e) => shows(e.category)).length;
  const parts = [];
  if (visits) parts.push(`${visits} 筆來訪`);
  if (events) parts.push(`${events} 筆行程`);
  return parts.join('・') || '這段時間沒有東西';
}

// ---------- 三種檢視 ----------

function bodyHtml(data, today) {
  if (state.view === 'day') return dayHtml(data, state.date, today);
  if (state.view === 'week') return weekHtml(data, today);
  return monthHtml(data, today);
}

/**
 * 月。一週一列，跨天的事情用橫跨格子的色條表示。
 *
 * 來訪與個人行程餵進同一次排版計算 —— 分兩次算的話兩種東西會互相蓋住，
 * 而她看月檢視就是為了知道「那一天到底卡了幾件事」。
 */
function monthHtml(data, today) {
  const weeks = monthWeeks(state.date.slice(0, 7));
  const items = [
    ...(shows('visit') ? data.visits.map(visitAsBar) : []),
    ...data.events.filter((e) => shows(e.category)),
  ];
  const rows = layoutMonth(items, weeks);
  const month = state.date.slice(0, 7);

  return `
    <div class="monthgrid">
      <div class="monthgrid__wd">${WEEKDAY_HEADERS.map((w) => `<span>${w}</span>`).join('')}</div>
      ${weeks.map((week, wi) => `
        <div class="monthweek">
          ${week.map((day, di) => `
            <div class="monthweek__day" style="grid-column: ${di + 1}">
              <button class="monthweek__n num ${day.date.slice(0, 7) !== month ? 'monthweek__n--adj' : ''}
                      ${day.date === today ? 'monthweek__n--today' : ''}
                      ${day.date === state.day ? 'monthweek__n--on' : ''}"
                      type="button" data-day="${day.date}">${Number(day.date.slice(8))}</button>
            </div>`).join('')}
          ${rows[wi].bars.map((b) => `
            <button class="monthbar ${b.kind}" type="button"
                    data-open="${esc(b.category === 'visit' ? `visit:${b.id}` : `event:${b.id}`)}"
                    style="grid-column: ${b.col} / span ${b.span}; grid-row: ${b.lane + 2}"
                    title="${esc(b.title)}">${esc(b.title)}</button>`).join('')}
          ${rows[wi].more.map((n, di) => (n
            ? `<span class="monthmore" style="grid-column: ${di + 1}; grid-row: 5">+${n}</span>`
            : '')).join('')}
        </div>`).join('')}
    </div>`;
}

/** 一筆來訪在月檢視上就是一格寬的色條。 */
function visitAsBar(visit) {
  const courses = [...new Set((visit.slots ?? []).map((s) => s.courseName).filter(Boolean))];
  return {
    id: visit.id,
    title: `${visit.customerName ?? '?'} ${courses[0] ?? ''}`.trim(),
    category: 'visit',
    kind: 'kind-visit',
    startDate: visit.date,
    endDate: visit.date,
    deletedAt: visit.deletedAt ?? null,
  };
}

/** 週。手機是七段直的清單，iPad 橫式才變七欄。一週是她真正在規劃的單位。 */
function weekHtml(data, today) {
  const days = weekDays(state.date);
  const summary = summaryByDate(shows('visit') ? data.visits : []);
  const eventCounts = countByDate(
    data.events.filter((e) => shows(e.category)), days[0], days[6],
  );

  return `
    <div class="weekgrid">
      ${days.map((date) => {
        const day = summary[date];
        const rows = shows('visit') ? agendaFor(data.visits, date, data) : [];
        const { allDay, timed } = dayEvents(data.events.filter((e) => shows(e.category)), date);
        const total = (day?.visits ?? 0) + (eventCounts[date] ?? 0);
        const weekend = [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());

        return `
          <section class="card ${weekend ? 'weekday--weekend' : ''}" style="padding: 0; overflow: hidden">
            <div class="weekday__head">
              <button class="weekday__n num ${date === today ? 'weekday__n--today' : ''}"
                      type="button" data-day="${date}"
                      style="border: none; background: ${date === today ? 'var(--accent)' : 'transparent'};
                             color: ${date === today ? 'var(--accent-text)' : 'inherit'}; cursor: pointer">
                ${Number(date.slice(8))}</button>
              <span style="font-size: var(--text-sm); font-weight: 700; color: var(--text-dim)">
                週${weekdayLabel(date)}</span>
              <span class="app__spacer"></span>
              <span class="num muted">${total ? `${total} 筆` : ''}</span>
            </div>

            ${allDay.map(eventLine).join('')}
            ${timed.map(eventLine).join('')}
            ${rows.map((r) => `
              <button class="note" type="button" data-open="visit:${esc(r.visitId)}"
                      style="align-items: center">
                <span class="num" style="width: 42px; flex-shrink: 0; font-size: var(--text-xs);
                                         font-weight: 700; color: var(--text-dim)">
                  ${esc(r.timeLabel)}</span>
                <span class="note__main">
                  <span class="note__text" style="font-size: var(--text-sm); font-weight: 700">
                    ${esc(r.customerName)}</span>
                  <span class="grouprow__note">${esc(r.courseName)}${
                    r.room ? `・${esc(r.room)}${esc(r.bed ?? '')}` : ''}${
                    r.therapist ? `・${esc(r.therapist)}` : ''}</span>
                </span>
                <span style="width: 7px; height: 7px; border-radius: 999px; flex-shrink: 0;
                             background: ${r.status === 'pending_confirm' ? 'var(--soon)' : 'var(--accent)'}"></span>
              </button>`).join('')}

            ${!total ? '<div style="padding: var(--space-3) var(--space-4); font-size: var(--text-sm); color: var(--text-mute)">沒有排東西</div>' : ''}
          </section>`;
      }).join('')}
    </div>`;
}

function eventLine(e) {
  return `
    <button class="allday ${e.kind}" type="button" data-open="event:${esc(e.id)}"
            style="margin: var(--space-2) var(--space-3) 0; width: auto">
      <span class="allday__bar"></span>
      <span>${esc(e.title)}</span>
      <span style="opacity: 0.75; font-weight: 500">${esc(e.spanLabel)}</span>
    </button>`;
}

/**
 * 日。一整天照時間排開，左邊時間、中間內容、右邊狀態。
 * 整天的個人行程釘在最上面，不進時間軸 —— 它沒有時間，硬塞進去只能擺在一個假位置。
 */
function dayHtml(data, date, today) {
  const rows = shows('visit') ? agendaFor(data.visits, date, data) : [];
  const visible = data.events.filter((e) => shows(e.category));
  const { allDay, timed } = dayEvents(visible, date);

  // 有時間的個人行程跟來訪的時段排在同一條時間軸上 —— 她要看的是
  // 「那一格幾點有事」，不是「這件事屬於哪一種資料」。
  const merged = [
    ...rows.map((r) => ({ kind: 'visit', at: r.startsAt, row: r })),
    ...timed.map((e) => ({ kind: 'event', at: e.startTime, event: e })),
  ].sort((a, b) => {
    const av = isValidTime(a.at) ? toMinutes(a.at) : Infinity;
    const bv = isValidTime(b.at) ? toMinutes(b.at) : Infinity;
    return av - bv;
  });

  if (!merged.length && !allDay.length) {
    return `<p class="muted">${esc(shortDate(date))} 沒有排東西。</p>`;
  }

  return `
    ${allDay.map(eventLine).join('')}
    <div class="timeline">
      ${merged.map((item) => (item.kind === 'visit'
        ? visitRow(item.row)
        : eventRow(item.event))).join('')}
    </div>`;
}

function visitRow(r) {
  return `
    <div class="timerow kind-visit">
      <div class="timerow__clock">
        <div class="timerow__from">${esc(r.startsAt || '—')}</div>
        <div class="timerow__to">${esc(r.endsAt || '')}</div>
      </div>
      <span class="timerow__bar"></span>
      <button class="timerow__body" type="button" data-open="visit:${esc(r.visitId)}"
              style="text-align: left; cursor: pointer">
        <span class="row" style="align-items: flex-start">
          <span class="row__main">
            <span class="row__title" style="font-size: var(--text-md)">${esc(r.customerName)}</span>
            <span class="grouprow__note">${esc(r.courseName)}${
              r.room ? `・${esc(r.room)}${esc(r.bed ?? '')}` : ''}${
              r.therapist ? `・${esc(r.therapist)}` : ''}</span>
          </span>
          <span class="badge ${r.status === 'pending_confirm' ? 'badge--soon' : 'badge--ok'}">
            ${esc(describeStatus(r.status))}</span>
        </span>
        ${r.clashes.length ? `
          <span class="warn">
            ${icon('alert', { size: 15 })}
            <span>${esc(r.clashes.map((c) => `${c.what} 這個時間也排了 ${c.with}`).join('；'))}。
              只是提醒，沒有擋。</span>
          </span>` : ''}
      </button>
    </div>`;
}

function eventRow(e) {
  return `
    <div class="timerow ${e.kind}">
      <div class="timerow__clock">
        <div class="timerow__from">${esc(e.startTime ?? '—')}</div>
        <div class="timerow__to">${esc(e.endTime ?? '')}</div>
      </div>
      <span class="timerow__bar"></span>
      <button class="timerow__body" type="button" data-open="event:${esc(e.id)}"
              style="text-align: left; cursor: pointer">
        <span class="row__title" style="font-size: var(--text-md)">${esc(e.title)}</span>
        ${e.note ? `<span class="grouprow__note">${esc(e.note)}</span>` : ''}
      </button>
    </div>`;
}

// ---------- 懸浮泡泡 ----------

function fabHtml() {
  return `
    <div class="fab" data-open-state="${state.fab}">
      ${state.fab ? `
        <div class="fab__menu">
          <button class="fab__item" type="button" data-new-event>
            <span>新增個人行程</span>
            <span style="width: 34px; height: 34px; border-radius: 999px; background: var(--tea);
                         color: var(--surface); display: flex; align-items: center; justify-content: center">
              ${icon('calendar', { size: 18 })}</span>
          </button>
          <button class="fab__item" type="button" data-new-visit>
            <span>新增來訪</span>
            <span style="width: 34px; height: 34px; border-radius: 999px; background: var(--accent);
                         color: var(--accent-text); display: flex; align-items: center; justify-content: center">
              ${icon('people', { size: 18 })}</span>
          </button>
        </div>` : ''}
      <button class="fab__main" type="button" data-fab aria-label="新增"
              style="transform: rotate(${state.fab ? 45 : 0}deg)">
        ${icon('plus', { size: 26, width: 2.2 })}
      </button>
    </div>`;
}

/**
 * 點一天，從底部滑出那一天的內容。**月曆整片留在原地**。
 *
 * 原本點一天是整頁切到日檢視 —— 那等於把「我在看八月」這個脈絡整個換掉，
 * 而她點下去只是想知道「這天卡了什麼」。像一般日曆 app 那樣推一個面板上來，
 * 看完往下滑掉就回到剛剛那個月。見 docs/adr/0018 的日曆那一段。
 */
function openDay(el, data, date) {
  const today = todayISO();
  const rows = shows('visit') ? agendaFor(data.visits, date, data) : [];
  const { allDay } = dayEvents(data.events.filter((e) => shows(e.category)), date);
  const n = rows.length + allDay.length;

  const sheet = openSheet({
    title: esc(shortDate(date)),
    note: n
      ? `${n} 件事。點一筆進去改。`
      : '這天還沒有東西 —— 但同事在 Abovee 壓的看不到，空的不代表真的空著。',
    body: dayHtml(data, date, today),
    actions: `
      <button class="btn" type="button" data-add-event>個人行程</button>
      <button class="btn btn--primary" type="button" data-add-visit>來訪</button>`,
  });

  sheet.el.querySelectorAll('[data-open]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const [what, id] = btn.dataset.open.split(':');
      closeSheet();
      go(what === 'visit' ? `/visits/${id}` : `/events/${id}`);
    }),
  );

  sheet.el.querySelector('[data-add-event]').addEventListener('click', () => {
    closeSheet();
    go(`/events/new/${date}`);
  });

  sheet.el.querySelector('[data-add-visit]').addEventListener('click', () =>
    openPicker(el, date),
  );
}

/**
 * 新增來訪要先選人。日曆上她心裡想的是「這一天要幫誰排」，
 * 所以選完人直接帶著日期進來訪編輯器，不要讓她再挑一次日期。
 *
 * 客戶清單只在真的要選人的時候才讀 —— 日曆是每天都會開的一頁，
 * 不要為了它多一次讀取。
 */
function openPicker(el, date) {
  const sheet = openSheet({
    title: `${esc(shortDate(date))} 要幫誰排？`,
    note: '選完會帶著這一天進來訪編輯器。',
    body: `
      <label class="field">
        <span class="visually-hidden">找人</span>
        <input type="text" data-search placeholder="打名字" style="width: 100%" />
      </label>
      <div class="groups" data-people><p class="muted" style="padding: var(--space-3); margin: 0">載入中…</p></div>`,
  });

  const box = sheet.el.querySelector('[data-people]');
  const search = sheet.el.querySelector('[data-search]');

  customersData
    .list()
    .then((customers) => {
      const paintList = () => {
        const q = String(search?.value ?? '').trim();
        const rows = customers
          .filter((c) => c.active !== false)
          .filter((c) => !q || String(c.name).includes(q))
          .slice(0, 40);

        box.innerHTML = rows.length
          ? rows.map((c) => `
              <button class="grouprow" type="button" data-pick="${esc(c.id)}">
                <span class="grouprow__main">
                  <span class="grouprow__label">${esc(c.name)}</span>
                  ${(c.flags ?? []).length
                    ? `<span class="grouprow__note">${esc((c.flags ?? []).join('・'))}</span>` : ''}
                </span>
                ${icon('right', { size: 16 })}
              </button>`).join('')
          : '<p class="muted" style="padding: var(--space-3); margin: 0">沒有這個人。</p>';

        box.querySelectorAll('[data-pick]').forEach((btn) =>
          btn.addEventListener('click', () => {
            closeSheet();
            go(`/visits/new/${btn.dataset.pick}/${date}`);
          }),
        );
      };

      paintList();
      search?.addEventListener('input', paintList);
    })
    .catch((err) => {
      box.innerHTML = `<p class="muted" style="padding: var(--space-3)">讀取失敗：${esc(err.message)}</p>`;
    });
}

// ---------- 事件 ----------

function wire(el, data) {
  el.querySelectorAll('[data-move]').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.date = moveBy(state.view, state.date, Number(btn.dataset.move));
      render(el);
    }),
  );

  el.querySelector('[data-today]')?.addEventListener('click', () => {
    state.date = todayISO();
    render(el);
  });

  el.querySelectorAll('[data-view]').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.view = btn.dataset.view;
      render(el);
    }),
  );

  el.querySelectorAll('[data-kind]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const id = btn.dataset.kind;
      if (state.hidden.has(id)) state.hidden.delete(id);
      else state.hidden.add(id);
      paint(el, data);
    }),
  );

  // 點一天：月曆留在原地，那一天的內容從底部滑出來
  el.querySelectorAll('[data-day]').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.day = btn.dataset.day;
      paint(el, data);
      openDay(el, data, state.day);
    }),
  );

  el.querySelectorAll('[data-open]').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const [what, id] = btn.dataset.open.split(':');
      go(what === 'visit' ? `/visits/${id}` : `/events/${id}`);
    }),
  );

  el.querySelector('[data-fab]')?.addEventListener('click', () => {
    state.fab = !state.fab;
    paint(el, data);
  });

  el.querySelector('[data-new-event]')?.addEventListener('click', () => {
    state.fab = false;
    go(`/events/new/${state.day ?? state.date}`);
  });

  el.querySelector('[data-new-visit]')?.addEventListener('click', () => {
    state.fab = false;
    paint(el, data);
    // 懸浮鈕上的「新增」沒有指定哪一天，就用她現在看著的那一天
    openPicker(el, state.day ?? state.date);
  });
}

