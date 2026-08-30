// 本輪可用性的收集與檢視。SPEC 第 4.3、8.5 節。掛在客戶詳情底下。
//
// 這一頁的設計只有一個重點：**原文永遠比解析結果大**。
//
// 收集有兩個來源：她自己記的，和客戶自己填表單填的（`source: 'form'`，
// 見 ADR-0031 與 ADR-0032）。兩種在這一頁長得一樣、改起來也一樣 ——
// 差別只有一顆徽章，因為客戶自己講的話比她轉述的可信，那件事值得看得見。
// 原文用正常字級顯示在最上面，解析出來的規則排在它下面，而且明講那是「系統讀成」，
// 讓她一眼看得出系統有沒有讀錯。看不懂的句子也要列出來 —— 安靜地少一條規則，
// 她會以為系統知道，其實不知道。

import * as data from '../../data/customers.js';
import {
  describeRule, currentCollection, validateCollection,
  collectionsByMonth, monthsTaken, summarizeCollection, describeRuleChanges,
} from '../../domain/availability.js';
import {
  freeTextFrom, monthGrid, picksToRules, rawTextFrom, rulesToPicks,
} from '../../domain/availabilityForm.js';
import {
  todayISO, addMonths, lastDayOf, shortDate, monthLabel, weekdayOf, weekdayName,
} from '../../domain/dates.js';
import * as banUi from '../components/ban.js';
import * as f from '../components/form.js';
import { icon } from '../icons.js';
import { monthNav, steppedMonth } from '../components/monthnav.js';

/**
 * 一週從星期一開始。全站四個畫著格子的地方都是這個順序 ——
 * 日曆與壓表的小日曆走 `domain/calendar.js` 的 `WEEKDAY_HEADERS`，
 * 這一頁與客戶填的表單自己列（它們的格子是自己畫的，不吃那一份表頭）。
 * 2026-08-25 之前日曆那兩個是週日起算，而這裡的註解寫著「跟她的日曆一樣」——
 * 那句話當時是假的。
 */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
import { pushLayer, pushScreen } from '../nav.js';
import { openSheet } from '../components/sheet.js';
import { confirmAction } from '../components/dialog.js';
import * as toast from '../toast.js';

const esc = f.esc;

// ---------- 客戶詳情裡的區塊 ----------

/**
 * 客戶詳情上那一段。
 *
 * **「以前問過的」是一行一份，收起來的時候只有月份與一句摘要**（ADR-0053）。
 * 以前是每一份都整塊攤開，問過六個月就是六大塊紅框框，底下的額度與來訪紀錄
 * 被推到看不見的地方 —— 她的原話是「不要一點開就跳出全部占版面」。
 *
 * 就地展開不做成抽屜：她攤開歷史是在對帳，那時候她會想一直看著它，
 * 而抽屜要再關一次才回得來（同「來訪紀錄」那一段的判斷）。
 */
export function sectionHtml(collections, today) {
  const current = currentCollection(collections, today);
  const groups = collectionsByMonth(collections)
    .map((g) => ({ ...g, records: g.records.filter((c) => c.id !== current?.id) }))
    .filter((g) => g.records.length);
  const count = groups.reduce((n, g) => n + g.records.length, 0);

  return `
    <div class="section">
      <h2 class="section__title">不能的時間</h2>
      ${current ? '' : '<span class="badge badge--overdue">該重問了</span>'}
      <button class="section__more" type="button" data-add-avail>記一次</button>
    </div>

    ${banUi.banBlock(banUi.rowFromCollection(current), {
      month: monthLabel(current?.validFrom ?? today),
      raw: true,
    })}

    ${current ? `
      <p style="margin: var(--space-2) 0 0">
        <button class="btn btn--sm" type="button" data-edit-avail="${esc(current.id)}">編輯</button>
      </p>` : ''}

    ${count
      ? `<details class="pastavail">
           <summary class="muted">以前問過的 ${count} 次</summary>
           ${byYear(groups).map(([year, months]) => `
             <p class="pastavail__year">${year ? `${esc(year)} 年` : '有效期看不出月份'}</p>
             ${months.flatMap((g) => g.records.map((c) => pastRow(g.month, c))).join('')}
           `).join('')}
         </details>`
      : ''}`;
}

