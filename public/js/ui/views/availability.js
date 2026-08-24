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
import { describeRule, currentCollection, validateCollection } from '../../domain/availability.js';
import {
  monthGrid, picksToRules, rawTextFrom, rulesToPicks,
} from '../../domain/availabilityForm.js';
import {
  todayISO, addMonths, lastDayOf, shortDate, monthLabel, weekdayOf,
} from '../../domain/dates.js';
import * as banUi from '../components/ban.js';
import * as f from '../components/form.js';
import { icon } from '../icons.js';

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];
import { pushScreen } from '../nav.js';
import { confirmAction } from '../components/dialog.js';
import * as toast from '../toast.js';

const esc = f.esc;

// ---------- 客戶詳情裡的區塊 ----------

export function sectionHtml(collections, today) {
  const current = currentCollection(collections, today);
  const others = collections.filter((c) => c.id !== current?.id);

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

    ${others.length
      ? `<details class="pastavail">
           <summary class="muted">以前問過的 ${others.length} 次</summary>
           ${others.map((c) => `
             <div class="pastavail__one">
               ${banUi.banBlock(banUi.rowFromCollection(c), {
                 month: monthLabel(c.validFrom ?? today), raw: true,
               })}
               <p style="margin: var(--space-1) 0 0">
                 <button class="btn btn--sm" type="button"
                         data-edit-avail="${esc(c.id)}">編輯</button></p>
             </div>`).join('')}
         </details>`
      : ''}`;
}

export function wireSection(ctx) {
  ctx.el.querySelector('[data-add-avail]')?.addEventListener('click', () => paintForm(ctx, null));

  ctx.el.querySelectorAll('[data-edit-avail]').forEach((btn) =>
    btn.addEventListener('click', () =>
      paintForm(ctx, ctx.availability.find((c) => c.id === btn.dataset.editAvail)),
    ),
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
 */
function paintForm(ctx, record, draft = null) {
  const { el, customer } = ctx;
  const today = todayISO();
  const isNew = !record?.id;

  const state = draft ?? initialDraft(record, today);
  const cells = monthGrid(state.month, { today: null });

  el.innerHTML = `
    <a class="backlink" href="#" data-back>${icon('left', { size: 17 })}${esc(customer.name)}</a>

    <div class="page">
      <h1 class="page__title">${isNew ? '記一次' : '改這一份'}</h1>
      <p class="page__lead">點掉他不方便的日子就好。什麼都不點就是「這個月都可以」。</p>
    </div>

    <div class="errors" data-errors hidden></div>

    <div class="section">
      <h2 class="section__title">${esc(monthLabel(`${state.month}-01`))}</h2>
      <span class="monthnav">
        <button class="monthnav__btn" type="button" data-month-step="-1"
                aria-label="上個月">${icon('left', { size: 16 })}</button>
        <button class="monthnav__btn" type="button" data-month-step="1"
                aria-label="下個月">${icon('right', { size: 16 })}</button>
      </span>
    </div>

    <div class="pickcal">
      <div class="pickcal__week">
        ${WEEK_ORDER.map((w) => `
          <button class="pickcal__wd" type="button" data-weekday="${w}"
                  aria-pressed="${Boolean(state.weekdays.get(w))}"
                  title="整個月的禮拜${WEEKDAY_NAMES[w]}都不行">${WEEKDAY_NAMES[w]}${
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

    ${state.sheetDate ? sheetHtml(state.sheetDate, state) : ''}`;

  wireForm(el, ctx, record, state, today);
}

/**
 * 打開既有的一份時，把規則反推回格子上（`rulesToPicks()`）。
 * 反推不回來的**不吞掉**，放進 `leftover` 列在畫面上。
 */
function initialDraft(record, today) {
  const month = record?.validFrom?.slice(0, 7) ?? defaultMonth(today);
  const { picks, leftover } = rulesToPicks(record?.rules ?? [], { month });

  return {
    month,
    weekdays: new Map(picks.weekdays.map((w) => [w.weekday, w.partOfDay ?? 'all'])),
    dates: new Map(picks.dates.map((d) => [d.date, d.partOfDay ?? 'all'])),
    leftover,
    freeText: '',
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
            WEEKDAY_NAMES[weekdayOf(date)]}」擋掉的。要放行請點日曆最上面那一排。</p>` : ''}
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

function wireForm(el, ctx, record, state, today) {
  const isNew = !record?.id;
  const form = el.querySelector('[data-form]');
  const repaint = () => paintForm(ctx, record, { ...state, ...readForm(form) });

  // 原地換掉整頁 → 疊一層。這一頁重畫自己很多次（點一天、換月份、刪一條），
  // 所以 pushScreen 要一把 key，不然按十次返回鍵才回得去。
  const back = pushScreen('availability-form', () => ctx.back());
  el.querySelector('[data-back]').addEventListener('click', (e) => {
    e.preventDefault();
    back();
  });
  el.querySelector('[data-cancel]').addEventListener('click', back);

  el.addEventListener('click', (e) => {
    const step = e.target.closest('[data-month-step]');
    if (step) {
      const next = addMonths(`${state.month}-01`, Number(step.dataset.monthStep)).slice(0, 7);
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
  // 沒有用到，但留著讓「今天」跟畫面上的其他日期一致
  void today;
  void repaint;
}

function readForm(form) {
  const v = f.readForm(form);
  return {
    freeText: String(v.freeText ?? ''),
    collectedAt: v.collectedAt || null,
    followupNote: String(v.followupNote ?? '').trim() || null,
  };
}

async function submit(ctx, record, next) {
  const errors = validateCollection(next);
  f.showErrors(ctx.el, errors);
  if (errors.length) return;

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
        success: '已儲存',
      });
    } else {
      await toast.withSaveState(() => data.createAvailability(ctx.id, payload), {
        success: '已記錄',
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
