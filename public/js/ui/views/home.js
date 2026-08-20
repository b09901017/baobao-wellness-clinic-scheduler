// 待辦中心。SPEC 第 8.1 節。首頁。
//
// 主力裝置是手機：她在院內走動、臨時被問，要能隨手勾掉一筆。
//
// **這一頁只放分類與數字，完整內容一律點進去看。** 她開這一頁是為了知道
// 「現在有幾件事、哪一件最急」，不是為了讀完所有細節。
//
// 最重要的一條動線是「跟客人確認時間」：壓表記完 → 這裡出現 → 問完按打勾 →
// 跳出確認畫面把所有時段攤開 → 確認後進日曆。客人說某幾筆不行就逐筆退回，
// 其餘照樣成立 —— 不做整批一次確認，因為客人常常是「這兩天可以、那天不行」。

import * as tasksData from '../../data/tasks.js';
import * as health from './health.js';
import * as visitsData from '../../data/visits.js';
import * as notesData from '../../data/notes.js';
import * as customersData from '../../data/customers.js';
import * as config from '../../data/config.js';
import { urgency, isCancelKind } from '../../domain/taskRules.js';
import { confirmMessage } from '../../domain/messages.js';
import {
  visitsToClose, visitsToConfirm, closeVisit, describeStatus, NOTE_MAX,
} from '../../domain/visits.js';
import { waitState, followupNoteOf } from '../../domain/confirmations.js';
import { sortNotes, openCount, groupByCustomer } from '../../domain/notes.js';
import { todayISO, shortDate, daysBetween } from '../../domain/dates.js';
import { wireDrag } from '../components/sheet.js';
import { timeLabel } from '../../domain/visitTime.js';
import * as f from '../components/form.js';
import * as message from '../components/message.js';
import { icon } from '../icons.js';
import * as toast from '../toast.js';
import { go } from '../router.js';

const esc = f.esc;

// 勾選的任務只活在這一次畫面裡。重畫（勾完送出、復原）就清空。
let picked = new Set();

// 總覽 / 依客戶。切換不進網址 —— 它是看法，不是位置。
let tab = 'all';

// 確認畫面。開著的是哪一位、哪幾段被客人退掉。
let drawer = null;

// ---------- 總覽 ----------

export async function render(el) {
  el.innerHTML = '<p class="muted">載入中…</p>';
  picked = new Set();
  drawer = null;

  const today = todayISO();
  let tasks;
  let pending;
  let unclosed;
  let notes;
  let settings;
  try {
    [tasks, pending, unclosed, notes, settings] = await Promise.all([
      tasksData.listOpen(),
      visitsData.listByStatus('pending_confirm'),
      visitsData.listUnclosed(today),
      notesData.listOpen(),
      config.getSettings(),
    ]);
  } catch (err) {
    el.innerHTML = `<div class="card"><p>讀取失敗：${esc(err.message)}</p>
      <p class="muted">如果一直失敗，可能是 Firestore 的索引還沒建好 ——
      Console 的錯誤訊息裡會有一個建立索引的連結。</p></div>`;
    return;
  }

  paint({ el, tasks, pending, unclosed, notes, settings, today });
}

function paint(ctx) {
  const { el, tasks, pending, unclosed, notes, today } = ctx;

  const overdue = tasks.filter((t) => urgency(t.dueDate, today) === 'overdue');
  const dueToday = tasks.filter((t) => t.dueDate === today);
  const tomorrow = tasks.filter((t) => daysBetween(today, t.dueDate) === 1);
  const waiting = byCustomer(visitsToConfirm(pending, today));
  const toClose = visitsToClose(unclosed ?? [], today);

  el.innerHTML = `
    <div class="page">
      <div class="page__row">
        <span class="muted num">${esc(shortDate(today))}</span>
      </div>
      <h1 class="page__title">${headline(tasks.length, overdue.length, waiting.size, toClose.length)}</h1>
    </div>

    <div data-health></div>

    <div class="seg" role="group" style="margin-bottom: var(--space-4)">
      <button class="seg__item" type="button" aria-pressed="${tab === 'all'}" data-tab="all">總覽</button>
      <button class="seg__item" type="button" aria-pressed="${tab === 'who'}" data-tab="who">依客戶</button>
    </div>

    ${tab === 'all' ? overviewHtml(ctx, { overdue, dueToday, tomorrow, waiting, toClose })
                    : byCustomerHtml(ctx, waiting)}

    ${notesCard(notes)}`;

  wireOverview(ctx);
  scanHealth(el);
}

/** 一句話講完現在的狀況。數字很小的時候不要硬講成很急。 */
function headline(total, overdue, waiting, toClose = 0) {
  if (!total && !waiting && !toClose) return '今天沒有待辦';
  const parts = [];
  if (total) parts.push(`今天有 ${total} 件`);
  // 沒結案的排在最前面 —— 那是唯一會讓剩餘次數失準的一種（SPEC 第 4.2 節）
  if (toClose) parts.push(`${toClose} 筆還沒結案`);
  else if (overdue) parts.push(`其中 ${overdue} 件逾期了`);
  else if (waiting) parts.push(`${waiting} 位在等你確認`);
  return parts.join('，');
}

