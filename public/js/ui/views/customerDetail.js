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
import { sortNotes, noteActions, MAX_LENGTH as NOTE_TEXT_MAX } from '../../domain/notes.js';
import { icon } from '../icons.js';
import { monthNav, steppedMonth } from '../components/monthnav.js';
import * as rules from '../../domain/customers.js';
import { clinicalTerms, partnerNames } from '../../domain/masterData.js';
import { readMarks, toCustomerFields, validateMarks } from '../../domain/customerMarks.js';
import {
  counts, reconcile, isOverused, sortPools, offCount, isProduct, durationChoicesOf,
  poolCourseOf,
} from '../../domain/entitlements.js';
import { pairsOf, missingPairs, describePair } from '../../domain/followups.js';
import {
  examVisits, followupsOfExam, nthLabel, secondFollowupIds,
} from '../../domain/nthFollowup.js';
import {
  describeStatus, statusClass, isActive, visitCourseLabel, statusForCard, focusFor, dayStatusBadges,
} from '../../domain/visits.js';
import { timeLabel } from '../../domain/visitTime.js';
import { buildProgress } from '../../domain/progress.js';
import { progressDayHtml, tallyHtml, pickedSlot } from './progress.js';
import { tip } from '../components/tip.js';
import { visitReadHtml, wireReadSlots } from './calendar.js';
import { openCard } from '../components/card.js';
import { todayISO, shortDate, addMonths, monthLabel } from '../../domain/dates.js';
import { purchaseHeadline } from '../../domain/purchases.js';
import { messagesFor } from '../../domain/messages.js';
import { formLink, inviteState } from '../../domain/availabilityForm.js';
import * as invitesData from '../../data/formInvites.js';
import * as f from '../components/form.js';
import * as marksUi from '../components/marks.js';
import * as buy from '../components/buy.js';
import * as planTweak from '../components/planTweak.js';
import { openBuySheet } from '../components/buySheet.js';
import * as flagsUi from '../components/flags.js';
import * as message from '../components/message.js';
import * as note from '../components/note.js';
import { taskRow, confirmUntick } from '../components/tasklist.js';
import { openActions, wireLongPress } from '../components/actions.js';
import {
  deliveryState, monthsOf, nextDeliveryDate, productActions, existingReminder,
  deliveryNoteFor, undelivered,
} from '../../domain/products.js';
import { confirmAction, confirmReview } from '../components/dialog.js';
import { openSheet, closeSheet } from '../components/sheet.js';
import * as toast from '../toast.js';
import { go } from '../router.js';
import { openFor as openBulkCancel } from './bulkCancel.js';
import { taskLine, taskSlots } from '../../domain/todoFlow.js';
import { back, popScreens, pushScreen, whenSettled } from '../nav.js';

const esc = f.esc;

/** 變更紀錄往回查幾筆來訪。listByCustomer 是新的在前，所以這是「最近的 N 筆」。 */
/**
 * 來訪紀錄那一段展開了沒。**預設收起來，而且不記住** —— 每次進來都是收起來的，
 * 那才是「預設不佔位置」的意思（`.scratch/customer-detail-rework/issues/06`）。
 *
 * 這一段跟上面的「這個月」重疊很多（同一批來訪，換個角度看），
 * 而她要看歷史的時候是在對帳 —— 那時候她會想一直看著它，所以是就地展開，
 * 不是抽屜（抽屜要再關一次才回得來）。
 */
let showVisits = false;

/**
 * 「這個月」那一段在看哪個月（`'YYYY-MM'`）。每次進這一頁重設成當月 ——
 * 她開這一頁十次有九次問的是「他這個月什麼時候來」。
 */
let detailMonth = null;

/**
 * 任務那一段在看哪一格：未完成／已完成。跟待辦中心的 `taskTab`、隨手記那一頁
 * 同一個判斷 —— **它是看法，不是位置**，所以不進網址。
 *
 * 預設「未完成」：她開這一頁問的是「他還有什麼沒做」。
 */
let taskTab = 'open';

/** 上一次畫的是誰。只給 `taskTab` 用，判斷這次是換人還是同一個人重讀。 */
let shownCustomerId = null;

/**
 * 這一頁的兩組委派監聽掛在自己的容器上，**不掛在 `el` 上**。
 *
 * `paint()` 與 `paintEntitlement()` 換的是 `el.innerHTML`，`el` 本身沒有被換掉
 * —— 掛在 `el` 上的話每重畫一次就多一顆，而且離開這一頁之後它們還活著：
 * `data-visit` 與 `data-task` 在待辦中心各有另一個意思，按下去會用一份
 * 已經過期的 `ctx` 去找東西（`.scratch/asks-2026-08-25/issues/04`）。
 *
 * 掛在每次重畫都會被換掉的容器上，就沒有任何人需要記得拆它。
 */
const pageRoot = (el) => el.querySelector('[data-detailpage]');
const entRoot = (el) => el.querySelector('[data-entform]');

const AUDIT_VISIT_LIMIT = 30;

/** 一眼掃得完的長度。超過就收進「看全部」，不要把整頁拉成一條長清單。 */
const RECENT_VISITS = 6;
const RECENT_TASKS = 6;

