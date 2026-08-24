// 日曆。SPEC 第 8.6 節、ADR-0015、ADR-0020。取代 TimeTree（第 4.9 節）。
//
// 這是**可以直接編輯的第一線畫面**，不是唯讀的檢視。上面有四類，
// 來自三個集合（ADR-0045）：
//
//   客戶來訪 —— `visits`。綁客戶，產生任務，扣次數，走第 4.1 節的狀態機
//   待辦     —— `notes` 裡**有日期的**那幾筆。就是隨手記本人，不是另一份資料
//                （ADR-0044）—— 所以「同步」這件事沒有東西要做
//   行事備註 —— `events`（`category: 'personal'`）。公出、演講。可以跨天
//   休假     —— `events`（`category: 'leave'`）。那幾天她根本不在
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
import * as notesData from '../../data/notes.js';
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
import { MAX_LENGTH as NOTE_TEXT_MAX } from '../../domain/notes.js';
import { toMinutes, isValidTime, timeLabel } from '../../domain/visitTime.js';
import { esc } from '../components/form.js';
import * as note from '../components/note.js';
import { confirmAction } from '../components/dialog.js';
import * as toast from '../toast.js';
import { openSheet, closeSheet } from '../components/sheet.js';
import { openCard, closeCard } from '../components/card.js';
import { icon } from '../icons.js';

// 看到哪一天留在模組層：點進一筆來訪再退回來，她要回到原本那一頁而不是今天。
// day 是「剛剛打開過哪一天」，關掉面板之後那一格還會標著 —— 她才知道自己看到哪裡。
const state = { view: 'month', date: null, day: null, hidden: new Set(), fab: false };

