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
import * as tasksData from '../../data/tasks.js';
import * as playbooksData from '../../data/playbooks.js';
import * as customersData from '../../data/customers.js';
import * as visitEditor from './visitEditor.js';
import * as eventEditor from './eventEditor.js';
import {
  VIEWS, VIEW_LABELS, WEEKDAY_HEADERS,
  rangeOf, moveBy, titleOf, weekDays, monthWeeks, agendaFor, summaryByDate,
} from '../../domain/calendar.js';
import { layoutMonth, dayEvents, countByDate, describeCategory, spanLabel } from '../../domain/events.js';
import { givableBags } from '../../domain/products.js';
import {
  describeStatus, statusClass, shortStatus, isActive, STATUS_VIEW_ORDER,
  applyStatus, visitActions,
} from '../../domain/visits.js';
import { todayISO, shortDate, weekdayLabel } from '../../domain/dates.js';
import { MAX_LENGTH as NOTE_TEXT_MAX, noteActions } from '../../domain/notes.js';
import { toMinutes, isValidTime, timeLabel } from '../../domain/visitTime.js';
import { esc } from '../components/form.js';
import { slotName, visitNames } from '../../domain/naming.js';
import * as note from '../components/note.js';
import { hintHtml } from '../components/playbookHint.js';
import { playbooksForVisit } from '../../domain/playbook.js';
import { mirrorHtml, fillMirror } from '../components/taskMirror.js';
import { cancelConsequences } from '../../domain/consequences.js';
import { confirmAction } from '../components/dialog.js';
import * as toast from '../toast.js';
import { openSheet, closeSheet } from '../components/sheet.js';
import { openCard, closeCard } from '../components/card.js';
import { openActions, wireLongPress } from '../components/actions.js';
import { go } from '../router.js';
import { icon } from '../icons.js';