export async function render(el, id) {
  showVisits = false;
  detailMonth = null;
  // 換人才重設任務那一格；**同一位客戶重讀不重設** —— 勾掉一筆任務會走
  // `reload()`（就是這一支），而她在「已完成」點回一筆之後應該還停在
  // 「已完成」，不是被彈回「未完成」。
  if (shownCustomerId !== id) taskTab = 'open';
  shownCustomerId = id;
  el.innerHTML = '<p class="muted">載入中…</p>';

  let ctx;
  try {
    const [customer, entitlements, visits, tasks, avail, courses, equipment, clinicalFlags,
      notes, rooms, staff, ivProducts, products, plans, partners] =
      await Promise.all([
        data.get(id),
        data.listEntitlements(id),
        visitsData.listByCustomer(id),
        tasksData.listByCustomer(id),
        data.listAvailability(id),
        config.listAll('courses'),
        config.listAll('equipment'),
        // 臨床提醒（ADR-0064）。永久限制的第二層，抬頭那一排與編輯表單都要它。
        config.listAll('clinicalFlags'),
        notesData.listByCustomer(id),
        // 診間與治療師是給那張讀取卡片用的（點一筆來訪浮出來的那一張，
        // 共用日曆的 `visitReadHtml()`）。跟其他幾份同一趟拿，不多一輪往返。
        config.listAll('rooms'),
        config.listAll('staff'),
        // 加購那一張表要的：營養點滴選得到品項、營養品選得到哪一款（ADR-0057）。
        config.listAll('ivProducts'),
        config.listAll('products'),
        // 「加購方案」那一張面板要的（`components/planTweak.js`）。
        config.listAll('plans'),
        // 合作機構（ADR-0076）。編輯基本資料那一張表要它才點得到。
        config.listAll('partners'),
      ]);
    ctx = {
      el, id, customer, entitlements, visits, tasks, courses, equipment, clinicalFlags, notes,
      rooms, staff, ivProducts, products, plans, partners,
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
  // 原地換掉的那幾層（編輯、加購、記一次）的瀏覽器紀錄也要退掉，
  // 不然她存完按返回鍵會回到一張已經存過的表單，看起來像沒存進去。
  popScreens();
  return render(ctx.el, ctx.id);
}

// ---------- 主畫面 ----------

function paint(ctx) {
  const { el, customer, entitlements, visits, tasks, equipment, clinicalFlags, notes } = ctx;
  const today = todayISO();
  // 那幾列的名字走顯示名稱（`SIS(60)`），跟日曆同一種寫法 —— 讀快照的話
  // 同一筆來訪在這一頁寫「復能」、在日曆上寫「SIS(60)」（ADR-0078）。
  const master = {
    courses: ctx.courses ?? [], equipment: equipment ?? [], ivProducts: ctx.ivProducts ?? [],
  };
  const flags = rules.splitFlags(customer, clinicalFlags);
  const partners = rules.partnersOf(customer);
  const marks = readMarks(customer);
  const openNotes = sortNotes(notes).filter((n) => !n.done);
  // 營養品跟課程額度分開畫（ADR-0057）：那一排卡的主體是三段式進度條，
  // 而營養品永遠是滿的 —— 沒有任何一筆來訪扣得掉它。
  const pools = entitlements.filter((e) => !isProduct(e));
  const bought = entitlements.filter(isProduct);
  // 名字底下那一行：買了什麼（ADR-0090）。跟客戶頁的卡片同一支。
  const headline = purchaseHeadline(customer, entitlements, { ...master, plans: ctx.plans ?? [] });

  el.innerHTML = `
    <div data-detailpage>
    <a class="backlink" href="#/customers" data-back>${icon('left', { size: 17 })}客戶</a>

    <div class="hero">
      <div class="row" style="align-items: flex-start">
        <div class="row__main">
          <h1 class="hero__name">${esc(customer.name)}
            ${customer.priority ? `<span class="stars">${'★'.repeat(customer.priority)}</span>` : ''}
          </h1>
          ${headline ? `<p class="hero__meta">${esc(headline)}</p>` : ''}
        </div>
        <button class="btn btn--sm" type="button" data-edit>編輯</button>
      </div>
      ${(customer.flags ?? []).length || partners.length || customer.active === false ? `
        <div class="hero__flags">
          ${flagsUi.detailChips(flags, { rows: clinicalFlags })}
          ${flagsUi.partnerChips(partners)}
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

    <div data-monthblock>${monthBlock(visits, today, master)}</div>

    ${availability.sectionHtml(ctx.availability, today)}

    <div class="section">
      <h2 class="section__title">額度</h2>
      <span class="section__n">${pools.length}</span>
      ${offCount(pools, visits)
        ? `<span class="badge badge--soon">${offCount(pools, visits)} 筆對不起來</span>`
        : ''}
      ${/* 三顆並排。「買過什麼」是唯讀的那一頁（當初買了什麼），
           另外兩顆是加購。她一年動不到幾次方案，所以方案那一顆排在中間 ——
           但它必須在這裡，不然「加購一整個方案」只有建新客戶時做得到。 */''}
      <a class="section__more" href="#/customers/${esc(ctx.id)}/bought">買過什麼</a>
      <button class="section__more" type="button" data-add-plan>加購方案</button>
      <button class="section__more" type="button" data-add-ent>加購</button>
    </div>
    ${pools.length === 0
      ? '<p class="muted" style="margin: 0">還沒有額度。按上面的「加購」單項加，或用「加購方案」一次展開一整套。</p>'
      : `<div class="strip noscroll-bar">${sortPools(pools, visits)
          .map((e) => poolCard(e, visits, ctx, today)).join('')}</div>`}

    ${productsBlock(bought, notes, ctx)}

    <div class="section">
      <h2 class="section__title">來訪紀錄</h2>
      <span class="section__n">${visits.length}</span>
      ${visits.length
        ? `<button class="section__more" type="button" data-toggle-visits
                   aria-expanded="${showVisits}">${showVisits ? '收起來' : '展開'}</button>`
        : ''}
    </div>
    ${!visits.length
      ? '<p class="muted" style="margin: 0">還沒有來訪紀錄。</p>'
      : (showVisits ? `
        <ul class="link-list">${visits.slice(0, RECENT_VISITS)
          .map((v) => visitRow(v, master)).join('')}</ul>
        ${visits.length > RECENT_VISITS
          ? `<p style="margin: var(--space-2) 0 0">
               <button class="btn btn--sm" type="button" data-all-visits>看全部 ${visits.length} 筆</button></p>`
          : ''}` : '')}

    <div class="section">
      <h2 class="section__title">隨手記</h2>
      ${openNotes.length ? `<span class="section__n">${openNotes.length} 未處理</span>` : ''}
    </div>
    ${notesBlock(notes)}

    ${/* 上面剛結束的是一排 28px 的小丸子，視覺重量很輕 ——
           `.section` 自己的上邊界在這裡不夠，兩塊會黏在一起 */''}
    <div data-taskblock style="margin-top: var(--space-5)">${taskBlock(tasks, visits, master)}</div>

    <div class="footlinks">
      <button class="footlink" type="button" data-msgs>
        ${icon('message', { size: 13 })}LINE 訊息</button>
      <button class="footlink" type="button" data-audit>變更紀錄</button>
      <button class="footlink footlink--danger" type="button" data-danger>
        ${customer.active === false ? '重新啟用與刪除' : '停用與刪除'}</button>
    </div>
    </div>`;

  wire(ctx, { today, marks });
}

function wire(ctx, { today, marks }) {
  const { el, entitlements, visits } = ctx;
  const master = {
    courses: ctx.courses ?? [], equipment: ctx.equipment ?? [], ivProducts: ctx.ivProducts ?? [],
  };

  el.querySelector('[data-back]').addEventListener('click', (e) => {
    e.preventDefault();
    back('/customers');
  });
  el.querySelector('[data-edit]').addEventListener('click', () => paintEdit(ctx));
  el.querySelector('[data-add-ent]')?.addEventListener('click', () => paintEntitlement(ctx, null));
  el.querySelector('[data-add-plan]')?.addEventListener('click', () => paintPlanPurchase(ctx));
  el.querySelector('[data-toggle-visits]')?.addEventListener('click', () => {
    showVisits = !showVisits;
    paint(ctx);
  });

  // 換月份**只重畫那一塊**（ADR-0038 的規矩：只換真的變了的那一塊）——
  // 重畫整頁會把她剛剛展開的來訪紀錄捲回最上面。
  pageRoot(el).addEventListener('click', (e) => {
    const stepped = steppedMonth(e.target, detailMonth ?? today.slice(0, 7), addMonths);
    if (stepped) {
      detailMonth = stepped;
      const box = el.querySelector('[data-monthblock]');
      if (box) box.innerHTML = monthBlock(ctx.visits, today, master);
      return;
    }
    const day = e.target.closest('[data-visit]');
    if (day) {
      // 「這個月」那一塊一段一顆按鈕（`progressDayHtml()`，2026-09-12）。
      // `data-slot` 是它在 `visit.slots` 裡的位置，不是畫出來的第幾列 ——
      // 讀法只有 `pickedSlot()` 一支，兩頁共用（同 `parseOpen()` 的規矩）。
      openVisitCard(ctx, day.dataset.visit, pickedSlot(day));
      return;
    }

    const toVisit = e.target.closest('[data-task-visit]');
    if (toVisit) {
      openVisitCard(ctx, toVisit.dataset.taskVisit, null, toVisit.dataset.taskId);
      return;
    }

    // 換任務那一格**只重畫那一塊**（同上面的換月份）。
    const tab = e.target.closest('[data-task-tab]');
    if (tab) {
      taskTab = tab.dataset.taskTab;
      const box = el.querySelector('[data-taskblock]');
      if (box) box.innerHTML = taskBlock(ctx.tasks, ctx.visits, master);
      return;
    }

    // 「看全部」那顆住在會被重畫的那一塊裡，所以也走委派 ——
    // 用 querySelector 掛的話，換一次分頁它就死了。
    if (e.target.closest('[data-all-tasks]')) {
      openAllTasks(ctx);
      return;
    }

    const task = e.target.closest('[data-task]');
    if (task) toggleTask(ctx, task.dataset.task);
  });

  el.querySelector('[data-marks]').addEventListener('click', () => openMarks(ctx, marks));

  el.querySelectorAll('[data-ent]').forEach((btn) =>
    btn.addEventListener('click', () =>
      paintEntitlement(ctx, entitlements.find((e) => e.id === btn.dataset.ent)),
    ),
  );

  el.querySelectorAll('[data-fix]').forEach((btn) =>
    btn.addEventListener('click', () => fixCounts(ctx, btn.dataset.fix)),
  );

  // 營養品那一列：**點一下與長按都開快捷選單**（ADR-0060）。
  // 它不是清單裡的一列（那種要保留「點＝看」），它是一個入口 ——
  // 而以前那個入口直接落進一張表單。
  el.querySelectorAll('[data-product]').forEach((btn) =>
    btn.addEventListener('click', () => openProductActions(ctx, btn.dataset.product)),
  );
  wireLongPress(el.querySelector('[data-products]'), '[data-product]', (btn) =>
    openProductActions(ctx, btn.dataset.product),
  );

  el.querySelectorAll('[data-add-followup]').forEach((btn) =>
    btn.addEventListener('click', () => addFollowup(ctx, btn.dataset.addFollowup)),
  );

  el.querySelectorAll('[data-note]').forEach((btn) =>
    btn.addEventListener('click', () => toggleNote(ctx, btn.dataset.note)),
  );

  // 長按一列＝直接做（ADR-0060）。五個入口共用同一組
  // （`noteActions()` 決定有哪幾顆、`note.runAction()` 執行）。
  //
  // 委派掛在那一塊清單上而不是 `el` 上：這一頁換月份、展開任務都會重畫，
  // 掛在 `el` 上每重畫一次就多一組。
  wireLongPress(el.querySelector('[data-notes]'), '[data-note]', (btn) => {
    const n = ctx.notes.find((x) => x.id === btn.dataset.note);
    if (!n) return;
    openActions({
      title: n.text,
      subtitle: n.date ? shortDate(n.date) : '沒有日期',
      items: noteActions(n, { today: todayISO() }),
      onPick: async (action) => {
        try {
          // 不傳 `onEdit`：這一頁沒有自己的編輯器，`runAction()` 會用內建的那一張。
          const changed = await note.runAction(action, n, {
            ...noteRunDeps(ctx),
            onBag: () => toast.info('那一包就在這一頁的「營養品」那一段'),
          });
          if (changed) await reload(ctx);
        } catch {
          /* 已處理 */
        }
      },
    });
  });

  note.wire(el);

  el.querySelector('[data-newnote]')?.addEventListener('submit', (e) => {
    e.preventDefault();
    addNote(ctx, e.target);
  });

  // 面板不在 `pageRoot(el)` 底下，委派監聽吃不到 —— 自己接一次
  //（底下的「全部任務」是同一個作法）。
  el.querySelector('[data-all-visits]')?.addEventListener('click', () => {
    const sheet = openSheet({
      title: '全部來訪',
      note: `${visits.length} 筆，新的在上面。`,
      body: `<ul class="link-list">${visits.map((v) => visitRow(v, master)).join('')}</ul>`,
    });
    sheet.el.querySelectorAll('[data-visit]').forEach((btn) =>
      btn.addEventListener('click', () => openVisitCard(ctx, btn.dataset.visit)),
    );
  });

  el.querySelector('[data-msgs]').addEventListener('click', () => openMessages(ctx, today));
  el.querySelector('[data-audit]').addEventListener('click', () => openAudit(ctx));
  el.querySelector('[data-danger]').addEventListener('click', () => openDanger(ctx));

  availability.wireSection(ctx);
}

// ---------- 抬頭與這個月 ----------

/**
 * 那一個月排了什麼。**一天一組、一段一列**，跟「看這個月的進度」那一頁
 * 長一模一樣（共用 `views/progress.js` 的 `progressDayHtml()` 與 `tallyHtml()`）——
 * 她的原話是「就像是客戶那頁『看這個月的進度』那邊呈現的一樣」。
 *
 * **只有選中的那個月。** 以前的篩選是「這個月 || 今天以後的全部」，
 * 所以標題寫著「這個月」卻混著下個月的來訪（她問「為什麼會有下個月的預約
 * 資訊跑進來？」）。SPEC 第 8.5 節原本寫的就是「本月與之後」，
 * 所以程式沒寫錯 —— 是標題與規格從一開始就對不起來。2026-08-24 定案：
 * **標題說哪個月就只有哪個月**，往右一格自己去看下個月。
 */
function monthBlock(visits, today, master = {}) {
  const month = detailMonth ?? today.slice(0, 7);
  const { rows } = buildProgress({
    customers: [{ id: '_', name: '_' }],
    // buildProgress 是照 customerId 分組的，這裡只有一位 —— 全部認成他。
    visits: visits.map((v) => ({ ...v, customerId: '_' })),
    month,
    // 那幾列印的是「那天做了什麼」（`SIS(30)`），跟進度追蹤同一支 `dayFor()`
    master,
  });
  const row = rows[0] ?? null;

  return `
    <div class="section">
      <h2 class="section__title">${esc(monthLabel(`${month}-01`))}</h2>
      <span class="section__n">${row ? `${row.days.length} 天・${row.slotCount} 段` : '沒有排'}</span>
      ${monthNav()}
    </div>

    ${row ? `
      <span class="chips" style="justify-content: flex-end; margin-bottom: var(--space-2)">
        ${tallyHtml(row.tally)}</span>
      <div class="progdays">${row.days.map(progressDayHtml).join('')}</div>`
      : '<p class="muted" style="margin: 0">這個月沒有排。</p>'}`;
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
async function openMessages(ctx, today) {
  const month = addMonths(today, 1).slice(0, 7);

  const sheet = openSheet({
    title: 'LINE 訊息',
    note: '產生的是草稿，複製之前可以直接改。',
    body: '<p class="muted">載入中…</p>',
  });

  // 她改過的 LINE 模板。跟連結同一趟拿，不多一輪往返；
  // `getTemplates()` 有行程內快取而且讀不到就回空物件（＝用預設值）。
  const [invite, templates] = await Promise.all([
    openInviteFor(ctx.customer.id, month, today),
    config.getTemplates(),
  ]);
  paintMessages(sheet, ctx, today, month, invite, templates);
}

/**
 * 這位客戶這個月有沒有一條還開著的表單連結。
 * 讀失敗就當沒有 —— 那一則退回原本的問法，她照樣問得了人。
 */
async function openInviteFor(customerId, month, today) {
  try {
    return (await invitesData.list())
      .filter((i) => i.customerId === customerId && i.month === month)
      .find((i) => inviteState(i, today) === 'open') ?? null;
  } catch {
    return null;
  }
}

/**
 * 只列現在用得到的：沒有待確認的來訪就不出現「問壓好的時間可不可以」，
 * 產生一則裡面沒有日期的空話比不產生更糟。
 *
 * **還沒有連結的時候，「問這一輪的時間」那一則換成一顆「產生表單連結」。**
 * 兩則（有連結的與沒連結的）同時給她會讓她不知道該貼哪一則，而貼錯的後果是
 * 客戶用打字回她、連結白給了。動線與待辦中心那一頁一樣：先產生，再複製。
 */
function paintMessages(sheet, ctx, today, month, invite, templates = {}) {
  const link = invite ? formLink(location.origin, invite.id) : '';
  const list = messagesFor({
    customer: ctx.customer, visits: ctx.visits, today, formLink: link, templates,
    // 那一段寫「那天真的做了什麼」（`13`）
    master: { courses: ctx.courses ?? [], equipment: ctx.equipment ?? [], ivProducts: ctx.ivProducts ?? [] },
  });
  const shown = link ? list : list.filter((m) => m.id !== 'ask');

  // 走面板自己的 update()：它會保住捲動位置，不會把她捲回最上面。
  sheet.update(`
    ${link ? '' : `
      <div class="field">
        <div class="field__label">問這一輪的時間</div>
        <p class="muted" style="margin: 0 0 var(--space-2)">
          先產生一條這位客戶專屬的連結，訊息才貼得出去。</p>
        <button class="btn btn--primary btn--wide" type="button" data-makelink>產生表單連結</button>
      </div>`}

    ${shown.length
      ? shown.map((m) => message.box({ id: `msg-${m.id}`, text: m.text, label: m.label })).join('')
      : (link ? '<p class="muted">現在沒有用得到的訊息。</p>' : '')}`);

  message.wire(sheet.el, toast.info);

  sheet.body()?.querySelector('[data-makelink]')?.addEventListener('click', async () => {
    const token = await toast.withSaveState(
      () => invitesData.create({
        customerId: ctx.customer.id, customerName: ctx.customer.name, month, sentAt: today,
      }),
      // 連點兩下就是兩條連結，而舊的那條會當場作廢 —— 她貼給客戶的可能是廢的那條
      {
        pending: '產生中…',
        success: '連結好了，複製訊息貼到 LINE',
        key: `invite:create:${ctx.customer.id}:${month}`,
      },
    );
    if (!token) return;
    // 就地換掉面板內容，不重開一張 —— 重開會再播一次滑上來的動畫，
    // 看起來像她按錯了什麼。
    paintMessages(
      sheet, ctx, today, month,
      await openInviteFor(ctx.customer.id, month, today), templates,
    );
  });
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
      // 這一頁本來就知道是誰，所以不用再讀一次客戶名單 —— 額度與可用性
      // 那幾則靠它才講得出名字（`domain/audit.js` 的 `describeParts()`）。
      const nameOf = (id) => (id === ctx.id ? (ctx.customer?.name ?? null) : null);
      sheet.update(
        events.length
          ? auditView.listHtml(events, { nameOf })
          : '<p class="muted">沒有變更紀錄。</p>',
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
    // **還掛著他的事就先擋**（prelaunch-audit-2026-09-23/issues/08，她選 A）：刪掉之後日曆與待辦上
    // 會留著一個點進去是「找不到這位客戶」的人，而那幾格在 Abovee 上還壓著。規則在 `deleteBlockers()`
    const block = rules.deleteBlockers({ visits: ctx.visits, tasks: ctx.tasks, notes: ctx.notes });
    if (block.visits.length || block.tasks.length || block.notes.length) {
      const master = liveMaster(ctx);
      const lineOf = (t) => {
        const l = taskLine(t, ctx.visits.find((v) => v.id === t.visitId), master);
        return `待辦「${l.kind}」・${l.date ? shortDate(l.date) : ''}`;
      };
      const noteOf = (n) => `隨手記「${n.text.length > 12 ? `${n.text.slice(0, 12)}…` : n.text}」${
        n.date ? `・${shortDate(n.date)}` : ''}`;
      // 「去批次取消」打開**今天以後最早**那一天的月份（issues/17）。已經過了、還沒結案的
      // 那幾筆該去簽療程單 —— 擋著的全部都是那種時，這一顆本身就是錯的路
      const ahead = block.visits.map((v) => v.date).filter((d) => d >= todayISO()).sort()[0];
      const goCancel = await confirmAction({
        title: `「${customer.name}」還刪不掉`,
        consequences: [
          ...block.visits.map((v) => `${shortDate(v.date)}　${visitCourseLabel(v, master)}（${describeStatus(v.status)}）`),
          ...block.tasks.map(lineOf),
          ...block.notes.map(noteOf),
          '——',
          ...(block.visits.length
            ? ['那幾段在 Abovee 上還壓著：還沒到的到壓表的「批次取消」取消，已經過了的到待辦「簽療程單」結案']
            : []),
          ...(block.tasks.length ? ['待辦做完勾掉'] : []),
          ...(block.notes.length ? ['隨手記勾掉或刪掉'] : []),
          '都收掉之後再回來刪',
        ],
        confirmLabel: ahead ? '去批次取消' : '知道了',
        cancelLabel: '先不要',
      });
      if (goCancel && ahead) {
        // 確認框收掉時排的那一趟 history.go() 回來之前換頁，會被它退掉（`whenSettled()`）
        closeSheet();
        await whenSettled();
        openBulkCancel(ctx.id, ahead.slice(0, 7));
        go('/schedule/cancel');
      }
      return;
    }

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
    <div class="pool poolcard">
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
      ${/* 「已與範本脫鉤」拿掉了：那是 ADR-0003 的說法，不是她的。她要從這一行
             知道的只有「這一筆是哪裡來的」，而範本之後會不會動到它，
             是她永遠不會問的問題（因為答案永遠是不會）。 */''}
      ${e.sourcePlanName
        ? `<p class="muted dim" style="font-size: var(--text-2xs)">來自方案「${esc(e.sourcePlanName)}」</p>`
        : '<p class="muted dim" style="font-size: var(--text-2xs)">單項加購</p>'}
      ${followupLine(e, ctx, visits)}
      ${rec.ok ? '' : reconcileWarning(e, rec)}
    </div>`;
}

/**
 * 「營養品」那一小段。**一筆都沒有就整段不畫** —— 大部分客戶不買，
 * 而一個永遠空著的段落只是在每次開這一頁時提醒她那件事不存在。
 *
 * 不塞進上面那一排額度卡，是因為那張卡的主體是「已完成／已排未上／剩餘」
 * 三段式進度條，而營養品永遠是滿的（ADR-0057）。一條永遠滿格的進度條
 * 在講一件不會發生的事。
 *
 * **點一列開的是快捷選單，不是「調整」那一張表**（ADR-0060）。
 * ADR-0020 對日曆定的規矩（先給看的，不先給改的）在這裡更該守：
 * 她點這一列，十次有九次要問的是「這一包給了沒、什麼時候給」，
 * 不是「改幾個月」。長按開的是同一張 —— 兩種手勢同一個結果，不會有人按錯。
 *
 * 那一列右邊多一句**提醒的狀態**（`9/3 給` / `還沒排哪天給`），
 * 因為那正是「約時間」那一顆要回答的問題。提醒就是一筆有日期的隨手記
 * （ADR-0044、0059），這一頁本來就讀好了，不多一次 IO。
 */
function productsBlock(bought, notes, ctx) {
  if (!bought.length) return '';

  const master = { products: ctx?.products ?? [] };
  const sorted = [...bought].sort(
    (a, b) => String(a.label ?? '').localeCompare(String(b.label ?? ''), 'zh-TW'),
  );

  return `
    <div class="section">
      <h2 class="section__title">營養品</h2>
      <span class="section__n">${sorted.length}</span>
    </div>
    <ul class="link-list" data-products>
      ${sorted.map((e) => {
        // 「給了沒」是這一段最重要的資訊 —— 她的原話是「假設我當天忘記給了，
        // 然後可以記我給了那些多少」。規則只在 `domain/products.js`。
        const gave = deliveryState(e, master);
        const reminder = existingReminder(notes, e.id);
        return `
        <li><button class="row-link" type="button" data-product="${esc(e.id)}" data-longpress>
          <span class="link-list__label">${esc(e.label ?? '（沒有名稱）')}
            <span class="muted">${esc(gave.text)}${
              gave.at ? `・${esc(shortDate(gave.at))}` : ''}${
              esc(reminderLine(gave, reminder))}</span></span>
          <span class="badge ${gave.state === 'all' ? 'badge--ok' : ''} num"
            >${esc(monthsOf(e))} 個月</span>
        </button></li>`;
      }).join('')}
    </ul>`;
}

/**
 * 那一列右邊接著寫的「哪天給」。
 *
 * **都給了就不寫** —— `deliveryState()` 那一句（「都給了・9/1」）已經講完了，
 * 再寫一次是同一件事講兩遍。
 */
function reminderLine(gave, reminder) {
  if (gave.state === 'all') return '';
  if (reminder?.date) return `・${shortDate(reminder.date)} 給`;
  return '・還沒排哪天給';
}

/**
 * 健檢那張卡片底下那一句「健檢做完 3 次，二返還欠 2 次」。
 *
 * 這一句只講事實，不講該怎麼辦 —— 什麼時候去約是她跟客戶談出來的（ADR-0002）。
 * 真的要她動手的只有一種情況：這位客戶身上根本沒有二返額度。那是 2026-08 以前
 * 建立的客戶（含舊表匯進來的那 21 位）的共同狀態，額度展開之後跟範本脫鉤
 * （ADR-0003），所以只能一筆一筆補。見 GitHub issue #15 與 ADR-0022。
 */
function followupLine(e, ctx, visits) {
  const coursesById = Object.fromEntries(ctx.courses.map((c) => [c.id, c]));
  const pair = pairsOf(ctx.entitlements, coursesById).find((p) => p.source.id === e.id);
  if (!pair) return '';

  if (!pair.followup) {
    return `
      <p class="muted">⚠ 這筆健檢還沒有對應的二返額度。沒有額度，二返記不進來，
        「約二返」的待辦也不會長出來。</p>
      <p style="margin-bottom: 0"><button class="btn btn--sm" type="button"
        data-add-followup="${esc(e.id)}">補一筆二返額度</button></p>`;
  }

  const line = describePair(pair, visits);
  return `
    ${line ? `<p class="muted">${esc(line.text)}</p>` : ''}
    ${nthLine(e, ctx, visits)}`;
}

/**
 * 這一筆健檢底下加約過哪幾返。**接在二返那一句下面，同一個位置、同一個字級。**
 *
 * n返 沒有額度，所以它沒有自己的卡片可以掛（`domain/nthFollowup.js` 的檔頭）。
 * 掛在健檢那一張底下是對的：她問的是「這一次健檢後來聽了幾次報告」。
 *
 * **這裡沒有「加約」按鈕。** ADR-0056 定了只有日曆改得了一筆來訪，而加一場
 * n返 就是建一筆來訪 —— 從這一頁給一顆按鈕等於在那個決定上再開一個洞。
 * 她的路徑跟排任何一場來訪一樣：壓表，或日曆。
 */
function nthLine(e, ctx, visits) {
  const coursesById = Object.fromEntries(ctx.courses.map((c) => [c.id, c]));
  const second = secondFollowupIds(ctx.entitlements);
  const rows = [];

  for (const exam of examVisits([e], coursesById, visits)) {
    const extra = followupsOfExam(exam.id, visits, second).filter((f) => !second.has(f.slot.entitlementId));
    if (!extra.length) continue;
    rows.push(`${shortDate(exam.date)} 的健檢 → ${
      extra.map((f) => `${nthLabel(f.nth)} ${shortDate(f.visit.date)}`).join('・')}`);
  }

  if (!rows.length) return '';
  return `<p class="muted">加約：${rows.map(esc).join('；')}</p>`;
}

async function addFollowup(ctx, entId) {
  const coursesById = Object.fromEntries(ctx.courses.map((c) => [c.id, c]));
  const miss = missingPairs(ctx.entitlements, coursesById).find((m) => m.source.id === entId);
  if (!miss) return;

  const ok = await confirmAction({
    title: `替「${miss.source.label}」補一筆二返額度？`,
    consequences: [
      `會新增「${miss.draft.label}」${miss.draft.totalQty} 次`,
      '次數跟健檢一樣多 —— 買幾次健檢就有幾次二返',
      '補了之後，健檢標成已完成才會長出「約二返」的待辦',
      '這次新增會留在稽核紀錄裡，也可以復原',
    ],
    confirmLabel: '補上',
  });
  if (!ok) return;

  try {
    await toast.withSaveState(() => data.createEntitlement(ctx.id, miss.draft), {
      success: '已補上二返額度',
      key: `entitlement:followup:${miss.source.id}`,
    });
    reload(ctx);
  } catch {
    /* 已處理 */
  }
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

/**
 * 來訪紀錄那一列。**長相跟以前一模一樣，只是不再是一條連到編輯器的連結**
 * —— 她認的是「日期＋課程＋狀態徽章」那一列，不是那是不是一個 `<a>`。
 *
 * 點下去跟任務列右邊那顆「詳情」走同一支（`openVisitCard()`，唯讀）。
 * 這是 ADR-0056 的另一半：留一條繞得過去的路，等於那個決定只做了一半。
 *
 * **帶主檔**：那一格印的是顯示名稱（`SIS(60)`），跟日曆同一種寫法 ——
 * 讀快照的話同一筆來訪在這一頁寫「復能」、在日曆上寫「SIS(60)」。
 */
function visitRow(v, master = null) {
  return `
    <li><button class="row-link" type="button" data-visit="${esc(v.id)}">
      <span class="link-list__label num">${esc(shortDate(v.date))}
        <span class="muted">${esc(visitCourseLabel(v, master))}</span>
      </span>
      ${/* 每一段不一樣時一段一個符號（`dayStatusBadges()`，issues/13）—— 整筆那一個是推導的，
             一段已確認、一段未到時它寫「已確認」，看起來整天都談定了 */''}
      <span class="daymarks">${dayStatusBadges(v).map((b) => `
        <span class="badge ${statusClass(b.status)}" title="${esc(describeStatus(b.status))}"
              aria-label="${esc(describeStatus(b.status))}">${esc(b.text)}</span>`).join('')}</span>
    </button></li>`;
}

/**
 * 任務那一整段：抬頭、未完成／已完成那一排、清單。
 *
 * **自己一個容器**（`[data-taskblock]`），換分頁時只重畫它 ——
 * 整頁重畫會把她剛剛展開的來訪紀錄收回去、把畫面捲回最上面（ADR-0038）。
 *
 * 分兩格的理由跟待辦中心一樣（`.scratch/asks-2026-08-25/issues/08`）：
 * 混在同一串裡的話，一位做完十次療程的客戶那六格會被已完成的塞滿，
 * 而她要看的「還沒做的那兩件」被擠進「看全部」裡面去了。
 */
function taskBlock(tasks, visits = [], master = null) {
  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);
  const rows = taskTab === 'done' ? done : open;
  // 來訪這一頁本來就有了（`ctx.visits`），所以一次讀取都不用多加 ——
  // 任務身上沒有來訪日與課程名，也不該有（`data/tasks.js` 的檔頭）。
  const visitById = new Map(visits.map((v) => [v.id, v]));
  const row = (t) => taskRow(t, visitById.get(t.visitId) ?? null, { master });

  return `
    <div class="section">
      <h2 class="section__title">任務</h2>
      <span class="section__n">${open.length ? `${open.length} 未完成` : `${tasks.length}`}</span>
      ${rows.length > RECENT_TASKS
        ? `<button class="section__more" type="button" data-all-tasks>看全部</button>`
        : ''}
    </div>

    ${/* 一筆任務都沒有的時候連那一排都不畫 —— 兩個空格子看起來像壞掉的東西 */''}
    ${!tasks.length
      // ADR-0027 與 ADR-0066：任務現在有**兩個**時機。這是 CLAUDE.md 點名的
      // 那幾句之一，改「什麼時候產生」的規則時要一起改。
      // 用她的詞，不要寫「系統登記」。
      //
      // 2026-09-10：那三行收進一顆 `?`（issue 09）。**「還沒有任務。」自己留著** ——
      // 空狀態是這一塊唯一的內容，藏起來就變成一片空白；要收的只有底下的說明。
      ? `<p class="muted" style="margin: 0">還沒有任務。${tip(
          '勾掉待辦上那一張「跟客人確認時間」之後，要去 Examine、耀聖掛號的那幾張才會長出來；'
          + '要寫紀錄的那幾種（二返、營養師諮詢）則是那一場簽完療程單之後才長。')}</p>`
      : `
        <div class="seg" role="group" style="margin-bottom: var(--space-3)">
          <button class="seg__item" type="button" aria-pressed="${taskTab === 'open'}"
                  data-task-tab="open">未完成${open.length ? ` ${open.length}` : ''}</button>
          <button class="seg__item" type="button" aria-pressed="${taskTab === 'done'}"
                  data-task-tab="done">已完成${done.length ? ` ${done.length}` : ''}</button>
        </div>
        ${rows.length
          ? `<div class="tasklist">${rows.slice(0, RECENT_TASKS).map(row).join('')}</div>`
          : `<p class="muted" style="margin: 0">${
              taskTab === 'done' ? '還沒有勾掉的。' : '沒有還沒做的了。'}</p>`}`}`;
}

/*
 * 一張任務長什麼樣**搬到 `ui/components/tasklist.js` 了**（2026-09-02）——
 * 待辦中心的「依客戶」抽屜要用同一份。搬走的理由寫在那一支的檔頭。
 *
 * 這一頁對那一列的兩個決定沒有變，記在這裡免得之後有人在抽屜那側改壞：
 *
 * - **點一列就是勾掉／拿回來**，哪裡都不去。以前整列連到那筆來訪
 *   （`#/visits/:id`，而且是整頁編輯器），她問「不是應該跳到 todo 那邊嗎？」
 *   —— 兩邊都不太對：待辦中心列的是所有客戶的任務，從一位客戶身上跳過去
 *   她還要在裡面把這個人找回來。所以答案是哪裡都不去
 *   （跟日曆上勾待辦同一個判斷，ADR-0045）。
 * - 右邊那顆叫「**詳情**」不叫「來訪」，浮出的是唯讀卡片（ADR-0056）。
 *   同一個動作在兩頁叫兩個名字，她會以為是兩件事。
 */

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
    <div class="groups" data-notes>
      ${rows.map((n) => note.row(n, { customer: false, iconSize: 12 })).join('')
        || '<p class="muted" style="padding: var(--space-3); margin: 0">還沒記過。</p>'}
    </div>
    ${/* 日期那一排包在 `.notemeta` 裡 —— 那是四個入口共用的外框
           （`CLAUDE.md` 的連動表）。以前這裡裸放，於是丸子貼著輸入框，
           她的原話是「跟輸入框以及下方的任務貼得太近了」 */''}
    <form data-newnote style="margin-top: var(--space-4)">
      <div style="display: flex; gap: var(--space-2)">
        <input type="text" name="text" maxlength="${NOTE_TEXT_MAX}" style="flex: 1; min-width: 0"
               placeholder="他臨時提的小要求…" aria-label="新的隨手記" />
        <button class="btn" type="submit">記</button>
      </div>
      <div class="notemeta">${note.field()}</div>
    </form>`;
}

// ---------- 營養品那一列的三顆 ----------
//
// 她的原話：「請改成點擊或長按後彈出選單，提供三個選項：約時間、已經給了、編輯」。
//
// **交付的紀錄與提醒的勾選寫在同一個 commit 裡**（`data/notes.js` 的
// `recordDelivery()`，ADR-0059）—— 分開寫的話「勾好了、交付沒記到」會留下
// 一筆看起來做完、其實查不出給了什麼的紀錄，而那正是要進試算表的東西。
//
// 日曆與待辦**沒有東西要同步**：提醒就是一筆有日期的隨手記本人（ADR-0044），
// 改它的日期就是改日曆上那一件。

function openProductActions(ctx, entId) {
  const e = ctx.entitlements.find((x) => x.id === entId);
  if (!e) return;

  const master = { products: ctx.products ?? [] };
  const reminder = existingReminder(ctx.notes, e.id);
  const gave = deliveryState(e, master);

  openActions({
    title: e.label ?? '（沒有名稱）',
    subtitle: `${monthsOf(e)} 個月・${gave.text}`,
    items: productActions(e, reminder, master),
    onPick: (action) => runProductAction(ctx, e, reminder, action),
  });
}

async function runProductAction(ctx, e, reminder, action) {
  if (action === 'edit') {
    paintEntitlement(ctx, e);
    return;
  }

  const master = { products: ctx.products ?? [] };

  try {
    if (action === 'when') {
      // 預設帶「她下一次會見到這位客戶是哪一天」。找不到就空白 ——
      // **不要退回今天**：今天客人不見得會來，而一個掛錯日期的待辦
      // 比一個沒有日期的待辦糟（`nextDeliveryDate()` 的檔頭）。
      const picked = await note.askDate(
        reminder?.date ?? nextDeliveryDate(ctx.visits, todayISO()),
        { title: '哪天順便給', subtitle: '選了之後，日曆的那一天會多一件待辦' },
      );
      if (!picked) return;

      if (reminder) {
        await toast.withSaveState(() => notesData.update(reminder.id, { date: picked }), {
          success: `改成 ${shortDate(picked)} 給`,
        });
      } else {
        const draft = deliveryNoteFor({
          entitlement: e,
          customer: { id: ctx.id, name: ctx.customer.name },
          date: picked,
        });
        if (!draft) {
          toast.info('這一包還沒選是哪幾款 —— 先按「編輯這一包」補上');
          return;
        }
        await toast.withSaveState(() => notesData.create(draft), {
          success: `${shortDate(picked)} 提醒你給${ctx.customer.name}`,
          key: `note:create:${e.id}:${picked}`,
        });
      }
      await reload(ctx);
      return;
    }

    if (action === 'gave') {
      const at = await note.askDate(todayISO(), {
        title: '哪一天給的',
        subtitle: '預設今天。這一筆會進試算表',
      });
      if (!at) return;

      // 逐款那一張借 `components/note.js` 的同一支 —— 兩邊各畫一張的話，
      // 遲早有一邊少了「給了的才會記進試算表」那一句。
      const picked = await note.askGiven(e, { customerName: ctx.customer.name, master });
      if (!picked?.length) return;

      // 這一下把剩下的全部記完了嗎 —— 跟 `prepareToggle()` 那一句同一個判斷。
      const all = picked.length === undelivered(e, master).length;

      await toast.withSaveState(
        () => notesData.recordDelivery(reminder, e, { at, productIds: picked }, {
          customerId: ctx.id,
          customerName: ctx.customer.name,
          products: ctx.products ?? [],
        }),
        { success: all ? '都給了，記起來了' : '記起來了' },
      );
      await reload(ctx);
    }
  } catch {
    /* 已處理 */
  }
}

/** 勾一筆隨手記／改它的日期與掛的人。五個入口的形狀一樣，只有這一份。 */
function noteRunDeps(ctx) {
  return {
    update: (id, changes) => notesData.update(id, changes),
    remove: (id, reason) => notesData.remove(id, reason),
    setDone: (id, done) => notesData.setDone(id, done),
    loadEntitlements: (cid) => data.listEntitlements(cid),
    recordDelivery: (n, e, d) => notesData.recordDelivery(n, e, d),
    loadCustomers: () => data.list(),
    // 舊資料的 `items[].name` 是空字串，靠主檔認回名字（`issues/10`）。
    // 這一頁已經讀好了，不多一次往返。
    loadProducts: async () => ctx.products ?? [],
    today: todayISO(),
    save: (run, opts) => toast.withSaveState(run, opts),
  };
}

async function toggleNote(ctx, id) {
  // **不要叫它 `note`** —— 這一頁把 `components/note.js` 也 import 成 `note`。
  const row = ctx.notes.find((n) => n.id === id);
  if (!row) return;

  // 營養品的提醒會先問「給了哪些」。問話在 withSaveState 外面 ——
  // 包進去的話她按了「先不要」也會跳一句「勾掉了」。
  const plan = await note.prepareToggle(row, noteRunDeps(ctx));
  if (!plan) return;

  try {
    await toast.withSaveState(plan.run, { success: plan.success });
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
        date: note.read(form),
      }),
      // 隨手記的**第四個**入口（CLAUDE.md 那四個共用 `components/note.js` 的）。
      // 四個都要有 key —— 漏掉的那個一定是比較順手的那個。
      { success: '記下來了', key: `note:create:${ctx.id}:${text}` },
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
  const { el, customer, equipment, clinicalFlags } = ctx;
  let flags = customer.flags ?? [];
  let partners = rules.partnersOf(customer);

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
        <div data-partners></div>
        ${f.date({ name: 'purchasedAt', label: '購買日', value: customer.purchasedAt ?? '' })}
        <div class="form__actions">
          <button class="btn btn--primary" type="submit">儲存</button>
          <button class="btn" type="button" data-cancel>取消</button>
        </div>
      </form>
    </section>`;

  // 原地換掉整頁 → 疊一層，返回鍵退得回詳情而不是離開這個人（ADR-0048）。
  const leave = pushScreen('customer-edit', () => paint(ctx));
  el.querySelector('[data-back]').addEventListener('click', (e) => {
    e.preventDefault();
    leave();
  });
  el.querySelector('[data-cancel]').addEventListener('click', leave);

  flagsUi.mount(el.querySelector('[data-flags]'), {
    flags,
    alerts: clinicalTerms(clinicalFlags),
    onChange: (list) => {
      flags = list;
    },
  });

  // 合作機構（ADR-0076）。**跟永久限制分成兩支** —— 它不是限制。
  flagsUi.mountPartners(el.querySelector('[data-partners]'), {
    partners,
    options: partnerNames(ctx.partners ?? []),
    onChange: (list) => {
      partners = list;
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
      partners,
      purchasedAt: v.purchasedAt || null,
    };

    const errors = rules.validate({ ...changes, id: ctx.id });
    f.showErrors(el, errors);
    if (errors.length) return;

    // **改名**（prelaunch-audit-2026-09-23/issues/09）：同名那一句照樣問（ADR-0102），
    // 而且今天以後（或還掛著沒做完的事）的來訪、還沒做的待辦、還沒勾的隨手記上的名字一起換 ——
    // 規則在 `renameTargets()`
    const renamed = changes.name !== (ctx.customer.name ?? '');
    if (renamed) {
      const said = rules.fieldWarnings({ ...changes, id: ctx.id }, await data.list().catch(() => [])).name;
      if (said && !await confirmReview([said])) return;
    }

    try {
      await toast.withSaveState(async () => {
        const targets = renamed
          ? rules.renameTargets(await ownSnapshots(ctx.id), todayISO(), changes.name)
          : [];
        await data.updateWithSnapshots(ctx.id, changes, targets);
      }, {
        success: '已儲存', key: `customer:update:${ctx.id}`,
      });
      reload(ctx);
    } catch {
      /* 已處理 */
    }
  });
}

/** 這位客戶身上帶著名字快照的那幾份（改名時要跟著換哪幾份由 `renameTargets()` 決定）。 */
async function ownSnapshots(customerId) {
  const [visits, tasks, notes] = await Promise.all([
    visitsData.listByCustomer(customerId),
    tasksData.listByCustomer(customerId),
    notesData.listByCustomer(customerId),
  ]);
  return { visits, tasks, notes };
}

// ---------- 額度編輯 ----------

/**
 * 加購一整個方案。
 *
 * 她的原話：「客戶詳情那邊的加購可以加購一整個方案」、「我希望方案也可以微調」。
 *
 * 面板本身在 `components/planTweak.js`（**三個入口共用同一張**）。
 * 這一頁只負責：把主檔遞進去、回答「哪一塊要重畫」、把結果寫下去。
 *
 * **寫入走 `data.addEntitlements()`** —— 跟單項加購同一支身體，所以方案裡的
 * 健檢照樣配得到二返、營養品照樣配得到交付提醒。另外寫一支的代價
 * `data/customers.js` 的檔頭記過。
 */
function paintPlanPurchase(ctx, draft = null) {
  const { el } = ctx;
  const plans = (ctx.plans ?? []).filter((p) => !p.deletedAt);
  const master = liveMaster(ctx);
  const d = draft ?? planTweak.blank(plans);

  el.innerHTML = `
    <div data-planform>
    <a class="backlink" href="#" data-back>${icon('left', { size: 17 })}${esc(ctx.customer.name)}</a>

    <div class="page"><h1 class="page__title">加購方案</h1></div>

    <div class="errors" data-errors hidden></div>

    <form data-form>
      ${planTweak.fields(d, plans)}

      <div class="form__actions">
        <button class="btn btn--primary" type="submit">加購</button>
        <button class="btn" type="button" data-cancel>取消</button>
      </div>
    </form>
    </div>`;

  wirePlanPurchase(el, ctx, d, { plans, master });
}

function wirePlanPurchase(el, ctx, d, { plans, master }) {
  // 重畫自己時不再疊一層（同 `wireEntitlement()`）
  const leave = pushScreen('plan-purchase', () => paint(ctx));
  el.querySelector('[data-back]').addEventListener('click', (ev) => {
    ev.preventDefault();
    leave();
  });
  el.querySelector('[data-cancel]').addEventListener('click', leave);

  const root = el.querySelector('[data-planform]');
  const form = () => el.querySelector('[data-form]');
  f.wireChips(root);

  let live = d;
  planTweak.wire(root, {
    form,
    draft: () => live,
    plans: () => plans,
    onChange: (next, { repaint }) => {
      live = next;
      if (repaint) paintPlanPurchase(ctx, next);
    },
  });

  // 「加一項」開的是 `components/buy.js` 那一張表，跟另外三個加購入口同一張。
  root.addEventListener('click', (ev) => {
    if (!ev.target.closest('[data-addextra]')) return;
    live = { ...live, ...planTweak.values(form(), planTweak.rowsOf(live, plans)) };
    // 「加一項」開的是 `components/buySheet.js` —— 跟新增客戶那一頁同一張。
    openBuySheet(master, (item) => {
      paintPlanPurchase(ctx, { ...live, extras: [...(live.extras ?? []), item] });
    }, { title: '加一項', note: '方案之外多加的。加完可以再加一項。' });
  });

  form().addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const next = { ...live, ...planTweak.values(form(), planTweak.rowsOf(live, plans)) };
    live = next;

    const errors = planTweak.validate(next, plans);
    f.showErrors(el, errors);
    if (errors.length) return;

    const rows = planTweak.payload(next, plans, {
      purchasedAt: ctx.customer.purchasedAt ?? null,
    });
    await toast.withSaveState(
      () => data.addEntitlements(ctx.id, rows, { customer: ctx.customer }),
      { success: `已加購 ${rows.length} 筆`, key: `plan:add:${ctx.id}` },
    );
    ctx.back();
  });
}