/** 頂端那一排可勾選的篩選。一種一個顏色，關掉就不顯示。 */
const KINDS = [
  // 這顆是開關不是狀態，所以用中性色 —— 來訪本身的顏色由狀態決定（見圖例）
  { id: 'visit', label: '客戶來訪', cls: 'kind-any' },
  { id: 'note', label: '待辦', cls: 'kind-todo' },
  { id: 'personal', label: '行事備註', cls: 'kind-personal' },
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
    const [visits, events, notes, rooms, staff] = await Promise.all([
      visitsData.listBetween(from.from, to.to),
      eventsData.listInRange(from.from, to.to),
      // 有日期的隨手記（ADR-0044）。跟其他四份一起走，不多一輪往返。
      notesData.listBetween(from.from, to.to),
      config.listAll('rooms'),
      config.listAll('staff'),
    ]);
    return {
      ok: true,
      value: {
        visits,
        events,
        notes,
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
  const notes = shows('note')
    ? (data.notes ?? []).filter((n) => inRange(n.date)).length
    : 0;
  const parts = [];
  if (visits) parts.push(`${visits} 筆來訪`);
  if (notes) parts.push(`${notes} 件待辦`);
  if (events) parts.push(`${events} 筆行事備註`);
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
 * 來訪與行事備註餵進同一次排版計算 —— 分兩次算的話兩種東西會互相蓋住，
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
    ...(shows('note') ? (data.notes ?? []).map(noteAsBar) : []),
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

/**
 * 一件待辦在月檢視上就是一格寬的色條。
 *
 * **它不搶一個色相**（ADR-0045）：方框勾勾那個記號在 11px 的字裡認得出來，
 * 而且它自己就說明了「這是一件可以勾掉的事」。勾掉的畫成刪除線 ——
 * **不消失**，她要看得出「這件事處理掉了」。記號與刪除線在 CSS 的 `.kind-todo`。
 */
function noteAsBar(n) {
  return {
    id: n.id,
    title: n.text ?? '',
    category: 'note',
    kind: `kind-todo${n.done ? ' kind-todo--done' : ''}`,
    startDate: n.date,
    endDate: n.date,
    deletedAt: n.deletedAt ?? null,
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
        const todos = notesOn(data, d);
        const total = (day?.visits ?? 0) + (eventCounts[d] ?? 0) + todos.length;
        const weekend = [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());

        // 一天一段，段裡面是跟日檢視一模一樣的列。卡片留在「一天」這一層
        // （那是分組），一筆一個框拿掉了 —— 見 `issues/03`。
        const pinned = [...todos.map(noteLine), ...allDay.map(eventLine)].join('');
        const timeline = [...timed.map(eventRow), ...rows.map(visitRow)].join('');

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

            ${total ? `
              <div class="timeline timeline--week">
                ${pinned}
                ${pinned && timeline ? '<hr class="timeline__split" />' : ''}
                ${timeline}
              </div>` : `
              <div style="padding: var(--space-3) var(--space-4); font-size: var(--text-sm);
                          color: var(--text-mute)">沒有排東西</div>`}
          </section>`;
      }).join('')}
    </div>`;
}

/** 那一天有日期的隨手記。篩選關掉就沒有。 */
function notesOn(data, date) {
  if (!shows('note')) return [];
  return (data.notes ?? []).filter((n) => !n.deletedAt && n.date === date);
}

/**
 * 一列。日／週檢視上**所有東西都長這樣**：左邊一小欄時間、一條色棒、右邊內容。
 *
 * 以前整天的東西是填滿底色的丸子、有時間的是白卡加左色棒，兩種上下相接的時候
 * 接縫看得出來 —— 文字起點差了快 50px，填色方式也不一樣。她的原話是
 * 「很不搭…有點重疊的感覺」（`.scratch/calendar-drawer/issues/05`）。
 *
 * 所以整天的東西也走這一套，差別只在左邊那一欄寫的是「整天」而不是時間。
 * 它回答的是同一個問題（這是幾點的事），站同一欄才對得齊。
 *
 * @param {object} row
 * @param {string} row.kind    色彩用的 class（狀態、類別或自己挑的顏色）
 * @param {string} row.open    data-open 的值，例：'note:abc'
 * @param {string} row.clock   左欄上面那行（時間或「整天」）
 * @param {string} [row.until] 左欄下面那行（結束時間）
 * @param {string} row.title   主體
 * @param {string} [row.sub]   主體底下那行（課程・診間・治療師）
 * @param {string} [row.aside] 右邊（狀態徽章、期間、客戶名字）
 * @param {string} [row.extra] 整列最底下（撞期提醒）
 */
function agendaRow({ kind, open, clock, until = '', title, sub = '', aside = '', extra = '' }) {
  return `
    <div class="timerow ${kind}">
      <div class="timerow__clock">
        <div class="timerow__from">${esc(clock)}</div>
        ${until ? `<div class="timerow__to">${esc(until)}</div>` : ''}
      </div>
      <span class="timerow__bar"></span>
      <button class="timerow__body" type="button" data-open="${esc(open)}">
        <span class="row" style="align-items: baseline">
          <span class="row__main">
            <span class="timerow__title">${esc(title)}</span>
            ${sub ? `<span class="timerow__sub">${esc(sub)}</span>` : ''}
          </span>
          ${aside}
        </span>
        ${extra}
      </button>
    </div>`;
}

/**
 * 一件待辦。**釘在最上面**，跟整天的行事備註同一區 —— 它沒有時間
 * （她自己選的：只選日期），硬塞進時間軸只能擺在一個假位置。
 *
 * 方框勾勾那個記號留著（ADR-0045）：它不搶一個色相，而顏色沒有「完成」
 * 這個狀態，記號有。
 */
function noteLine(n) {
  return agendaRow({
    kind: `kind-todo${n.done ? ' kind-todo--done' : ''}`,
    open: `note:${n.id}`,
    clock: '整天',
    title: n.text,
    aside: n.customerName ? `<span class="timerow__aside">${esc(n.customerName)}</span>` : '',
  });
}

/** 整天的行事備註或休假。跨天的把期間寫在右邊 —— 那是這一類唯一有、別人沒有的資訊。 */
function eventLine(e) {
  return agendaRow({
    kind: e.kind,
    open: `event:${e.id}`,
    clock: '整天',
    title: e.title,
    sub: e.note ?? '',
    aside: e.spanLabel && e.spanLabel !== '整天'
      ? `<span class="timerow__aside">${esc(e.spanLabel)}</span>`
      : '',
  });
}

/**
 * 日。一整天照時間排開，左邊時間、中間內容、右邊狀態。
 * 整天的行事備註釘在最上面，不進時間軸 —— 它沒有時間，硬塞進去只能擺在一個假位置。
 */
function dayHtml(data, date, today) {
  const rows = shows('visit') ? agendaFor(data.visits, date, data) : [];
  const visible = data.events.filter((e) => shows(e.category));
  const { allDay, timed } = dayEvents(visible, date);
  const todos = notesOn(data, date);

  // 有時間的行事備註跟來訪的時段排在同一條時間軸上 —— 她要看的是
  // 「那一格幾點有事」，不是「這件事屬於哪一種資料」。
  const merged = [
    ...rows.map((r) => ({ kind: 'visit', at: r.startsAt, row: r })),
    ...timed.map((e) => ({ kind: 'event', at: e.startTime, event: e })),
  ].sort((a, b) => {
    const av = isValidTime(a.at) ? toMinutes(a.at) : Infinity;
    const bv = isValidTime(b.at) ? toMinutes(b.at) : Infinity;
    return av - bv;
  });

  // 空的那一天講的那句話搬到這裡（`issues/04`）—— 它以前掛在抽屜抬頭底下的
  // 說明列上，而那一列現在拿掉了。這句不能拿掉：SPEC 第 8.6 節最後一段要求
  // 這一頁講明「空的格子不等於那個時段真的空著」，不然她會拿它當可用時段表用。
  if (!merged.length && !allDay.length && !todos.length) {
    return `<p class="muted" style="margin: 0">這天還沒有東西 ——
      但同事在 Abovee 壓的看不到，空的不代表真的空著。</p>`;
  }

  const pinned = [...todos.map(noteLine), ...allDay.map(eventLine)].join('');

  return `
    <div class="timeline">
      ${pinned}
      ${pinned && merged.length ? '<hr class="timeline__split" />' : ''}
      ${merged.map((item) => (item.kind === 'visit'
        ? visitRow(item.row)
        : eventRow(item.event))).join('')}
    </div>`;
}

/** 一筆來訪的一段。狀態 class 掛在整列上，色棒與徽章都從它繼承。 */
function visitRow(r) {
  return agendaRow({
    kind: esc(statusClass(r.status)) || 'kind-visit',
    open: `visit:${r.visitId}`,
    clock: r.startsAt || '—',
    until: r.endsAt || '',
    title: r.customerName,
    sub: `${r.courseName}${r.room ? `・${r.room}${r.bed ?? ''}` : ''}${
      r.therapist ? `・${r.therapist}` : ''}`,
    aside: `<span class="badge ${esc(statusClass(r.status))}">${esc(describeStatus(r.status))}</span>`,
    extra: r.clashes.length ? `
      <span class="warn">
        ${icon('alert', { size: 15 })}
        <span>${esc(r.clashes.map((c) => `${c.what} 這個時間也排了 ${c.with}`).join('；'))}。
          只是提醒，沒有擋。</span>
      </span>` : '',
  });
}

/** 有時間的行事備註。跟來訪排在同一條時間軸上。 */
function eventRow(e) {
  return agendaRow({
    kind: e.kind,
    open: `event:${e.id}`,
    clock: e.startTime ?? '—',
    until: e.endTime ?? '',
    title: e.title,
    sub: e.note ?? '',
  });
}

// ---------- 懸浮泡泡 ----------

function fabHtml() {
  return `
    <div class="fab" data-open="${state.fab}">
      ${state.fab ? `
        <div class="fab__menu">
          <button class="fab__item" type="button" data-new-event>
            <span>新增行事備註</span>
            <span class="fab__dot fab__dot--tea">${icon('calendar', { size: 18 })}</span>
          </button>
          <button class="fab__item" type="button" data-new-note>
            <span>新增待辦</span>
            <span class="fab__dot fab__dot--todo">${icon('pencil', { size: 18 })}</span>
          </button>
          <button class="fab__item" type="button" data-new-visit>
            <span>新增來訪</span>
            <span class="fab__dot">${icon('people', { size: 18 })}</span>
          </button>
        </div>` : ''}
      <button class="fab__main" type="button" data-fab aria-label="新增"
              aria-expanded="${state.fab}">
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

  const sheet = openSheet({
    title: shortDate(date),
    // 抬頭底下不再寫「N 件事。點一筆看細節，要改再按鉛筆。」（`issues/04`）——
    // 那是她每天做十次的事，寫出來只佔一行，件數清單自己數得出來。
    // 空的那一天要講的那句話搬進 dayHtml() 的空狀態裡。
    body: dayHtml(data, date, today),
    tools: addMenuHtml(),
    onClose: closeCard,
  });

  sheet.el.querySelectorAll('[data-open]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const [what, id] = btn.dataset.open.split(':');
      openDetail(el, data, what, id, date);
    }),
  );

  wireAddMenu(sheet, {
    visit: () => pickCustomer(el, data, sheet, date, date),
    note: () => mountNoteEditor(el, data, sheet, { date, backDate: date }),
    event: () => mountEditor(el, data, sheet, { kind: 'event', date, backDate: date }),
  });

  return sheet;
}

/**
 * 那一天的抽屜，抬頭右上角那一顆「＋」。
 *
 * 以前是底部三顆並排的按鈕（待辦／行事備註／來訪）。三顆等寬、其中一顆主色，
 * 那是**分段切換**的長相 —— 她的原話是「不像是新增的樣子，感覺像是切換而已」。
 * 而且它們佔掉抽屜底部一整條，那一格是她看那一天時最不需要的東西。
 *
 * 選單往下長，順序是**離觸發點最近的最常按** —— 來訪排第一。
 * 懸浮泡泡往上長，所以那邊來訪在最下面：兩者的規矩是同一條
 * （手指從那一顆出發，第一個碰到的是來訪），只是方向相反。
 */
function addMenuHtml() {
  return `
    <div class="addmenu" data-addmenu>
      <button class="addmenu__btn" type="button" data-addmenu-toggle
              aria-label="新增" aria-expanded="false">
        ${icon('plus', { size: 20, width: 2.2 })}
      </button>
      <div class="addmenu__list" data-addmenu-list hidden>
        <button class="addmenu__item" type="button" data-add="visit">
          <span class="fab__dot">${icon('people', { size: 16 })}</span>
          <span>新增來訪</span>
        </button>
        <button class="addmenu__item" type="button" data-add="note">
          <span class="fab__dot fab__dot--todo">${icon('pencil', { size: 16 })}</span>
          <span>新增待辦</span>
        </button>
        <button class="addmenu__item" type="button" data-add="event">
          <span class="fab__dot fab__dot--tea">${icon('calendar', { size: 16 })}</span>
          <span>新增行事備註</span>
        </button>
      </div>
    </div>`;
}

function wireAddMenu(sheet, handlers) {
  const menu = sheet.el.querySelector('[data-addmenu]');
  if (!menu) return;
  const list = menu.querySelector('[data-addmenu-list]');
  const toggle = menu.querySelector('[data-addmenu-toggle]');

  const setOpen = (open) => {
    list.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  };

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(list.hidden);
  });

  // 點面板上任何其他地方就收起來。掛在抽屜上而不是 document 上 ——
  // 抽屜關掉的時候這個監聽跟著節點一起消失，不必自己拆。
  sheet.el.addEventListener('click', (e) => {
    if (menu.contains(e.target)) return;
    setOpen(false);
  });

  // Esc 先收選單，**不要讓它一路傳到抽屜**（`sheet.js` 也聽 Escape）——
  // 不然按一下 Esc 會把整張抽屜關掉，而她只是想收掉那張小選單。
  // 同一個道理見 `card.js` 的 onKey：最上面那一層先關。
  sheet.el.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || list.hidden) return;
    e.stopPropagation();
    setOpen(false);
    toggle.focus();
  });

  menu.querySelectorAll('[data-add]').forEach((btn) =>
    btn.addEventListener('click', () => {
      setOpen(false);
      handlers[btn.dataset.add]?.();
    }),
  );
}

/**
 * 一筆的讀取模式。**先給看的，不先給改的。**
 *
 * 她點一筆的十次有九次只是要確認「那天幾點、誰、做什麼」。直接進表單等於
 * 每一次都冒著改到東西的風險，而這一站最不能出錯的就是次數（ADR-0020）。
 */
function openDetail(el, data, what, id, date) {
  if (what === 'note') return openNoteCard(el, data, id, date);

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
 * 一件待辦的讀取模式。
 *
 * **勾掉那一顆就長在讀取卡片上**，這是待辦跟來訪不一樣的地方：勾掉不是
 * 「改資料」，是「這件事做完了」，而那正是她點開它的原因。來訪那一張
 * 之所以要先看再按鉛筆，是因為那一站最不能出錯的是次數（ADR-0020）；
 * 隨手記勾錯了點回來就好。
 */
function openNoteCard(el, data, id, date) {
  const n = (data.notes ?? []).find((x) => x.id === id);
  if (!n) return;

  const paint = (current) => {
    openCard({
      title: current.text,
      subtitle: `${esc(shortDate(current.date))}${
        current.customerName ? `・${esc(current.customerName)}` : ''}`,
      body: `<p class="muted">隨手記。沒有死線 —— 這個日期是「想在這一天處理」，
        不是死線。</p>`,
      actions: `
        <button class="btn ${current.done ? '' : 'btn--primary'}" type="button" data-tick>
          ${current.done ? '拿回來，還沒做' : '做完了，勾掉'}</button>`,
      canEdit: true,
      onEdit: () => {
        closeCard();
        openNoteEditor(el, data, { id: current.id, backDate: date });
      },
      onMount: (card) => {
        card.querySelector('[data-tick]')?.addEventListener('click', async () => {
          try {
            await toast.withSaveState(() => notesData.setDone(current.id, !current.done), {
              success: current.done ? '拿回來了' : '勾掉了',
            });
          } catch {
            return; /* 已處理 */
          }
          // 卡片留在原地，只把它自己重畫一次 —— 她可能還想看那一天的其他東西。
          // 底下那一天的面板等關掉之後由 render() 一起更新。
          const next = { ...current, done: !current.done };
          const i = (data.notes ?? []).findIndex((x) => x.id === current.id);
          if (i >= 0) data.notes[i] = next;
          paint(next);
        });
      },
      onClose: () => render(el),
    });
  };

  paint(n);
}

/**
 * 待辦的編輯器。掛在同一張抽屜裡，不換頁（ADR-0020）。
 *
 * 欄位跟隨手記其他三個入口一模一樣（`ui/components/note.js`）——
 * 日曆上那一類**就是隨手記本人**（ADR-0044），長得不一樣只會讓她以為
 * 是兩種東西。
 */
function mountNoteEditor(el, data, sheet, spec) {
  const existing = spec.id ? (data.notes ?? []).find((x) => x.id === spec.id) : null;
  const isNew = !existing;

  sheet.setTitle(isNew ? '新增待辦' : '改這一件');
  sheet.setNote('隨手記。掛了日期就會出現在日曆上，拿掉日期它還在隨手記裡。');
  sheet.setActions('');
  // 換成編輯器／選人之後，抬頭那顆「＋」要收掉 ——
  // 在一張正在填的表單上面留一顆「新增」是講不通的。
  sheet.setTools('');
  sheet.update(`
    <form data-noteform class="form">
      <label class="field">
        <span class="field__label">記什麼</span>
        <input type="text" name="text" maxlength="${NOTE_TEXT_MAX}"
               value="${esc(existing?.text ?? '')}"
               placeholder="例：幫王小明問週六有沒有位子" />
      </label>
      <span class="field__label">哪一天</span>
      ${note.field({ value: existing?.date ?? spec.date })}
      <div class="form__actions" style="margin-top: var(--space-4)">
        <button class="btn btn--primary btn--wide" type="submit">
          ${isNew ? '記下來' : '存起來'}</button>
        ${isNew ? '' : `
          <button class="btn" type="button" data-undate>從日曆拿掉</button>
          <button class="btn btn--danger" type="button" data-drop>刪掉</button>`}
      </div>
      ${isNew ? '' : `<p class="field__hint">「從日曆拿掉」只是清掉日期 ——
        這一筆會留在隨手記裡，只是不再出現在日曆上。</p>`}
    </form>`);
  sheet.expand();

  note.wire(sheet.el);

  const done = () => {
    closeSheet();
    render(el);
  };

  const write = async (changes, success) => {
    try {
      await toast.withSaveState(
        () => (isNew ? notesData.create(changes) : notesData.update(existing.id, changes)),
        { success },
      );
      done();
    } catch {
      /* 已處理 */
    }
  };

  sheet.el.querySelector('[data-noteform]').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = String(e.target.elements.text.value ?? '').trim();
    if (!text) return;
    write(
      {
        text,
        date: note.read(sheet.el),
        // 掛的客戶不在這一頁改 —— 那是客戶詳情頁的事，而這裡改的是「哪一天」。
        customerId: existing?.customerId ?? null,
        customerName: existing?.customerName ?? null,
      },
      isNew ? '記下來了' : '改好了',
    );
  });

  sheet.el.querySelector('[data-undate]')?.addEventListener('click', () =>
    write(
      {
        text: existing.text,
        date: null,
        customerId: existing.customerId ?? null,
        customerName: existing.customerName ?? null,
      },
      '從日曆拿掉了，隨手記裡還在',
    ),
  );

  sheet.el.querySelector('[data-drop]')?.addEventListener('click', async () => {
    const ok = await confirmAction({
      title: '刪掉這一件？',
      body: '它會進「已刪除項目」，之後還原得回來。',
      confirm: '刪掉',
      danger: true,
    });
    if (!ok) return;
    try {
      await toast.withSaveState(() => notesData.remove(existing.id, '從日曆刪掉'), {
        success: '刪掉了',
      });
      done();
    } catch {
      /* 已處理 */
    }
  });
}

/** 沒有現成抽屜可以接的時候（資訊卡片上的鉛筆）就開一張新的。 */
function openNoteEditor(el, data, spec) {
  const sheet = openSheet({ title: '', body: '', onClose: closeCard });
  mountNoteEditor(el, data, sheet, spec);
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
      行事備註不綁客戶、不產生任務、不扣次數。</p>`;
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
    ? (isNew ? '新增行事備註' : '行事備註')
    : `${shortDate(spec.date)} ${isNew ? '排一筆' : '的來訪'}`);
  sheet.setNote('');
  sheet.setActions('');
  // 換成編輯器／選人之後，抬頭那顆「＋」要收掉 ——
  // 在一張正在填的表單上面留一顆「新增」是講不通的。
  sheet.setTools('');
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
  // 換成編輯器／選人之後，抬頭那顆「＋」要收掉 ——
  // 在一張正在填的表單上面留一顆「新增」是講不通的。
  sheet.setTools('');
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

  el.querySelector('[data-new-note]')?.addEventListener('click', () => {
    state.fab = false;
    paint(el, data);
    openNoteEditor(el, data, { date: state.day ?? state.date });
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
