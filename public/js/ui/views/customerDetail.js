// 客戶詳情。SPEC 第 8.5 節。
//
// 這一頁是她被客戶臨時問「我還剩幾次」「我這個月哪天要來」時會打開的畫面，
// 所以次數要現算，而且要誠實：計數欄位與現算對不起來時把差異顯示出來，
// 不自動偷改（SPEC 第 6.6 節）。
//
// ## 版面的順序就是她問問題的順序
//
//   名字 → 備註 → 這個月什麼時候來 → 不能的時間 → 還剩幾次 → 來過幾次 → 雜事
//
// 不再是一疊白卡。一頁疊七張白卡看起來像七件事，其實是同一個人的七個面向 ——
// 改成細標題加一條髮絲線分段，名字直接坐在紙上。
//
// 一年點兩次的東西（LINE 訊息、變更紀錄、停用與刪除）收成最底下的小標籤，
// 點了從底部滑出來。給它們一整張卡等於天天提醒她那件事存在。
// 見 docs/adr/0018-detail-pages-are-one-page-not-a-stack-of-cards.md

import * as data from '../../data/customers.js';
import * as visitsData from '../../data/visits.js';
import * as tasksData from '../../data/tasks.js';
import * as availability from './availability.js';
import * as auditView from './audit.js';
import * as auditData from '../../data/audit.js';
import * as config from '../../data/config.js';
import * as notesData from '../../data/notes.js';
import { sortNotes } from '../../domain/notes.js';
import { icon } from '../icons.js';
import * as rules from '../../domain/customers.js';
import { contraindicationTerms } from '../../domain/contraindications.js';
import { readMarks, toCustomerFields, validateMarks } from '../../domain/customerMarks.js';
import { counts, reconcile, isOverused, validateEntitlement } from '../../domain/entitlements.js';
import { describeStatus, isActive } from '../../domain/visits.js';
import { timeLabel } from '../../domain/visitTime.js';
import { todayISO, shortDate } from '../../domain/dates.js';
import { messagesFor } from '../../domain/messages.js';
import * as f from '../components/form.js';
import * as marksUi from '../components/marks.js';
import * as flagsUi from '../components/flags.js';
import * as message from '../components/message.js';
import { confirmAction } from '../components/dialog.js';
import { openSheet, closeSheet } from '../components/sheet.js';
import * as toast from '../toast.js';
import { go } from '../router.js';

const esc = f.esc;

/** 變更紀錄往回查幾筆來訪。listByCustomer 是新的在前，所以這是「最近的 N 筆」。 */
const AUDIT_VISIT_LIMIT = 30;

/** 一眼掃得完的長度。超過就收進「看全部」，不要把整頁拉成一條長清單。 */
const RECENT_VISITS = 6;
const RECENT_TASKS = 6;

export async function render(el, id) {
  el.innerHTML = '<p class="muted">載入中…</p>';

  let ctx;
  try {
    const [customer, entitlements, visits, tasks, avail, courses, equipment, notes] =
      await Promise.all([
        data.get(id),
        data.listEntitlements(id),
        visitsData.listByCustomer(id),
        tasksData.listByCustomer(id),
        data.listAvailability(id),
        config.listAll('courses'),
        config.listAll('equipment'),
        notesData.listByCustomer(id),
      ]);
    ctx = {
      el, id, customer, entitlements, visits, tasks, courses, equipment, notes,
      availability: avail,
      back: () => reload(ctx),
    };
  } catch (err) {
    el.innerHTML = `<div class="card"><p>讀取失敗：${esc(err.message)}</p></div>`;
    return;
  }

  if (!ctx.customer) {
    el.innerHTML = `
      <a class="backlink" href="#/customers">${icon('left', { size: 17 })}客戶</a>
      <div class="card"><p>找不到這位客戶，可能已經被刪除。</p>
      <p class="muted">刪除只是標記，資料還在，可以在設定 → 已刪除項目 還原。</p></div>`;
    return;
  }

  paint(ctx);
}

function reload(ctx) {
  // 重畫整頁時把開著的面板收掉 —— 它顯示的是已經過期的那一份
  closeSheet();
  return render(ctx.el, ctx.id);
}

// ---------- 主畫面 ----------