/**
 * 加購／調整額度。
 *
 * **兩個入口拆成兩張表**（2026-08-24）。以前是同一張表用 `isNew` 分岔，
 * 八個欄位上下疊、每一個看起來一樣重要 —— 而她點進來的理由只有兩種：
 *
 * - **加購**：客戶多買了五次復能 → 選一個課程、打一個數字。其餘七個欄位
 *   都是「跟方案範本展開出來的一樣就好」，她一年動不到一次。
 * - **調整**：次數談錯了、或多送兩次 → 改**一個數字**。
 *
 * 所以每一張表都有一個主體，其餘收進「進階設定」那一摺。她明講不要更多
 * 說明文字（`.scratch/form-legibility/spec.md`），所以那些欄位底下解釋
 * 「為什麼這裡有這個欄位」的 hint 大半跟著進去或直接刪掉。
 */
function paintEntitlement(ctx, record, draft = null) {
  const { el } = ctx;
  const isNew = !record;
  const e = draft ?? record ?? { ...buy.blank(), advanced: false };

  const master = liveMaster(ctx);
  const c = isNew ? null : counts(record, ctx.visits, record.id);

  el.innerHTML = `
    <div data-entform>
    <a class="backlink" href="#" data-back>${icon('left', { size: 17 })}${esc(ctx.customer.name)}</a>

    <div class="page">
      <h1 class="page__title">${isNew ? '加購' : esc(record.label)}</h1>
    </div>

    <div class="errors" data-errors hidden></div>

    <form data-form>
      ${isNew ? buy.fields(e, master) : adjustFields(e, c)}

      <details class="advanced" ${e.advanced ? 'open' : ''}>
        <summary class="advanced__head">進階設定${advancedDigest(e, isNew, master)}</summary>
        <div class="advanced__body">
          ${advancedFields(e, master, isNew, ctx.customer.purchasedAt ?? null)}
        </div>
      </details>

      <div class="form__actions">
        <button class="btn btn--primary" type="submit">${isNew ? '加購' : '存起來'}</button>
        <button class="btn" type="button" data-cancel>取消</button>
      </div>
    </form>

    ${isNew ? '' : entitlementDanger()}
    </div>`;

  wireEntitlement(el, ctx, record, e, { isNew, master });
}

