// 來訪編輯器。SPEC 第 8.3 節。
//
// 一個客戶、一天、多個連續時段。她是在 Abovee 壓完表才回來記錄的，
// 所以這一頁的目標是「快速記錄」：時間自動接、時長自動帶、該指派什麼自動判斷。
//
// 檢查全部在 domain/visits.js。這裡只負責把 errors 擋下來、把 warnings 顯示在旁邊。
//
// 兩個進入點、一份實作（ADR-0020）：客戶那條路走路由（`renderNew` / `renderEdit`），
// 日曆走 `mountNew` / `mountEdit` 掛進抽屜裡。差別只有外框（回上一頁的連結、
// 存完去哪裡），表單、驗證、二次確認、狀態按鈕全部同一份 —— 醫療禁忌的硬性阻擋
// 只能有一個實作，兩份遲早會有一份忘記擋。

import * as customersData from '../../data/customers.js';
import * as visitsData from '../../data/visits.js';
import * as config from '../../data/config.js';
import * as tasksData from '../../data/tasks.js';
import {
  INITIAL_STATUS, describeStatus, statusClass, statusForCard, isLocked, validateVisit,
  coursesForEntitlement, courseForEquipment, picksEquipment, assignsFor,
  sameDayState, editorTarget, slotNoteOf,
  applyStatus, NOTE_MAX,
} from '../../domain/visits.js';
import { countsWithDraft, schedulable } from '../../domain/entitlements.js';
import { bookingConsequences, cancelConsequences } from '../../domain/consequences.js';
import { pairsOf, examChoicesFor } from '../../domain/followups.js';
import {
  isNthSlot, nthOf, nthLabel, nextNthFor, examChoicesForNth, courseIdForNth,
  secondFollowupIds, nthSlotFields, MIN_NTH, MAX_NTH,
} from '../../domain/nthFollowup.js';
import { isConfigured } from '../../data/sheetSync.js';
import { icon } from '../icons.js';
import { splitFlags } from '../../domain/customers.js';
import { slotName } from '../../domain/naming.js';
import * as flagsUi from '../components/flags.js';
import {
  orderedRoomSlots, staffWithRole, picksDoctor, ivChoicesFor,
  THERAPIST_ROLE, DOCTOR_ROLE,
} from '../../domain/masterData.js';
import { endOf, nextStart, isValidTime, timeLabel, DEFAULT_GAP_MIN } from '../../domain/visitTime.js';
import { todayISO, isValidDate, shortDate } from '../../domain/dates.js';
import * as f from '../components/form.js';
import * as slotNote from '../components/slotNote.js';
import { confirmAction, confirmReview } from '../components/dialog.js';
import * as toast from '../toast.js';
import { go } from '../router.js';
import { back } from '../nav.js';

const esc = f.esc;

const roomKey = (roomId, bed) => `${roomId ?? ''}|${bed ?? ''}`;

function parseRoomKey(key) {
  if (!key) return { roomId: null, bed: null };
  const [roomId, bed] = String(key).split('|');
  return { roomId: roomId || null, bed: bed || null };
}

// ---------- 進入點 ----------

export async function renderNew(el, customerId, date = null) {
  await boot(el, { customerId, date });
}

export async function renderEdit(el, visitId) {
  await boot(el, { visitId });
}

/**
 * 掛進抽屜裡的新增。`embedded` 拿掉回上一頁的連結，`onDone` 取代換頁 ——
 * 日曆上排一筆是在同一張抽屜裡完成的（ADR-0020）。
 *
 * @param {HTMLElement} el
 * @param {{customerId: string, date?: string, embedded?: boolean,
 *          onDone?: Function, onCancel?: Function}} opts
 */
export async function mountNew(el, { customerId, date = null, ...rest } = {}) {
  await boot(el, { customerId, date, ...rest });
}

/**
 * 掛進抽屜裡的修改。
 *
 * `slotIndex` = 她點的是哪一段（ADR-0085）。帶了就**只畫那一段**，
 * 也不給「＋新增一個時段」—— 她的原話是「就請讓我只能修改這一個時段的東西，
 * 而不是讓我還可以新增還可以修其他時段的東西」。
 *
 * 沒帶就照舊全部：網址那條路（`renderEdit()`）沒有段落資訊，畫成空的比
 * 畫太多糟（同 `slotsToShow()` 的兩條退路）。
 */
export async function mountEdit(el, { visitId, slotIndex = null, ...rest } = {}) {
  await boot(el, { visitId, slotIndex, ...rest });
}

async function boot(el, {
  customerId = null, visitId = null, date = null, slotIndex = null,
  embedded = false, onDone = null, onCancel = null,
}) {
  el.innerHTML = '<p class="muted">載入中…</p>';

  let ctx;
  try {
    const existing = visitId ? await visitsData.get(visitId) : null;
    if (visitId && !existing) {
      el.innerHTML = `
        ${embedded ? '' : `<a class="backlink" href="#/customers">${icon('left', { size: 17 })}客戶</a>`}
        <div class="card"><p>找不到這筆來訪，可能已經被刪除。</p></div>`;
      return;
    }

    const id = existing?.customerId ?? customerId;
    // 額度那一排丸子問的是「這一段扣哪一筆」，所以只列排得進來訪的
    //（`schedulable()`）—— 營養品扣不掉任何一段，見 ADR-0057。
    const [customer, entitlements, all, settings, customerVisits] = await Promise.all([
      customersData.get(id),
      customersData.listEntitlements(id).then(schedulable),
      config.loadAll(),
      config.getSettings(),
      visitsData.listByCustomer(id),
    ]);

    if (!customer) {
      el.innerHTML = `
        ${embedded ? '' : `<a class="backlink" href="#/customers">${icon('left', { size: 17 })}客戶</a>`}
        <div class="card"><p>找不到這位客戶。</p></div>`;
      return;
    }

    // **同一天已經有一筆就接著編輯它**（ADR-0083）。壓表那一頁一直是這樣做的，
    // 日曆這條路以前完全不查，於是同一位客戶同一天會長出兩筆獨立的來訪 ——
    // 而規則她看不出來（她 2026-09-08 問的「為什麼可以同一天再來訪一次」）。
    //
    // 收不下（那一天已經結案／取消）就照樣開新的一筆，並且講出來：
    // 那是唯一一種同一天會有第二筆的情況。
    const day = isValidDate(date) ? date : (existing?.date ?? todayISO());
    const sameDay = existing
      ? { open: null, closed: [] }
      : sameDayState(customerVisits, customer.id, day);

    // **要編哪一筆、要不要接一段新的，只有一句話**（ADR-0083）。
    // 2026-09-09 之前這裡寫成 `existing ?? merging` 再一律 `withNewSlot()`，
    // 於是**改一筆既有的來訪也會被偷偷接上一段空的** —— 那一段不會被畫出來
    // 卻會被存進去，而 `validateVisit()` 擋著說「第 N 段：要選一個課程」。
    const target = editorTarget({ existing, open: sameDay.open });
    const base = target.visit;
    const draft = base
      ? (target.addSlot ? withNewSlot(base, entitlements, all, settings) : { ...base })
      : blankVisit(customer, entitlements, all, settings, date);
    const sameDayVisits = await visitsData.listByDate(draft.date);

    ctx = {
      el, customer, entitlements, all, settings, customerVisits, sameDayVisits,
      isNew: !existing,
      // **存下去之前那一筆有幾段。** `hasNewSlots()` 拿它比 —— 時段身上沒有 id，
      // 而新的一律接在尾巴，所以段數比得出「這裡面有沒有還沒壓過的」。
      storedSlotCount: base?.slots?.length ?? 0,
      // 這一筆來訪的文件是新的嗎（存檔走 create 還是 update）。
      // **跟「有沒有新的時段」是兩件事** —— 併進既有那一筆時文件是舊的，
      // 但那一段是全新的，Abovee 那一道照樣要問。
      isNewDoc: !base,
      merged: target.merged,
      // **那一天已經結案了，這是新的一筆**（ADR-0083 決定三）。壓表那一頁
      // 早就講得出這一句，日曆這條路以前什麼都不說 —— 而那正是「同一天
      // 為什麼有兩塊」最需要一句解釋的時候。
      closedToday: target.merged || existing ? [] : sameDay.closed,
      // 哪幾段畫得出來、改得動（`isEditable()`）。
      //   改一段  → 就那一段
      //   併進來  → 只有剛剛加上去的那一段
      //   其餘    → 全部
      editSlots: existing && Number.isInteger(slotIndex) && existing.slots?.[slotIndex]
        ? [slotIndex]
        : (target.merged ? [base.slots.length] : null),
      // 「＋新增一個時段」給不給。**改一段時不給**（她要的），
      // 新增時給 —— 她 2026-09-09：「新增的時候…我希望一樣可以一次新增多筆多個時段」。
      canAddSlots: !existing,
      unlockReason: null, embedded, onDone, onCancel,
    };
    paint(ctx, draft);
  } catch (err) {
    el.innerHTML = `<div class="card"><p>讀取失敗：${esc(err.message)}</p></div>`;
  }
}