function overviewHtml(ctx, { overdue, dueToday, tomorrow, waiting, toClose }) {
  const { tasks } = ctx;
  const cancels = tasks.filter((t) => isCancelKind(t.kind));
  const kinds = [...new Set(tasks.filter((t) => !isCancelKind(t.kind)).map((t) => t.kind))];

  return `
    <div class="tiles">
      ${tile('overdue', overdue.length, '逾期', 'tile--overdue')}
      ${tile('today', dueToday.length, '今天', 'tile--soon')}
      ${tile('tomorrow', tomorrow.length, '明天', '')}
    </div>

    <div class="groups">
      ${toClose.length ? groupRow({
        href: '#/todo/close', lead: true, dot: 'accent',
        label: '客人來了嗎', note: '簽了療程單就打勾，次數這時才扣', n: toClose.length,
      }) : ''}
      ${groupRow({
        href: '#/todo/confirm', lead: true, dot: 'accent',
        label: '跟客人確認時間', note: '壓好了、還沒問過本人', n: waiting.size,
      })}
      ${kinds.map((k) => groupRow({
        href: `#/todo/${encodeURIComponent(k)}`, dot: '',
        label: k, note: kindNote(k), n: tasks.filter((t) => t.kind === k).length,
      })).join('')}
      ${cancels.length ? groupRow({
        href: '#/todo/cancel', dot: 'danger',
        label: '改時間／取消', note: '要回頭取消舊登記', n: cancels.length, danger: true,
      }) : ''}
    </div>`;
}

const KIND_NOTES = {
  打電話: '來訪前一天提醒',
  Abovee: '壓表登記',
  Examine: '預約作業 → 查核 → 已報到',
  耀聖: '右下角 → 未報到 → V',
  // 健檢做完了、還沒回去跟客人約聽報告的時間（GitHub issue #15）。
  // 死線不是來訪日前一天，是健檢日往後算 —— 間隔在設定頁調。
  約二返: '健檢做完了，還沒約聽報告的時間',
};
const kindNote = (k) => KIND_NOTES[k] ?? '';

function tile(id, n, label, cls) {
  return `
    <button class="tile ${cls}" type="button" data-tile="${id}">
      <span class="tile__n">${n}</span>
      <span class="tile__label">${esc(label)}</span>
    </button>`;
}

function groupRow({ href, label, note, n, dot = '', lead = false, danger = false }) {
  return `
    <a class="grouprow ${lead ? 'grouprow--lead' : ''}" href="${href}">
      <span class="grouprow__dot ${dot ? `grouprow__dot--${dot}` : ''}"></span>
      <span class="grouprow__main">
        <span class="grouprow__label" ${danger ? 'style="color: var(--overdue)"' : ''}>${esc(label)}</span>
        ${note ? `<span class="grouprow__note">${esc(note)}</span>` : ''}
      </span>
      <span class="grouprow__n" ${danger ? 'style="color: var(--overdue)"' : ''}>${n}</span>
      ${icon('right', { size: 18 })}
    </a>`;
}

/** 依客戶：一位客戶一列，看得出「這個人身上還有幾件事」。 */
function byCustomerHtml(ctx, waiting) {
  const { tasks } = ctx;
  const rows = new Map();

  const bump = (id, name, what) => {
    if (!rows.has(id)) rows.set(id, { id, name, whats: new Set(), n: 0 });
    const row = rows.get(id);
    row.whats.add(what);
    row.n += 1;
  };

  for (const t of tasks) bump(t.customerId, t.customerName ?? '（沒有名字）', t.kind);
  for (const [id, visits] of waiting) {
    bump(id, visits[0].customerName ?? '（沒有名字）', '跟客人確認時間');
  }

  if (!rows.size) return '<p class="muted">沒有待辦。</p>';

  return `
    <div class="stack">
      ${[...rows.values()]
        .sort((a, b) => b.n - a.n || String(a.name).localeCompare(String(b.name), 'zh-TW'))
        .map((r) => `
          <a class="card row" href="#/customers/${esc(r.id)}" style="text-decoration: none; color: inherit">
            <span class="row__main">
              <span class="row__title">${esc(r.name)}</span>
              <span class="muted">${esc([...r.whats].join('・'))}</span>
            </span>
            <span class="badge ${r.whats.has('跟客人確認時間') ? 'badge--ok' : 'badge--soon'}">${r.n}</span>
            ${icon('right', { size: 18 })}
          </a>`).join('')}
    </div>`;
}

// ---------- 隨手記 ----------

/**
 * 客人的零碎小要求。沒有死線，所以它不是任務（見 CONTEXT.md）。
 *
 * 首頁只放最近幾筆與一個輸入框 —— 它要能在三秒內記完，多一個必填欄位
 * 就會變成「算了我等一下再記」，然後就忘了。掛客戶在點進去那一頁做。
 */
function notesCard(notes) {
  const rows = sortNotes(notes).slice(0, 4);
  return `
    <section class="card" style="margin-top: var(--space-5)">
      <div class="row" style="align-items: baseline; margin-bottom: var(--space-2)">
        <h2 class="card__title row__main" style="margin: 0">隨手記
          <span class="muted"> ${openCount(notes)}</span></h2>
        <a class="muted" href="#/todo/notes"
           style="display: inline-flex; align-items: center; gap: 2px; white-space: nowrap">
          全部${icon('right', { size: 14 })}</a>
      </div>

      <div class="groups">
        ${rows.map(noteRow).join('') || '<p class="muted" style="padding: var(--space-3)">還沒記過。客人臨時說的小要求記在這裡。</p>'}
      </div>

      <form data-newnote style="display: flex; gap: var(--space-2); margin-top: var(--space-3)">
        <input type="text" name="text" maxlength="200" style="flex: 1; min-width: 0"
               placeholder="記一筆…" aria-label="新的隨手記" />
        <button class="btn btn--primary" type="submit">記</button>
      </form>
    </section>`;
}

function noteRow(n) {
  return `
    <button class="note ${n.done ? 'note--done' : ''}" type="button" data-note="${esc(n.id)}">
      <span class="note__box">${icon('check', { size: 13, width: 3.2 })}</span>
      <span class="note__main">
        <span class="note__text">${esc(n.text)}</span>
        ${n.customerName ? `<span class="badge" style="margin-top: var(--space-1)">${esc(n.customerName)}</span>` : ''}
      </span>
    </button>`;
}

// ---------- 資料健檢 ----------

/**
 * SPEC 第 6.6 節要求 app 啟動時也在背景跑一次，而她一打開 app 就是這一頁。
 * 掃描本身每天最多跑一次，細節見 views/health.js。
 *
 * 沒問題時整張卡不出現：沒事還佔一格，下次真的有事時她也不會注意到。
 */
async function scanHealth(el) {
  const paintCard = (badge) => {
    const slot = el.querySelector('[data-health]');
    if (!slot) return;
    slot.innerHTML = badge
      ? `<a class="card" href="#/settings/health" style="display: block; text-decoration: none; color: inherit; border-color: var(--soon)">
           <div class="row">
             <span class="row__main">
               <span class="card__title" style="margin: 0; display: block">資料健檢</span>
               <span class="badge badge--soon" style="margin: 3px 0">${esc(badge)}</span>
               <span class="muted" style="display: block">背景掃描發現的差異。只是提醒，沒有動到任何資料。</span>
             </span>
             ${icon('right', { size: 16 })}
           </div>
         </a>`
      : '';
  };

  paintCard(health.lastBadge());
  const result = await health.runIfDue();
  if (result) paintCard(health.lastBadge());
}

// ---------- 總覽的事件 ----------

function wireOverview(ctx) {
  const { el } = ctx;

  el.querySelectorAll('[data-tab]').forEach((btn) =>
    btn.addEventListener('click', () => {
      tab = btn.dataset.tab;
      paint(ctx);
    }),
  );

  el.querySelectorAll('[data-tile]').forEach((btn) =>
    btn.addEventListener('click', () => go(`/todo/${btn.dataset.tile}`)),
  );

  el.querySelectorAll('[data-note]').forEach((btn) =>
    btn.addEventListener('click', () => toggleNote(ctx, btn.dataset.note)),
  );

  el.querySelector('[data-newnote]')?.addEventListener('submit', (e) => {
    e.preventDefault();
    addNote(ctx, e.target);
  });
}

async function toggleNote(ctx, id) {
  const note = ctx.notes.find((n) => n.id === id);
  if (!note) return;
  try {
    await toast.withSaveState(() => notesData.setDone(id, !note.done), {
      success: note.done ? '拿回來了' : '勾掉了',
    });
    await render(ctx.el);
  } catch {
    /* 已處理 */
  }
}

async function addNote(ctx, form) {
  const text = form.elements.text.value.trim();
  if (!text) return;
  try {
    await toast.withSaveState(() => notesData.create({ text }), { success: '記下來了' });
    await render(ctx.el);
  } catch {
    /* 已處理 */
  }
}

// ---------- 點進去的那一頁 ----------

const GROUPS = {
  confirm: { title: '跟客人確認時間', lead: '壓好了、還沒問過本人。問完回來按打勾。' },
  close: { title: '客人來了嗎', lead: '客人來了、療程單簽了就打勾。次數是這時候才扣的。' },
  overdue: { title: '逾期的', lead: '死線已經過去了。' },
  today: { title: '今天要做的', lead: '死線是今天。' },
  tomorrow: { title: '明天要做的', lead: '可以提早做。' },
  cancel: { title: '改時間／取消', lead: '來訪取消後，要回去把已經做掉的登記收回來。' },
  notes: { title: '隨手記', lead: '客人臨時說的小要求。沒有死線，所以它不是任務。' },
};

/** 網址列與 app 標題用。認不得的當成任務種類原樣顯示。 */
export function groupTitle(group) {
  return GROUPS[group]?.title ?? group;
}

export async function renderGroup(el, group) {
  el.innerHTML = '<p class="muted">載入中…</p>';
  picked = new Set();
  drawer = null;

  if (group === 'confirm') return renderConfirm(el);
  if (group === 'close') return renderClose(el);
  if (group === 'notes') return renderNotes(el);

  const tasks = await tasksData.listOpen();
  const today = todayISO();

  const filters = {
    overdue: (t) => urgency(t.dueDate, today) === 'overdue',
    today: (t) => t.dueDate === today,
    tomorrow: (t) => daysBetween(today, t.dueDate) === 1,
    cancel: (t) => isCancelKind(t.kind),
  };
  const match = filters[group] ?? ((t) => t.kind === group);
  const meta = GROUPS[group] ?? { title: group, lead: kindNote(group) };

  paintTasks({ el, group, tasks: tasks.filter(match), today, meta });
}

function paintTasks(ctx) {
  const { el, tasks, today, meta } = ctx;

  el.innerHTML = `
    ${backLink()}
    <div class="page">
      <h1 class="page__title">${esc(meta.title)}</h1>
      <p class="page__lead">${esc(meta.lead)}</p>
    </div>

    ${tasks.length ? `
      <div class="stack">${tasks.map((t) => taskRow(t, today)).join('')}</div>
      <div class="form__actions" style="margin-top: var(--space-4)">
        <button class="btn btn--primary btn--wide" type="button" data-mark disabled>
          把勾起來的標成完成</button>
      </div>`
      : '<p class="muted">這裡是空的。</p>'}`;

  el.querySelectorAll('[data-task]').forEach((box) =>
    box.addEventListener('change', () => {
      if (box.checked) picked.add(box.dataset.task);
      else picked.delete(box.dataset.task);
      syncMarkButton(el);
    }),
  );

  el.querySelectorAll('[data-visit]').forEach((btn) =>
    btn.addEventListener('click', () => go(`/visits/${btn.dataset.visit}`)),
  );

  el.querySelector('[data-mark]')?.addEventListener('click', () => markDone(ctx));
  syncMarkButton(el);
}

function backLink() {
  return `<a class="backlink" href="#/">${icon('left', { size: 19 })}待辦</a>`;
}

function taskRow(t, today) {
  const state = urgency(t.dueDate, today);
  return `
    <div class="card row" style="margin: 0">
      <label class="choice" style="border: none; background: none; padding: 0; flex: 1; min-width: 0; align-items: flex-start">
        <input type="checkbox" data-task="${esc(t.id)}" ${picked.has(t.id) ? 'checked' : ''} />
        <span class="row__main">
          <span class="row__title">
            ${esc(t.customerName ?? '（沒有名字）')}
            <span class="badge">${esc(t.kind)}</span>
            <span class="badge ${badgeClass(state)}">${esc(dueLabel(t.dueDate, today))}</span>
          </span>
          ${t.note ? `<span class="muted">${esc(t.note)}</span>` : ''}
        </span>
      </label>
      ${t.visitId ? `<button class="btn" type="button" data-visit="${esc(t.visitId)}"
                             style="min-height: 40px">來訪</button>` : ''}
    </div>`;
}

function badgeClass(state) {
  if (state === 'overdue') return 'badge--overdue';
  if (state === 'soon') return 'badge--soon';
  return '';
}

/** 死線用「還剩幾天」講，不是只給一個日期 —— 她要的是急不急，不是哪一天。 */
function dueLabel(dueDate, today) {
  const days = daysBetween(today, dueDate);
  if (days < 0) return `逾期 ${-days} 天`;
  if (days === 0) return '今天';
  if (days === 1) return '明天';
  return `${shortDate(dueDate)} 還有 ${days} 天`;
}

function syncMarkButton(el) {
  const btn = el.querySelector('[data-mark]');
  if (!btn) return;
  btn.disabled = picked.size === 0;
  btn.textContent = picked.size
    ? `把勾起來的 ${picked.size} 筆標成完成`
    : '把勾起來的標成完成';
}

async function markDone(ctx) {
  const ids = [...picked];
  if (!ids.length) return;
  try {
    // 一批寫在同一個 commit 裡，所以復原是整批一起退回去
    await toast.withSaveState(() => tasksData.setDone(ids, true), {
      success: `${ids.length} 筆完成`,
    });
    picked = new Set();
    await renderGroup(ctx.el, ctx.group);
  } catch {
    /* 已處理 */
  }
}

// ---------- 跟客人確認時間 ----------
//
// 這一列有三條路，不是兩條：打勾確認、逐段標「客人說不行」，
// 以及**寫一句「禮拜一再問問」**。第三條是她 2026-08-20 講的 ——
// 「問了但還沒回」寫不進去的話，下次打開那一列長得跟從來沒問過的一模一樣。
//
// 那一句存在來訪上（`followupNote` / `followupAt`），不是任務也不是備註：
// 任務要有死線（而「再問問」沒有死線），備註跟著人一輩子（而這一句下禮拜一就過期）。
// 命名對齊 `customers/{id}/availability` 上那一個，小寫的 followup。
// 見 .scratch/visit-lifecycle/issues/01-confirm-row-cannot-carry-a-note.md

async function renderConfirm(el) {
  const [pending, settings] = await Promise.all([
    visitsData.listByStatus('pending_confirm'),
    config.getSettings(),
  ]);
  const today = todayISO();
  paintConfirm({ el, pending: visitsToConfirm(pending, today), settings, today });
}

function paintConfirm(ctx) {
  const { el, pending, settings, today } = ctx;
  const groups = [...byCustomer(pending).entries()];
  const noReplyDays = settings.noReplyDays ?? 3;

  el.innerHTML = `
    ${backLink()}
    <div class="page">
      <h1 class="page__title">跟客人確認時間</h1>
      <p class="page__lead">壓好了、還沒問過本人的有 ${groups.length} 位。問完回來按打勾。</p>
    </div>

    ${groups.length ? `
      <div class="stack">
        ${groups.map(([id, visits]) => confirmCard(id, visits, today, noReplyDays)).join('')}
      </div>`
      : '<p class="muted">都問過了。</p>'}

    ${drawer ? drawerHtml(ctx) : ''}`;

  wireConfirm(ctx);
}

function confirmCard(customerId, visits, today, noReplyDays) {
  const name = visits[0].customerName ?? '（沒有名字）';
  const state = waitState(visits, today, noReplyDays);
  const slots = visits.flatMap((v) => v.slots ?? []);

  return `
    <div class="card ${state.asked ? 'card--asked' : ''}" style="margin: 0">
      <div class="row" style="align-items: flex-start">
        <div class="row__main">
          <div class="row__title">${esc(name)}</div>
          <div class="muted num">壓了 ${slots.length} 段・${esc(state.label)}</div>
        </div>
        <button class="fab__main" type="button" data-open="${esc(customerId)}"
                style="width: 46px; height: 46px" aria-label="${esc(name)}・確認">
          ${icon('check', { size: 22, width: 2.6 })}
        </button>
      </div>

      <div class="chips" style="margin-top: var(--space-3)">
        ${visits.map((v) => `<span class="badge num">${esc(shortDate(v.date))}</span>`).join('')}
      </div>

      ${followupForm(customerId, name, state.note)}

      ${message.box({
        id: customerId,
        text: confirmMessage({ name }, visits),
        collapsed: true,
        buttonLabel: '複製 LINE 確認訊息',
      })}
    </div>`;
}

/**
 * 「問過了，在等」那一句。直接是一個輸入框，不是一顆「加備註」按鈕 ——
 * 她人在 LINE 裡，多一次點擊就會變成「算了等一下再記」，然後就忘了
 * （同 notesCard() 的理由）。
 *
 * 寫完那一列看得出問過了：卡片換一個底、天數改成從問的那天算。
 * **但它還在清單上** —— 事情還沒完，移走就等於忘記。
 */
function followupForm(customerId, name, note) {
  return `
    <form data-followup="${esc(customerId)}"
          style="display: flex; gap: var(--space-2); margin-top: var(--space-3)">
      <input type="text" name="text" maxlength="${NOTE_MAX}" value="${esc(note ?? '')}"
             style="flex: 1; min-width: 0" placeholder="問了還沒回？記一句…"
             aria-label="${esc(name)}・問過了要記的一句話" />
      <button class="btn" type="submit">${note ? '改' : '記'}</button>
    </form>`;
}

/**
 * 確認畫面。把這個人所有的時段攤開，逐筆可以標「客人說不行」。
 *
 * 不做整批一次確認 —— 客人常常是「這兩天可以、那天不行」，整批只能全對或全錯，
 * 等於逼她重壓。
 */
function drawerHtml(ctx) {
  const visits = byCustomer(ctx.pending).get(drawer.customerId) ?? [];
  const name = visits[0]?.customerName ?? '';
  const rows = visits.flatMap((v) =>
    (v.slots ?? []).map((s, i) => ({ visit: v, slot: s, key: `${v.id}:${i}` })),
  );
  const okCount = rows.filter((r) => !drawer.rejected.has(r.key)).length;
  const note = followupNoteOf(visits);

  return `
    <div class="drawer-backdrop" data-backdrop>
      <div class="drawer" role="dialog" aria-modal="true" aria-label="確認 ${esc(name)} 的時段">
        <button class="drawer__grip" type="button" data-close-drawer aria-label="關閉"></button>
        <div class="drawer__head">
          <h2 class="drawer__title">${esc(name)} 的 ${rows.length} 段</h2>
        </div>
        ${note
          // 這張面板蓋住了底下那張卡，她自己寫的那一句要跟著進來，
          // 否則「上次問到哪」在最需要它的那一刻反而看不到。
          ? `<p class="card__asked" style="margin-top: 0">上次問過：${esc(note)}</p>`
          : ''}
        <p class="drawer__note">確認之後會自動排進日曆，並且產生該做的登記。</p>

        <div class="drawer__body">
        ${rows.map((r) => {
          const no = drawer.rejected.has(r.key);
          return `
            <button class="slotrow ${no ? 'slotrow--no' : ''}" type="button" data-slot="${esc(r.key)}">
              <span class="slotrow__main">
                <span class="slotrow__when">${esc(shortDate(r.visit.date))} ${esc(timeLabel(r.slot))}</span>
                <span class="slotrow__what">${esc(r.slot.courseName ?? '')}</span>
                ${r.visit.note ? `<span class="muted dim">備註：${esc(r.visit.note)}</span>` : ''}
              </span>
              <span class="badge ${no ? 'badge--overdue' : 'badge--ok'}">${no ? '客人說不行' : '可以'}</span>
            </button>`;
        }).join('')}

        <p class="card__note" style="margin-top: var(--space-3)">
          哪一段客人說不行就點它一下，其餘的照樣成立。</p>
        </div>

        <div class="drawer__actions">
          <button class="btn btn--primary" type="button" data-apply>
            ${okCount ? `確認 ${okCount} 段，加進日曆` : '全部退回未確認'}</button>
          <button class="btn" type="button" data-close-drawer>先不要，回去</button>
        </div>
      </div>
    </div>`;
}

function wireConfirm(ctx) {
  const { el } = ctx;

  message.wire(el, toast.info);

  el.querySelectorAll('[data-open]').forEach((btn) =>
    btn.addEventListener('click', () => {
      drawer = { customerId: btn.dataset.open, rejected: new Set() };
      paintConfirm(ctx);
    }),
  );

  el.querySelectorAll('[data-slot]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const key = btn.dataset.slot;
      if (drawer.rejected.has(key)) drawer.rejected.delete(key);
      else drawer.rejected.add(key);
      paintConfirm(ctx);
    }),
  );

  const close = () => {
    drawer = null;
    paintConfirm(ctx);
  };
  el.querySelectorAll('[data-close-drawer]').forEach((b) => b.addEventListener('click', close));
  el.querySelector('[data-backdrop]')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) close();
  });

  // 這一張是自己畫的（它要跟著整頁重畫），沒走 openSheet，
  // 但手勢要跟全站一樣 —— 只有一張拖不動的話，她會以為那張壞了。
  const box = el.querySelector('.drawer');
  if (box) wireDrag(box, close, { backdrop: el.querySelector('[data-backdrop]') }).playIn();

  el.querySelectorAll('[data-followup]').forEach((form) =>
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      saveFollowupNote(ctx, form.dataset.followup, form.querySelector('[name=text]').value);
    }),
  );

  el.querySelector('[data-apply]')?.addEventListener('click', () => applyConfirm(ctx));
}

/**
 * 記下（或收掉）「問過了，在等」那一句。
 *
 * 這位客戶所有還在等的來訪各自帶一份同樣的字，一個 commit 寫完 ——
 * 分開寫的話復原只退得回其中一筆（見 data/visits.js 的 setFollowupNote）。
 */
async function saveFollowupNote(ctx, customerId, text) {
  const visits = byCustomer(ctx.pending).get(customerId) ?? [];
  if (!visits.length) return;

  const trimmed = String(text ?? '').trim();
  if (trimmed === (followupNoteOf(visits) ?? '')) return; // 沒改就不要白寫一筆稽核

  try {
    await toast.withSaveState(
      () => visitsData.setFollowupNote(visits.map((v) => v.id), trimmed),
      { success: trimmed ? '記下了，這一列還留著' : '收掉了' },
    );
    await renderConfirm(ctx.el);
  } catch {
    /* 已處理 */
  }
}

/**
 * 套用確認結果。
 *
 * 一位客戶可能有好幾天的來訪，每一天各自是一筆 visit：
 *
 * - 一整天都被退掉 → 那一筆轉 cancelled，**時段留著不刪** ——
 *   當初壓了什麼是要留下來的紀錄，而且 Rules 也不收沒有時段的來訪。
 * - 只退掉其中幾段 → 把那幾段移出來訪，其餘轉 confirmed。
 *   任務會跟著收（見 domain/taskRules.js 的規則矩陣）。
 * - 一段都沒退 → 整筆轉 confirmed。
 */
async function applyConfirm(ctx) {
  const visits = byCustomer(ctx.pending).get(drawer.customerId) ?? [];
  const rejected = drawer.rejected;
  const at = new Date().toISOString();

  const customerVisits = await visitsData.listByCustomer(drawer.customerId);

  const writes = visits.map((v) => {
    const keep = (v.slots ?? []).filter((_, i) => !rejected.has(`${v.id}:${i}`));

    // 「禮拜一再問問」是「還在等回覆」那一段的東西。這一筆走出去了就收掉，
    // 留著只會在別的畫面變成一句過期的話。改動留在稽核紀錄裡，沒有真的消失。
    if (!keep.length) {
      return {
        ...v,
        status: 'cancelled',
        cancelledAt: at,
        statusAt: at,
        cancelReason: '客人說這個時間不行',
        released: true,
        followupNote: null,
        followupAt: null,
      };
    }
    return {
      ...v,
      slots: keep,
      status: 'confirmed',
      confirmedAt: at,
      statusAt: at,
      followupNote: null,
      followupAt: null,
    };
  });

  try {
    await toast.withSaveState(
      async () => {
        // 一筆一筆存：每一筆各自要重算次數與任務，硬塞進同一個 commit
        // 會超過 Firestore 一批 500 個操作的上限
        for (const v of writes) await visitsData.save(v, customerVisits);
      },
      {
        success: writes.some((v) => v.status === 'cancelled')
          ? '記好了，退掉的已產生取消登記'
          : '確認了，已排進日曆',
        // 跨多個 commit 的動作給不出正確的復原（見 data/repo.js 的 withUndo）
        undoable: false,
      },
    );
    drawer = null;
    await renderConfirm(ctx.el);
  } catch {
    /* 已處理 */
  }
}

// ---------- 客人來了嗎（收尾） ----------
//
// 這一頁是 SPEC 第 4.2 節那句「次數在已完成才扣」的入口。
// 在這之前它藏在來訪編輯器的狀態卡裡，走動時拿手機要點四層 ——
// 而這是每天都要做好幾次的動作，漏掉的後果是剩餘次數整個不準。
//
// 不是任務，是從來訪推導的（`domain/visits.js` 的 `visitsToClose()`）：
// 療程單就是「這一次算不算數」的憑據，而那個答案就在來訪的狀態上。

async function renderClose(el) {
  const today = todayISO();
  const unclosed = await visitsData.listUnclosed(today);
  paintClose({ el, rows: visitsToClose(unclosed, today), today });
}

function paintClose(ctx) {
  const { el, rows, today } = ctx;

  el.innerHTML = `
    ${backLink()}
    <div class="page">
      <h1 class="page__title">客人來了嗎</h1>
      <p class="page__lead">${rows.length
        ? `有 ${rows.length} 筆還沒結案。客人來了、療程單簽了就打勾 —— 次數是這時候才扣的。`
        : '都結案了。'}</p>
    </div>

    ${rows.length ? `<div class="stack">${rows.map((v) => closeCard(v, today)).join('')}</div>` : ''}

    ${drawer ? closeDrawerHtml(ctx) : ''}`;

  wireClose(ctx);
}

function closeCard(visit, today) {
  const late = daysBetween(visit.date, today);
  const slots = visit.slots ?? [];

  return `
    <div class="card" style="margin: 0">
      <div class="row" style="align-items: flex-start">
        <div class="row__main">
          <div class="row__title">${esc(visit.customerName ?? '（沒有名字）')}</div>
          <div class="muted num">${esc(shortDate(visit.date))}・${slots.length} 段${
            late > 0 ? `・過了 ${late} 天` : ''}</div>
        </div>
        <button class="fab__main" type="button" data-open="${esc(visit.id)}"
                style="width: 46px; height: 46px"
                aria-label="${esc(visit.customerName ?? '')}・結案">
          ${icon('check', { size: 22, width: 2.6 })}
        </button>
      </div>

      <div class="chips" style="margin-top: var(--space-3)">
        ${slots.map((sl) => `<span class="badge num">${esc(timeLabel(sl))}　${
          esc(sl.courseName ?? '')}</span>`).join('')}
      </div>

      ${visit.status === 'pending_confirm' ? `
        <p class="card__note" style="margin-top: var(--space-3)">
          這一筆到現在還是「${esc(describeStatus(visit.status))}」—— 那天過了，
          要嘛她來了要嘛沒來，兩種都在下面結掉。</p>` : ''}
    </div>`;
}

/**
 * 收尾畫面。把那一天的時段攤開，逐段勾「這段做了沒」。
 *
 * 預設全部打勾 —— 十次有九次是整天照排的做完了。
 * 客人做了兩段就走的情況會發生（2026-08-20 使用者確認），那時取消勾選那一段，
 * 它就不扣次數（`domain/entitlements.js` 的 `slotOutcome()`）。
 */
function closeDrawerHtml(ctx) {
  const visit = ctx.rows.find((v) => v.id === drawer.visitId);
  if (!visit) return '';

  const slots = visit.slots ?? [];
  const doneCount = slots.filter((_, i) => !drawer.missed.has(i)).length;

  return `
    <div class="drawer-backdrop" data-backdrop>
      <div class="drawer" role="dialog" aria-modal="true"
           aria-label="替 ${esc(visit.customerName ?? '')} 結案">
        <button class="drawer__grip" type="button" data-close-drawer aria-label="關閉"></button>
        <div class="drawer__head">
          <h2 class="drawer__title">${esc(visit.customerName ?? '')}・${esc(shortDate(visit.date))}</h2>
        </div>
        <p class="drawer__note">哪一段沒做就點它一下。次數只扣打勾的那幾段。</p>

        <div class="drawer__body">
          ${slots.map((sl, i) => {
            const missed = drawer.missed.has(i);
            return `
              <button class="slotrow ${missed ? 'slotrow--no' : ''}" type="button" data-slot="${i}">
                <span class="slotrow__main">
                  <span class="slotrow__when">${esc(timeLabel(sl))}</span>
                  <span class="slotrow__what">${esc(sl.courseName ?? '')}</span>
                </span>
                <span class="badge ${missed ? 'badge--overdue' : 'badge--ok'}">${
                  missed ? '沒做' : '做了'}</span>
              </button>`;
          }).join('')}

          ${visit.note ? `<p class="card__note" style="margin-top: var(--space-3)">
            壓表時記的：${esc(visit.note)}</p>` : ''}
        </div>

        <div class="drawer__actions">
          <button class="btn btn--primary" type="button" data-apply>
            ${doneCount ? `這 ${doneCount} 段做了，結案` : '一段都沒做 → 記成未到'}</button>
          <button class="btn" type="button" data-close-drawer>先不要，回去</button>
        </div>
      </div>
    </div>`;
}

function wireClose(ctx) {
  const { el } = ctx;

  el.querySelectorAll('[data-open]').forEach((btn) =>
    btn.addEventListener('click', () => {
      drawer = { visitId: btn.dataset.open, missed: new Set() };
      paintClose(ctx);
    }),
  );

  el.querySelectorAll('[data-slot]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.slot);
      if (drawer.missed.has(i)) drawer.missed.delete(i);
      else drawer.missed.add(i);
      paintClose(ctx);
    }),
  );

  const close = () => {
    drawer = null;
    paintClose(ctx);
  };
  el.querySelectorAll('[data-close-drawer]').forEach((b) => b.addEventListener('click', close));
  el.querySelector('[data-backdrop]')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) close();
  });

  // 手勢跟全站一樣 —— 只有一張拖不動的話，她會以為那張壞了
  const box = el.querySelector('.drawer');
  if (box) wireDrag(box, close, { backdrop: el.querySelector('[data-backdrop]') }).playIn();

  el.querySelector('[data-apply]')?.addEventListener('click', () => applyClose(ctx));
}

/**
 * 結案。一次只動一筆來訪，所以是單一個 commit —— 復原退得回去。
 *
 * 規則本身在 `domain/visits.js` 的 `closeVisit()`，這裡只負責把畫面上的
 * 勾選狀態翻成逐段的布林。來訪編輯器的狀態按鈕走同一支。
 */
async function applyClose(ctx) {
  const visit = ctx.rows.find((v) => v.id === drawer.visitId);
  if (!visit) return;

  const attended = (visit.slots ?? []).map((_, i) => !drawer.missed.has(i));
  const next = closeVisit(visit, attended);
  const customerVisits = await visitsData.listByCustomer(visit.customerId);

  try {
    await toast.withSaveState(() => visitsData.save(next, customerVisits), {
      success: next.status === 'done'
        ? `${visit.customerName ?? ''} 結案了，次數扣掉了`
        : `記成未到，次數沒有扣`,
    });
    drawer = null;
    await renderClose(ctx.el);
  } catch {
    /* 已處理 */
  }
}

// ---------- 隨手記那一頁 ----------

async function renderNotes(el) {
  const [notes, customers] = await Promise.all([
    notesData.listOpen(),
    customersData.list(),
  ]);
  paintNotes({ el, notes, customers });
}

function paintNotes(ctx) {
  const { el, notes, customers } = ctx;
  const groups = groupByCustomer(notes);

  el.innerHTML = `
    ${backLink()}
    <div class="page">
      <h1 class="page__title">隨手記</h1>
      <p class="page__lead">客人臨時說的小要求。沒有死線，所以它不是任務。</p>
    </div>

    <section class="card">
      <form data-newnote>
        <label class="field">
          <span class="field__label">記什麼</span>
          <input type="text" name="text" maxlength="200" placeholder="例：指定 LuLu，不要排騰崴" />
        </label>
        ${f.select({
          name: 'customerId', label: '關於誰　可以不填', value: '',
          options: [{ value: '', label: '（沒掛客戶）' },
            ...customers.map((c) => ({ value: c.id, label: c.name }))],
        })}
        <button class="btn btn--primary btn--wide" type="submit">記一筆</button>
      </form>
    </section>

    ${groups.map((g) => `
      <section class="card">
        <h2 class="card__title">${esc(g.customerName)}
          <span class="muted"> ${g.notes.length}</span></h2>
        <div class="groups">${g.notes.map(noteRow).join('')}</div>
      </section>`).join('')
      || '<p class="muted">還沒記過。</p>'}`;

  el.querySelectorAll('[data-note]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const note = notes.find((n) => n.id === btn.dataset.note);
      if (!note) return;
      try {
        await toast.withSaveState(() => notesData.setDone(note.id, !note.done), {
          success: note.done ? '拿回來了' : '勾掉了',
        });
        await renderNotes(el);
      } catch {
        /* 已處理 */
      }
    }),
  );

  el.querySelector('[data-newnote]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = f.readForm(e.target);
    if (!String(v.text ?? '').trim()) return;
    const customer = customers.find((c) => c.id === v.customerId) ?? null;
    try {
      await toast.withSaveState(
        () => notesData.create({
          text: v.text,
          customerId: customer?.id ?? null,
          customerName: customer?.name ?? null,
        }),
        { success: '記下來了' },
      );
      await renderNotes(el);
    } catch {
      /* 已處理 */
    }
  });
}

// ---------- 小工具 ----------

/** @returns {Map<string, object[]>} 客戶 id → 他的來訪 */
function byCustomer(visits) {
  const out = new Map();
  for (const v of visits) {
    if (!out.has(v.customerId)) out.set(v.customerId, []);
    out.get(v.customerId).push(v);
  }
  for (const rows of out.values()) rows.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

// 「已等 N 天」「問過了」那一組判斷全部在 domain/confirmations.js ——
// 進度追蹤頁之後要問同一句話，這裡不留第二份。