/** 這一頁手上那四份主檔，已刪除的濾掉。加購那一張表吃的就是這個形狀。 */
function liveMaster(ctx) {
  const live = (rows) => (rows ?? []).filter((r) => !r.deletedAt);
  return {
    courses: live(ctx.courses),
    equipment: live(ctx.equipment),
    ivProducts: live(ctx.ivProducts),
    products: live(ctx.products),
  };
}

/**
 * 調整的主體是那三個數字。
 *
 * 「已完成 / 已排未上」是**唯讀**的（SPEC 第 6.4 節：只能透過來訪狀態變化連動）。
 * 對不起來的時候走資料健檢那一頁修（ADR-0007），不在這裡。
 */
function adjustFields(e, c) {
  // 營養品沒有「已完成／已排未上」—— 沒有任何一筆來訪扣得掉它（ADR-0057）。
  // 印三個永遠是 0 的數字，等於畫面在講一件不會發生的事。
  const total = isProduct(e) ? '幾份' : '總次數';
  return `
    <div class="fieldgroup">
      <span class="fieldgroup__label">${total}</span>
      <div class="qty">
        <input class="qty__n" type="number" name="totalQty" min="1" step="1"
               inputmode="numeric" value="${esc(e.totalQty ?? 1)}" aria-label="${total}" />
        ${[1, 5, 10].map((n) => `
          <button class="chip chip--sm" type="button" data-qty="${n}">+${n}</button>`).join('')}
      </div>
    </div>

    ${isProduct(e) ? '' : `
    <div class="tally">
      <span class="tally__one"><b class="num">${c.done}</b>已完成</span>
      <span class="tally__one"><b class="num">${c.booked}</b>已排未上</span>
      <span class="tally__one tally__one--key"><b class="num">${c.remaining}</b>剩餘</span>
      ${c.noShow ? `<span class="tally__one"><b class="num">${c.noShow}</b>未到</span>` : ''}
    </div>
    <p class="muted dim" style="margin: var(--space-1) 0 0; font-size: var(--text-2xs)">
      已完成與已排未上跟著來訪的狀態走，改不了。對不起來時到資料健檢修。</p>`}`;
}