function paint(ctx) {
  const { el, customer, entitlements, visits, tasks, equipment, notes } = ctx;
  const today = todayISO();
  const flags = rules.splitFlags(customer, equipment);
  const marks = readMarks(customer);
  const openNotes = sortNotes(notes).filter((n) => !n.done);
  const openTasks = tasks.filter((t) => !t.done);

  el.innerHTML = `
    <a class="backlink" href="#/customers" data-back>${icon('left', { size: 17 })}客戶</a>

    <div class="hero">
      <div class="row" style="align-items: flex-start">
        <div class="row__main">
          <h1 class="hero__name">${esc(customer.name)}
            ${customer.priority ? `<span class="stars">${'★'.repeat(customer.priority)}</span>` : ''}
          </h1>
          <p class="hero__meta">${esc(contactLine(customer))}</p>
        </div>
        <button class="btn btn--sm" type="button" data-edit>編輯</button>
      </div>
      ${flags.contraindications.length || flags.others.length || customer.active === false ? `
        <div class="hero__flags">
          ${flags.contraindications.map((x) => `<span class="flag">${esc(x)}</span>`).join('')}
          ${flags.others.map((x) => `<span class="badge">${esc(x)}</span>`).join('')}
          ${customer.active === false ? '<span class="badge badge--soon">已停用</span>' : ''}
        </div>` : ''}
    </div>

    <div class="section">
      <h2 class="section__title">備註</h2>
      ${marks.length ? `<span class="section__n">${marks.length}</span>` : ''}
      <button class="section__more" type="button" data-marks>
        ${marks.length ? '編輯' : '加一則'}</button>
    </div>
    ${marks.length
      ? marksUi.row(marks, { large: true })
      : '<p class="muted" style="margin: 0">還沒有備註。客戶臨時提的小事記在這裡，顏色自己分。</p>'}

    <div class="section">
      <h2 class="section__title">這個月</h2>
      <span class="section__n">${esc(monthLine(visits, today))}</span>
    </div>
    ${visitStrip(visits, today)}

    ${availability.sectionHtml(ctx.availability, today)}

    <div class="section">
      <h2 class="section__title">額度</h2>
      <span class="section__n">${entitlements.length}</span>
      <button class="section__more" type="button" data-add-ent>加購</button>
    </div>
    ${entitlements.length === 0
      ? '<p class="muted" style="margin: 0">還沒有額度。按上面的「加購」單項加。</p>'
      : `<div class="pools">${entitlements.map((e) => poolCard(e, visits, ctx, today)).join('')}</div>`}

    <div class="section">
      <h2 class="section__title">來訪紀錄</h2>
      <span class="section__n">${visits.length}</span>
      ${visits.length > RECENT_VISITS
        ? `<button class="section__more" type="button" data-all-visits>看全部</button>`
        : ''}
    </div>
    ${visits.length
      ? `<ul class="link-list">${visits.slice(0, RECENT_VISITS).map(visitRow).join('')}</ul>`
      : '<p class="muted" style="margin: 0">還沒有來訪紀錄。</p>'}
    <p style="margin: var(--space-3) 0 0">
      <button class="btn" type="button" data-add-visit>記錄一次來訪</button></p>

    <div class="section">
      <h2 class="section__title">隨手記</h2>
      ${openNotes.length ? `<span class="section__n">${openNotes.length} 未處理</span>` : ''}
    </div>
    ${notesBlock(notes)}

    <div class="section">
      <h2 class="section__title">任務</h2>
      <span class="section__n">${openTasks.length ? `${openTasks.length} 未完成` : `${tasks.length}`}</span>
      ${tasks.length > RECENT_TASKS
        ? `<button class="section__more" type="button" data-all-tasks>看全部</button>`
        : ''}
    </div>
    ${tasks.length
      ? `<ul class="link-list">${[...openTasks, ...tasks.filter((t) => t.done)]
          .slice(0, RECENT_TASKS).map(taskRow).join('')}</ul>
         <p class="muted" style="margin: var(--space-2) 0 0">
           要勾完成請到待辦中心，那裡可以一次勾一批。</p>`
      : '<p class="muted" style="margin: 0">還沒有任務。記錄來訪之後，該做的系統登記會自動產生。</p>'}

    <div class="footlinks">
      <button class="footlink" type="button" data-msgs>
        ${icon('message', { size: 13 })}LINE 訊息</button>
      <button class="footlink" type="button" data-audit>變更紀錄</button>
      <button class="footlink footlink--danger" type="button" data-danger>
        ${customer.active === false ? '重新啟用與刪除' : '停用與刪除'}</button>
    </div>`;

  wire(ctx, { today, marks });
}