// 看到哪一天留在模組層：點進一筆來訪再退回來，她要回到原本那一頁而不是今天。
// day 是「剛剛打開過哪一天」，關掉面板之後那一格還會標著 —— 她才知道自己看到哪裡。
// `data` 是最後一次畫出來的那一份。長按改完狀態之後要重讀再把同一天重開 ——
// 而 `openDay()` 需要一份新的資料（ADR-0020：她的下一個動作八成是看同一天的別筆）。
const state = { view: 'month', date: null, day: null, hidden: new Set(), fab: false, data: null };

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
    const [visits, events, notes, rooms, staff, courses, equipment, playbooks] = await Promise.all([
      visitsData.listBetween(from.from, to.to),
      eventsData.listInRange(from.from, to.to),
      // 有日期的隨手記（ADR-0044）。跟其他幾份一起走，不多一輪往返。
      notesData.listBetween(from.from, to.to),
      config.listAll('rooms'),
      config.listAll('staff'),
      // 課程主檔：讀取卡片上「這一場的待辦」要它才算得出「簽療程單」該不該
      // 出現（`needsForm()`），取消那一道確認也要它才講得出壓在哪個系統。
      // 含已刪除的 —— 她停用一個課程，既有的來訪照樣要答得出這兩件事。
      config.listAll('courses', { includeDeleted: true }),
      // 器材主檔：一段要唸成什麼要它（`domain/naming.js`）——「復能(SIS)」的
      // 括號裡那一半就是從這裡來的。含已刪除的，理由同課程。
      config.listAll('equipment', { includeDeleted: true }),
      // 備忘錄（ADR-0067）。點開一筆來訪時，那一份的前幾行會浮在卡片底下。
      // `data/playbooks.js` 有行程內快取，所以一個 session 只真的讀一次。
      // **讀不到不擋日曆** —— 那一塊不畫就是了，它是提醒不是這一頁的主體。
      playbooksData.list().catch(() => []),
    ]);
    return {
      ok: true,
      value: {
        visits,
        events,
        notes,
        playbooks,
        roomsById: Object.fromEntries(rooms.map((r) => [r.id, r])),
        staffById: Object.fromEntries(staff.map((s) => [s.id, s])),
        coursesById: Object.fromEntries(courses.map((c) => [c.id, c])),
        // 一段要唸成什麼要的是**陣列**（`domain/naming.js`）。跟上面那張表
        // 並存不是重複：那一張回答「這個 id 是誰」，這一份回答「怎麼唸」。
        master: { courses, equipment },
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
  state.data = data;

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

    <p class="footnote">
      ${icon('todo', { size: 14 })}
      <span>長按一列可以直接改。</span>
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
  // **取消的不算。** 這一行回答的是「那段時間有幾件事要做」，而取消的那一筆
  // 已經沒事要做了 —— 算進去會讓她以為那幾天排滿了（ADR-0061）。
  // 它們照樣畫得出來（月檢視的色條、抽屜裡暗掉的那一列），只是不算數。
  const visits = shows('visit')
    ? data.visits.filter((v) => inRange(v.date) && isActive(v)).length
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
    ...(shows('visit') ? data.visits.map((v) => visitAsBar(v, data.master)) : []),
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
function visitAsBar(visit, master = {}) {
  // **月檢視寫器材名**（`13`）：一格只放得下四個多字，而她真正要認的是
  // 「那天是哪一台」——「復能」三個人都一樣，「SIS」才分得出來。
  const courses = visitNames(visit, master, 'short');
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
        const rows = shows('visit')
          ? agendaFor(data.visits, d, { ...data, includeCancelled: true })
          : [];
        const { allDay, timed } = dayEvents(data.events.filter((e) => shows(e.category)), d);
        const todos = notesOn(data, d);
        // `summaryByDate()` 已經濾掉取消的，所以這個數字天生就不含它們 ——
        // 跟頂端那一行講同一句話（ADR-0061）。
        const total = (day?.visits ?? 0) + (eventCounts[d] ?? 0) + todos.length;
        const weekend = [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());

        // 一天一段，段裡面是跟日檢視一模一樣的列。卡片留在「一天」這一層
        // （那是分組），一筆一個框拿掉了 —— 見 `issues/03`。
        //
        // **畫不畫那一段看的是「有沒有東西可以畫」，不是 `total`。**
        // 那個數字刻意不含取消的（ADR-0061），所以拿它當開關的話，
        // 一天只剩取消的來訪時整段會寫「沒有排東西」而那一列根本不畫。
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

            ${pinned || timeline ? `
              <div class="timeline">
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
 * @param {string} [row.marks] 抬頭右邊那幾顆小圖示（有沒有記的話／備忘錄）
 * @param {string} [row.extra] 整列最底下（撞期提醒）
 */
function agendaRow({
  kind, open, clock, until = '', title, sub = '', aside = '', marks = '', extra = '',
}) {
  return `
    <div class="timerow ${kind}">
      <div class="timerow__clock">
        <div class="timerow__from">${esc(clock)}</div>
        ${until ? `<div class="timerow__to">${esc(until)}</div>` : ''}
      </div>
      <span class="timerow__bar"></span>
      <button class="timerow__body" type="button" data-open="${esc(open)}" data-longpress>
        <span class="row" style="align-items: baseline">
          <span class="row__main">
            <span class="timerow__title">${esc(title)}${marks}</span>
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
  // `includeCancelled`：取消的畫出來但暗掉（ADR-0061）。月檢視的色條一直
  // 都畫得出來，而這裡以前整筆濾掉 —— 同一份資料兩種畫法，她點下去看到空的。
  const rows = shows('visit')
    ? agendaFor(data.visits, date, { ...data, includeCancelled: true })
    : [];
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
  //
  // **問的是 `merged`，也就是「畫得出東西嗎」，不是「有幾件事要做」。**
  // 一天只剩取消的來訪時那幾列照樣要畫（ADR-0061），所以那時候這裡不可以
  // 走空狀態 —— 有了 `includeCancelled` 之後 `merged` 本來就非空。
  // （用「還算數的那幾筆」去問會把 ADR-0061 做反：畫面又變回什麼都沒有。）
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
        ? visitRow(item.row, data)
        : eventRow(item.event))).join('')}
    </div>`;
}

/**
 * 一筆來訪的一段。狀態 class 掛在整列上，色棒與徽章都從它繼承。
 *
 * 取消的那幾列多一個 `timerow--off`：整列降透明度加刪除線（ADR-0061）。
 * **不吃新的色相** —— 色相已經用完了（ADR-0039、0045），所以走的是
 * `.kind-todo--done` 那一種手法。
 */
function visitRow(r, data = null) {
  const off = r.status === 'cancelled' ? ' timerow--off' : '';
  return agendaRow({
    kind: `${esc(statusClass(r.status)) || 'kind-visit'}${off}`,
    open: `visit:${r.visitId}`,
    clock: r.startsAt || '—',
    until: r.endsAt || '',
    title: r.customerName,
    marks: noteMarks(r, data),
    sub: `${r.courseLabel ?? r.courseName}${r.room ? `・${r.room}${r.bed ?? ''}` : ''}${
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

/**
 * 那一列右邊那兩顆小圖示：**這一筆底下有沒有字**。
 *
 * 她的原話：「無法第一時間知道哪一個預約項目底下寫有專屬備忘錄，
 * 必須逐一點開編輯才能確認。」
 *
 * **兩種來源要用兩顆不同的圖示**（她 2026-09-04 選的），因為它們是兩種東西：
 *
 *   記事本 `book`   `visit.note`「記的話」—— 只屬於**這一筆**，她自己打的
 *   翻開的書 `manual` 掛得到的備忘錄／SOP —— 綁**課程**，同一個課程每一筆都有
 *
 * **用形狀不用顏色。** 日曆上要分辨的已經有七種，而色相在休假走斜線紋、
 * 待辦走方框勾勾的時候就用完了（ADR-0039、0045）。這一顆問的是「有沒有」
 * 不是「哪一種」，形狀答得了。
 *
 * **只在抽屜的清單上，不上月檢視** —— 月檢視一格只有幾個 px 的色條，
 * 塞不下第三種記號。
 */
function noteMarks(r, data) {
  const visit = data?.visits?.find((v) => v.id === r.visitId) ?? null;
  const hasPlaybook = visit && playbooksForVisit(data?.playbooks ?? [], visit).length > 0;

  return `${r.hasNote
    ? `<span class="timerow__mark" role="img" aria-label="有記的話">${icon('book', { size: 13 })}</span>`
    : ''}${hasPlaybook
    ? `<span class="timerow__mark" role="img" aria-label="有備忘錄">${icon('manual', { size: 13 })}</span>`
    : ''}`;
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

  // 抽屜裡那幾列的 click **每重畫一次就要重掛**：`sheet.update()` 換掉整塊
  // 內容，舊節點連同監聽一起沒了。所以接的是 `openSheet()` 的 `onMount`
  // —— 它在開的時候與每一次 `update()` 之後都會被呼叫，那正是它存在的理由。
  //
  // **只有這一圈搬進來。** `wireLongPress()` 與 `wireAddMenu()` 是委派在
  // `sheet.el` 上的，而 `sheet.el` 在 `update()` 之後還是同一個節點 ——
  // 搬進來就會每重畫一次多掛一組（`components/actions.js` 的檔頭寫著
  // 這個 repo 修過三次同一種）。抬頭那顆「＋」在 `tools` 那一格，也不在裡面。
  const wireRows = (drawer) => {
    drawer.querySelectorAll('[data-open]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const [what, id] = btn.dataset.open.split(':');
        openDetail(el, data, what, id, date, repaint);
      }),
    );
  };

  const sheet = openSheet({
    title: shortDate(date),
    // 抬頭底下不再寫「N 件事。點一筆看細節，要改再按鉛筆。」（`issues/04`）——
    // 那是她每天做十次的事，寫出來只佔一行，件數清單自己數得出來。
    // 空的那一天要講的那句話搬進 dayHtml() 的空狀態裡。
    body: dayHtml(data, date, today),
    tools: addMenuHtml(),
    onClose: closeCard,
    onMount: wireRows,
  });

  /**
   * 那一天就地重畫。**讀的是抽屜手上那一份 `data`**，不是 `state.data`
   * —— `render()` 之後那兩份會分岔，而她剛剛那一下改的是手上這一份。
   *
   * 走 `sheet.update()` 而不是重開抽屜：它不重設捲動位置，`sheet.js` 上
   * 那一句註解寫的就是這件事（「勾一筆隨手記不該把她捲回最上面」）。
   *
   * **寫成函式宣告是刻意的**：`wireRows` 排在它上面（它要當 `openSheet()`
   * 的參數），靠宣告的提升才引用得到它。改成 `const` 會在她點第一列的時候
   * 丟 ReferenceError。
   */
  function repaint() {
    sheet.update(dayHtml(data, date, todayISO()));
  }

  // 長按一列＝直接做（ADR-0060）。點一下的行為一個字都沒有變。
  // 委派掛在 `sheet.el` 上：那張抽屜關掉時整個節點被拿掉，監聽跟著消失。
  wireLongPress(sheet.el, '[data-open]', (btn) => {
    const [what, id] = btn.dataset.open.split(':');
    openQuickActions(el, data, what, id, date);
  });

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
 *
 * @param {Function} [repaint] 那一天的抽屜就地重畫。**只有待辦那一種用得到**
 *   —— 它是唯一一種可以在讀取卡片上直接改到資料的（ADR-0045）。來訪與
 *   行事備註改完走 `refreshAfterAction()`，那條路本來就會把抽屜整個重開。
 *   日／週檢視上點一筆時沒有抽屜，所以這裡收得到 undefined。
 */
function openDetail(el, data, what, id, date, repaint) {
  if (what === 'note') return openNoteCard(el, data, id, date, repaint);

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

  // 備忘錄接在 `visitReadHtml()` 後面，**只在日曆上** —— 另外三頁問的問題
  // （他還剩幾次、今天要掛哪幾個、這個月做了多少）都不是「這一場我該怎麼做」。
  // 「這一場的待辦」那一塊相反：它在 `visitReadHtml()` 裡面，四頁一起長
  // （2026-09-04 她自己選的，見 `.scratch/templates-memo-and-consequences/spec.md`）。
  const html = (tasks) => visitReadHtml(visit, { ...data, tasks })
    + hintHtml({ playbooks: data.playbooks ?? [], visit });

  const card = openCard({
    title: visit.customerName ?? '（沒有名字）',
    subtitle: `${esc(shortDate(visit.date))}・${esc(describeStatus(visit.status))}`,
    // **先畫，不等任務讀回來。** 她點下去要的是「那天幾點、誰、做什麼」，
    // 為了底下那一小塊讓整張卡片慢半秒是本末倒置。
    body: html(undefined),
    canEdit: true,
    onEdit: () => {
      closeCard();
      openEditor(el, data, {
        kind: 'visit', visitId: visit.id, date: visit.date, backDate: date,
      });
    },
  });

  fillMirror(card, visit, html);
}

/**
 * 一件待辦的讀取模式。
 *
 * **勾掉那一顆就長在讀取卡片上**，這是待辦跟來訪不一樣的地方：勾掉不是
 * 「改資料」，是「這件事做完了」，而那正是她點開它的原因。來訪那一張
 * 之所以要先看再按鉛筆，是因為那一站最不能出錯的是次數（ADR-0020）；
 * 隨手記勾錯了點回來就好。
 *
 * ## 勾完之後這一張自己收掉（2026-09-05，ADR-0073）
 *
 * 在這之前它是**原地重畫**，而重畫的實作是 `openCard()`，那一支第一行就是
 * `closeCard()` —— 所以她看到的是「一張關掉、另一張跳出來」，而新那一張最
 * 顯眼的字是「拿回來，還沒做」。她的原話：
 *
 * > 我按確認之後他又會立刻跳出要不要收回？…我希望是我勾掉然後按確定後，
 * > 他就直接勾掉，而且不要跳出要不要收回的確認
 *
 * **但只有資料庫真的變了才收。** 營養品的提醒沒給完時 `recordDelivery()`
 * 刻意留成 `done: false` 只換掉文字 —— 那一次她按了「勾掉」而它沒有被勾掉，
 * 卡片這時候收掉就是在說一件沒有發生的事（SPEC 第 6.9 節、ADR-0070）。
 *
 * 底部那顆「復原」不受影響：它是**寫入之後**的安全網（SPEC 第 6.3 節），
 * 不是寫入之前的確認，8 秒後自己消失也不擋任何東西。
 */
function openNoteCard(el, data, id, date, repaint) {
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
          // 營養品的提醒會先問「給了哪些」（四個入口共用 `note.prepareToggle()`）。
          // 問話在 withSaveState 外面 —— 包進去的話她按了「先不要」也會跳
          // 一句「勾掉了」。
          const plan = await note.prepareToggle(current, noteDeps());
          if (!plan) return;

          let next;
          try {
            next = await toast.withSaveState(plan.run, { success: plan.success });
          } catch {
            return; /* 已處理 */
          }
          // **看的是寫入那一層回報的那一筆，不是 `!current.done`。**
          // 營養品的提醒沒給完時 `recordDelivery()` 刻意把它留成沒勾掉、
          // 只換掉文字，猜的話畫面會說它已經勾掉了 —— 而資料庫裡沒有
          // 這回事（SPEC 第 6.9 節：樂觀更新要誠實）。
          const i = (data.notes ?? []).findIndex((x) => x.id === current.id);
          if (i >= 0) data.notes[i] = next;

          // 那一天的抽屜就地跟上。它在這之前從頭到尾只畫過一次（`openDay()`
          // 那一刻），而卡片關掉時跑的 `render()` 重畫的是月曆那一片 ——
          // 抽屜掛在 `document.body` 底下，不在 `el` 裡，所以她要重新整理
          // 才看得到那一列被劃掉。
          repaint?.();

          // 真的勾掉（或真的拿回來）了：這張卡片唯一的一件事做完了，收掉它。
          // `onClose` 會把月曆那一片一起更新。
          if (Boolean(next.done) !== Boolean(current.done)) {
            closeCard();
            return;
          }
          // 沒有真的變 —— 留在原地照實說（營養品沒給完的那一次）。
          paint(next);
        });
      },
      onClose: () => render(el),
    });
  };

  paint(n);
}

