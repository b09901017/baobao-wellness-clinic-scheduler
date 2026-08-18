// 待辦中心。SPEC 第 8.1 節。首頁。
//
// 主力裝置是手機：她在院內走動、臨時被問，要能隨手勾掉一筆。
// 所以每一列都是一個 44px 以上的勾選區，勾完一批再一次送出 ——
// 她到 Examine 是一次把十幾個人掛完的，不是掛一個回來勾一次。
//
// 四個區塊都可以收合，收合狀態不記住：每次打開都從全部展開開始，
// 免得某個區塊被收起來之後就再也沒被看到。

import * as tasksData from '../../data/tasks.js';
import * as health from './health.js';
import * as visitsData from '../../data/visits.js';
import * as config from '../../data/config.js';
import { urgency, isCancelKind } from '../../domain/taskRules.js';
import { confirmMessage } from '../../domain/messages.js';
import { todayISO, shortDate, daysBetween } from '../../domain/dates.js';
import * as f from '../components/form.js';
import * as toast from '../toast.js';
import { go } from '../router.js';

const esc = f.esc;

// 勾選的任務只活在這一次畫面裡。重畫（勾完送出、復原）就清空。
let picked = new Set();

// 待辦區塊的種類篩選。她說「只看還沒進 Abovee 的」是常見的用法。
let kindFilter = 'all';

export async function render(el) {
  el.innerHTML = '<p class="muted">載入中…</p>';
  picked = new Set();

  let tasks;
  let pending;
  let settings;
  try {
    [tasks, pending, settings] = await Promise.all([
      tasksData.listOpen(),
      visitsData.listByStatus('pending_confirm'),
      config.getSettings(),
    ]);
  } catch (err) {
    el.innerHTML = `<div class="card"><p>讀取失敗：${esc(err.message)}</p>
      <p class="muted">如果一直失敗，可能是 Firestore 的索引還沒建好 ——
      Console 的錯誤訊息裡會有一個建立索引的連結。</p></div>`;
    return;
  }

  const today = todayISO();
  const ctx = { el, tasks, pending, settings, today };
  paint(ctx);
}

function paint(ctx) {
  const { el, tasks, pending, settings, today } = ctx;

  const overdue = tasks.filter((t) => urgency(t.dueDate, today) === 'overdue').length;
  const cancels = tasks.filter((t) => isCancelKind(t.kind));
  const createdToday = pending.filter((v) => sameDay(v.createdAt, today));
  const noReplyDays = settings.noReplyDays ?? 3;

  el.innerHTML = `
    <div data-health>${healthCard(health.lastBadge())}</div>
    ${section('待辦', tasks.length, overdue ? `${overdue} 筆逾期` : '', taskSection(ctx))}
    ${section('今天壓了誰', createdToday.length, '', todaySection(createdToday))}
    ${section('等回覆', pending.length, waitingNote(pending, today, noReplyDays),
      waitingSection(pending, today, noReplyDays))}
    ${section('改時間／取消', cancels.length, '', cancelSection(cancels, today))}`;

  wire(ctx);
  scanHealth(el);
}

/**
 * 資料健檢的摘要。SPEC 第 6.6 節要求 app 啟動時也在背景跑一次，
 * 而她一打開 app 就是這一頁，所以掛在這裡而不是進入點 ——
 * 掃描本身每天最多跑一次，細節見 views/health.js。
 *
 * 沒問題時整張卡不出現：沒事還佔一格，下次真的有事時她也不會注意到。
 */
function healthCard(badge) {
  if (!badge) return '';
  return `
    <section class="card">
      <h2 class="card__title">資料健檢
        <span class="badge badge--overdue">${esc(badge)}</span></h2>
      <p class="muted">背景掃描發現的差異。只是提醒，沒有動到任何資料。</p>
      <p><a class="btn" href="#/settings/health">去看</a></p>
    </section>`;
}

/** 掃完才把卡片補上，不擋首頁的第一次繪製 —— 她開 app 是為了勾待辦，不是為了等資料健檢。 */
async function scanHealth(el) {
  const result = await health.runIfDue();
  if (!result) return;
  // 掃描期間她可能已經換頁了，元素不在就算了
  const slot = el.querySelector('[data-health]');
  if (slot) slot.innerHTML = healthCard(health.lastBadge());
}

function section(title, count, note, body) {
  return `
    <details class="card" open>
      <summary class="card__title">
        ${esc(title)}<span class="muted"> ${count}</span>
        ${note ? `<span class="badge badge--overdue">${esc(note)}</span>` : ''}
      </summary>
      ${body}
    </details>`;
}

// ---------- 1. 待辦 ----------

function taskSection(ctx) {
  const { tasks, today } = ctx;
  if (!tasks.length) {
    return '<p class="muted">沒有待辦。來訪存進去之後，該做的系統登記會自動出現在這裡。</p>';
  }

  const kinds = [...new Set(tasks.map((t) => t.kind))];
  const visible = tasks.filter((t) => kindFilter === 'all' || t.kind === kindFilter);

  return `
    <div class="chips">
      <button class="chip" type="button" data-kind="all"
              aria-pressed="${kindFilter === 'all'}">全部</button>
      ${kinds
        .map(
          (k) => `<button class="chip" type="button" data-kind="${esc(k)}"
                    aria-pressed="${kindFilter === k}">${esc(k)}</button>`,
        )
        .join('')}
    </div>

    ${visible.length
      ? visible.map((t) => taskRow(t, today)).join('')
      : '<p class="muted">這個種類沒有待辦。</p>'}

    <div class="form__actions">
      <button class="btn btn--primary" type="button" data-mark disabled>
        把勾起來的標成完成
      </button>
    </div>`;
}