function wire(ctx, { today, marks }) {
  const { el, entitlements, visits, tasks } = ctx;

  el.querySelector('[data-back]').addEventListener('click', (e) => {
    e.preventDefault();
    go('/customers');
  });
  el.querySelector('[data-edit]').addEventListener('click', () => paintEdit(ctx));
  el.querySelector('[data-add-ent]')?.addEventListener('click', () => paintEntitlement(ctx, null));
  el.querySelector('[data-add-visit]').addEventListener('click', () => go(`/visits/new/${ctx.id}`));

  el.querySelector('[data-marks]').addEventListener('click', () => openMarks(ctx, marks));

  el.querySelectorAll('[data-ent]').forEach((btn) =>
    btn.addEventListener('click', () =>
      paintEntitlement(ctx, entitlements.find((e) => e.id === btn.dataset.ent)),
    ),
  );

  el.querySelectorAll('[data-fix]').forEach((btn) =>
    btn.addEventListener('click', () => fixCounts(ctx, btn.dataset.fix)),
  );

  el.querySelectorAll('[data-note]').forEach((btn) =>
    btn.addEventListener('click', () => toggleNote(ctx, btn.dataset.note)),
  );

  el.querySelector('[data-newnote]')?.addEventListener('submit', (e) => {
    e.preventDefault();
    addNote(ctx, e.target);
  });

  el.querySelector('[data-all-visits]')?.addEventListener('click', () =>
    openSheet({
      title: '全部來訪',
      note: `${visits.length} 筆，新的在上面。`,
      body: `<ul class="link-list">${visits.map(visitRow).join('')}</ul>`,
    }),
  );

  el.querySelector('[data-all-tasks]')?.addEventListener('click', () =>
    openSheet({
      title: '全部任務',
      note: '要勾完成請到待辦中心，那裡可以一次勾一批。',
      body: `<ul class="link-list">${[...tasks.filter((t) => !t.done), ...tasks.filter((t) => t.done)]
        .map(taskRow).join('')}</ul>`,
    }),
  );

  el.querySelector('[data-msgs]').addEventListener('click', () => openMessages(ctx, today));
  el.querySelector('[data-audit]').addEventListener('click', () => openAudit(ctx));
  el.querySelector('[data-danger]').addEventListener('click', () => openDanger(ctx));

  availability.wireSection(ctx);
}

// ---------- 抬頭與這個月 ----------

function contactLine(c) {
  const parts = [];
  if (c.phone) parts.push(c.phone);
  if (c.lineId) parts.push(`LINE ${c.lineId}`);
  if (c.source) parts.push(c.source);
  if (c.purchasedAt) parts.push(`${c.purchasedAt} 購買`);
  return parts.length ? parts.join('・') : '沒有聯絡方式';
}

function monthLine(visits, today) {
  const month = today.slice(0, 7);
  const inMonth = visits.filter((v) => isActive(v) && v.date.startsWith(month));
  const waiting = inMonth.filter((v) => v.status === 'pending_confirm').length;
  if (!inMonth.length) return '這個月還沒排';
  return `${inMonth.length} 次${waiting ? `・${waiting} 筆等回覆` : ''}`;
}

/**
 * 這個月與之後的來訪，橫著排。
 *
 * 客戶臨時問的就是「我什麼時候要來」，而那個答案是一串日期 ——
 * 橫著捲一眼看得到有幾次，直著疊要捲三個螢幕才知道。
 */
function visitStrip(visits, today) {
  const month = today.slice(0, 7);
  const rows = visits
    .filter((v) => isActive(v) && (v.date.startsWith(month) || v.date > today))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 12);

  if (!rows.length) {
    return '<p class="muted" style="margin: 0">這個月還沒有排，之後也還沒有。</p>';
  }

  return `<div class="strip noscroll-bar">${rows.map((v) => {
    const cls = v.date < today ? 'stripcard--past'
      : v.status === 'pending_confirm' ? 'stripcard--soon' : '';
    const slots = (v.slots ?? []).slice(0, 3);
    return `
      <a class="stripcard ${cls}" href="#/visits/${esc(v.id)}">
        <span class="stripcard__day">${esc(shortDate(v.date))}</span>
        ${slots.map((s) => `
          <span class="stripcard__slot">${esc(timeLabel(s))}　${esc(s.courseName ?? '')}</span>`).join('')}
        ${(v.slots ?? []).length > slots.length
          ? `<span class="stripcard__slot dim">還有 ${(v.slots ?? []).length - slots.length} 段</span>` : ''}
        <span class="badge ${statusClass(v.status)}">${esc(describeStatus(v.status))}</span>
      </a>`;
  }).join('')}</div>`;
}

// ---------- 備註 ----------