/**
 * 摺疊的標題要講出裡面被動過幾樣 —— 收起來的東西不能安靜地生效。
 *
 * 顯示名稱要跟**自動帶的那一個**比（`keptLabel()`）。以前是「有值就算改過」，
 * 於是她一選課程就看到「改了 顯示名稱」—— 而那是 app 自己填的，她沒有動過。
 * 畫面在講一件沒發生的事，比沒講還糟。
 */
function advancedDigest(e, isNew, master) {
  // 時長那一格在「有可選時長的課程」上已經是主體的一排丸子了（`buy.js`），
  // 那一排本來就一定有值 —— 講「改了 時長」會變成每一次都出現的假訊息。
  const timed = isNew && durationChoicesOf(durationCourse(e, master)).length >= 2;
  const changed = [
    e.durationMin && !timed ? '時長' : null,
    e.frequencyRule ? '頻率限制' : null,
    e.expiresAt ? '到期日' : null,
    isNew && buy.keptLabel(e, master) ? '顯示名稱' : null,
  ].filter(Boolean);
  return changed.length ? `<span class="muted"> 改了 ${changed.join('、')}</span>` : '';
}

/**
 * 進階設定。**營養品只有顯示名稱** —— 時長、頻率限制、器材、課程、到期日
 * 對一罐夜態美通通沒有意義（ADR-0057）。
 */