function taskRow(t, today) {
  const state = urgency(t.dueDate, today);
  return `
    <div class="row">
      <label class="choice choice--row">
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
      ${t.visitId
        ? `<button class="btn" type="button" data-visit="${esc(t.visitId)}">來訪</button>`
        : ''}
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

// ---------- 2. 今天壓了誰 ----------

function todaySection(visits) {
  if (!visits.length) {
    return '<p class="muted">今天還沒壓表。</p>';
  }

  const byCustomer = new Map();
  for (const v of visits) {
    if (!byCustomer.has(v.customerId)) byCustomer.set(v.customerId, []);
    byCustomer.get(v.customerId).push(v);
  }

  return [...byCustomer.entries()]
    .map(([customerId, rows]) => {
      const name = rows[0].customerName ?? '（沒有名字）';
      const message = confirmMessage({ name }, rows);
      return `
        <div class="pool">
          <div class="pool__head"><span>${esc(name)}</span>
            <span class="muted">${rows.length} 次</span></div>
          <ul class="link-list">
            ${rows.map((v) => `<li><a href="#/visits/${esc(v.id)}">${esc(visitLine(v))}</a></li>`).join('')}
          </ul>
          <details>
            <summary class="muted">先看一下訊息</summary>
            <textarea class="msg" readonly rows="3"
                      data-msg="${esc(customerId)}">${esc(message)}</textarea>
          </details>
          <p><button class="btn" type="button" data-copy="${esc(customerId)}">複製確認訊息</button></p>
        </div>`;
    })
    .join('');
}

function visitLine(v) {
  const times = (v.slots ?? []).map((s) => s.startsAt).filter(Boolean).sort();
  const courses = [...new Set((v.slots ?? []).map((s) => s.courseName).filter(Boolean))];
  return `${shortDate(v.date)} ${times[0] ?? ''} ${courses.join('、')}`.trim();
}

// ---------- 3. 等回覆 ----------

const isLate = (v, today, noReplyDays) => {
  const days = waitedDays(v, today);
  return days !== null && days >= noReplyDays;
};

function waitingNote(pending, today, noReplyDays) {
  const late = pending.filter((v) => isLate(v, today, noReplyDays)).length;
  return late ? `${late} 筆超過 ${noReplyDays} 天` : '';
}

function waitingSection(pending, today, noReplyDays) {
  if (!pending.length) {
    return '<p class="muted">沒有在等回覆的。</p>';
  }

  // 等最久的排前面。時段已經被佔住卻沒人回，是最危險的狀態（SPEC 4.1）。
  const rows = pending
    .slice()
    .sort((a, b) => (waitedDays(b, today) ?? 0) - (waitedDays(a, today) ?? 0));

  return `
    <ul class="link-list">
      ${rows
        .map((v) => {
          const days = waitedDays(v, today);
          return `<li><a href="#/visits/${esc(v.id)}">
            ${esc(v.customerName ?? '（沒有名字）')} ${esc(shortDate(v.date))}
            <span class="link-list__label">
              <span class="badge ${isLate(v, today, noReplyDays) ? 'badge--overdue' : ''}">${
                days === null ? '剛壓' : `已等 ${days} 天`
              }</span>
            </span></a></li>`;
        })
        .join('')}
    </ul>
    <p class="muted">超過 ${noReplyDays} 天沒回覆會變紅。天數可以在設定 → 排序權重調。</p>`;
}

// ---------- 4. 改時間／取消 ----------

function cancelSection(cancels, today) {
  if (!cancels.length) {
    return '<p class="muted">沒有要回頭取消的登記。</p>';
  }
  return `
    <p class="muted">這些是來訪取消後、要回去把已經做掉的登記收回來的。
      同樣的項目也在上面的待辦裡，這裡只是把它們挑出來。</p>
    ${cancels.map((t) => taskRow(t, today)).join('')}`;
}

// ---------- 事件 ----------

function wire(ctx) {
  const { el } = ctx;

  el.querySelectorAll('[data-kind]').forEach((btn) =>
    btn.addEventListener('click', () => {
      kindFilter = btn.dataset.kind;
      paint(ctx);
    }),
  );

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

  el.querySelectorAll('[data-copy]').forEach((btn) =>
    btn.addEventListener('click', () => copyMessage(el, btn)),
  );

  el.querySelector('[data-mark]')?.addEventListener('click', () => markDone(ctx));
  syncMarkButton(el);
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
    await render(ctx.el);
  } catch {
    /* withSaveState 已顯示錯誤與重試 */
  }
}

async function copyMessage(el, btn) {
  const area = el.querySelector(`[data-msg="${CSS.escape(btn.dataset.copy)}"]`);
  const text = area?.value ?? '';
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    toast.info('已複製，貼到 LINE 就可以送出');
  } catch {
    // iOS 在非安全情境或沒有使用者手勢時會擋剪貼簿。退而求其次選起來讓她長按複製。
    area.closest('details').open = true;
    area.select();
    toast.info('複製被瀏覽器擋下來了，訊息已經選起來，長按複製');
  }
}

/** Firestore 的 Timestamp 與字串都收，缺的一律當成不是今天。 */
function sameDay(ts, today) {
  return isoOf(ts) === today;
}

/**
 * 等了幾天。null 代表還不知道 —— serverTimestamp 要等伺服器回來才有值，
 * 剛按下「已壓表」的那一筆讀回來會是空的。那時顯示「剛壓」，不要假裝是 0 天。
 */
function waitedDays(visit, today) {
  const iso = isoOf(visit.createdAt);
  return iso ? daysBetween(iso, today) : null;
}

function isoOf(ts) {
  if (!ts) return null;
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