// ---------- 長按：快捷選單（ADR-0060） ----------
//
// 點一下＝看（讀取卡片），長按＝做。點一下的行為一個字都沒有變。
//
// **改一筆來訪只有日曆這一個入口**（ADR-0056），所以狀態那幾顆只長在這裡 ——
// 待辦中心與客戶詳情的列一顆都不會有。
//
// 存完之後三個畫面怎麼跟上：**一條路都不另外開。** 寫入一律走
// `visitsData.save()`，它把來訪本身、額度的計數與該產生／該收掉的任務放在
// 同一個 batch 裡。待辦中心的「跟客人確認時間」「簽療程單」是從來訪**推導**的，
// 客戶詳情的次數是 `counts()` 現算的 —— 沒有第二份資料要同步。

/** 長按一列之後跳出來的那一張。三種東西各一份清單，全部在 domain。 */
function openQuickActions(el, data, what, id, backDate) {
  if (what === 'visit') return visitQuickActions(el, data, id, backDate);
  if (what === 'note') return noteQuickActions(el, data, id, backDate);
  return eventQuickActions(el, data, id, backDate);
}

/**
 * 存完之後：重讀那一頁，再把**同一天**的抽屜開回來。
 *
 * 不開回來的話她每改一筆就要重新找一次那一天，而她在日曆上的心裡狀態是
 * 「八月三號那天」（ADR-0020）。`render()` 讀完會把新的那一份放進 `state.data`。
 */
