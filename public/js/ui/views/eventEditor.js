// 行事備註的編輯器。ADR-0015。
//
// 公出、休假、演講 —— 她自己的行事，不是客戶的來訪。
// 不綁客戶、不產生任務、不扣次數，所以這一頁完全碰不到額度與任務，
// 也就不可能扣錯次數。那正是它跟來訪編輯器分開的理由。
//
// 兩個進入點、一份實作（ADR-0020）：客戶那條路走路由（`renderNew` / `renderEdit`），
// 日曆走 `mount()` 掛進抽屜裡。差別只有外框（回上一頁的連結、存完去哪裡），
// 表單本身與驗證一模一樣 —— 兩份表單遲早會有一份漏掉一個欄位。

import * as eventsData from '../../data/events.js';
import {
  CATEGORIES, DEFAULT_CATEGORY, validateEvent, kindClass, isLeave, EVENT_COLOR_OPTIONS,
} from '../../domain/events.js';
import { todayISO, isValidDate, shortDate } from '../../domain/dates.js';
import * as f from '../components/form.js';
import { confirmAction } from '../components/dialog.js';
import { icon } from '../icons.js';
import * as toast from '../toast.js';
import { go } from '../router.js';

const esc = f.esc;

export async function renderNew(el, date) {
  mountNew(el, { date });
}

export async function renderEdit(el, id) {
  await mountEdit(el, { id });
}

function blankEvent(date) {
  const start = isValidDate(date) ? date : todayISO();
  return {
    title: '',
    category: DEFAULT_CATEGORY,
    startDate: start,
    endDate: start,
    allDay: true,
    color: null,
    startTime: '09:00',
    endTime: '10:00',
    note: '',
  };
}

/**
 * 新增一筆。`embedded` 時不畫回上一頁的連結，存完呼叫 `onDone` 而不是換頁 ——
 * 日曆上按「＋」是在同一張抽屜裡完成的，換頁會把「我在看八月」洗掉。
 *
 * @param {HTMLElement} el
 * @param {{date?: string, embedded?: boolean, onDone?: Function, onCancel?: Function}} opts
 */
export function mountNew(el, { date = null, embedded = false, onDone, onCancel } = {}) {
  paint(el, blankEvent(date), { isNew: true, embedded, onDone, onCancel });
}

/** 改一筆。讀不到就把原因寫在原地，不要留一個空白面板。 */
export async function mountEdit(el, { id, embedded = false, onDone, onCancel } = {}) {
  el.innerHTML = '<p class="muted">載入中…</p>';
  const event = await eventsData.get(id);
  if (!event) {
    el.innerHTML = '<div class="card"><p>找不到這筆行程，可能已經被刪掉了。</p></div>';
    return;
  }
  paint(el, event, { isNew: false, embedded, onDone, onCancel });
}

function paint(el, event, opts) {
  // 畫面上的暫存值。存下去之前不寫回資料。
  const draft = { ...event };

  const repaint = () => {
    el.innerHTML = html(draft, opts);
    wire(el, draft, { ...opts, id: event.id }, repaint);
  };
  repaint();
}

function html(e, { isNew, embedded = false }) {
  return `
    ${embedded ? '' : `
      <a class="backlink" href="#/calendar">${icon('left', { size: 19 })}日曆</a>

      <div class="page">
        <h1 class="page__title">${isNew ? '新增行事備註' : '行事備註'}</h1>
        <p class="page__lead">不綁客戶、不產生任務、不扣次數。這是唯一可以跨天的東西。</p>
      </div>`}

    <section class="card ${embedded ? 'card--bare' : ''}">
      <div class="errors" data-errors hidden></div>

      <label class="field">
        <span class="field__label">名稱</span>
        <input type="text" data-title maxlength="80" value="${esc(e.title ?? '')}"
               placeholder="例：宜蘭休假" />
      </label>

      <div class="fieldgroup">
        <span class="fieldgroup__label">哪一種</span>
        <div class="chips">
          ${CATEGORIES.map((c) => `
            <button class="chip ${kindClass(c.id)}" type="button"
                    aria-pressed="${c.id === e.category}" data-category="${c.id}">
              ${esc(c.label)}</button>`).join('')}
        </div>
        ${isLeave(e)
          ? `<p class="field__hint">休假那幾天壓表的小日曆會直接劃掉 —— 你人不在，排了也是白排。</p>`
          : `<p class="field__hint">行事備註只是那個時段有事，其餘時間照樣排得了。</p>`}
      </div>

      ${colourField(e)}

      <label class="choice choice--row">
        <input type="checkbox" data-allday ${e.allDay ? 'checked' : ''} />
        <span>整天</span>
      </label>

      <label class="field">
        <span class="field__label">開始</span>
        <input type="date" data-start value="${esc(e.startDate ?? '')}" />
      </label>

      <label class="field">
        <span class="field__label">結束</span>
        <input type="date" data-end value="${esc(e.endDate ?? '')}" />
        <span class="field__hint">跟開始不同就是跨天的，月檢視上會拉成一條橫的。</span>
      </label>

      ${e.allDay ? '' : `
        <label class="field">
          <span class="field__label">開始時間</span>
          <input type="time" data-starttime value="${esc(e.startTime ?? '')}" step="300" />
        </label>
        <label class="field">
          <span class="field__label">結束時間</span>
          <input type="time" data-endtime value="${esc(e.endTime ?? '')}" step="300" />
        </label>`}

      <label class="field">
        <span class="field__label">備註</span>
        <input type="text" data-note maxlength="200" value="${esc(e.note ?? '')}" />
      </label>

      <div class="form__actions">
        <button class="btn btn--primary" type="button" data-save>
          ${isNew ? '加進日曆' : '存起來'}</button>
        ${embedded ? '<button class="btn" type="button" data-cancel>取消</button>' : ''}
      </div>
    </section>

    ${isNew ? '' : `
      <section class="card danger ${embedded ? 'card--bare' : ''}">
        <h2 class="card__title">刪掉這筆</h2>
        <p class="card__note">刪除只是標記，設定 → 已刪除項目裡還原得回來。</p>
        <button class="btn btn--danger" type="button" data-delete>刪掉</button>
      </section>`}`;
}