/** 年份新的在前。`collectionsByMonth()` 已經排好月份，這裡只是再收一層。 */
function byYear(groups) {
  const years = new Map();
  for (const g of groups) {
    const year = g.month ? g.month.slice(0, 4) : null;
    if (!years.has(year)) years.set(year, []);
    years.get(year).push(g);
  }
  return [...years.entries()];
}

/** 收起來只有一行：哪個月、什麼時候問的、幾條。點開才是那份紅框框。 */
function pastRow(month, record) {
  return `
    <details class="pastavail__one">
      <summary class="pastavail__sum">
        <span class="pastavail__month">${month ? esc(monthLabel(`${month}-01`)) : '？'}</span>
        <span class="muted">${esc(summarizeCollection(record))}</span>
      </summary>
      ${banUi.banBlock(banUi.rowFromCollection(record), {
        month: month ? monthLabel(`${month}-01`) : '', raw: true,
      })}
      <p style="margin: var(--space-2) 0 0">
        <button class="btn btn--sm" type="button"
                data-edit-avail="${esc(record.id)}">編輯</button></p>
    </details>`;
}

export function wireSection(ctx) {
  ctx.el.querySelector('[data-add-avail]')?.addEventListener('click', () => openPicker(ctx));

  ctx.el.querySelectorAll('[data-edit-avail]').forEach((btn) =>
    btn.addEventListener('click', () =>
      paintForm(ctx, ctx.availability.find((c) => c.id === btn.dataset.editAvail)),
    ),
  );
}

// ---------- 記一次：先問是哪個月 ----------
//
// 她問時間的節奏是「月底那一兩個禮拜問下個月」，所以一份就是一個月（ADR-0053）。
// 「記一次」以前直接開一張下個月的空白表，於是同一個月被記兩份是很容易的事 ——
// 而壓表只挑得到其中一份（`collectionFor()`，ADR-0036），另一份是隱形的。
//
// **同一個月不會有第二份，是動線本身保證的**：已經有的月份只出現在「改」那一排，
// 不會出現在「新增」那一排。不是靠一句錯誤訊息。

/** 「新增」那一排給幾個月。從下個月往後數，夠她提前問。 */
const AHEAD = 4;

function openPicker(ctx) {
  const today = todayISO();
  const taken = new Set(monthsTaken(ctx.availability));
  const existing = collectionsByMonth(ctx.availability).filter((g) => g.month);
  const ahead = [];
  for (let i = 1; i <= AHEAD; i += 1) {
    const month = addMonths(today, i).slice(0, 7);
    if (!taken.has(month)) ahead.push(month);
  }

  const sheet = openSheet({
    title: '記一次',
    note: '一份就是一個月。已經問過的那幾個月在上面，改它就好。',
    body: `
      ${existing.length ? `
        <div class="field">
          <div class="field__label">改已經填過的</div>
          <div class="chips">
            ${existing.flatMap((g) => g.records.map((c) => `
              <button class="chip" type="button" data-pick-edit="${esc(c.id)}">
                ${esc(monthLabel(`${g.month}-01`))}
                <span class="num dim">&nbsp;${esc(c.collectedAt ?? '')}</span></button>`)).join('')}
          </div>
        </div>` : ''}

      <div class="field">
        <div class="field__label">新增</div>
        <div class="chips">
          ${ahead.map((m) => `
            <button class="chip" type="button" data-pick-new="${m}">
              ${esc(monthLabel(`${m}-01`))}</button>`).join('')
            || '<span class="muted">往後四個月都問過了。要改的話點上面那一排。</span>'}
        </div>
      </div>`,
  });

  sheet.el.querySelectorAll('[data-pick-edit]').forEach((btn) =>
    btn.addEventListener('click', () => {
      sheet.close();
      paintForm(ctx, ctx.availability.find((c) => c.id === btn.dataset.pickEdit));
    }),
  );

  sheet.el.querySelectorAll('[data-pick-new]').forEach((btn) =>
    btn.addEventListener('click', () => {
      sheet.close();
      paintForm(ctx, null, null, btn.dataset.pickNew);
    }),
  );
}