function blankVisit(customer, entitlements, all, settings, date = null) {
  const visit = {
    customerId: customer.id,
    customerName: customer.name,
    // 從日曆上點某一天新增時要帶著那一天進來 —— 她心裡想的是「這天要幫誰排」，
    // 不該回到編輯器再挑一次日期。
    date: isValidDate(date) ? date : todayISO(),
    status: INITIAL_STATUS,
    confirmedAt: null,
    cancelledAt: null,
    statusAt: null,
    cancelReason: null,
    released: null,
    note: null,
    slots: [],
  };
  const first = entitlements[0];
  if (first) visit.slots.push(blankSlot(first, all, settings, '09:00'));
  return visit;
}

function blankSlot(entitlement, all, settings, startsAt) {
  const course = coursesForEntitlement(entitlement, all.courses, all.equipment)[0] ?? null;
  const durationMin = entitlement?.durationMin ?? course?.durationMin ?? 60;
  return {
    entitlementId: entitlement?.id ?? null,
    courseId: course?.id ?? null,
    courseName: course?.name ?? null,
    equipmentId: null,
    // 買的時候就定下來的那一款先選好 —— 不選存不下去，而只有一個正確答案的
    // 時候讓她多點一下沒有任何意義（`ivChoicesFor()`）。
    ivProductId: course?.requiresIvProduct ? (entitlement?.ivProductId ?? null) : null,
    startsAt,
    endsAt: endOf(startsAt, durationMin),
    roomId: null,
    bed: null,
    therapistId: null,
    doctorId: null,
    attended: null,
    // **新加的一段一定是「還沒問客人」**（ADR-0081）。不寫的話
    // `withSlotStatuses()` 會讓它繼承整筆的狀態 —— 併進一筆已確認的來訪時，
    // 那一段會被靜默標成談定了，而她根本還沒跟客人講過這個時間。
    // 壓表那一頁的 `withExtraSlot()` 做的是同一件事。
    status: INITIAL_STATUS,
  };
}

/**
 * 既有的那一筆，尾巴接上一段空的。
 *
 * 併進同一天時走這條（`boot()`）。時間接在最後一段結束的 N 分鐘後 ——
 * 跟「＋新增一個時段」同一條算法，各算一次的話兩個入口的預設會不一樣。
 */
function withNewSlot(visit, entitlements, all, settings) {
  const slots = visit.slots ?? [];
  const last = slots[slots.length - 1];
  const gap = settings.slotGapMin ?? DEFAULT_GAP_MIN;
  const startsAt = last && isValidTime(last.endsAt) ? nextStart(last.endsAt, gap) : '09:00';
  return { ...visit, slots: [...slots, blankSlot(entitlements[0], all, settings, startsAt)] };
}

// ---------- 畫面 ----------

/** 存完、取消、刪掉之後回哪裡。抽屜裡是關掉面板，路由那條路是回客戶詳情。 */
function leave(ctx) {
  if (ctx.onDone) ctx.onDone();
  else go(`/customers/${ctx.customer.id}`);
}