function openMarks(ctx, current) {
  let draft = current;

  const sheet = openSheet({
    title: '備註',
    note: '客戶臨時提的、你要記得的事。顏色只給你自己分類用，系統不會因為顏色做任何事。',
    body: '<div data-marks-editor></div>',
    actions: `
      <button class="btn" type="button" data-sheet-close>取消</button>
      <button class="btn btn--primary" type="button" data-save>儲存</button>`,
    onMount: (drawer) => {
      const box = drawer.querySelector('[data-marks-editor]');
      if (box && !box.dataset.mounted) {
        box.dataset.mounted = '1';
        marksUi.mount(box, { marks: current, onChange: (list) => { draft = list; } });
      }
    },
  });

  sheet.el.querySelector('[data-save]').addEventListener('click', async () => {
    const errors = validateMarks(draft);
    if (errors.length) {
      toast.info(errors[0]);
      return;
    }
    try {
      await toast.withSaveState(() => data.update(ctx.id, toCustomerFields(draft)), {
        success: '記下來了',
      });
      reload(ctx);
    } catch {
      /* 已處理 */
    }
  });
}

// ---------- 底下那幾個小標籤 ----------

/**
 * 要貼到 LINE 的訊息。
 *
 * 只列現在用得到的：沒有待確認的來訪就不出現「問壓好的時間可不可以」，
 * 產生一則裡面沒有日期的空話比不產生更糟。
 */
function openMessages(ctx, today) {
  const list = messagesFor({ customer: ctx.customer, visits: ctx.visits, today });

  const sheet = openSheet({
    title: 'LINE 訊息',
    note: '產生的是草稿，複製之前可以直接改。',
    body: list.length
      ? list.map((m) => message.box({ id: `msg-${m.id}`, text: m.text, label: m.label })).join('')
      : '<p class="muted">現在沒有用得到的訊息。壓好表或該問時間了才會長出來。</p>',
  });

  message.wire(sheet.el, toast.info);
}

/**
 * 變更紀錄。
 *
 * 只帶最近幾十筆來訪的 id 去查：in 查詢要分批，全部帶等於一直往回翻，
 * 而她在這裡要看的是「最近這筆資料被改成什麼」。
 * 開了才載入 —— 這是這一頁最貴的一次讀取，而她十次打開有九次是在看「還剩幾次」。
 */
function openAudit(ctx) {
  const sheet = openSheet({
    title: '變更紀錄',
    note: '這位客戶本人、他的額度、可用性與來訪的變更。只能看，改不掉也刪不掉。',
    body: '<p class="muted">載入中…</p>',
  });

  auditData
    .listForCustomer(ctx.id, ctx.visits.slice(0, AUDIT_VISIT_LIMIT).map((v) => v.id))
    .then((events) => {
      sheet.update(
        events.length ? auditView.listHtml(events) : '<p class="muted">沒有變更紀錄。</p>',
      );
    })
    .catch((err) => {
      sheet.update(`<p>讀取失敗：${esc(err.message)}</p>
        <p class="muted">關掉再開一次就會重試。</p>`);
    });
}

function openDanger(ctx) {
  const { customer } = ctx;
  const disabled = customer.active === false;

  const sheet = openSheet({
    title: '停用與刪除',
    note: disabled
      ? '目前已停用：不會出現在客戶清單與待排佇列裡，資料都還在。'
      : '停用後不會出現在客戶清單與待排佇列裡，既有來訪不受影響。',
    body: `<p class="muted">刪除是標記，資料不會消失，可以在設定 → 已刪除項目 還原。</p>`,
    actions: `
      <button class="btn" type="button" data-toggle-active>${disabled ? '重新啟用' : '停用'}</button>
      <button class="btn btn--danger" type="button" data-delete>刪除</button>`,
  });

  sheet.el.querySelector('[data-toggle-active]').addEventListener('click', async () => {
    const turningOff = !disabled;
    const ok = await confirmAction({
      title: turningOff ? `停用「${customer.name}」？` : `重新啟用「${customer.name}」？`,
      consequences: turningOff
        ? [
            '客戶清單預設看不到他，要切到「已停用」才會出現',
            '壓表時不會再被排進待排佇列',
            '額度、來訪、任務全部原封不動留著',
            '隨時可以再啟用',
          ]
        : ['他會重新出現在客戶清單與待排佇列裡'],
      confirmLabel: turningOff ? '停用' : '啟用',
      danger: turningOff,
    });
    if (!ok) return;

    try {
      await toast.withSaveState(() => data.update(ctx.id, { active: !turningOff }), {
        success: turningOff ? '已停用' : '已啟用',
      });
      reload(ctx);
    } catch {
      /* 已處理 */
    }
  });

  sheet.el.querySelector('[data-delete]').addEventListener('click', async () => {
    const ok = await confirmAction({
      title: `刪除「${customer.name}」？`,
      consequences: [
        '這是標記刪除，資料不會真的消失',
        `他底下的 ${ctx.entitlements.length} 筆額度與 ${ctx.visits.length} 筆來訪都不會被修改`,
        '客戶清單上不再顯示，壓表時也不會出現',
        '可以在設定 → 已刪除項目 還原',
      ],
      confirmLabel: '刪除',
      danger: true,
    });
    if (!ok) return;

    try {
      // 復原按鈕由 withSaveState 自己接上（SPEC 第 6.3 節）
      await toast.withSaveState(() => data.remove(ctx.id), { success: '已刪除' });
      closeSheet();
      go('/customers');
    } catch {
      /* 已處理 */
    }
  });
}