// ---------- 收集表單：一個日曆 ----------
//
// 2026-08-24 之前這裡是「客戶原話 → 用原文重新解析 → 系統讀成 N 條 →
// 自己加一條（六個下拉選單）」。那是為了「客戶回一段自由文字」那個世界設計的，
// 而那個世界已經過去了：現在幾乎每一份都是客戶自己在表單上點的
//（ADR-0031、0032），剩下的是她在電話裡問到的 —— 而她手上就有一個日曆。
//
// 她的原話：「我點選不能的時間的記一次，我希望呈現的介面是一個日曆，
// 而不是選單…就和我給客戶填的不方便的時間的那個表單一樣簡單明瞭就好，
// 一樣可以有備註啦。」
//
// **互動照抄客戶那一頁，樣式不抄。** 客戶那一頁的顏色寫在 `public/css/form.css`
// 而且刻意不套 `.status-*`（SPEC 第 8.9 節）—— 那是為了「改一個來訪顏色不會
// 同時改到客戶看的東西」。這一頁是她的畫面，走 `app.css`。
//
// ## 原文變成產出，不是輸入
//
// `rawTextFrom()` 把她點的東西寫成一句人話，再把她打的備註接在後面。
// SPEC 第 4.3 節的「原文永遠比解析結果大」仍然成立 —— 原文還在，
// 只是它現在保證跟規則一致（那句話餵回 `parseAvailability()` 會得到同一組規則，
// 那是 `tests/availability-form.test.js` 盯著的不變量）。

/**
 * 點一天之後那張三選一疊在這一頁上面，所以它**也是一層**（ADR-0048：
 * 畫面上多出來一層東西，就多一筆返回鍵退得掉的紀錄 —— 不管那一層是一張抽屜、
 * 一張卡片、一個對話框）。
 *
 * 它的生死跟著 `state.sheetDate` 走，同步在 `wireForm()` 的最後做：
 * 有日期就推一層、沒有就收掉。這樣「點選項」「點取消」「按返回鍵」三條路
 * 都落在同一個地方，不會有第二份關閉邏輯。
 */
let daySheetLayer = null;

/**
 * 這一頁的委派監聽掛在 `[data-availform]` 上，**不掛在 `el` 上**。
 *
 * `paintForm()` 換的是 `el.innerHTML`，`el` 本身沒有被換掉 —— 掛在 `el` 上的話
 * 每重畫一次就多一顆，而且**離開這一頁之後它還活著**：客戶詳情的「這個月」
 * 也用 `monthNav()`（同一個 `data-month-step`），於是記一次回去之後按那兩顆
 * 箭頭會整頁跳回記一次（`.scratch/asks-2026-08-25/issues/04`）。
 *
 * 掛在每次重畫都會被換掉的那個容器上，就沒有任何人需要記得拆它。
 */
const formRoot = (el) => el.querySelector('[data-availform]');

/** 她問的永遠是「下個月」，所以預設就是下個月。 */
const defaultMonth = (today) => addMonths(today, 1).slice(0, 7);

const rangeOfMonth = (month) => {
  const [y, m] = month.split('-').map(Number);
  return { validFrom: `${month}-01`, validTo: `${month}-${String(lastDayOf(y, m)).padStart(2, '0')}` };
};

const PART_CHOICES = [
  ['all', '整天不行'],
  ['am', '只有上午不行'],
  ['pm', '只有下午不行'],
];

/**
 * @param {object} ctx
 * @param {object|null} record 既有的那一份，null 是新記一次
 * @param {object|null} draft 重畫時帶著的暫存值
 * @param {string|null} month 新增時她在面板上挑的那個月，`'YYYY-MM'`
 */