function paint(ctx, draft) {
  const { el, customer, entitlements, all, customerVisits, sameDayVisits, isNew, embedded } = ctx;
  const locked = isLocked(draft.status) && !ctx.unlockReason;
  // 整筆都在畫面上嗎。`editSlots` 有值就代表只畫了其中幾段。
  //
  // 2026-09-12 起它只剩一個用途：**日期那一格給不給改**。整筆的狀態卡與
  // 危險區整塊拿掉了（ADR-0089），而網址那條路（`renderEdit()`）仍然畫得出
  // 整天那一張 —— 它沒有任何畫面上的連結，所以不算「一條路」。
  const wholeVisit = !isNew && !ctx.editSlots;

  // **抬頭那顆 badge 印她正在改的那一段的狀態**（ADR-0085）。
  //
  // 她 2026-09-10：「日曆新增來訪為什麼會出現這一天整筆的，下面那個狀態
  // 應該是這個時段的吧？」—— 整筆那一個是**推導出來的**（`visitStatusFrom()`），
  // 所以她把一段沒問過客人的併進一筆已確認的來訪時，抬頭會退回「待確認」，
  // 而她點進來改的那一段早上就談定了。
  //
  // 只畫一段的時候才印那一段的；整筆都在畫面上（或新增好幾段）時印整筆的
  // —— 那時候「這一段」沒有答案，挑一個就是在猜。
  const headSlot = ctx.editSlots?.length === 1 ? ctx.editSlots[0] : null;
  const headStatus = statusForCard(draft, headSlot);

  const { errors } = validateVisit(draft, {
    customer,
    entitlements,
    courses: all.courses,
    equipment: all.equipment,
    rooms: all.rooms,
    staff: all.staff,
    ivProducts: all.ivProducts,
    sameDayVisits,
    customerVisits,
  });

  el.innerHTML = `
    ${embedded ? '' : `
      <a class="backlink" href="#/customers/${esc(customer.id)}" data-back>${icon('left', { size: 17 })}${esc(customer.name)}</a>`}

    <section class="card ${embedded ? 'card--bare' : ''}">
      <div class="row__title">
        ${esc(customer.name)}
        <span class="badge ${statusClass(headStatus)}">${esc(describeStatus(headStatus))}</span>
        ${flagsUi.detailChips(splitFlags(customer, all.clinicalFlags), { rows: all.clinicalFlags })}
      </div>
      ${/* **提醒那一塊不在這裡了**（2026-09-09）。她的原話：「所以新增來訪的
             這個表單最上面就不需要還有一個提醒了」—— 那幾句話改成存檔前
             跳一道（`submit()`），而且只在真的有話要講的時候跳。
             errors 留著：那是擋著不讓存的，不是提醒。 */''}
      <div class="errors" data-errors hidden></div>
    </section>

    ${locked ? lockedCard(embedded) : ''}

    <form data-form ${locked ? 'inert' : ''}>
      ${/* **「記一句」不在這裡了**（ADR-0084）。它搬到每一段身上，收在那一段
             抬頭列右邊那顆夾板後面 —— 她 2026-09-09：「我希望是每一筆都可以有
             他的記一句，而不要是一整天的」。 */''}
      ${closedNote(ctx)}
      ${/* **只改一段時日期不給改**（ADR-0085）。日期是整筆的 —— 改了那一天
             剩下那幾段也跟著搬，而她點進來要改的只有這一段。要整天改期就是
             取消 + 重排（SPEC 第 7 節規則 10）。 */''}
      ${wholeVisit || isNew ? `
        <section class="card ${embedded ? 'card--bare' : ''}">
          ${f.date({ name: 'date', label: '來訪日期', value: draft.date })}
        </section>` : ''}

      ${/* **只畫改得動的那幾段**（ADR-0085）。她從日曆點的是一段，那就只有
             那一段；併進既有那一天時只有剛加上去的那一段。其餘原封不動地
             跟著 `readDraft()` 走 —— 「這一天還有另外幾段」一個字都不講，
             她 2026-09-09 明確說不需要知道。 */''}
      ${draft.slots
        .map((slot, i) => (isEditable(ctx, i) ? slotCard(ctx, draft, slot, i) : ''))
        .join('')}

      ${ctx.canAddSlots ? `
        <section class="card ${embedded ? 'card--bare' : ''}">
          <p><button class="btn" type="button" data-add-slot>＋ 新增一個時段</button></p>
        </section>` : ''}

      <section class="card ${embedded ? 'card--bare' : ''}">
        <div class="form__actions">
          <button class="btn btn--primary" type="submit">${hasNewSlots(ctx, draft) ? '記錄這次來訪' : '儲存'}</button>
          <button class="btn" type="button" data-cancel-edit>取消</button>
        </div>
        ${/* 「上面紅色的問題要先處理才存得下去」拿掉了（2026-09-09）——
               紅色的那幾行自己就在說這件事，而她要的是少一點字。 */''}
      </section>
    </form>

    ${/* **整筆的那幾顆一顆都不畫了**（2026-09-12，ADR-0089）。

           2026-09-10 那一版是「帶了 slotIndex 就不畫」（ADR-0085／0088），
           而第二條路是日曆讀取卡片底下那一顆「改這一天」。她 2026-09-12 說
           那一顆也不要：「如果要改我也會一項一項改」，而追問「改整天的日期」
           與「刪除這一天」要不要留路時回答「整個拿掉，兩件事都不要了」。

           取消一整天的第二條路是**壓表的批次取消**（ADR-0082）——
           她自己指的那一條：「我可以從壓表那邊刪」。整筆的狀態仍然改得動的
           只剩逐段：長按某一列的「取消這一段」，以及簽療程單那條逐段的路。 */''}`;

  el.querySelector('[data-back]')?.addEventListener('click', (e) => {
    e.preventDefault();
    back(`/customers/${customer.id}`);
  });
  el.querySelector('[data-cancel-edit]').addEventListener('click', () =>
    (ctx.onCancel ? ctx.onCancel() : go(`/customers/${customer.id}`)),
  );

  const form = el.querySelector('[data-form]');
  f.wireChips(form);
  // 展開那一句話。`form` 每次 `paint()` 都被換掉，所以不必給 signal。
  slotNote.wire(form);

  form.addEventListener('change', async (e) => {
    // 那幾句話不影響畫面上算出來的任何東西，所以不要為了它們重畫。
    // 重畫會在她打完字、手指正要按下「儲存」的那一刻把那顆按鈕換掉 ——
    // 按下去與放開落在兩個不同的元素上，那一下就不算數（其餘欄位都是用點的，
    // 點完本來就會重畫，碰不到這個問題）。
    //
    // **2026-09-09 起是逐段的**（`s0-note`、`s1-note`…，ADR-0084）。
    // 只比 `=== 'note'` 的話那個豁免會整個失效，而症狀是「打完字按儲存沒反應」。
    if (/^s\d+-note$/.test(e.target.name ?? '')) return;

    const next = readDraft(ctx, form, draft);
    if (e.target.name === 'date' && next.date !== draft.date) {
      try {
        ctx.sameDayVisits = await visitsData.listByDate(next.date);
      } catch {
        ctx.sameDayVisits = [];
      }
    }
    paint(ctx, next);
  });

  el.querySelector('[data-add-slot]')?.addEventListener('click', () => {
    const next = withNewSlot(readDraft(ctx, form, draft), entitlements, all, ctx.settings);
    // 新加的那一段當然要畫得出來 —— 併進既有那一天時 `editSlots` 是一份名單，
    // 不接上去的話她按了「新增一個時段」而畫面上什麼都不會多。
    if (ctx.editSlots) ctx.editSlots = [...ctx.editSlots, next.slots.length - 1];
    paint(ctx, next);
  });

  el.querySelectorAll('[data-del-slot]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const next = readDraft(ctx, form, draft);
      next.slots.splice(Number(btn.dataset.delSlot), 1);
      paint(ctx, next);
    }),
  );

  // 既有的來訪：那一格真的在 Abovee 上壓過，所以是**取消**不是刪掉（ADR-0081）。
  // 走的是跟日曆長按選單同一支 `applyStatus()` 與同一份後果說明 ——
  // 兩邊各寫一次的話遲早有一邊少講一句。
  el.querySelectorAll('[data-cancel-slot]').forEach((btn) =>
    btn.addEventListener('click', () => cancelOneSlot(ctx, draft, Number(btn.dataset.cancelSlot))),
  );

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit(ctx, readDraft(ctx, form, draft));
  });

  // 第一次送出之後才顯示 errors —— 一打開就滿江紅只會讓人不想看
  if (ctx.submitted) f.showErrors(el, errors);

  if (locked) wireUnlock(ctx, draft);
}


/**
 * 「那一天已經結案了，這是新的一筆」。
 *
 * 只有一種情況會出現（ADR-0083 決定三）：她從日曆替某位客戶排某一天，
 * 而那一天既有的那一筆已經標成已完成或未到 —— 那時候併不進去，只能開新的。
 *
 * **這是唯一一句「說明文字」在這一輪被加回來的地方**，而它過得了
 * issue 11 的判準：不講的話她會在日曆上看到同一天兩塊，而畫面什麼都沒說。
 */