// ---------- 額度 ----------

function poolCard(e, visits, ctx, today) {
  const c = counts(e, visits, e.id);
  const rec = reconcile(e, visits, e.id);
  const pct = (n) => (c.total > 0 ? Math.min(100, (n / c.total) * 100) : 0);
  const over = isOverused(c);
  const expiry = rules.membershipState(e.expiresAt, today);
  // 額度名稱常常就是課程名（靜脈、健檢），一樣的話不用印兩次
  const kind = kindText(e, ctx);

  return `
    <div class="pool">
      <div class="pool__head">
        <span>${esc(e.label)}</span>
        <button class="btn--ghost btn btn--sm" type="button" data-ent="${esc(e.id)}">調整</button>
      </div>
      ${kind === e.label ? '' : `<p class="muted dim" style="margin: 0; font-size: var(--text-2xs)">${esc(kind)}</p>`}

      <div class="meter ${over ? 'meter--over' : ''}"
           role="img" aria-label="共 ${c.total} 次，已完成 ${c.done}，已排未上 ${c.booked}，剩餘 ${c.remaining}${
             c.noShow ? `，未到 ${c.noShow}` : ''
           }">
        <span class="meter__done" style="width:${pct(c.done)}%"></span>
        <span class="meter__booked" style="width:${pct(c.booked)}%"></span>
      </div>

      <div class="legend">
        <span>已完成 <b>${c.done}</b></span>
        <span>已排未上 <b>${c.booked}</b></span>
        <span>剩餘 <b>${c.remaining}</b></span>
        <span>共 <b>${c.total}</b></span>
        ${c.noShow ? `<span>未到 <b>${c.noShow}</b></span>` : ''}
      </div>
      ${c.noShow ? '<p class="muted">未到不扣次數，那幾次已經還回去了。</p>' : ''}

      ${over ? '<p class="muted">⚠ 已排 + 已完成超過總次數。只是提醒，沒有擋任何東西。</p>' : ''}
      ${e.expiresAt ? `<p class="muted dim" style="font-size: var(--text-2xs)">${esc(e.expiresAt)} 到期${
        expiry.state === 'expired' ? '（已過期）' : ''
      }</p>` : ''}
      ${e.sourcePlanName
        ? `<p class="muted dim" style="font-size: var(--text-2xs)">來自方案「${esc(e.sourcePlanName)}」的展開，已與範本脫鉤</p>`
        : '<p class="muted dim" style="font-size: var(--text-2xs)">單項加購</p>'}
      ${rec.ok ? '' : reconcileWarning(e, rec)}
    </div>`;
}

function reconcileWarning(e, rec) {
  return `
    <p class="muted">⚠ 計數欄位與來訪對不起來：
      存的是 已完成 ${rec.stored.done}、已排 ${rec.stored.booked}，
      重算是 已完成 ${rec.actual.done}、已排 ${rec.actual.booked}。
      畫面上顯示的是重算值。</p>
    <p style="margin-bottom: 0"><button class="btn btn--sm" type="button"
      data-fix="${esc(e.id)}">把計數欄位改成重算值</button></p>`;
}

function kindText(e, ctx) {
  if (e.type === 'pool') {
    const names = (e.optionEquipmentIds ?? []).map(
      (id) => ctx.equipment.find((x) => x.id === id)?.name ?? '（已刪除）',
    );
    return `擇一：${names.join(' / ')}`;
  }
  return ctx.courses.find((c) => c.id === e.courseId)?.name ?? '（課程已刪除）';
}