function paintForm(ctx, record, draft = null, month = null) {
  const { el, customer } = ctx;
  const today = todayISO();
  const isNew = !record?.id;

  // 從客戶詳情重新進來（不是自己重畫）—— 上一次留下的那一層不算數了。
  if (!draft) daySheetLayer = null;

  const state = draft ?? initialDraft(record, today, month);
  const cells = monthGrid(state.month, { today: null });

  el.innerHTML = `
    <div data-availform>
    <a class="backlink" href="#" data-back>${icon('left', { size: 17 })}${esc(customer.name)}</a>

    <div class="page">
      <h1 class="page__title">${isNew ? '記' : '改'}${
        esc(monthLabel(`${state.month}-01`))}不能的時間</h1>
      <p class="page__lead">點掉他不方便的日子就好。什麼都不點就是「這個月都可以」。</p>
    </div>

    <div class="errors" data-errors hidden></div>

    <div class="section">
      <h2 class="section__title">${esc(monthLabel(`${state.month}-01`))}</h2>
      ${
        // **既有的那一份不給換月份**：一份綁一段有效期（ADR-0053），把 9 月那一份
        // 改成 10 月，壓 9 月的表就會突然找不到那一份。要記 10 月的話回上一頁
        // 按「記一次 → 新增」，那條路長出來的是新的一份。
        isNew ? monthNav() : ''
      }
    </div>

    <div class="pickcal">
      <div class="pickcal__week">
        ${WEEK_ORDER.map((w) => `
          <button class="pickcal__wd" type="button" data-weekday="${w}"
                  aria-pressed="${Boolean(state.weekdays.get(w))}"
                  title="整個月的禮拜${weekdayName(w)}都不行">${weekdayName(w)}${
            partTag(state.weekdays.get(w))}</button>`).join('')}
      </div>
      <div class="pickcal__grid">${cells.map((c) => cellHtml(c, state)).join('')}</div>
    </div>
    <p class="muted dim" style="margin: var(--space-2) 0 0; font-size: var(--text-2xs)">
      點最上面那一排可以一次擋掉整個月的某一天（例：每個禮拜五）。</p>

    <div class="section">
      <h2 class="section__title">存起來會變成</h2>
    </div>
    <div data-preview>${previewHtml(state)}</div>

    <section class="card" style="margin-top: var(--space-4)">
      <form data-form>
        ${f.text({
          name: 'freeText', label: '備註　可以不填', value: state.freeText,
          placeholder: '出國回來看情況再說',
          hint: '照抄她說的就好。這一段不會被系統讀成規則，但會一起存進原文。',
        })}
        ${f.date({ name: 'collectedAt', label: '什麼時候問的', value: state.collectedAt })}
        ${f.text({
          name: 'followupNote', label: '追蹤備註　可以不填', value: state.followupNote ?? '',
          placeholder: '禮拜一再確認一次',
        })}

        <div class="form__actions">
          <button class="btn btn--primary" type="submit">儲存</button>
          <button class="btn" type="button" data-cancel>取消</button>
        </div>
      </form>
    </section>

    ${leftoverHtml(state)}
    ${isNew ? '' : dangerZone()}

    ${state.sheetDate ? sheetHtml(state.sheetDate, state) : ''}
    </div>`;

  wireForm(el, ctx, record, state);
}

/**
 * 打開既有的一份時，把規則反推回格子上（`rulesToPicks()`）。
 * 反推不回來的**不吞掉**，放進 `leftover` 列在畫面上。
 */
function initialDraft(record, today, picked = null) {
  const month = record?.validFrom?.slice(0, 7) ?? picked ?? defaultMonth(today);
  const { picks, leftover } = rulesToPicks(record?.rules ?? [], { month });

  return {
    month,
    weekdays: new Map(picks.weekdays.map((w) => [w.weekday, w.partOfDay ?? 'all'])),
    dates: new Map(picks.dates.map((d) => [d.date, d.partOfDay ?? 'all'])),
    leftover,
    // **她（或客戶）自己打的那段話要帶回來。** 存檔時 rawText 是重新產生的，
    // 不帶回來的話改一份舊的等於安靜地把客戶原本說的話換掉（SPEC 第 4.3 節）。
    freeText: freeTextFrom(record?.rawText, picks, { month }),
    collectedAt: record?.collectedAt ?? today,
    followupNote: record?.followupNote ?? '',
    sheetDate: null,
  };
}

const partTag = (v) => ({ am: ' 上午', pm: ' 下午' })[v] ?? '';