function closedNote(ctx) {
  const rows = ctx.closedToday ?? [];
  if (!rows.length) return '';

  const what = [...new Set(rows.map((v) => describeStatus(v.status)))].join('、');
  return `
    <section class="card ${ctx.embedded ? 'card--bare' : ''}">
      <p class="field__hint" style="margin: 0">
        ${esc(shortDate(rows[0].date))} 那一天已經是「${esc(what)}」了，所以這是另外一次來訪。
      </p>
    </section>`;
}

/**
 * 一個時段。
 *
 * **選項一律用丸子，不是下拉選單**（2026-08-24）。SPEC 第 8.2 節寫的
 * 「課程／時段／器材／治療師／診間全部用點的，備註才要打字」與第 8.3 節那張
 * 範例圖畫的本來就是丸子 —— 實作用了 `<select>` 是從一開始就沒照規格做。
 * 理由與作法見 `ui/components/form.js` 的 `chips()`。
 *
 * **時間合成一行**（`10:30 – 11:30`）：結束時間本來就是算出來的，
 * 拆成兩個上下疊的欄位等於用兩行講一件事。那句「依 XX 的時長自動算」也拿掉了
 * —— 改了左邊右邊就動，那是看得出來的。
 */
function slotCard(ctx, draft, slot, i) {
  const { entitlements, all, customerVisits, customer, embedded } = ctx;
  const nth = isNthSlot(slot);
  const ent = nth ? null : (entitlements.find((x) => x.id === slot.entitlementId) ?? null);
  // n返 借二返那個課程，所以課程那一排不用出現（只有一個選項，而且她選不了別的）
  // 擇一池的課程是從器材推出來的（ADR-0075），所以那一排不出現 ——
  // 她選的是器材，課程跟著走。
  const courseChoices = nth || ent?.type === 'pool'
    ? []
    : coursesForEntitlement(ent, all.courses, all.equipment);
  const course = all.courses.find((c) => c.id === slot.courseId) ?? null;
  const assigns = assignsFor(ent, course, slot.equipmentId);
  const nthExams = nthExamChoices(ctx, draft);

  return `
    <section class="card slotcard ${embedded ? 'card--bare' : ''}">
      <div class="slothead">
        <div class="slothead__time">
          <input type="time" name="s${i}-start" value="${esc(slot.startsAt ?? '')}"
                 step="${f.timeStepFor(slot.startsAt)}"
                 aria-label="第 ${i + 1} 段的開始時間" />
          <span class="slothead__dash">–</span>
          <span class="slothead__end num">${esc(slot.endsAt ?? '—')}</span>
        </div>
        ${/* 剩餘次數不寫在這裡：正下方那一排額度丸子上，被選中的那一顆
             已經寫著「復能 剩 11」。同一個數字在相隔 30px 的地方寫兩次，
             省下來的空間剛好夠課程名待在同一行（SPEC 第 8.3 節那張圖）。 */''}
        ${/* n返 的名字不在主檔上（它借二返那個課程），所以照返數印 */''}
        ${nth
          ? `<span class="slothead__what">${esc(nthLabel(nthOf(slot)) ?? 'n返')}</span>`
          : (course
            ? `<span class="slothead__what">${esc(slotName(slot, all, 'short'))}</span>`
            : '<span class="app__spacer"></span>')}
      </div>

      ${/* 右上角那兩顆。**記一句排在 × 前面** —— 破壞性的那一顆永遠在最外側
             （同 `visitActions()` 的規矩），而她的拇指是從右邊進來的。 */''}
      <div class="slotcard__tools">
        ${slotNote.toggle({ name: `s${i}-note`, on: Boolean(slotNoteOf(draft, slot)) })}
        ${slotXButton(ctx, draft, slot, i)}
      </div>

      ${slotNote.html({ name: `s${i}-note`, value: slotNoteOf(draft, slot), maxlength: NOTE_MAX })}

      ${slot.status === 'cancelled' ? `
        <p class="field__hint" style="margin: 0 0 var(--space-3)">
          這一段取消了 —— 時段退回去了，次數也還回來了。那一天剩下的照舊。
        </p>` : ''}

      ${f.chips({
        name: `s${i}-ent`, label: '額度', value: nth ? NTH_PICK : slot.entitlementId,
        options: [
          ...entitlements.map((e) => {
            // **把手上這一份草稿也算進去**（她 2026-09-08）：她只有 1 堂
            // INDIBA 卻在同一張表單裡排了兩段時，第二顆丸子要寫「剩 0」。
            // 走的是跟 `entitlementWarnings()` 同一支 —— 各組一次的話
            // 兩個地方會給出不一樣的數字。
            const c = countsWithDraft(e, customerVisits, draft, e.id);
            return { value: e.id, label: e.label, note: `剩 ${c.remaining}` };
          }),
          // **n返 不是一筆額度**（`domain/nthFollowup.js` 的檔頭）——
          // 它排在同一排是因為她在這裡問的是「這一段是什麼」，而那一排就是
          // 回答那個問題的地方。前面插一條線與一個小標，因為滑到底看到的
          // 那一顆是另一種東西（`chips()` 的 `lead`）。
          //
          // **一個健檢都沒有時整顆不畫**，不是畫成 disabled ——
          // 一顆永遠按不下去的丸子只會讓她每次都試一下。
          ...(nthExams.length
            ? [{ value: NTH_PICK, label: '＋ n返', note: '不扣次數', lead: '加約' }]
            : []),
        ],
      })}

      ${nth ? nthFields(ctx, draft, slot, i, nthExams) : ''}

      ${/* 只有一個選項時不畫丸子（一顆孤零零的丸子看起來像可以取消），
             課程名由上面那一行的抬頭講 —— SPEC 第 8.3 節那張圖就是
             `10:30–11:30  物理賦能  剩 11/12`。 */''}
      ${/* **判準是「不到兩個選項就不畫」。** 兩種情況都收在這一句話裡：
             n返 沒有課程可以挑（它借二返那一個），擇一池的課程由器材推出來
             （ADR-0075）—— 兩者算出來都是空陣列。

             2026-09-09 之前這裡問的是 `=== 1`，於是空陣列走進去畫了一個
             「課程」標籤加一列什麼都沒有的丸子（她 2026-09-08 回報的
             「為什麼會多一個空白的課程」）。`f.chips()` 現在自己也擋一層。 */''}
      ${nth || courseChoices.length <= 1
        ? ''
        : f.chips({
            name: `s${i}-course`, label: '課程', value: slot.courseId,
            options: courseChoices.map((c) => ({ value: c.id, label: c.name })),
          })}

      ${picksEquipment(ent, course) ? equipmentField(customer, ent, all, slot, i) : ''}
      ${course?.requiresIvProduct ? ivField(ent, all, slot, i) : ''}

      ${/* 要治療師還是治療室，由她挑的那一台器材推出來（ADR-0075）。挑之前
             那個問題沒有答案，所以兩排都不畫、只留一句話 —— 壓表那一頁走的是
             同一支 `assignsFor()`，兩邊各判斷一次會出現「畫面上要她選治療師、
             存進去的卻是一段要診間的 ILIB」。 */''}
      ${assigns === null ? f.undecidedHint(ent?.label) : ''}
      ${assigns === 'room' ? roomField(all, course, slot, i) : ''}
      ${assigns === 'therapist'
        ? f.chips({
            name: `s${i}-staff`, label: '治療師', value: slot.therapistId, quiet: true,
            options: staffWithRole(all.staff, THERAPIST_ROLE)
              .map((x) => ({ value: x.id, label: x.name })),
            // 一個治療師都沒有時要講出為什麼 —— 空的那一排整個消失的話，
            // 她會以為這一段不用選人。壓表那一頁講的是同一句話。
            hint: staffWithRole(all.staff, THERAPIST_ROLE).length
              ? ''
              : '主檔裡還沒有治療師，到「設定 → 治療師與醫師」新增。',
          })
        : ''}
      ${picksDoctor(course) ? doctorField(all, slot, i) : ''}
      ${examField(ctx, draft, ent, slot, i)}
    </section>`;
}