/** 這一筆的「幾分鐘」要問哪一個課程。擇一池問復能，其餘問它自己。 */
function durationCourse(e, master) {
  if (e?.type === 'pool') return poolCourseOf(master);
  return (master.courses ?? []).find((c) => c.id === e?.courseId) ?? null;
}

function advancedFields(e, master, isNew, purchasedAt = null) {
  if (isProduct(e)) {
    return f.text({
      name: 'label', label: '顯示名稱', value: e.label,
      placeholder: '留空就用營養品的名字',
    });
  }

  return `
    ${f.text({
      name: 'label', label: '顯示名稱', value: e.label,
      placeholder: '留空就用課程的名字',
    })}
    ${/* 加購時「幾分鐘」與「哪一種」已經是主體的兩排丸子（`components/buy.js`），
         這裡不可以再長出同名的第二個欄位 —— 兩個 `name="durationMin"` 會讓
         `readForm()` 讀到不確定的那一個。調整既有額度時沒有那兩排，照舊。 */''}
    ${isNew && durationChoicesOf(durationCourse(e, master)).length >= 2 ? '' : f.number({
      name: 'durationMin', label: '時長（分鐘）', value: e.durationMin ?? '', min: 1, step: 1,
      hint: '留空就用課程本身的時長。',
    })}
    ${e.type === 'pool'
      ? (isNew ? '' : f.checkboxes({
          name: 'optionEquipmentIds', label: '可選的器材',
          values: e.optionEquipmentIds ?? [],
          options: master.equipment.map((x) => ({ value: x.id, label: x.name })),
        }))
      : `<input type="hidden" name="courseId" value="${esc(e.courseId ?? '')}" />
         ${isNew ? '' : f.select({
           name: 'courseIdPick', label: '課程', value: e.courseId ?? null,
           options: [
             { value: null, label: '（請選擇）' },
             ...courseOptions(master.courses, e.courseId),
           ],
         })}`}
    ${f.text({
      name: 'frequencyRule', label: '頻率限制', value: e.frequencyRule ?? '',
      placeholder: '每季一次', hint: '只提示不阻擋。',
    })}
    ${buy.expiryRow(e, { from: purchasedAt })}`;
}