function cellHtml(cell, state) {
  if (!cell.date) return '<span class="pickcal__cell pickcal__cell--blank"></span>';

  const picked = state.dates.get(cell.date) ?? (state.weekdays.get(cell.weekday) ?? null);
  const byWeekday = !state.dates.has(cell.date) && state.weekdays.has(cell.weekday);
  const mark = { all: '✕', am: '上午', pm: '下午' }[picked] ?? '';

  return `
    <button class="pickcal__cell ${picked ? `pickcal__cell--off pickcal__cell--${picked}` : ''}
            ${byWeekday ? 'pickcal__cell--auto' : ''}"
            type="button" data-date="${cell.date}" aria-pressed="${Boolean(picked)}">
      <span class="pickcal__d">${cell.day}</span>
      ${mark ? `<span class="pickcal__tag">${esc(mark)}</span>` : ''}
    </button>`;
}

/**
 * 點了一天之後從底下浮出來的三選一。
 *
 * 照客戶那一頁（ADR-0034）：**不做三態循環**（誤觸看不出來，而且點錯要再點
 * 三下才回得到原點），**不做拖拉**（拖拉要關掉那一區的原生捲動）。
 */
function sheetHtml(date, state) {
  const current = state.dates.get(date) ?? null;
  // 這一天是被「每個禮拜X」擋掉的，而**那一條沒有辦法只放行一天** ——
  // 規則裡沒有「except」這種東西（`picksToRules()` 只有星期與日期兩層）。
  // 與其給她一顆按了沒用的「這天其實可以」，不如講出真正的開關在哪裡。
  const byWeekday = !current && state.weekdays.has(weekdayOf(date));

  return `
    <div class="picksheet-back" data-close>
      <div class="picksheet" role="dialog" aria-modal="true">
        <p class="picksheet__title">${esc(shortDate(date))}</p>
        ${byWeekday ? `
          <p class="picksheet__note">這一天是被「每個禮拜${
            weekdayName(weekdayOf(date))}」擋掉的。要放行請點日曆最上面那一排。</p>` : ''}
        ${PART_CHOICES.map(([v, label]) => `
          <button class="picksheet__choice ${current === v ? 'picksheet__choice--on' : ''}"
                  type="button" data-set="${v}">${label}</button>`).join('')}
        <button class="picksheet__cancel" type="button" data-close>
          ${current ? '這天其實可以' : '取消'}
        </button>
      </div>
    </div>`;
}

/** 存起來會變成什麼。跟客戶詳情上那一塊長一樣，所以她看到的就是之後看到的。 */
function previewHtml(state) {
  const picks = draftPicks(state);
  const rules = picksToRules(picks, { month: state.month });
  const range = rangeOfMonth(state.month);

  return banUi.banBlock(banUi.rowFromCollection({
    ...range,
    rules: [...rules, ...state.leftover],
    collectedAt: state.collectedAt,
    rawText: null,
  }), { month: monthLabel(range.validFrom) });
}

/** 反推不回格子上的那幾條。改不了，但仍然生效 —— 所以要看得見。 */
function leftoverHtml(state) {
  if (!state.leftover.length) return '';
  return `
    <section class="card card--danger" style="margin-top: var(--space-4)">
      <h2 class="card__title">這幾條標不回日曆上</h2>
      <p class="card__note">它們**仍然生效**，只是在這一頁改不了 ——
        通常是別的月份的日期，或是舊版手動加的條件。不要的話按刪掉。</p>
      <div class="groups">
        ${state.leftover.map((r, i) => `
          <div class="row" style="padding: var(--space-2) var(--space-3)">
            <span class="row__main">${esc(describeRule(r))}</span>
            <button class="btn btn--sm" type="button" data-drop-leftover="${i}">刪掉</button>
          </div>`).join('')}
      </div>
    </section>`;
}

/**
 * 畫面上的狀態 → `picksToRules()` 吃的形狀。
 *
 * **跟星期那一層重複的日子不送出去**：她點了「每個禮拜二」之後又單獨點了
 * 9/15 整天，兩條規則講的是同一件事，而收集卡上會多一顆看起來像有意義的丸子。
 * 半天不一樣的那幾天要留著 —— 那是真的在說一件不同的事。
 */