async function refreshAfterAction(el, backDate) {
  closeSheet();
  closeCard();
  await render(el);
  if (backDate && state.data) openDay(el, state.data, backDate);
}

function visitQuickActions(el, data, id, backDate) {
  const visit = data.visits.find((v) => v.id === id);
  if (!visit) return;

  const items = visitActions(visit, { today: todayISO() });
  if (!items.length) {
    // 終點（已完成／已取消）沒有東西可做。**講出來**，不要跳一張空選單 ——
    // 靜靜什麼都不發生比講一句話糟（SPEC 第 6.9 節）。
    toast.info(`這一筆是「${describeStatus(visit.status)}」，已經是終點了`);
    return;
  }

  openActions({
    title: visit.customerName ?? '（沒有名字）',
    subtitle: `${shortDate(visit.date)}・${describeStatus(visit.status)}`,
    items,
    onPick: (action) => runVisitAction(el, data, visit, action, backDate),
  });
}

async function runVisitAction(el, data, visit, action, backDate) {
  if (action === 'edit') {
    openEditor(el, data, {
      kind: 'visit', visitId: visit.id, date: visit.date, backDate,
    });
    return;
  }

  if (action === 'close') {
    // 收尾是**逐段**的（ADR-0025：客人做了兩段就走是會發生的事，而次數就是
    // 跟著它扣的）。所以這一顆不自己標，通到待辦中心那張逐段的抽屜。
    go('/todo/close');
    return;
  }

  // 取消照樣走二次確認。長按省掉的是找到那一筆的四層點擊，不是那個決定本身。
  //
  // 那幾句話走 `domain/consequences.js` 的 `cancelConsequences()`，
  // 跟來訪編輯器的狀態卡是**同一份**（ADR-0056：改得動一筆來訪的只有日曆，
  // 而這兩個入口都算在那一個入口裡）。以前兩邊各寫一次「Abovee／Examine／耀聖」
  // 三個並列 —— 而 `bookingSystemsForVisit()` 早就答得出來是哪一個。
  if (action === 'cancelled') {
    // 會被收掉哪幾張要問這一筆的任務。點下去才讀 —— 日曆是她每天開十幾次的
    // 一頁，為了一道確認框先把整月的任務讀回來是白費的。
    // 讀不到就少講那兩句，不要擋住她取消（同 `confirmUntick()` 的判斷）。
    let tasks = [];
    try {
      tasks = await tasksData.listByVisit(visit.id);
    } catch {
      /* 少講兩句，不擋 */
    }
    const ok = await confirmAction({
      title: `取消${visit.customerName ?? ''}這一筆來訪？`,
      consequences: cancelConsequences({
        visit,
        coursesById: data.coursesById ?? {},
        tasks,
      }),
      confirmLabel: '取消這筆來訪',
      danger: true,
    });
    if (!ok) return;
  }

  try {
    // `save()` 要這位客戶的全部來訪才算得出額度的計數（`recount()`）。
    const customerVisits = await visitsData.listByCustomer(visit.customerId);
    const next = applyStatus(visit, action);
    // 快捷選單自己會在回呼之前把節點移除，所以**快速**連點本來就落空了。
    // 但「長按 → 選 → 還在存 → 再長按 → 再選」這條慢路徑沒有東西擋，
    // 而改一筆來訪只有日曆這一個入口（ADR-0056）—— 另外三個存來訪的地方
    // （待辦中心、壓表、來訪編輯器）都有 key，就這裡沒有。
    await toast.withSaveState(() => visitsData.save(next, customerVisits), {
      success: `已改成「${describeStatus(action)}」`,
      key: `visit:save:${visit.id}`,
    });
    await refreshAfterAction(el, backDate);
  } catch {
    /* 已處理 */
  }
}