async function fixCounts(ctx, entId) {
  const e = ctx.entitlements.find((x) => x.id === entId);
  const rec = reconcile(e, ctx.visits, entId);

  const ok = await confirmAction({
    title: `把「${e.label}」的計數欄位改成重算值？`,
    consequences: [
      `已完成 ${rec.stored.done} → ${rec.actual.done}`,
      `已排未上 ${rec.stored.booked} → ${rec.actual.booked}`,
      '重算值是從來訪推導出來的，那才是真相',
      '這次修正會留在稽核紀錄裡',
    ],
    confirmLabel: '修正',
  });
  if (!ok) return;

  try {
    await toast.withSaveState(
      () => data.updateEntitlement(ctx.id, entId, {
        doneCount: rec.actual.done,
        bookedCount: rec.actual.booked,
        lastReconciledAt: new Date().toISOString(),
      }),
      { success: '已修正' },
    );
    reload(ctx);
  } catch {
    /* 已處理 */
  }
}

// ---------- 來訪與任務的列 ----------

function visitRow(v) {
  const courses = [...new Set((v.slots ?? []).map((s) => s.courseName).filter(Boolean))];
  return `
    <li><a href="#/visits/${esc(v.id)}">
      <span class="link-list__label num">${esc(shortDate(v.date))}
        <span class="muted">${esc(courses.join('、') || `${(v.slots ?? []).length} 個時段`)}</span>
      </span>
      <span class="badge ${statusClass(v.status)}">${esc(describeStatus(v.status))}</span>
    </a></li>`;
}

function statusClass(status) {
  if (status === 'pending_confirm') return 'badge--soon';
  if (status === 'cancelled' || status === 'no_show') return 'badge--overdue';
  return 'badge--ok';
}

function taskRow(t) {
  const label = `${t.done ? '✓ ' : ''}${esc(t.kind)}`;
  const badge = `<span class="badge ${t.done ? 'badge--ok' : ''}">${
    t.done ? '已完成' : `死線 ${esc(t.dueDate)}`
  }</span>`;

  // 手動加的獨立待辦沒有來訪可以點進去
  return t.visitId
    ? `<li><a href="#/visits/${esc(t.visitId)}">
        <span class="link-list__label">${label}</span>${badge}</a></li>`
    : `<li><span class="row__main" style="padding: var(--space-2) 0; font-size: var(--text-sm)">
        ${label} ${badge}</span></li>`;
}

// ---------- 隨手記 ----------

/**
 * 掛在這位客戶身上的隨手記。SPEC 第 8.5 節。
 *
 * 跟任務分開放：任務是來訪自動產生的、有死線的；隨手記是她自己打的、沒有死線的。
 * 混在一起的話「這件事到底會不會有人提醒我」就說不清楚了。
 */
function notesBlock(notes) {
  const rows = sortNotes(notes);
  return `
    <div class="groups">
      ${rows.map((n) => `
        <button class="note ${n.done ? 'note--done' : ''}" type="button" data-note="${esc(n.id)}">
          <span class="note__box">${icon('check', { size: 12, width: 3.2 })}</span>
          <span class="note__main"><span class="note__text">${esc(n.text)}</span></span>
        </button>`).join('')
        || '<p class="muted" style="padding: var(--space-3); margin: 0">還沒記過。</p>'}
    </div>
    <form data-newnote style="display: flex; gap: var(--space-2); margin-top: var(--space-2)">
      <input type="text" name="text" maxlength="200" style="flex: 1; min-width: 0"
             placeholder="他臨時提的小要求…" aria-label="新的隨手記" />
      <button class="btn" type="submit">記</button>
    </form>`;
}

async function toggleNote(ctx, id) {
  const note = ctx.notes.find((n) => n.id === id);
  if (!note) return;
  try {
    await toast.withSaveState(() => notesData.setDone(id, !note.done), {
      success: note.done ? '拿回來了' : '勾掉了',
    });
    await reload(ctx);
  } catch {
    /* 已處理 */
  }
}

async function addNote(ctx, form) {
  const text = form.elements.text.value.trim();
  if (!text) return;
  try {
    await toast.withSaveState(
      () => notesData.create({
        text,
        customerId: ctx.id,
        customerName: ctx.customer.name,
      }),
      { success: '記下來了' },
    );
    await reload(ctx);
  } catch {
    /* 已處理 */
  }
}

// ---------- 編輯基本資料 ----------

/**
 * 備註不在這張表單裡 —— 它有自己的編輯器（點抬頭下面那一段的「編輯」）。
 * 會籍到期日也不在：實務上沒有會籍這件事（ADR-0019）。
 */