const draftPicks = (state) => {
  const weekdays = [...state.weekdays].map(([weekday, v]) => ({
    weekday, partOfDay: v === 'all' ? null : v,
  }));
  const byWeekday = new Map(weekdays.map((w) => [w.weekday, w.partOfDay]));

  const dates = [...state.dates]
    .map(([date, v]) => ({ date, partOfDay: v === 'all' ? null : v }))
    .filter((d) => !(byWeekday.has(weekdayOf(d.date))
      && byWeekday.get(weekdayOf(d.date)) === d.partOfDay));

  return { weekdays, dates };
};

function wireForm(el, ctx, record, state) {
  const isNew = !record?.id;
  const form = el.querySelector('[data-form]');

  // 原地換掉整頁 → 疊一層。這一頁重畫自己很多次（點一天、換月份、刪一條），
  // 所以 pushScreen 要一把 key，不然按十次返回鍵才回得去。
  const back = pushScreen('availability-form', () => ctx.back());
  el.querySelector('[data-back]').addEventListener('click', (e) => {
    e.preventDefault();
    back();
  });
  el.querySelector('[data-cancel]').addEventListener('click', back);

  formRoot(el).addEventListener('click', (e) => {
    const next = steppedMonth(e.target, state.month, addMonths);
    if (next) {
      // 換月份不清掉已經點的：她可能在兩個月之間來回確認。反正只有
      // `state.month` 那個月的格子畫得出來，存的時候也只收那個月。
      paintForm(ctx, record, { ...state, ...readForm(form), month: next, sheetDate: null });
      return;
    }

    const wd = e.target.closest('[data-weekday]');
    if (wd) {
      const n = Number(wd.dataset.weekday);
      const nextMap = new Map(state.weekdays);
      if (nextMap.has(n)) nextMap.delete(n);
      else nextMap.set(n, 'all');
      paintForm(ctx, record, { ...state, ...readForm(form), weekdays: nextMap });
      return;
    }

    const cell = e.target.closest('[data-date]');
    if (cell) {
      paintForm(ctx, record, { ...state, ...readForm(form), sheetDate: cell.dataset.date });
      return;
    }

    const set = e.target.closest('[data-set]');
    if (set) {
      const nextDates = new Map(state.dates);
      nextDates.set(state.sheetDate, set.dataset.set);
      paintForm(ctx, record, { ...state, ...readForm(form), dates: nextDates, sheetDate: null });
      return;
    }

    if (e.target.closest('[data-close]')) {
      const nextDates = new Map(state.dates);
      // 「這天其實可以」與「取消」共用這一顆：本來就沒點過的話刪掉是 no-op。
      if (e.target.closest('.picksheet__cancel')) nextDates.delete(state.sheetDate);
      paintForm(ctx, record, { ...state, ...readForm(form), dates: nextDates, sheetDate: null });
      return;
    }

    const drop = e.target.closest('[data-drop-leftover]');
    if (drop) {
      const i = Number(drop.dataset.dropLeftover);
      paintForm(ctx, record, {
        ...state, ...readForm(form),
        leftover: state.leftover.filter((_, k) => k !== i),
      });
    }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const next = { ...state, ...readForm(form) };
    const picks = draftPicks(next);
    const range = rangeOfMonth(next.month);

    submit(ctx, record, {
      ...range,
      collectedAt: next.collectedAt,
      followupNote: next.followupNote,
      // 原文是**產生**的，不是打的。她的備註接在第二行 —— 跟客戶那一頁同一支，
      // 所以「產生的原文餵回解析器會得到同一組規則」那個不變量在這裡也成立。
      rawText: rawTextFrom({ ...picks, freeText: next.freeText }, { month: next.month }),
      rules: [...picksToRules(picks, { month: next.month }), ...next.leftover],
    });
  });

  if (!isNew) wireDangerZone(ctx, record);

  // 三選一那一層的生死。三條關閉的路（選一個、按取消、按返回鍵）都經過這裡。
  if (state.sheetDate && !daySheetLayer) {
    daySheetLayer = pushLayer(() => {
      daySheetLayer = null;
      // 返回鍵：收掉三選一，那一天不動。
      paintForm(ctx, record, { ...state, ...readForm(form), sheetDate: null });
    });
  } else if (!state.sheetDate && daySheetLayer) {
    daySheetLayer.pop();
    daySheetLayer = null;
  }
}