/**
 * 「給營養品」那一顆點開之後要列的東西。點開才讀，而且只讀一次
 * （`note.wireGive()` 的規矩）—— 日曆是她每天開十幾次的一頁。
 *
 * 誰有貨、哪幾包還沒給完，規則全部在 `domain/products.js` 的 `givableBags()`。
 */
async function loadGivableBags() {
  const [customers, entitlementsBy, openNotes, products] = await Promise.all([
    customersData.list(),
    customersData.entitlementsByCustomer(),
    notesData.listOpen(),
    config.listAll('products'),
  ]);
  return givableBags({ customers, entitlementsBy, notes: openNotes, master: { products } });
}

/** 勾一筆隨手記／改它的日期與掛的人，五個入口共用同一份形狀。 */
function noteDeps() {
  return {
    update: (id, changes) => notesData.update(id, changes),
    remove: (id, reason) => notesData.remove(id, reason),
    setDone: (id, done) => notesData.setDone(id, done),
    loadEntitlements: (cid) => customersData.listEntitlements(cid),
    recordDelivery: (n, e, d) => notesData.recordDelivery(n, e, d),
    loadCustomers: () => customersData.list(),
    // 舊資料的 `items[].name` 是空字串，靠主檔認回名字（`issues/10`）。
    loadProducts: () => config.listAll('products'),
    today: todayISO(),
    // 問話那一段刻意在 withSaveState 外面（見 `note.prepareToggle()` 的檔頭），
    // 所以這裡收的是「真的會寫的那一下」。
    save: (run, opts) => toast.withSaveState(run, opts),
  };
}