function wireEntitlement(el, ctx, record, e, { isNew, master }) {
  // 同上。這一頁換課程／展開進階時會重畫自己，pushScreen 的 key 讓它不再疊一層。
  const leave = pushScreen('entitlement-edit', () => paint(ctx));
  el.querySelector('[data-back]').addEventListener('click', (ev) => {
    ev.preventDefault();
    leave();
  });
  el.querySelector('[data-cancel]').addEventListener('click', leave);

  const form = el.querySelector('[data-form]');
  const advanced = () => Boolean(el.querySelector('.advanced')?.open);

  const root = entRoot(el);
  f.wireChips(root);

  // 這一張表上的四種動作（換「買了什麼」、換「幾萬的／哪一種」、`+1`、
  // 在「自己打」那一格打字）走 `components/buy.js` 的同一份接線 ——
  // 三個入口共用，這裡只回答「哪一塊要重畫」。
  //
  // `live` 是**還沒重畫的那幾下**的草稿。不重畫的那兩下（`+1` 與打字）
  // 也一定要收起來，`afterDetail()` 的檔頭寫了為什麼。
  let live = e;
  buy.wire(root, {
    form: () => form,
    draft: () => live,
    master,
    typed: (box) => readEntitlement(box, master),
    onChange: (next, { repaint }) => {
      live = next;
      if (repaint) paintEntitlement(ctx, record, { ...next, advanced: advanced() });
    },
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    // 「＋ 新增…」打的那一款先寫進主檔，換回一張指得到它的草稿。
    // 沒有要新增就原樣回來，一次 IO 都不會發生（三個入口共用同一支）。
    const next = await buy.commitNewProduct(
      { ...live, ...readEntitlement(form, master) },
      { products: ctx.products },
      (row) => config.create('products', row),
    );

    const errors = buy.validate(next, {
      courses: ctx.courses, equipment: ctx.equipment, products: ctx.products,
    });
    f.showErrors(el, errors);
    if (errors.length) return;

    try {
      if (isNew) {
        await toast.withSaveState(
          () => data.createEntitlement(
            ctx.id,
            buy.toEntitlement(next, { purchasedAt: ctx.customer.purchasedAt ?? null }),
            {
              // 營養品要配一筆「哪天順便給」的提醒（ADR-0059），而那一句話要
              // 印得出是誰 —— 少了它會變成「給營養品：…」，
              // 而她的隨手記上一次有十幾筆，看不出是誰的。
              customer: ctx.customer,
              // 「我都是等客人哪天有預約來，我就順便給」。找不到就留空白 ——
              // **不要退回今天**：一個掛錯日期的待辦比一個沒有日期的待辦糟，
              // 前者她會照著做（`nextDeliveryDate()` 的檔頭）。
              deliverOn: nextDeliveryDate(ctx.visits, todayISO()),
            },
          ),
          // 連點兩下就是兩筆額度，而額度是「還能上幾次」的來源
          { success: '已加購', key: `entitlement:create:${ctx.id}` },
        );
      } else {
        await toast.withSaveState(
          () => data.updateEntitlement(ctx.id, record.id, buy.payload(next)),
          { success: '已儲存', key: `entitlement:update:${record.id}` },
        );
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

function readEntitlement(form, master = {}) {
  const v = f.readForm(form);
  return {
    // 課程由「買了什麼」那一排丸子決定，而那一顆的值直接寫進草稿
    // （`buy.afterPick()`），不從表單讀 —— 因為擇一池那一顆不是課程 id。
    // 進階設定裡的下拉（只有編輯既有的那一張才有）優先。
    courseId: v.courseIdPick ?? v.courseId ?? null,
    label: String(v.label ?? '').trim(),
    totalQty: v.totalQty,
    durationMin: v.durationMin ?? null,
    optionEquipmentIds: v.optionEquipmentIds ?? [],
    frequencyRule: String(v.frequencyRule ?? '').trim() || null,
    expiresAt: v.expiresAt || null,
    // 等級／品項那幾排只有加購那一張表有。**沒在畫面上就不回報** ——
    // 少帶一個欄位就等於把它清成 null，見 ADR-0054 的 Consequences。
    ...buy.read(form, v, master),
  };
}

function entitlementDanger() {
  return `
    <section class="card danger" style="margin-top: var(--space-5)">
      <h2 class="card__title">刪除這筆額度${tip(
        '刪除是標記，資料不會消失，可以在設定 → 已刪除項目 還原。')}</h2>
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

/**
 * 點一筆來訪浮出讀取模式的卡片。**唯讀，沒有鉛筆。**
 *
 * ADR-0020 早就寫了「先讀取，要改按鉛筆」這條規矩，但它一直只活在日曆上 ——
 *「她點一筆的十次有九次只是要確認那天幾點、誰、做什麼。直接落進表單等於每次
 * 都冒著改到東西的風險，而這一站最不能出錯的就是次數。」
 *
 * 2026-08-25 這一頁再往前收一格：連那十次裡的第十次都不在這裡做。她在客戶詳情
 * 回答的是「他還剩幾次、這個月哪天來」，排班是日曆的事，而一筆來訪有三個入口
 * 改得動，等於同一件事有三條路。見 ADR-0056。
 *
 * 卡片本身共用日曆那一支 `visitReadHtml()` —— 同一筆來訪在兩個畫面上
 * 長得不一樣，她會以為是兩種東西。
 */
function openVisitCard(ctx, visitId, slotIndex = null, taskId = null) {
  const visit = ctx.visits.find((v) => v.id === visitId);
  if (!visit) return;

  // 從一張待辦點進來：**只開它講的那幾段**（`taskSlots()`，issues/08）—— 一段就直接是那一段
  const task = taskId ? (ctx.tasks ?? []).find((t) => t.id === taskId) : null;
  const only = task ? taskSlots(task, visit, byId(ctx.courses ?? [])) : null;

  // 她點到哪一段了。「這個月」那一塊一段一顆按鈕（2026-09-12），所以這裡
  // 多半是個整數；來訪紀錄那一列與任務列的「詳情」沒有段落，進來是 null。
  //
  // **在卡片裡就地換掉**，不是關掉再開一張 —— `openCard()` 第一行就是
  // `closeCard()`，重開等於畫面閃一下（ADR-0073 為那個閃爍付過帳）。
  //
  // 那一天只有一段時，那一段就是那一天（`focusFor()`）—— 不然來訪紀錄那一列
  // 點下去會是一張只有一列的空目錄。
  let focus = focusFor(visit, slotIndex, only);

  // **這一頁不走 `fillMirror()`**：這位客戶的全部任務手上本來就有，
  // 為了同一份資料再打一次網路沒有道理（她常常在大樓裡用行動網路）。
  const body = () => visitReadHtml(visit, {
    roomsById: byId(ctx.rooms ?? []),
    staffById: byId(ctx.staff ?? []),
    coursesById: byId(ctx.courses ?? []),
    // 那一段叫什麼（`domain/naming.js`）—— 四個畫面共用同一支，
    // 少帶這一份的話這一頁會寫「復能」而日曆上寫「SIS(60)」。
    master: { courses: ctx.courses ?? [], equipment: ctx.equipment ?? [], ivProducts: ctx.ivProducts ?? [] },
    // 「這一段扣的是哪一筆」（ADR-0077）。這一頁的額度本來就在手上，
    // 不必像日曆那樣點開才去讀那一位。
    entitlementsById: byId(ctx.entitlements ?? []),
    tasks: ctx.tasks ?? [],
    today: todayISO(),
    // **她點的那一段**（ADR-0080）。沒帶的那幾條路（來訪紀錄那一列、
    // 任務列的「詳情」）進來的是一張目錄：只列那幾段讓她點。
    focusSlot: focus,
    only,
  });

  // 整筆那一個是**推導出來的**：加一段沒問過客人的進去就會退回「待確認」，
  // 而她點的可能是早上那段已經談定的（ADR-0085）。
  const sub = () => esc(describeStatus(statusForCard(visit, focus)));

  const card = openCard({
    title: shortDate(visit.date),
    subtitle: sub(),
    body: body(),
    onMount: (cardEl) => wireReadSlots(cardEl, (i) => {
      focus = i;
      card.update(body(), { subtitle: sub() });
    }),
  });
}

const byId = (rows) => Object.fromEntries((rows ?? []).map((r) => [r.id, r]));

/**
 * 「看全部」那張面板。**列的是現在那一格的全部**，不是兩格混在一起 ——
 * 抬頭要講出是哪一格，不然她分不出「這是全部」還是「這是未完成的全部」。
 *
 * 面板不在 `pageRoot(el)` 底下，委派監聽吃不到，所以自己接一次。
 */
function openAllTasks(ctx) {
  const rows = ctx.tasks.filter((t) => (taskTab === 'done' ? t.done : !t.done));
  const visitById = new Map(ctx.visits.map((v) => [v.id, v]));
  const master = {
    courses: ctx.courses ?? [], equipment: ctx.equipment ?? [], ivProducts: ctx.ivProducts ?? [],
  };
  const sheet = openSheet({
    title: `全部任務・${taskTab === 'done' ? '已完成' : '未完成'}`,
    body: `<div class="tasklist">${
      rows.map((t) => taskRow(t, visitById.get(t.visitId) ?? null, { master }))
        .join('')}</div>`,
  });
  sheet.el.querySelectorAll('[data-task]').forEach((btn) =>
    btn.addEventListener('click', () => {
      sheet.close();
      toggleTask(ctx, btn.dataset.task);
    }),
  );
  // 「詳情 ›」以前在這張面板上**畫了卻沒接**（點了沒反應，2026-09-24 排查時找到、她說接上）。
  // 卡片疊在面板上面、不先收面板 —— 同依客戶抽屜那一顆，返回鍵回到這一份清單
  sheet.el.querySelectorAll('[data-task-visit]').forEach((btn) =>
    btn.addEventListener('click', () => openVisitCard(ctx, btn.dataset.taskVisit, null, btn.dataset.taskId)),
  );
}

/**
 * 勾掉／拿回來一張任務。
 *
 * 以前這一頁寫著「要勾完成請到待辦中心，那裡可以一次勾一批」—— 那句話在
 * 解釋一個限制，而不是限制本身。在這裡勾掉一筆沒有任何壞處
 * （跟日曆上勾待辦是同一個判斷，ADR-0045），而且她人就在這個客戶身上。
 */
async function toggleTask(ctx, id) {
  const task = ctx.tasks.find((t) => t.id === id);
  if (!task) return;
  // 拿回鏈上那兩種會收掉別的張，先問一句（三個入口共用 `confirmUntick()`）
  if (!(await confirmUntick(task, !task.done))) return;
  try {
    await toast.withSaveState(() => tasksData.setDone(task, !task.done), {
      success: task.done ? '拿回來了' : '勾掉了',
    });
    reload(ctx);
  } catch {
    /* 已處理 */
  }
}
