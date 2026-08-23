// 日曆。SPEC 第 8.6 節、ADR-0015、ADR-0020。取代 TimeTree（第 4.9 節）。
//
// 這是**可以直接編輯的第一線畫面**，不是唯讀的檢視。上面有兩種各自獨立的東西：
//
//   來訪     —— 綁客戶，產生任務，扣次數，走第 4.1 節的狀態機
//   個人行程 —— 公出、休假、演講。不綁客戶、不產生任務、不扣次數，可以跨天
//
// 月檢視上跨天的東西畫成橫跨格子的色條而不是圓點 —— 看不出從哪天到哪天的話，
// 那條資訊等於沒給。排版計算在 domain/events.js 的 layoutMonth()。
//
// **這一頁從頭到尾不換頁**（ADR-0020）：點一天從底部滑出那一天，點裡面一筆
// 浮出一張讀取模式的卡片，按鉛筆才進編輯器，而編輯器就長在同一張抽屜裡。
// 左右滑是上一個月／下一個月。她開這一頁是為了「看八月」，任何把八月洗掉的
// 動作都要有很好的理由。
//
// 這一頁只顯示她自己排的來訪。同事在 Abovee 上壓的東西這裡看不到
//（SPEC 第 4.7 節），所以「空的格子」不代表那個時段真的空著 ——
// 畫面上要講明這件事，不然她會拿這一頁當可用時段表用。

import * as config from '../../data/config.js';
import * as visitsData from '../../data/visits.js';
import * as eventsData from '../../data/events.js';
import * as customersData from '../../data/customers.js';
import * as visitEditor from './visitEditor.js';
import * as eventEditor from './eventEditor.js';
import {
  VIEWS, VIEW_LABELS, WEEKDAY_HEADERS,
  rangeOf, moveBy, titleOf, weekDays, monthWeeks, agendaFor, summaryByDate,
} from '../../domain/calendar.js';
import { layoutMonth, dayEvents, countByDate, describeCategory, spanLabel } from '../../domain/events.js';
import {
  describeStatus, statusClass, shortStatus, STATUS_VIEW_ORDER,
} from '../../domain/visits.js';
import { todayISO, shortDate, weekdayLabel } from '../../domain/dates.js';
import { toMinutes, isValidTime, timeLabel } from '../../domain/visitTime.js';
import { esc } from '../components/form.js';
import { openSheet, closeSheet } from '../components/sheet.js';
import { openCard, closeCard } from '../components/card.js';
import { icon } from '../icons.js';

// 看到哪一天留在模組層：點進一筆來訪再退回來，她要回到原本那一頁而不是今天。
// day 是「剛剛打開過哪一天」，關掉面板之後那一格還會標著 —— 她才知道自己看到哪裡。
const state = { view: 'month', date: null, day: null, hidden: new Set(), fab: false };

/** 頂端那一排可勾選的篩選。一種一個顏色，關掉就不顯示。 */
const KINDS = [
  // 這顆是開關不是狀態，所以用中性色 —— 來訪本身的顏色由狀態決定（見圖例）
  { id: 'visit', label: '來訪', cls: 'kind-any' },
  { id: 'personal', label: '個人行程', cls: 'kind-personal' },
  { id: 'leave', label: '休假', cls: 'kind-leave' },
];

const shows = (id) => !state.hidden.has(id);

/** 左右滑的三格：上一頁、這一頁、下一頁。 */
const PANES = [-1, 0, 1];

/** 換到哪一頁的序號。補讀回來的資料比她的下一次滑還慢時，用它決定要不要丟掉。 */
let epoch = 0;

export async function render(el) {
  const mine = ++epoch;
  state.date ??= todayISO();
  el.innerHTML = '<p class="muted">載入中…</p>';

  const result = await load();
  if (mine !== epoch) return;
  if (!result.ok) {
    el.innerHTML = `<div class="card"><p>讀取失敗：${esc(result.error)}</p>
      <p class="muted">如果訊息裡有建立索引的連結，點它建好之後再回來。</p></div>`;
    return;
  }
  paint(el, result.value);
}