/**
 * 那一段右上角那顆 ×。**新的來訪與既有的來訪意思不一樣。**
 *
 * - **還沒存過**（`isNew`）：整段拿掉就好。它從來沒有被壓過，沒有東西要收。
 * - **已經存過**：那一格是**真的在 Abovee 上壓過**的，所以 × 是
 *   「取消這一段」不是「刪掉這一段」（ADR-0081）。刪掉的話沒有紀錄它
 *   曾經被壓過，也不會長出「取消 Abovee」—— 那正是確認動線修掉的同一個 bug。
 *
 * 已經取消掉的那一段不再給 × ：它已經是終點了。
 * 只有一段時也不給 —— 要取消整筆走底下的狀態卡，那裡問得比較清楚。
 */
function slotXButton(ctx, draft, slot, i) {
  if (draft.slots.length <= 1 || slot.status === 'cancelled') return '';

  // **逐段問，不是問整筆。** 併進既有那一天時這張表單上同時有兩種段：
  // 前面那幾段真的在 Abovee 上壓過（× 是取消），剛剛加上去的那一段
  // 連存都還沒存過（× 是移除）。問 `ctx.isNew` 的話後者會走進取消那條路，
  // 而 `applyStatus()` 會替一段從來不存在的時段長出一張「取消 Abovee」。
  const stored = i < (ctx.storedSlotCount ?? 0);
  const [attr, label] = stored
    ? ['data-cancel-slot', `取消第 ${i + 1} 段`]
    : ['data-del-slot', `移除第 ${i + 1} 段`];

  return `<button class="slothead__x" type="button" ${attr}="${i}"
                  aria-label="${esc(label)}">${icon('close', { size: 15, width: 2 })}</button>`;
}

/**
 * 額度那一排上「n返」那一顆的值。**不是任何一筆額度的 id** ——
 * 它只活在表單裡，`readDraft()` 讀到它就換一條路組時段。
 *
 * 前綴那兩條底線是刻意的：Firestore 的自動 id 是 20 個 [A-Za-z0-9] 字元，
 * 撞不到。
 */
const NTH_PICK = '__nth__';

/** 這位客戶有哪幾次健檢接得了 n返。一段一段都問同一支，答案一樣。 */
function nthExamChoices(ctx, draft) {
  return examChoicesForNth({
    entitlements: ctx.entitlements,
    coursesById: Object.fromEntries(ctx.all.courses.map((c) => [c.id, c])),
    visits: ctx.customerVisits,
    excludeVisitId: draft?.id ?? null,
  });
}

/**
 * n返 的兩排：第幾返、哪一次健檢的。
 *
 * 跟二返那一排（`examField()`）刻意長得不一樣的地方只有一個：
 * **一個候選都不會被鎖住**。二返是一對一，所以被別的二返認領掉的那幾次
 * 點不下去；n返 沒有上限，每一次健檢都可以再約一場。已經有幾返照樣標出來
 * —— 她要對照的正是那個。
 *
 * 兩排都 `quiet`：換這兩顆不影響任何別的欄位，重畫只會讓她捲回最上面
 * （ADR-0038）。
 */
function nthFields(ctx, draft, slot, i, choices) {
  const picked = nthOf(slot) ?? MIN_NTH;

  const numbers = [];
  for (let n = MIN_NTH; n <= MAX_NTH; n += 1) numbers.push(n);

  return `
    <div class="nthfields">
    ${f.chips({
      name: `s${i}-nth`, label: '第幾返', value: String(picked), quiet: true,
      options: numbers.map((n) => ({ value: String(n), label: nthLabel(n) })),
      hint: '二返是健檢做完一定會有的那一次，在上面那一排選它的額度。這裡是加約的。',
    })}

    ${choices.length
      ? f.chips({
          name: `s${i}-exam-nth`, label: '這是哪一次健檢的', quiet: true,
          value: slot.followupForVisitId ?? null,
          options: choices.map((c) => ({
            value: c.visitId,
            label: shortDate(c.date),
            // 已經有幾返了。**不寫「還沒約」** —— 那三個字是二返那一排的，
            // 兩個地方講不同的事會讓她以為是同一件。
            note: c.note,
          })),
          hint: '一定要選 —— 沒有它，試算表上這一場沒有位置可以印。',
        })
      : `<div class="fieldgroup">
           <span class="fieldgroup__label">這是哪一次健檢的</span>
           <p class="muted" style="margin: 0">還沒有做完的健檢可以接。先把那一次健檢結案。</p>
         </div>`}
    </div>`;
}

/**
 * 「這是哪一次健檢的二返」。只有二返那一筆額度會冒出這一排。
 *
 * 跟壓表那一頁是同一組候選（`domain/followups.js` 的 `examChoicesFor()`）——
 * 兩邊各算一次的話，同一段在壓表選得到、回來改就選不到了。
 *
 * `quiet: true`：換這一顆不影響任何別的欄位，重畫只會讓她捲回最上面（ADR-0038）。
 */
function examField(ctx, draft, ent, slot, i) {
  if (!ent?.followupForEntitlementId) return '';

  const coursesById = Object.fromEntries(ctx.all.courses.map((c) => [c.id, c]));
  const pair = pairsOf(ctx.entitlements, coursesById).find((x) => x.followup?.id === ent.id);
  if (!pair) return '';

  const choices = examChoicesFor(pair, ctx.customerVisits, {
    selected: slot.followupForVisitId ?? null,
    excludeVisitId: draft?.id ?? null,
  });

  if (!choices.length) {
    return `
      <div class="fieldgroup">
        <span class="fieldgroup__label">這是哪一次健檢的</span>
        <p class="muted" style="margin: 0">還沒有做完的健檢可以接。</p>
      </div>`;
  }

  return f.chips({
    name: `s${i}-exam`, label: '這是哪一次健檢的', value: slot.followupForVisitId ?? null,
    quiet: true,
    options: choices.map((c) => ({
      value: c.visitId,
      label: shortDate(c.date),
      disabled: c.taken,
      note: c.taken ? '已約' : '',
    })),
    hint: '還沒定也存得下去，但試算表的二返註記要靠它才寫得出日期。',
  });
}