function paintEdit(ctx) {
  const { el, customer, equipment } = ctx;
  let flags = customer.flags ?? [];

  el.innerHTML = `
    <a class="backlink" href="#" data-back>${icon('left', { size: 17 })}${esc(customer.name)}</a>
    <section class="card">
      <h2 class="card__title">編輯基本資料</h2>
      <div class="errors" data-errors hidden></div>
      <form data-form>
        ${f.text({ name: 'name', label: '姓名', value: customer.name })}
        ${f.text({ name: 'phone', label: '電話', value: customer.phone ?? '' })}
        ${f.text({ name: 'lineId', label: 'LINE', value: customer.lineId ?? '' })}
        ${f.text({ name: 'source', label: '購買通路', value: customer.source ?? '' })}
        ${f.select({
          name: 'priority', label: '喜好程度', value: String(customer.priority ?? 0),
          options: Array.from({ length: rules.MAX_PRIORITY + 1 }, (_, i) => ({
            value: String(i), label: i === 0 ? '0 · 還沒評' : `${i} ${'★'.repeat(i)}`,
          })),
        })}
        <div data-flags></div>
        ${f.date({ name: 'purchasedAt', label: '購買日', value: customer.purchasedAt ?? '' })}
        <div class="form__actions">
          <button class="btn btn--primary" type="submit">儲存</button>
          <button class="btn" type="button" data-cancel>取消</button>
        </div>
      </form>
    </section>`;

  const back = () => paint(ctx);
  el.querySelector('[data-back]').addEventListener('click', (e) => {
    e.preventDefault();
    back();
  });
  el.querySelector('[data-cancel]').addEventListener('click', back);

  flagsUi.mount(el.querySelector('[data-flags]'), {
    flags,
    terms: contraindicationTerms(equipment),
    onChange: (list) => {
      flags = list;
    },
  });

  el.querySelector('[data-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = f.readForm(e.target);
    const changes = {
      name: v.name.trim(),
      phone: v.phone.trim() || null,
      lineId: v.lineId.trim() || null,
      source: v.source.trim() || null,
      priority: Number(v.priority) || 0,
      flags,
      purchasedAt: v.purchasedAt || null,
    };

    const errors = rules.validate({ ...changes, id: ctx.id });
    f.showErrors(el, errors);
    if (errors.length) return;

    try {
      await toast.withSaveState(() => data.update(ctx.id, changes), { success: '已儲存' });
      reload(ctx);
    } catch {
      /* 已處理 */
    }
  });
}

// ---------- 額度編輯 ----------

function paintEntitlement(ctx, record, draft = null) {
  const { el } = ctx;
  const isNew = !record;
  const e = draft ?? record ?? {
    type: 'single', label: '', totalQty: 1, durationMin: null,
    courseId: null, optionEquipmentIds: [], frequencyRule: null, expiresAt: null,
  };

  const aliveCourses = ctx.courses.filter((c) => !c.deletedAt);
  const aliveEquip = ctx.equipment.filter((x) => !x.deletedAt);

  el.innerHTML = `
    <a class="backlink" href="#" data-back>${icon('left', { size: 17 })}${esc(ctx.customer.name)}</a>
    <section class="card">
      <h2 class="card__title">${isNew ? '加購額度' : esc(record.label)}</h2>
      <div class="errors" data-errors hidden></div>
      <form data-form>
        ${f.select({
          name: 'type', label: '型態', value: e.type,
          options: [
            { value: 'single', label: '單一課程（固定療程）' },
            { value: 'pool', label: '擇一池（每次選一種器材）' },
          ],
          hint: '換型態會換掉下面要填的欄位。',
        })}
        ${f.text({ name: 'label', label: '顯示名稱', value: e.label, placeholder: '復能' })}
        ${f.number({ name: 'totalQty', label: '總次數', value: e.totalQty, min: 1 })}
        ${f.number({
          name: 'durationMin', label: '時長（分鐘）', value: e.durationMin ?? '', min: 1, step: 5,
          hint: '留空就用課程本身的時長。',
        })}
        ${e.type === 'pool'
          ? f.checkboxes({
              name: 'optionEquipmentIds', label: '可選的器材',
              values: e.optionEquipmentIds ?? [],
              options: aliveEquip.map((x) => ({ value: x.id, label: x.name })),
              hint: '至少兩種。客戶身上有對應禁忌的器材，排班時會被硬性擋掉。',
            })
          : f.select({
              name: 'courseId', label: '課程', value: e.courseId ?? null,
              options: [
                { value: null, label: '（請選擇）' },
                ...courseOptions(aliveCourses, e.courseId),
              ],
            })}
        ${f.text({
          name: 'frequencyRule', label: '頻率限制', value: e.frequencyRule ?? '',
          placeholder: '每季一次', hint: '只提示不阻擋。留空代表沒有限制。',
        })}
        ${f.date({ name: 'expiresAt', label: '這筆額度的到期日', value: e.expiresAt ?? '' })}
        ${isNew ? '' : usedFields(record)}
        <div class="form__actions">
          <button class="btn btn--primary" type="submit">儲存</button>
          <button class="btn" type="button" data-cancel>取消</button>
        </div>
      </form>
    </section>
    ${isNew ? '' : entitlementDanger()}`;

  const back = () => paint(ctx);
  el.querySelector('[data-back]').addEventListener('click', (ev) => {
    ev.preventDefault();
    back();
  });
  el.querySelector('[data-cancel]').addEventListener('click', back);

  const form = el.querySelector('[data-form]');

  // 換型態要換欄位，所以重畫。先把填到一半的值讀回來，不要清掉。
  form.addEventListener('change', (ev) => {
    if (ev.target.name !== 'type') return;
    paintEntitlement(ctx, record, { ...e, ...readEntitlement(form) });
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const next = { ...e, ...readEntitlement(form) };

    const errors = validateEntitlement(next, { courses: ctx.courses, equipment: ctx.equipment });
    f.showErrors(el, errors);
    if (errors.length) return;

    const payload = {
      type: next.type,
      label: next.label,
      totalQty: next.totalQty,
      durationMin: next.durationMin,
      courseId: next.type === 'single' ? next.courseId : null,
      optionEquipmentIds: next.type === 'pool' ? next.optionEquipmentIds : null,
      frequencyRule: next.frequencyRule,
      expiresAt: next.expiresAt,
    };

    try {
      if (isNew) {
        await toast.withSaveState(
          () => data.createEntitlement(ctx.id, {
            ...payload,
            sourcePlanName: null, // 單項加購
            purchasedAt: ctx.customer.purchasedAt ?? null,
            doneCount: 0,
            bookedCount: 0,
            lastReconciledAt: null,
          }),
          { success: '已加購' },
        );
      } else {
        await toast.withSaveState(() => data.updateEntitlement(ctx.id, record.id, payload), {
          success: '已儲存',
        });
      }
      reload(ctx);
    } catch {
      /* 已處理 */
    }
  });

  if (!isNew) wireEntitlementDanger(ctx, record);
}