function readForm(form) {
  const v = f.readForm(form);
  return {
    freeText: String(v.freeText ?? ''),
    collectedAt: v.collectedAt || null,
    followupNote: String(v.followupNote ?? '').trim() || null,
  };
}

/**
 * 改既有的那一份之前，先把差異講出來（ADR-0053）。
 *
 * 「已儲存」三個字說不出「我剛剛是不是把 9/17 弄掉了」，而這一份是壓那個月的表
 * 唯一會看的東西。**沒有差異就不問**，也不寫一筆稽核 —— 她只是點進來看一眼。
 *
 * 新增不問：她正在建立的東西畫面上就有，再問一次只是多一次點擊。
 *
 * @returns {Promise<boolean>} 要不要繼續存
 */
async function confirmChanges(record, next) {
  const { added, removed } = describeRuleChanges(record?.rules ?? [], next.rules ?? []);
  const month = monthLabel(next.validFrom);

  if (!added.length && !removed.length) {
    // 規則一條都沒動，但備註或收集日期可能改了 —— 那兩個不值得攔一次。
    return true;
  }

  return confirmAction({
    title: `改${month}不能的時間？`,
    consequences: [
      // 逃脫由 `components/dialog.js` 負責，這裡傳純文字就好
      ...removed.map((r) => `拿掉「${r}」`),
      ...added.map((r) => `加上「${r}」`),
      `改完之後壓${month}的表會用這一份`,
    ],
    confirmLabel: '存起來',
  });
}

async function submit(ctx, record, next) {
  const errors = validateCollection(next);
  f.showErrors(ctx.el, errors);
  if (errors.length) return;

  if (record?.id && !(await confirmChanges(record, next))) return;

  const payload = {
    rawText: next.rawText.trim(),
    collectedAt: next.collectedAt,
    validFrom: next.validFrom,
    validTo: next.validTo,
    followupNote: next.followupNote,
    rules: next.rules ?? [],
  };

  try {
    if (record?.id) {
      await toast.withSaveState(() => data.updateAvailability(ctx.id, record.id, payload), {
        success: '已儲存', key: `availability:update:${record.id}`,
      });
    } else {
      // 同一個月連點兩下就是兩份可用性，而「哪一份算數」要靠資料健檢才看得出來
      // （ADR-0053：一份就是一個月，重複的不自動合併）。
      await toast.withSaveState(() => data.createAvailability(ctx.id, payload), {
        success: '已記錄', key: `availability:create:${ctx.id}:${payload.month ?? payload.validFrom}`,
      });
    }
    ctx.back();
  } catch {
    /* withSaveState 已顯示錯誤與重試 */
  }
}

function dangerZone() {
  return `
    <section class="card danger">
      <h2 class="card__title">刪除這次的詢問結果</h2>
      <p class="muted">問錯人、記錯了才用刪除。過期的不用刪 —— 它會自己變灰，
        而且留著看得出上次是什麼時候問的。</p>
      <p><button class="btn btn--danger" type="button" data-del-avail>刪除</button></p>
    </section>`;
}

function wireDangerZone(ctx, record) {
  ctx.el.querySelector('[data-del-avail]').addEventListener('click', async () => {
    const ok = await confirmAction({
      title: '刪除這次的詢問結果？',
      consequences: [
        '原文與解析出來的規則都會一起收起來',
        '這是標記刪除，資料不會真的消失',
        '如果只是過期了，不用刪 —— 它會自己變灰',
      ],
      confirmLabel: '刪除',
      danger: true,
    });
    if (!ok) return;

    try {
      await toast.withSaveState(() => data.removeAvailability(ctx.id, record.id), {
        success: '已刪除',
      });
      ctx.back();
    } catch {
      /* 已處理 */
    }
  });
}