/** 擇一池的器材。被禁忌擋掉的要留在原位標示出來，不能整個消失。 */
/**
 * 營養點滴的品項。
 *
 * **預設就是她買的那一款**，其餘的收在「換一款」後面 ——
 * 哪幾顆、誰在前面只寫在 `domain/masterData.js` 的 `ivChoicesFor()`，
 * 壓表那一頁讀的是同一支。真的換了會有一句提醒（`assignmentWarnings()`）。
 */
function ivField(ent, all, slot, i) {
  const { bought, primary, others } = ivChoicesFor(ent, all.ivProducts);
  const options = [...primary, ...others].map((p) => ({ value: p.id, label: p.name }));

  // **這一排刻意不是 quiet 的**（器材、治療師、診間那幾排是）。換了品項會多出
  // 一句「跟買的不一樣」，而那一句由 `assignmentWarnings()` 算、畫在整張表的
  // 上方 —— 不重畫就看不到它。訊息只有一份，所以只能用重畫換
  //（在這裡自己再寫一句，就是第二份會跟 domain 分岔的文案）。
  return f.chips({
    name: `s${i}-iv`, label: '營養點滴品項', value: slot.ivProductId,
    options,
    // 有買的那一款才收：沒有的話全部都是平等的候選，收起來只是把選項藏掉。
    tuckAfter: bought ? primary.length : null,
  });
}

/**
 * 器材那一排。**沒有一顆是關著的**（ADR-0074）—— 她在診間裡看得到儀器擺在哪，
 * app 看不到。要提醒的那幾台照樣點得下去，點下去底下才跳一句。
 *
 * 那一句走 `flagsUi.noticeBlock()`，跟壓表的記錄面板共用同一支。
 * 這一頁換丸子會整張重畫，所以不用另外接一段就地換字。
 */
function equipmentField(customer, ent, all, slot, i) {
  const options = ent?.type === 'pool'
    ? (ent.optionEquipmentIds ?? [])
      .map((id) => all.equipment.find((e) => e.id === id))
      .filter(Boolean)
    : all.equipment;

  return `
    ${f.chips({
      name: `s${i}-equip`, label: '器材', value: slot.equipmentId,
      options: options.map((eq) => ({ value: eq.id, label: eq.name })),
    })}
    ${flagsUi.noticeBlock({
      customer,
      equipment: options.find((eq) => eq.id === slot.equipmentId) ?? null,
      options,
      size: 16,
    })}`;
}

/**
 * 二返這一類要選醫師的課程。和器材、品項那兩個選單長一樣，用點的不打字。
 *
 * **只列角色是醫師的人。** 混進治療師會讓她在復能之外的地方也點錯人，
 * 而那兩個詞在 CONTEXT.md 是刻意分開的。
 *
 * 沒選不會擋 —— 她的舊表寫過 `二返(8/5)`，時間敲定了、醫師還沒定，
 * 那是真的會發生的順序。存得下去，旁邊給一句提醒（domain/visits.js）。
 */
function doctorField(all, slot, i) {
  const doctors = staffWithRole(all.staff, DOCTOR_ROLE);
  return f.chips({
    name: `s${i}-doc`, label: '醫師　還沒定也存得下去', value: slot.doctorId, quiet: true,
    options: [
      { value: null, label: '還沒定' },
      ...doctors.map((d) => ({ value: d.id, label: d.name })),
    ],
    hint: doctors.length ? '' : '主檔裡還沒有醫師，到「設定 → 治療師與醫師」新增。',
  });
}

function roomField(all, course, slot, i) {
  // 排好序、每一顆帶著「排不排得進去」的那一份，只算在 `orderedRoomSlots()`
  //（她 2026-09-08 要的「優先置頂」：EECP 是治5、治8，ILIB 是 `.10`、治2、治3）。
  // 壓表那一頁走的是同一支 —— 兩邊各排一次的話，同一個課程在兩個畫面上
  // 第一顆丸子不一樣，她不會知道哪個算數。
  //
  // 排不進去的不藏起來（她偶爾真的會排到別間），但要標出來 ——
  // 診間有十七間，排錯順序等於每次都要從頭掃。
  const options = orderedRoomSlots(course, all.rooms).map((s) => ({
    value: roomKey(s.roomId, s.bed),
    label: s.label,
    note: s.usual ? '' : '不常用',
  }));

  // **比的是診間，不是診間＋床位**（2026-09-08）。床位那一層取消之後選項上
  // 只有 `r-iv8|`，而舊來訪身上是 `r-iv8|A` —— 拿它去比的話一顆都不會按著，
  // 而她一存檔那一段的診間就被清成 null 了（畫面上什麼都不會說）。
  // 存回去時 `bed` 跟著變成 null，那正是她要的「連舊資料一起清掉」。
  return f.chips({
    name: `s${i}-room`, label: '診間', quiet: true,
    value: slot.roomId ? roomKey(slot.roomId, null) : null,
    options,
  });
}

// ---------- 讀回表單 ----------