/**
 * 挑顏色。公出、宜蘭休假、高齡演講對系統來說一模一樣，那個差別只有她知道
 * （ADR-0040）。色票跟客戶備註同一組六色。
 *
 * 第一顆是「跟著類別」，也就是不挑 —— 它要長成那一類本來的顏色，
 * 所以把 kindClass() 掛在它身上讓 --kind-fg 解得出來。
 */
function colourField(e) {
  return `
    <div class="fieldgroup">
      <span class="fieldgroup__label">顏色　可以不挑</span>
      <div class="swatches" role="group" aria-label="顏色">
        <button class="swatch swatch--auto ${kindClass(e.category)}" type="button"
                data-colour="" aria-pressed="${!e.color}" aria-label="跟著類別"
                style="--mark: var(--kind-fg)"></button>
        ${EVENT_COLOR_OPTIONS.map((c) => `
          <button class="swatch" type="button" data-colour="${c.id}"
                  aria-pressed="${c.id === e.color}" aria-label="${esc(c.label)}"
                  style="--mark: var(--evcolor-${c.id})"></button>`).join('')}
      </div>
      <p class="field__hint">日曆上這一筆會用這個顏色。${
        isLeave(e) ? '休假身上的斜線不會跟著換 —— 那條紋路講的是「你不在」。' : ''}</p>
    </div>`;
}

function wire(el, draft, { isNew, id, embedded, onDone, onCancel }, repaint) {
  const bind = (sel, key) =>
    el.querySelector(sel)?.addEventListener('input', (ev) => {
      draft[key] = ev.target.value;
    });

  bind('[data-title]', 'title');
  bind('[data-note]', 'note');
  bind('[data-starttime]', 'startTime');
  bind('[data-endtime]', 'endTime');

  el.querySelector('[data-start]')?.addEventListener('change', (ev) => {
    draft.startDate = ev.target.value;
    // 結束日期跟著往後推，不要留一個比開始早的值在那裡
    if (draft.endDate < draft.startDate) draft.endDate = draft.startDate;
    repaint();
  });

  el.querySelector('[data-end]')?.addEventListener('change', (ev) => {
    draft.endDate = ev.target.value;
    repaint();
  });

  el.querySelectorAll('[data-category]').forEach((btn) =>
    btn.addEventListener('click', () => {
      draft.category = btn.dataset.category;
      repaint();
    }),
  );

  el.querySelectorAll('[data-colour]').forEach((btn) =>
    btn.addEventListener('click', () => {
      // 空字串就是「跟著類別」。存 null 不存空字串 ——
      // 「挑了一個叫空字串的顏色」跟「沒挑」在查詢上是兩件事。
      draft.color = btn.dataset.colour || null;
      repaint();
    }),
  );

  el.querySelector('[data-allday]')?.addEventListener('change', (ev) => {
    draft.allDay = ev.target.checked;
    repaint();
  });

  el.querySelector('[data-save]')?.addEventListener('click', () =>
    save(el, draft, { isNew, id, onDone }),
  );
  el.querySelector('[data-cancel]')?.addEventListener('click', () => onCancel?.());
  el.querySelector('[data-delete]')?.addEventListener('click', () =>
    remove(el, draft, id, onDone),
  );
}

async function save(el, draft, { isNew, id, onDone }) {
  const { errors } = validateEvent(draft);
  const box = el.querySelector('[data-errors]');
  if (box) {
    box.hidden = !errors.length;
    box.innerHTML = errors.length ? `<ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : '';
  }
  if (errors.length) return;

  try {
    await toast.withSaveState(
      () => (isNew ? eventsData.create(draft) : eventsData.update(id, draft)),
      { success: isNew ? '加好了' : '存好了' },
    );
    if (onDone) onDone();
    else go('/calendar');
  } catch {
    /* 已處理 */
  }
}

async function remove(el, draft, id, onDone) {
  const ok = await confirmAction({
    title: `刪掉「${draft.title}」？`,
    consequences: [
      `${shortDate(draft.startDate)}${draft.endDate !== draft.startDate ? `–${shortDate(draft.endDate)}` : ''} 從日曆上消失`,
      '刪除只是標記，設定 → 已刪除項目裡還原得回來',
    ],
    confirmLabel: '刪掉',
    danger: true,
  });
  if (!ok) return;

  try {
    await toast.withSaveState(() => eventsData.remove(id, '在日曆上刪掉'), { success: '刪掉了' });
    if (onDone) onDone();
    else go('/calendar');
  } catch {
    /* 已處理 */
  }
}