/**
 * 讀三格的範圍。左右滑要能立刻畫出隔壁那個月，滑到一半才去讀
 * 會看到一片空白然後跳一下 —— 那正是「絲滑」的反面。
 */
async function load() {
  const from = rangeOf(state.view, moveBy(state.view, state.date, -1));
  const to = rangeOf(state.view, moveBy(state.view, state.date, 1));
  try {
    const [visits, events, rooms, staff] = await Promise.all([
      visitsData.listBetween(from.from, to.to),
      eventsData.listInRange(from.from, to.to),
      config.listAll('rooms'),
      config.listAll('staff'),
    ]);
    return {
      ok: true,
      value: {
        visits,
        events,
        roomsById: Object.fromEntries(rooms.map((r) => [r.id, r])),
        staffById: Object.fromEntries(staff.map((s) => [s.id, s])),
      },
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * 滑到隔壁那一頁之後。
 *
 * **先用手上的資料立刻畫，再靜靜補讀一次。** 走 `render()` 會先閃一下「載入中…」，
 * 那一閃正好落在她剛放開手指的那一刻 —— 手感會從「翻過去了」變成「重新載入了」。
 * 隔壁那一格本來就已經讀進來了，畫得出來；再隔壁那一格等補讀回來才有東西，
 * 而那一格她現在看不到。
 */
async function slide(el, data, offset) {
  const mine = ++epoch;
  state.date = moveBy(state.view, state.date, offset);
  paint(el, data);

  const result = await load();
  // 她可能在補讀回來之前又滑了一次，那時這份資料講的是別的月份
  if (!result.ok || mine !== epoch) return;
  paint(el, result.value);
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

    ${shows('visit') ? legendHtml() : ''}

    <p class="muted" style="margin: 0 0 var(--space-2)">${countLine(data, state.date)}</p>

    <div class="swipe noscroll-bar" data-swipe>
      ${PANES.map((offset) => {
        const date = moveBy(state.view, state.date, offset);
        return `<div class="swipe__pane" data-offset="${offset}">${bodyHtml(data, date, today)}</div>`;
      }).join('')}
    </div>

    <p class="footnote">
      ${icon('info', { size: 14 })}
      <span>這裡只有你自己排的。同事在 Abovee 壓的看不到 ——
        空的格子不代表那個時段真的空著。</span>
    </p>

    ${fabHtml()}`;

  wire(el, data);
}

/**
 * 哪個顏色是哪一種。
 *
 * 月檢視的色條上放不下狀態兩個字，顏色是唯一的線索 —— 沒有圖例她只能用猜的。
 * 這是說明不是控制項，所以不佔 SPEC 第 8.6 節那「控制項最多兩列」的額度。
 * 關掉「來訪」那顆篩選時整條收起來：那時畫面上一條來訪的色條都沒有。
 */
function legendHtml() {
  return `
    <p class="callegend">
      ${STATUS_VIEW_ORDER.map((status) => `
        <span class="callegend__item ${esc(statusClass(status))}">
          <span class="callegend__swatch" aria-hidden="true"></span>
          <span>${esc(shortStatus(status))}</span>
        </span>`).join('')}
    </p>`;
}

function countLine(data, date) {
  const range = rangeOf(state.view, date);
  const inRange = (d) => d >= range.from && d <= range.to;
  const visits = shows('visit')
    ? data.visits.filter((v) => inRange(v.date)).length
    : 0;
  const events = data.events.filter(
    (e) => shows(e.category) && e.startDate <= range.to && e.endDate >= range.from,
  ).length;
  const parts = [];
  if (visits) parts.push(`${visits} 筆來訪`);
  if (events) parts.push(`${events} 筆行程`);
  return parts.join('・') || '這段時間沒有東西';
}

// ---------- 三種檢視 ----------

function bodyHtml(data, date, today) {
  if (state.view === 'day') return dayHtml(data, date, today);
  if (state.view === 'week') return weekHtml(data, date, today);
  return monthHtml(data, date, today);
}

/**
 * 月。一週一列，跨天的事情用橫跨格子的色條表示。
 *
 * 來訪與個人行程餵進同一次排版計算 —— 分兩次算的話兩種東西會互相蓋住，
 * 而她看月檢視就是為了知道「那一天到底卡了幾件事」。
 *
 * **一整欄都是那一天的按鈕**（`.monthweek__hit`，從第一列跨到最後一列）：
 * 她的手指戳的是那一天，不是那個數字。色條疊在上面但不吃點擊 ——
 * 點到人名跳去別的畫面是最容易誤觸的一種設計（ADR-0020）。
 */
function monthHtml(data, date, today) {
  const weeks = monthWeeks(date.slice(0, 7));
  const items = [
    ...(shows('visit') ? data.visits.map(visitAsBar) : []),
    ...data.events.filter((e) => shows(e.category)),
  ];
  const rows = layoutMonth(items, weeks);
  const month = date.slice(0, 7);

  return `
    <div class="monthgrid">
      <div class="monthgrid__wd">${WEEKDAY_HEADERS.map((w) => `<span>${w}</span>`).join('')}</div>
      ${weeks.map((week, wi) => `
        <div class="monthweek">
          <div class="monthweek__hits">
            ${week.map((day) => `
              <button class="monthweek__hit ${day.date === state.day ? 'monthweek__hit--on' : ''}"
                      type="button" data-day="${day.date}"
                      aria-label="${esc(shortDate(day.date))}">
                <span class="monthweek__n num ${day.date.slice(0, 7) !== month ? 'monthweek__n--adj' : ''}
                      ${day.date === today ? 'monthweek__n--today' : ''}">${Number(day.date.slice(8))}</span>
              </button>`).join('')}
          </div>
          ${rows[wi].bars.map((b) => `
            <span class="monthbar ${b.kind}"
                  style="grid-column: ${b.col} / span ${b.span}; grid-row: ${b.lane + 2}"
                  title="${esc(b.title)}"><span class="monthbar__t">${esc(b.title)}</span></span>`).join('')}
          ${rows[wi].more.map((n, di) => (n
            ? `<span class="monthmore" style="grid-column: ${di + 1}; grid-row: 5">+${n}</span>`
            : '')).join('')}
        </div>`).join('')}
    </div>`;
}

/**
 * 一筆來訪在月檢視上就是一格寬的色條。
 *
 * 顏色跟著狀態走，不是所有來訪都同一條綠 —— 她要一眼看出這個月哪幾天還沒問客人。
 * 色條上放不下狀態兩個字，所以顏色就是唯一的線索，頂端要有圖例。
 */
function visitAsBar(visit) {
  const courses = [...new Set((visit.slots ?? []).map((s) => s.courseName).filter(Boolean))];
  const name = visit.customerName ?? '?';
  const course = courses[0] ?? '';
  return {
    id: visit.id,
    // 姓名與課程之間用**半形**間隔號。一格是七分之一個螢幕寬，
    // 手機上放得下四個多字 —— 全形的空白或「・」等於整整少看到一個字，
    // 而被切掉時那一顆懸在邊緣的全形符號比半形的顯眼得多。
    title: course ? `${name}·${course}` : name,
    category: 'visit',
    kind: statusClass(visit.status) || 'kind-visit',
    startDate: visit.date,
    endDate: visit.date,
    deletedAt: visit.deletedAt ?? null,
  };
}

/** 週。手機是七段直的清單，iPad 橫式才變七欄。一週是她真正在規劃的單位。 */
function weekHtml(data, date, today) {
  const days = weekDays(date);
  const summary = summaryByDate(shows('visit') ? data.visits : []);
  const eventCounts = countByDate(
    data.events.filter((e) => shows(e.category)), days[0], days[6],
  );

  return `
    <div class="weekgrid">
      ${days.map((d) => {
        const day = summary[d];
        const rows = shows('visit') ? agendaFor(data.visits, d, data) : [];
        const { allDay, timed } = dayEvents(data.events.filter((e) => shows(e.category)), d);
        const total = (day?.visits ?? 0) + (eventCounts[d] ?? 0);
        const weekend = [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());

        return `
          <section class="card ${weekend ? 'weekday--weekend' : ''}" style="padding: 0; overflow: hidden">
            <button class="weekday__head" type="button" data-day="${d}">
              <span class="weekday__n num ${d === today ? 'weekday__n--today' : ''}">
                ${Number(d.slice(8))}</span>
              <span style="font-size: var(--text-sm); font-weight: 700; color: var(--text-dim)">
                週${weekdayLabel(d)}</span>
              <span class="app__spacer"></span>
              <span class="num muted">${total ? `${total} 筆` : ''}</span>
            </button>

            ${allDay.map(eventLine).join('')}
            ${timed.map(eventLine).join('')}
            ${rows.map((r) => `
              <button class="note ${esc(statusClass(r.status))}" type="button"
                      data-open="visit:${esc(r.visitId)}" style="align-items: center">
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
                             background: var(--kind-fg, var(--text-mute))"></span>
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
  // 狀態 class 掛在整列上：左邊那條色棒（.timerow__bar 讀 --kind-fg）與
  // 右邊的徽章都從它繼承，不必各自再判斷一次狀態。
  return `
    <div class="timerow ${esc(statusClass(r.status)) || 'kind-visit'}">
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
          <span class="badge ${esc(statusClass(r.status))}">
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
 *
 * 面板裡的每一筆都可以點，點了浮出一張讀取模式的卡片（ADR-0020）——
 * 抽屜留在底下，看完那一筆關掉還在同一天。
 */
function openDay(el, data, date) {
  const today = todayISO();
  const rows = shows('visit') ? agendaFor(data.visits, date, data) : [];
  const { allDay, timed } = dayEvents(data.events.filter((e) => shows(e.category)), date);
  const n = rows.length + allDay.length + timed.length;

  const sheet = openSheet({
    title: shortDate(date),
    note: n
      ? `${n} 件事。點一筆看細節，要改再按鉛筆。`
      : '這天還沒有東西 —— 但同事在 Abovee 壓的看不到，空的不代表真的空著。',
    body: dayHtml(data, date, today),
    actions: `
      <button class="btn" type="button" data-add-event>個人行程</button>
      <button class="btn btn--primary" type="button" data-add-visit>來訪</button>`,
    onClose: closeCard,
  });

  sheet.el.querySelectorAll('[data-open]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const [what, id] = btn.dataset.open.split(':');
      openDetail(el, data, what, id, date);
    }),
  );

  sheet.el.querySelector('[data-add-event]').addEventListener('click', () =>
    mountEditor(el, data, sheet, { kind: 'event', date, backDate: date }),
  );

  sheet.el.querySelector('[data-add-visit]').addEventListener('click', () =>
    pickCustomer(el, data, sheet, date, date),
  );

  return sheet;
}

/**
 * 一筆的讀取模式。**先給看的，不先給改的。**
 *
 * 她點一筆的十次有九次只是要確認「那天幾點、誰、做什麼」。直接進表單等於
 * 每一次都冒著改到東西的風險，而這一站最不能出錯的就是次數（ADR-0020）。
 */
function openDetail(el, data, what, id, date) {
  if (what === 'event') {
    const event = data.events.find((e) => e.id === id);
    if (!event) return;
    openCard({
      title: event.title,
      subtitle: `${esc(describeCategory(event.category))}・${esc(spanLabel(event))}`,
      body: eventReadHtml(event),
      canEdit: true,
      onEdit: () => {
        closeCard();
        openEditor(el, data, { kind: 'event', id: event.id, backDate: date });
      },
    });
    return;
  }

  const visit = data.visits.find((v) => v.id === id);
  if (!visit) return;
  openCard({
    title: visit.customerName ?? '（沒有名字）',
    subtitle: `${esc(shortDate(visit.date))}・${esc(describeStatus(visit.status))}`,
    body: visitReadHtml(visit, data),
    canEdit: true,
    onEdit: () => {
      closeCard();
      openEditor(el, data, {
        kind: 'visit', visitId: visit.id, date: visit.date, backDate: date,
      });
    },
  });
}

/**
 * 一筆來訪的讀取模式內容。
 *
 * export 出去是因為進度追蹤頁點一筆時要看到**一模一樣**的東西 ——
 * 兩邊各畫一份，遲早會變成一邊看得到治療師、另一邊看不到
 * （同樣的理由見 ADR-0018 的 `ui/views/audit.js` 的 `listHtml()`）。
 *
 * @param {object} visit
 * @param {{roomsById:object, staffById:object}} data
 */
export function visitReadHtml(visit, data) {
  const slots = visit.slots ?? [];
  return `
    ${slots.map((s) => {
      const room = data.roomsById[s.roomId]?.name ?? null;
      const therapist = data.staffById[s.therapistId]?.name ?? null;
      const where = [room ? `${room}${s.bed ?? ''}` : null, therapist].filter(Boolean).join('・');
      return `
        <div class="readslot">
          <div class="readslot__when num">${esc(timeLabel(s))}</div>
          <div class="readslot__what">${esc(s.courseName ?? '（沒有課程）')}${
            where ? `・${esc(where)}` : ''}</div>
        </div>`;
    }).join('') || '<p class="muted">這筆沒有任何時段。</p>'}

    ${visit.note ? `
      <div class="readrow">
        <span class="readrow__k">記的話</span>
        <span class="readrow__v">${esc(visit.note)}</span>
      </div>` : ''}

    <p class="muted" style="margin: var(--space-3) 0 0">
      改時間不是改日期 —— 取消這一筆再重排一筆，舊系統的登記才會長出取消任務。</p>`;
}

function eventReadHtml(event) {
  return `
    <div class="readrow">
      <span class="readrow__k">哪一種</span>
      <span class="readrow__v">${esc(describeCategory(event.category))}</span>
    </div>
    <div class="readrow">
      <span class="readrow__k">時間</span>
      <span class="readrow__v">${esc(spanLabel(event))}</span>
    </div>
    ${event.note ? `
      <div class="readrow">
        <span class="readrow__k">備註</span>
        <span class="readrow__v">${esc(event.note)}</span>
      </div>` : ''}
    <p class="muted" style="margin: var(--space-3) 0 0">
      個人行程不綁客戶、不產生任務、不扣次數。</p>`;
}

// ---------- 就地編輯 ----------

/**
 * 把編輯器掛進**一張抽屜**，不換頁也不開第二層面板。
 *
 * 為什麼不是換頁：她在日曆上排一筆的心裡狀態是「八月三號那天再塞一個」，
 * 換頁把八月洗掉之後，存完回來還要自己找回那一天（ADR-0020）。
 *
 * `backDate` 是「取消的話回哪一天」。從某一天的抽屜點進來就填那一天，
 * 從懸浮鈕進來就沒有 —— 取消直接關掉。
 *
 * @param {object} spec { kind:'visit'|'event', id?, visitId?, customerId?, date?, backDate? }
 */
function mountEditor(el, data, sheet, spec) {
  const { kind, backDate = null } = spec;
  const isNew = !spec.id && !spec.visitId;

  // 抬頭放日期不放人名：人名連同狀態與醫療禁忌就在編輯器自己的第一列，
  // 抬頭再寫一次等於用掉一整行講同一件事。她在這裡要確認的是「排到哪一天」。
  sheet.setTitle(kind === 'event'
    ? (isNew ? '新增個人行程' : '個人行程')
    : `${shortDate(spec.date)} ${isNew ? '排一筆' : '的來訪'}`);
  sheet.setNote('');
  sheet.setActions('');
  sheet.update('<div data-editor></div>');
  // 表單比一天的清單長得多，直接撐到頂 —— 不必她自己再拖一次
  sheet.expand();

  const host = sheet.el.querySelector('[data-editor]');
  const opts = {
    embedded: true,
    onDone: () => {
      closeSheet();
      render(el);
    },
    onCancel: () => {
      closeSheet();
      if (backDate) openDay(el, data, backDate);
    },
  };

  if (kind === 'event') {
    if (spec.id) eventEditor.mountEdit(host, { id: spec.id, ...opts });
    else eventEditor.mountNew(host, { date: spec.date, ...opts });
  } else if (spec.visitId) {
    visitEditor.mountEdit(host, { visitId: spec.visitId, ...opts });
  } else {
    visitEditor.mountNew(host, { customerId: spec.customerId, date: spec.date, ...opts });
  }
}

/** 沒有現成抽屜可以接的時候（懸浮鈕、資訊卡片上的鉛筆）就開一張新的。 */
function openEditor(el, data, spec) {
  const sheet = openSheet({ title: '', body: '', onClose: closeCard });
  mountEditor(el, data, sheet, spec);
}

/**
 * 新增來訪要先選人。日曆上她心裡想的是「這一天要幫誰排」，
 * 所以選完人直接帶著日期進來訪編輯器 —— 而且是**在同一張抽屜裡**接下去，
 * 不要選完人畫面就換掉（ADR-0020）。
 *
 * 客戶清單只在真的要選人的時候才讀 —— 日曆是每天都會開的一頁，
 * 不要為了它多一次讀取。
 */
function pickCustomer(el, data, sheet, date, backDate = null) {
  sheet.setTitle(`${shortDate(date)} 要幫誰排？`);
  sheet.setNote('選完就在這裡接著記，不會換頁。');
  sheet.setActions('');
  sheet.update(`
    <label class="field">
      <span class="visually-hidden">找人</span>
      <input type="text" data-search placeholder="打名字" style="width: 100%" />
    </label>
    <div class="groups" data-people><p class="muted" style="padding: var(--space-3); margin: 0">載入中…</p></div>`);

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
          btn.addEventListener('click', () =>
            mountEditor(el, data, sheet, {
              kind: 'visit', customerId: btn.dataset.pick, date, backDate,
            }),
          ),
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
  // 箭頭跟左右滑走同一條路 —— 一個閃「載入中」另一個不閃，會像兩個不同的功能
  el.querySelectorAll('[data-move]').forEach((btn) =>
    btn.addEventListener('click', () => slide(el, data, Number(btn.dataset.move))),
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

  // 週檢視與日檢視裡的一筆：浮出讀取模式的卡片，不換頁
  el.querySelectorAll('[data-open]').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const [what, id] = btn.dataset.open.split(':');
      openDetail(el, data, what, id, null);
    }),
  );

  el.querySelector('[data-fab]')?.addEventListener('click', () => {
    state.fab = !state.fab;
    paint(el, data);
  });

  el.querySelector('[data-new-event]')?.addEventListener('click', () => {
    state.fab = false;
    paint(el, data);
    openEditor(el, data, { kind: 'event', date: state.day ?? state.date });
  });

  el.querySelector('[data-new-visit]')?.addEventListener('click', () => {
    state.fab = false;
    paint(el, data);
    // 懸浮鈕上的「新增」沒有指定哪一天，就用她現在看著的那一天
    const sheet = openSheet({ title: '', body: '', onClose: closeCard });
    pickCustomer(el, data, sheet, state.day ?? state.date);
  });

  wireSwipe(el, data);
}

/**
 * 左右滑換上一個月／下一個月。
 *
 * 三格 `scroll-snap`，中間那一格是現在這一頁，滑停之後把 state 往那個方向挪一格
 * 再重畫、靜靜捲回中間。**不自己接 touch 事件** —— 慣性、邊緣回彈與跨裝置的手感
 * 只有瀏覽器原生的捲動給得出來，這一點跟壓表的卡片組同一個判斷（ADR-0017）。
 *
 * 用捲動停下來判斷而不是 `scrollend`：iOS Safari 到現在都還不一定發那個事件，
 * 而這一頁一半的時間跑在 iPad 上。
 */
function wireSwipe(el, data) {
  const box = el.querySelector('[data-swipe]');
  if (!box) return;

  const paneWidth = () => box.clientWidth;

  // 先站到中間那一格。auto 而不是 smooth —— 這不是她做的動作，不該看到它滑。
  const center = () => box.scrollTo({ left: paneWidth(), behavior: 'auto' });
  center();
  // 版面還在算的時候 clientWidth 可能是 0，下一幀再站一次
  requestAnimationFrame(center);

  let timer = null;
  let settling = false;

  box.addEventListener('scroll', () => {
    if (settling) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const w = paneWidth();
      if (!w) return;
      const offset = Math.round(box.scrollLeft / w) - 1;
      if (!offset) return;
      settling = true;
      slide(el, data, offset);
    }, 110);
  });
}