function readDraft(ctx, form, draft) {
  const v = f.readForm(form);
  const { entitlements, all } = ctx;

  const coursesById = Object.fromEntries(all.courses.map((c) => [c.id, c]));

  const slots = draft.slots.map((slot, i) => {
    // **沒有被畫出來的那幾段一個欄位都不碰**（ADR-0085）。
    //
    // 底下那一段是靠 `key()` 保留原值的：欄位沒畫出來時 `v[...]` 是
    // `undefined`，`key()` 就退回舊值。但那只有**列得出名字的欄位**受保護，
    // 而那一段身上還有 `attended`、`status`、`followupNth` 這些沒有欄位的格子
    // —— 它們會被 `...slot` 帶過去，卻擋不住底下那幾行寫死的 `null`
    // （`equipmentId`、`therapistId`、`followupNth` 都有）。
    //
    // 所以整段回原本那一個物件，不是「小心地重組一份一樣的」。
    if (!isEditable(ctx, i)) return slot;

    const entitlementId = key(v, `s${i}-ent`, isNthSlot(slot) ? NTH_PICK : slot.entitlementId);

    // n返 走另一條路：沒有額度、沒有課程可以挑（借二返那個），
    // 但多了返數與「哪一次健檢的」。形狀由 `nthSlotFields()` 給，
    // 三個入口共用同一支 —— 各自組一次的話遲早有一個忘了把
    // `entitlementId` 設成 null，而那一段會被算進某一筆額度的次數裡。
    if (entitlementId === NTH_PICK) {
      return readNthSlot({ v, i, slot, ctx, coursesById });
    }

    const ent = entitlements.find((x) => x.id === entitlementId) ?? null;

    // 換了額度就要重挑課程，舊的課程可能根本不屬於新的額度
    const choices = coursesForEntitlement(ent, all.courses, all.equipment);
    let courseId = key(v, `s${i}-course`, slot.courseId);
    if (choices.length === 1) courseId = choices[0].id;
    else if (!choices.some((c) => c.id === courseId)) courseId = null;

    // **擇一池的課程由器材決定**（ADR-0075）：四選一選到 ILIB 那一段算 ILIB
    // （要診間），其餘三台算復能（要治療師）。推不出來就維持原來的 ——
    // 清成 null 的話那一段存不下去，而她只是還沒挑器材。
    const equipmentId = v[`s${i}-equip`] ?? slot.equipmentId ?? null;
    if (ent?.type === 'pool') {
      courseId = courseForEquipment(equipmentId, all.equipment, courseId ?? choices[0]?.id ?? null);
    }

    const course = all.courses.find((c) => c.id === courseId) ?? null;
    // 畫欄位那一邊走的是同一支（`slotCard()`）—— 兩邊各判斷一次的話，
    // 會出現「畫面上沒有診間那一排、存進去卻帶著一個舊的 roomId」。
    const assigns = assignsFor(ent, course, equipmentId);
    const startsAt = v[`s${i}-start`] || slot.startsAt;
    const durationMin = ent?.durationMin ?? course?.durationMin ?? 60;

    return {
      ...slot,
      entitlementId,
      courseId,
      courseName: course?.name ?? null,
      equipmentId: picksEquipment(ent, course) ? (v[`s${i}-equip`] ?? null) : null,
      ivProductId: course?.requiresIvProduct ? (v[`s${i}-iv`] ?? null) : null,
      startsAt,
      endsAt: isValidTime(startsAt) ? endOf(startsAt, durationMin) : slot.endsAt,
      // 那一段身上那一句話（ADR-0084）。收起來的時候 textarea 照樣在 DOM 裡，
      // 所以讀得到 —— `hidden` 的是包住它的 `<label>`。
      note: String(key(v, `s${i}-note`, slot.note ?? '') ?? '').trim() || null,
      ...(assigns === 'room'
        ? parseRoomKey(v[`s${i}-room`])
        : { roomId: null, bed: null }),
      therapistId: assigns === 'therapist' ? (v[`s${i}-staff`] ?? null) : null,
      doctorId: picksDoctor(course) ? (v[`s${i}-doc`] ?? null) : null,
      // 不是二返就一定是 null —— 帶著一個不相干的 id 會讓試算表把註記
      // 寫到別人底下。沒被畫出來時 `v[...]` 是 undefined，那時要留原值
      // 不要清成 null（同這一支的 `key()`）。
      followupForVisitId: ent?.followupForEntitlementId
        ? key(v, `s${i}-exam`, slot.followupForVisitId ?? null)
        : null,
      // **她把這一段從「n返」改回一筆額度了。** `...slot` 會把 `followupNth`
      // 原封不動帶過來，而帶著它的那一段會同時被算進那筆額度的次數、
      // 又被畫成一場三返 —— 存檔時 `validateVisit()` 會擋（「不可以同時指定
      // 額度」），但她看到的是一個莫名其妙的錯誤訊息。清乾淨是這裡的事。
      followupNth: null,
    };
  });

  return {
    ...draft,
    date: v.date || draft.date,
    // **整筆那一句不再從表單讀** —— 那個欄位 2026-09-09 拿掉了（ADR-0084）。
    // 舊資料的值靠 `...draft` 原封帶著，由 `save()` 的 `withSlotNotes()`
    // 搬到第一段。在這裡清成 null 的話，她只是打開改個時間就把那句話弄丟了。
    slots,
  };
}

/**
 * 一段 n返 讀回來。
 *
 * 時間、醫師、診間跟一般時段一樣走同一組欄位（課程是二返那一個，
 * 所以 `assigns` 與 `picksDoctor()` 都答得出來）；差別只有前面那三樣。
 */
function readNthSlot({ v, i, slot, ctx, coursesById }) {
  const { entitlements, all, customerVisits } = ctx;
  const examVisitId = key(v, `s${i}-exam-nth`, slot.followupForVisitId ?? null);
  const exam = customerVisits.find((x) => x.id === examVisitId) ?? null;
  const nth = Number(key(v, `s${i}-nth`, nthOf(slot) ?? MIN_NTH));

  const courseId = exam
    ? courseIdForNth(exam, entitlements, coursesById)
    // 還沒選健檢時課程也還不知道 —— 沿用原本那一個（改一段既有的 n返 時
    // 它已經對了）。存檔會被 `validateVisit()` 擋下來並講出是哪一格沒選。
    : (slot.courseId ?? null);
  const course = all.courses.find((c) => c.id === courseId) ?? null;

  const startsAt = v[`s${i}-start`] || slot.startsAt;
  const durationMin = course?.durationMin ?? 30;

  return {
    ...slot,
    ...nthSlotFields({ nth, examVisitId, courseId }),
    note: String(key(v, `s${i}-note`, slot.note ?? '') ?? '').trim() || null,
    equipmentId: null,
    ivProductId: null,
    startsAt,
    endsAt: isValidTime(startsAt) ? endOf(startsAt, durationMin) : slot.endsAt,
    ...(assignsFor(null, course, null) === 'room'
      ? parseRoomKey(v[`s${i}-room`])
      : { roomId: null, bed: null }),
    therapistId: null,
    doctorId: picksDoctor(course) ? (v[`s${i}-doc`] ?? null) : null,
  };
}

/**
 * 這一張表單裡有沒有**還沒被壓過**的時段。
 *
 * Abovee 那一道確認（SPEC 第 7 節規則 11）以前問的是 `isNew` —— 那是
 * 「這筆來訪的文件是新的嗎」。併進既有那一天之後那個問題就答錯了：
 * 文件是舊的、而那一段是全新的，她**確實**要先去 Abovee 把它壓住。
 *
 * 順手補上一個一直都在的洞：既有那一筆按「＋新增一個時段」加一段，
 * 以前一道確認都沒有。
 *
 * 判準是 `slot.id` 之外唯一站得住的東西：**存下去之前它就在文件裡了嗎**。
 * 時段沒有 id，所以拿「原本那一筆有幾段」比 —— 新的一律接在尾巴
 * （`withNewSlot()` 與「＋新增一個時段」都是），所以索引比得出來。
 */
function hasNewSlots(ctx, draft) {
  const before = ctx.storedSlotCount ?? 0;
  return (draft.slots ?? []).length > before;
}

/**
 * 這一段現在編輯得動嗎。
 *
 * `ctx.editSlots` 是**哪幾段畫得出來**：
 *
 * - `null`　　　全部（網址那條路進來的、以及一筆全新的來訪）
 * - `[2]`　　　她從日曆點的那一段（ADR-0085）
 * - `[3, 4]`　　併進既有那一天時，只有新加的那幾段
 *
 * 判斷只有這一支，畫欄位與讀回表單走同一句話 —— 兩邊各判斷一次的話，
 * 會出現「畫面上沒有那一段、存進去卻把它清掉了」。
 */