function noteQuickActions(el, data, id, backDate) {
  const n = (data.notes ?? []).find((x) => x.id === id);
  if (!n) return;

  openActions({
    title: n.text,
    subtitle: [n.date ? shortDate(n.date) : '沒有日期', n.customerName]
      .filter(Boolean).join('・'),
    items: noteActions(n, { today: todayISO(), onCalendar: true }),
    onPick: async (action) => {
      try {
        const changed = await note.runAction(action, n, {
          ...noteDeps(),
          onEdit: () => openNoteEditor(el, data, { id: n.id, backDate }),
          onBag: () => {
            if (n.customerId) go(`/customers/${n.customerId}`);
            else toast.info('這一筆沒有掛客戶，找不到是哪一包');
          },
        });
        if (changed) await refreshAfterAction(el, backDate);
      } catch {
        /* 已處理 */
      }
    },
  });
}

function eventQuickActions(el, data, id, backDate) {
  const event = data.events.find((e) => e.id === id);
  if (!event) return;

  openActions({
    title: event.title,
    subtitle: `${describeCategory(event.category)}・${spanLabel(event)}`,
    // 行事備註本來就只有這兩件事可做 —— 它不綁客戶、不產生任務、不扣次數。
    items: [
      { id: 'edit', label: '改這一筆', icon: 'pencil' },
      { id: 'remove', label: '刪掉', icon: 'trash', tone: 'danger' },
    ],
    onPick: async (action) => {
      if (action === 'edit') {
        openEditor(el, data, { kind: 'event', id: event.id, backDate });
        return;
      }
      const ok = await confirmAction({
        title: `刪掉「${event.title}」？`,
        consequences: [
          '它會進「已刪除項目」，之後還原得回來',
          isLeaveEvent(event)
            ? '那幾天就不再被當成休假了 —— 壓表會重新排得進去'
            : '行事備註不綁客戶、不產生任務，所以沒有別的東西會跟著變',
        ],
        confirmLabel: '刪掉',
        danger: true,
      });
      if (!ok) return;
      try {
        await toast.withSaveState(() => eventsData.remove(event.id, '在日曆上長按刪掉'), {
          success: '刪掉了',
        });
        await refreshAfterAction(el, backDate);
      } catch {
        /* 已處理 */
      }
    },
  });
}

