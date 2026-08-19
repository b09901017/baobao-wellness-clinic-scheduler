// 個人行程的編輯器。ADR-0015。
//
// 公出、休假、演講 —— 她自己的行事，不是客戶的來訪。
// 不綁客戶、不產生任務、不扣次數，所以這一頁完全碰不到額度與任務，
// 也就不可能扣錯次數。那正是它跟來訪編輯器分開的理由。

import * as eventsData from '../../data/events.js';
import { CATEGORIES, DEFAULT_CATEGORY, validateEvent, kindClass, isLeave } from '../../domain/events.js';
import { todayISO, isValidDate, shortDate } from '../../domain/dates.js';
import * as f from '../components/form.js';
import { confirmAction } from '../components/dialog.js';
import { icon } from '../icons.js';
import * as toast from '../toast.js';
import { go } from '../router.js';

const esc = f.esc;

export async function renderNew(el, date) {
  const start = isValidDate(date) ? date : todayISO();
  paint(el, {
    title: '',
    category: DEFAULT_CATEGORY,
    startDate: start,
    endDate: start,
    allDay: true,
    startTime: '09:00',
    endTime: '10:00',
    note: '',
  }, { isNew: true });
}

export async function renderEdit(el, id) {
  el.innerHTML = '<p class="muted">載入中…</p>';
  const event = await eventsData.get(id);
  if (!event) {
    el.innerHTML = '<div class="card"><p>找不到這筆行程，可能已經被刪掉了。</p></div>';
    return;
  }
  paint(el, event, { isNew: false });
}

function paint(el, event, { isNew }) {
  // 畫面上的暫存值。存下去之前不寫回資料。
  const draft = { ...event };

  const repaint = () => {
    el.innerHTML = html(draft, { isNew });
    wire(el, draft, { isNew, id: event.id }, repaint);
  };
  repaint();
}

function html(e, { isNew }) {
  return `
    <a class="backlink" href="#/calendar">${icon('left', { size: 19 })}日曆</a>

    <div class="page">
      <h1 class="page__title">${isNew ? '新增個人行程' : '個人行程'}</h1>
      <p class="page__lead">不綁客戶、不產生任務、不扣次數。這是唯一可以跨天的東西。</p>
    </div>

    <section class="card">
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
          : `<p class="field__hint">個人行程只是那個時段有事，其餘時間照樣排得了。</p>`}
      </div>

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

      <button class="btn btn--primary btn--wide" type="button" data-save>
        ${isNew ? '加進日曆' : '存起來'}</button>
    </section>

    ${isNew ? '' : `
      <section class="card danger">
        <h2 class="card__title">刪掉這筆</h2>
        <p class="card__note">刪除只是標記，設定 → 已刪除項目裡還原得回來。</p>
        <button class="btn btn--danger" type="button" data-delete>刪掉</button>
      </section>`}`;
}

function wire(el, draft, { isNew, id }, repaint) {
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

  el.querySelector('[data-allday]')?.addEventListener('change', (ev) => {
    draft.allDay = ev.target.checked;
    repaint();
  });

  el.querySelector('[data-save]')?.addEventListener('click', () => save(el, draft, { isNew, id }));
  el.querySelector('[data-delete]')?.addEventListener('click', () => remove(el, draft, id));
}

async function save(el, draft, { isNew, id }) {
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
    go('/calendar');
  } catch {
    /* 已處理 */
  }
}

async function remove(el, draft, id) {
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
    go('/calendar');
  } catch {
    /* 已處理 */
  }
}