function isEditable(ctx, i) {
  return !ctx.editSlots || ctx.editSlots.includes(i);
}

// 沒被畫出來的欄位讀回來是 undefined，那時要保留原值而不是清成 null
function key(values, name, fallback) {
  return name in values ? values[name] : fallback;
}

// ---------- 儲存 ----------

async function submit(ctx, draft) {
  const { el, customer, entitlements, all, customerVisits, sameDayVisits } = ctx;
  ctx.submitted = true;

  const { errors, warnings } = validateVisit(draft, {
    customer, entitlements,
    courses: all.courses, equipment: all.equipment, rooms: all.rooms,
    staff: all.staff, ivProducts: all.ivProducts,
    sameDayVisits, customerVisits,
  });
  f.showErrors(el, errors);
  if (errors.length) {
    el.querySelector('[data-errors]')?.scrollIntoView({ block: 'center' });
    return;
  }

  // **第一道：這幾段先看一下。** 超過次數、還沒選治療師那一類。
  // 只在真的有東西要講的時候跳（她 2026-09-08：「如果沒有就可以不用提醒」）。
  // 句子照抄 `validateVisit()` 的 —— 在這裡重寫一遍等於同一件事兩種說法。
  if (!await confirmReview(warnings)) return;

  // SPEC 第 7 節規則 11：標記已壓表時要問這一句。app 看不到那幾個系統，
  // 這道確認就是她手寫的那兩個驚嘆號。
  //
  // 抬頭與後果由 `domain/consequences.js` 算：這裡以前寫死「Abovee」，
  // 而健檢壓的是 Examine ——「在哪壓」早就答得出來（`bookingSystemFor()`），
  // 只是沒有人用它。壓表那一頁走的是同一支。
  if (hasNewSlots(ctx, draft)) {
    const said = bookingConsequences({
      visit: draft,
      coursesById: Object.fromEntries(all.courses.map((c) => [c.id, c])),
      sheetSyncOn: isConfigured(ctx.settings),
    });
    const ok = await confirmAction({
      title: said.title,
      consequences: [
        // **只列這一次新加的那幾段。** 併進既有那一天時，前面那幾段她早就
        // 壓過也早就問過客人了，列出來會讓這一道看起來像在問全部。
        ...draft.slots.slice(ctx.storedSlotCount ?? 0).map((s) => slotSummary(s, all)),
        ...said.lines,
      ],
      confirmLabel: '已確認，記錄',
    });
    if (!ok) return;
  }

  const payload = ctx.unlockReason
    ? { ...draft, lastCorrection: { at: new Date().toISOString(), reason: ctx.unlockReason } }
    : draft;

  try {
    // 存一筆來訪會動到額度的計數欄位，做兩次就多扣一次（新增的那條路有二次確認
    // 擋著，改的那條沒有）。同一位客戶的同一天鎖在一起就夠了。
    const id = await toast.withSaveState(() => visitsData.save(payload, customerVisits), {
      success: hasNewSlots(ctx, draft) ? '已記錄' : '已儲存',
      key: `visit:save:${payload.id ?? `${payload.customerId}:${payload.date}`}`,
    });
    leave(ctx);
    return id;
  } catch {
    return null; /* withSaveState 已顯示錯誤與重試 */
  }
}

function slotSummary(slot, all) {
  const room = all.rooms.find((r) => r.id === slot.roomId);
  const staff = all.staff.find((s) => s.id === slot.therapistId);
  const doctor = all.staff.find((s) => s.id === slot.doctorId);
  const where = room ? `${room.name}${slot.bed ?? ''}` : staff?.name ?? '';
  // 醫師接在診間後面而不是取代它：二返同時要診間和醫師，只印一個就少了一半。
  const who = doctor ? ` ${doctor.name}醫師` : '';
  // 這道確認是她自己在看的，所以印「那天做了什麼」（`SIS(30)`）——
  // 課程全名那一格是額度在講的話（ADR-0078），兩者不是同一種字
  return `${timeLabel(slot)} ${slotName(slot, all, 'short')}${where ? ` ${where}` : ''}${who}`;
}

/** 課程主檔的 id → 課程。 */
const coursesByIdOf = (all) => Object.fromEntries((all?.courses ?? []).map((c) => [c.id, c]));

/**
 * 這一筆來訪身上現有的任務。取消／刪除那兩道確認要它才講得出「哪幾張會被收掉」。
 *
 * **讀不到就少講那兩句，不要擋住她。** 那個動作在離線時照樣寫得進本機快取
 * （`ui/toast.js` 的檔頭），為了一句說明把它擋下來是本末倒置。
 */
async function visitTasks(draft) {
  if (!draft?.id) return [];
  try {
    return await tasksData.listByVisit(draft.id);
  } catch {
    return [];
  }
}

/**
 * 取消其中一段（既有來訪的 ×）。
 *
 * **讀的是 `draft` 不是表單**，跟底下那張狀態卡同一個作法：這一下是一個
 * 狀態決定，不是一次編輯。她如果剛好改了幾格還沒存，那幾格不會跟著寫進去。
 */
async function cancelOneSlot(ctx, draft, slotIndex) {
  if (!Number.isInteger(slotIndex) || !draft.slots[slotIndex]) return;

  const ok = await confirmAction({
    title: `取消第 ${slotIndex + 1} 段？`,
    consequences: cancelConsequences({
      visit: draft,
      coursesById: coursesByIdOf(ctx.all),
      tasks: await visitTasks(draft),
      sheetSyncOn: isConfigured(ctx.settings),
      slotIndex,
    }),
    confirmLabel: '取消這一段',
    danger: true,
  });
  if (!ok) return;

  const next = applyStatus(draft, 'cancelled', { slotIndex });
  try {
    await toast.withSaveState(() => visitsData.save(next, ctx.customerVisits), {
      success: '這一段取消了',
      key: `visit:save:${next.id}`,
    });
    leave(ctx);
  } catch {
    /* 已處理 */
  }
}

// ---------- 已完成的更正流程 ----------

function lockedCard(embedded = false) {
  return `
    <section class="card ${embedded ? 'card--bare' : ''}">
      <h2 class="card__title">這一天已經完成，是唯讀的</h2>
      <p class="muted">已完成的來訪不能直接改（SPEC 第 6.4 節）。要更正請填理由，
        理由會跟著這次修改一起留在稽核紀錄裡。</p>
      <label class="field">
        <span class="field__label">更正理由</span>
        <input type="text" data-unlock-reason placeholder="時間記錯了，實際是 15:00" />
      </label>
      <p><button class="btn" type="button" data-unlock>解鎖修改</button></p>
    </section>`;
}

function wireUnlock(ctx, draft) {
  ctx.el.querySelector('[data-unlock]').addEventListener('click', () => {
    const reason = ctx.el.querySelector('[data-unlock-reason]').value.trim();
    if (!reason) {
      toast.info('要先填更正理由');
      return;
    }
    ctx.unlockReason = reason;
    paint(ctx, draft);
  });
}