/** 休假那幾天她根本不在，所以刪掉它的後果跟一般的行事備註不一樣。 */
const isLeaveEvent = (event) => event?.category === 'leave';

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
      ${/* 三排各自是一個欄位，節奏跟上面那個「記什麼」一樣 ——
             以前它們裸放而且中間一點間距都沒有，「營養品」和「掛給誰」
             會擠在一起（她的原話）。`.notemeta` 是那四個入口共用的外框。 */''}
      <div class="field">
        <span class="field__label">哪一天</span>
        <div class="notemeta">${note.field({ value: existing?.date ?? spec.date })}</div>
      </div>
      <div class="field" data-calwho>
        <span class="field__label">掛給誰</span>
        <div class="notemeta">
          ${note.who({
            customerId: existing?.customerId ?? null,
            customerName: existing?.customerName ?? null,
          })}
        </div>
      </div>
      ${isNew ? `<div class="field">${note.give()}</div>` : ''}
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
  // 「掛給誰」跟另外四個入口是同一塊（`ui/components/note.js`）。它以前不在
  // 這一頁，理由寫的是「那是客戶詳情頁的事」—— 而那句話指向一個不存在的地方：
  // 隨手記除了勾掉之外沒有別的編輯入口，這一張就是唯一的那一個
  // （ADR-0044 的 Consequences 自己寫著）。
  //
  // **旗標是必要的。** `note.wire()` 每次都重抓 `[data-notedate]` 所以它自己
  // 防得了重複，`wireWho()` 是把監聽委派在 `sheet.el` 上的 —— 而
  // `sheet.update()` 換的是內容那一塊，`sheet.el` 本身留著。同一張抽屜上
  // mount 兩次就會掛兩組（同 `views/home.js` 的 `openQuick()`）。
  if (!sheet.el.dataset.noteWhoWired) {
    sheet.el.dataset.noteWhoWired = '1';
    // 點開才讀客戶名單 —— 日曆是每天開十幾次的一頁。
    note.wireWho(sheet.el, { load: () => customersData.list() });

    // 「給營養品」那一顆捷徑（ADR-0059、issue 12）。**只在新增時有** ——
    // 改一件既有的待辦時，它是哪一包早就決定了。
    note.wireGive(sheet.el, {
      load: () => loadGivableBags(),
      onPick: (picked) => {
        const box = sheet.el.querySelector('[data-calwho]');
        if (box) box.hidden = Boolean(picked);
        const text = sheet.el.querySelector('[data-noteform] [name="text"]');
        if (picked && text) text.value = picked.text;
      },
    });
  }

  const done = () => {
    closeSheet();
    render(el);
  };

  const write = async (changes, success) => {
    try {
      await toast.withSaveState(
        () => (isNew ? notesData.create(changes) : notesData.update(existing.id, changes)),
        {
          success,
          key: isNew ? `note:create:${changes.date}:${changes.text}` : `note:update:${existing.id}`,
        },
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
    // 選了一包營養品的話，掛的人與 `entitlementId` 由那一包決定 ——
    // 「掛給誰」那一排這時候是收起來的。
    const bag = isNew ? note.readGive(sheet.el) : null;

    write(
      {
        text,
        date: note.read(sheet.el),
        // 兩個欄位是一組的（`domain/notes.js` 的 `normalizePatch()`）：
        // 只帶其中一個過來，另一個會被算成空的。`readWho()` 一律兩個一起回。
        ...(bag
          ? {
            customerId: bag.customerId,
            customerName: bag.customerName,
            entitlementId: bag.entitlementId,
          }
          : note.readWho(sheet.el)),
      },
      isNew ? '記下來了' : '改好了',
    );
  });

  sheet.el.querySelector('[data-undate]')?.addEventListener('click', () =>
    write(
      {
        text: existing.text,
        date: null,
        // 從表單讀，不從 `existing` 讀 —— 她可能剛剛才在這一頁改了掛給誰，
        // 然後才按「從日曆拿掉」。用舊的那一份會把她剛改的清掉。
        ...note.readWho(sheet.el),
      },
      '從日曆拿掉了，隨手記裡還在',
    ),
  );

  sheet.el.querySelector('[data-drop]')?.addEventListener('click', async () => {
    const ok = await confirmAction({
      title: '刪掉這一件？',
      consequences: [
        '它會進「已刪除項目」，之後還原得回來',
        '這一筆在隨手記那邊也會一起消失 —— 日曆上的待辦就是它本人',
      ],
      confirmLabel: '刪掉',
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
 * **這裡不解釋規則。** 底下本來有一句「改時間不是改日期 —— 取消這一筆再重排
 * 一筆」，而這張卡片上根本沒有一個地方改得了日期 —— 那句話對著一個不存在的
 * 按鈕解釋它為什麼不能按（她的原話：「我完全看不懂他想說什麼」）。
 * 那條規則（SPEC 第 7 節規則 10）仍然寫在它真的會發生的地方：來訪編輯器的
 * 狀態卡與取消確認框。見 ADR-0056。
 *
 * ## 「這一場的待辦」那一塊也在這裡，四個畫面一起長
 *
 * 2026-09-04 她要的：點開一筆就看得到那一場的行政進度，不用跳到待辦中心。
 * 做成這一支的一部分而不是日曆的零件，是她自己選的 —— 同一筆來訪在四個畫面
 * 上看到的東西本來就該一模一樣，而「這一場走到哪」不是日曆才要回答的問題。
 *
 * **只給看，不給勾**（她選的）：那一塊裡一個 `<input type="checkbox">` 都沒有。
 *
 * `data.tasks` **沒給就整塊不畫** —— `undefined` 是「還沒讀到」，
 * `[]` 才是「真的一張都沒有」。兩個混在一起的話，讀取還沒回來的那一瞬間
 * 會印出一句「這一場沒有待辦」，而那是假的。
 *
 * @param {object} visit
 * @param {{roomsById:object, staffById:object, tasks?:object[],
 *          coursesById?:object, today?:string}} data
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
          ${/* **那天真的做了什麼**（`13`）：她點的是四選一，這裡要寫「復能(SIS)」。
                四個畫面共用這一支，所以四頁一起改 —— 那是刻意的（ADR-0018、0056）。 */''}
          <div class="readslot__what">${esc(slotName(s, data.master ?? {}, 'full') || '（沒有課程）')}${
            where ? `・${esc(where)}` : ''}</div>
        </div>`;
    }).join('') || '<p class="muted">這筆沒有任何時段。</p>'}

    ${visit.note ? `
      <div class="readrow">
        <span class="readrow__k">記的話</span>
        <span class="readrow__v">${esc(visit.note)}</span>
      </div>` : ''}

    ${mirrorHtml({
      visit,
      tasks: data.tasks,
      coursesById: data.coursesById ?? {},
      today: data.today ?? todayISO(),
    })}`;
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

  // 長按一列＝直接做（ADR-0060）。
  //
  // **委派掛在 `[data-swipe]` 上，不是 `el` 上。** `paint()` 換的是
  // `el.innerHTML`，`el` 本身留著 —— 掛在它上面的話每重畫一次就多一組，
  // 而這一頁光是點一顆篩選就會重畫。三格 swipe 容器每次重畫都是新的節點。
  wireLongPress(el.querySelector('[data-swipe]'), '[data-open]', (btn) => {
    const [what, id] = btn.dataset.open.split(':');
    openQuickActions(el, data, what, id, null);
  });

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