function courseOptions(courses, currentId) {
  const opts = courses.map((c) => ({
    value: c.id,
    label: c.active === false ? `${c.name}（已停用）` : c.name,
  }));
  // 指向已刪除課程的舊資料要留著顯示，不可以無聲改成別的課程。
  if (currentId && !courses.some((c) => c.id === currentId)) {
    opts.unshift({ value: currentId, label: '（課程已刪除）' });
  }
  return opts;
}

function readEntitlement(form) {
  const v = f.readForm(form);
  return {
    type: v.type,
    label: String(v.label ?? '').trim(),
    totalQty: v.totalQty,
    durationMin: v.durationMin ?? null,
    courseId: v.courseId ?? null,
    optionEquipmentIds: v.optionEquipmentIds ?? [],
    frequencyRule: String(v.frequencyRule ?? '').trim() || null,
    expiresAt: v.expiresAt || null,
  };
}

/** 已扣掉的次數不可直接改數字，只能透過來訪狀態變化連動 —— SPEC 第 6.4 節。 */
function usedFields(record) {
  return f.readonly({
    label: '已完成 / 已排未上',
    value: `${record.doneCount ?? 0} / ${record.bookedCount ?? 0}`,
    hint: '這兩個數字不能直接改，它們跟著來訪的狀態走。對不起來時詳情頁會顯示差異。',
  });
}

function entitlementDanger() {
  return `
    <section class="card danger">
      <h2 class="card__title">刪除這筆額度</h2>
      <p class="muted">刪除是標記，資料不會消失，可以在設定 → 已刪除項目 還原。</p>
      <p style="margin-bottom: 0">
        <button class="btn btn--danger" type="button" data-del-ent>刪除</button></p>
    </section>`;
}

function wireEntitlementDanger(ctx, record) {
  ctx.el.querySelector('[data-del-ent]').addEventListener('click', async () => {
    const c = counts(record, ctx.visits, record.id);
    const ok = await confirmAction({
      title: `刪除「${record.label}」這筆額度？`,
      consequences: [
        `這筆額度共 ${c.total} 次，已完成 ${c.done} 次、已排未上 ${c.booked} 次`,
        '已經排好的來訪不會被刪，但它們會指向一筆已刪除的額度',
        '這是標記刪除，可以在設定 → 已刪除項目 還原',
      ],
      confirmLabel: '刪除',
      danger: true,
    });
    if (!ok) return;

    try {
      await toast.withSaveState(() => data.removeEntitlement(ctx.id, record.id), {
        success: '已刪除',
      });
      reload(ctx);
    } catch {
      /* 已處理 */
    }
  });
}
