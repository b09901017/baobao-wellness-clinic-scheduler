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
  INITIAL_STATUS, describeStatus, statusClass, nextStatuses, isLocked, validateVisit,
  coursesForEntitlement, courseForEquipment, picksEquipment, assignsFor,
  applyStatus, NOTE_MAX,
} from '../../domain/visits.js';
import { counts, schedulable } from '../../domain/entitlements.js';
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
  roomSlots, orderedRoomsForCourse, staffWithRole, picksDoctor, ivChoicesFor,
  THERAPIST_ROLE, DOCTOR_ROLE,
} from '../../domain/masterData.js';
import { endOf, nextStart, isValidTime, timeLabel, DEFAULT_GAP_MIN } from '../../domain/visitTime.js';
import { todayISO, isValidDate, shortDate } from '../../domain/dates.js';
import * as f from '../components/form.js';
import { confirmAction } from '../components/dialog.js';
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

/** 掛進抽屜裡的修改。 */
export async function mountEdit(el, { visitId, ...rest } = {}) {
  await boot(el, { visitId, ...rest });
}

async function boot(el, {
  customerId = null, visitId = null, date = null,
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

    const draft = existing ? { ...existing } : blankVisit(customer, entitlements, all, settings, date);
    const sameDayVisits = await visitsData.listByDate(draft.date);

    ctx = {
      el, customer, entitlements, all, settings, customerVisits, sameDayVisits,
      isNew: !existing, unlockReason: null, embedded, onDone, onCancel,
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
  };
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

  const { errors, warnings } = validateVisit(draft, {
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
        <span class="badge ${statusClass(draft.status)}">${esc(describeStatus(draft.status))}</span>
        ${flagsUi.detailChips(splitFlags(customer, all.clinicalFlags), { rows: all.clinicalFlags })}
      </div>
      <div class="errors" data-errors hidden></div>
      ${warnings.length ? warningsHtml(warnings, embedded) : ''}
    </section>

    ${locked ? lockedCard(embedded) : ''}

    <form data-form ${locked ? 'inert' : ''}>
      <section class="card ${embedded ? 'card--bare' : ''}">
        ${f.date({ name: 'date', label: '來訪日期', value: draft.date })}
        ${f.text({
          name: 'note', label: '這一次記一句', value: draft.note ?? '',
          placeholder: '例：她說下午比較好', maxlength: NOTE_MAX,
          hint: '跟著這一筆來訪，不是掛在客戶身上 —— 那是備註，在客戶那一頁改。',
        })}
      </section>

      ${draft.slots.map((slot, i) => slotCard(ctx, draft, slot, i)).join('')}

      <section class="card ${embedded ? 'card--bare' : ''}">
        <p><button class="btn" type="button" data-add-slot>＋ 新增一個時段</button></p>
        <p class="muted">預設接在上一段結束的 ${ctx.settings.slotGapMin ?? DEFAULT_GAP_MIN} 分鐘後。</p>
      </section>

      <section class="card ${embedded ? 'card--bare' : ''}">
        <div class="form__actions">
          <button class="btn btn--primary" type="submit">${isNew ? '記錄這次來訪' : '儲存'}</button>
          <button class="btn" type="button" data-cancel-edit>取消</button>
        </div>
        ${ctx.submitted && errors.length
          ? '<p class="muted">上面紅色的問題要先處理才存得下去。</p>'
          : ''}
      </section>
    </form>

    ${isNew ? '' : statusCard(draft, embedded)}
    ${isNew ? '' : dangerZone(embedded)}`;

  el.querySelector('[data-back]')?.addEventListener('click', (e) => {
    e.preventDefault();
    back(`/customers/${customer.id}`);
  });
  el.querySelector('[data-cancel-edit]').addEventListener('click', () =>
    (ctx.onCancel ? ctx.onCancel() : go(`/customers/${customer.id}`)),
  );

  const form = el.querySelector('[data-form]');
  f.wireChips(form);

  form.addEventListener('change', async (e) => {
    // 這一句話不影響畫面上算出來的任何東西，所以不要為了它重畫。
    // 重畫會在她打完字、手指正要按下「儲存」的那一刻把那顆按鈕換掉 ——
    // 按下去與放開落在兩個不同的元素上，那一下就不算數（其餘欄位都是用點的，
    // 點完本來就會重畫，碰不到這個問題）。
    if (e.target.name === 'note') return;

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

  el.querySelector('[data-add-slot]').addEventListener('click', () => {
    const next = readDraft(ctx, form, draft);
    const last = next.slots[next.slots.length - 1];
    const gap = ctx.settings.slotGapMin ?? DEFAULT_GAP_MIN;
    const startsAt = last && isValidTime(last.endsAt) ? nextStart(last.endsAt, gap) : '09:00';
    next.slots.push(blankSlot(entitlements[0], all, ctx.settings, startsAt));
    paint(ctx, next);
  });

  el.querySelectorAll('[data-del-slot]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const next = readDraft(ctx, form, draft);
      next.slots.splice(Number(btn.dataset.delSlot), 1);
      paint(ctx, next);
    }),
  );

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit(ctx, readDraft(ctx, form, draft));
  });

  // 第一次送出之後才顯示 errors —— 一打開就滿江紅只會讓人不想看
  if (ctx.submitted) f.showErrors(el, errors);

  if (locked) wireUnlock(ctx, draft);
  if (!isNew && !locked) wireStatus(ctx, draft);
  if (!isNew) wireDangerZone(ctx, draft);
}

function warningsHtml(warnings, embedded = false) {
  return `
    <div class="card ${embedded ? 'card--flat' : ''}">
      <h3 class="card__title">提醒</h3>
      <ul class="muted">${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
      <p class="muted">這些都只是提醒，不會擋著不讓你存 —— app 看不到同事在 Abovee 上壓的東西。</p>
    </div>`;
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
        ${draft.slots.length > 1
          ? `<button class="slothead__x" type="button" data-del-slot="${i}"
                     aria-label="移除第 ${i + 1} 段">${icon('close', { size: 15, width: 2 })}</button>`
          : ''}
      </div>

      ${f.chips({
        name: `s${i}-ent`, label: '額度', value: nth ? NTH_PICK : slot.entitlementId,
        options: [
          ...entitlements.map((e) => {
            const c = counts(e, customerVisits, e.id);
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
      ${/* n返 沒有課程可以挑（它借二返那一個），所以整排不畫 ——
             以前這裡只問 `length === 1`，於是 n返 會多出一排**空的**「課程」，
             而一排沒有東西的丸子看起來像壞掉。 */''}
      ${nth || courseChoices.length === 1
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
      ${assigns === null ? `
        <p class="field__hint">先選上面那一台 ——
          ${esc(ent?.label ?? '這一筆')} 要治療師還是治療室，看那天用的是哪一種。</p>` : ''}
      ${assigns === 'room' ? roomField(all, course, slot, i) : ''}
      ${assigns === 'therapist'
        ? f.chips({
            name: `s${i}-staff`, label: '治療師', value: slot.therapistId, quiet: true,
            options: staffWithRole(all.staff, THERAPIST_ROLE)
              .map((x) => ({ value: x.id, label: x.name })),
          })
        : ''}
      ${picksDoctor(course) ? doctorField(all, slot, i) : ''}
      ${examField(ctx, draft, ent, slot, i)}
    </section>`;
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
      name: `s${i}-equip`, label: '器材', value: slot.equipmentId, quiet: true,
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
  // 排得進去的排前面，而**它們自己的順序由 `orderedRoomsForCourse()` 決定**
  //（她 2026-09-08 要的「優先置頂」：EECP 是治5、治8，ILIB 是 `.10`、治2、治3）。
  // 壓表那一頁走的是同一支 —— 兩邊各排一次的話，同一個課程在兩個畫面上
  // 第一顆丸子不一樣，她不會知道哪個算數。
  const ordered = orderedRoomsForCourse(course, all.rooms);
  const rank = new Map(ordered.map((r, idx) => [r.id, idx]));
  const slots = roomSlots(all.rooms);

  // 排不進去的不藏起來（她偶爾真的會排到別間），但要標出來 ——
  // 診間有十七間，排錯順序等於每次都要從頭掃。
  const options = slots
    .slice()
    .sort((a, b) => (rank.get(a.roomId) ?? Infinity) - (rank.get(b.roomId) ?? Infinity))
    .map((s) => ({
      value: roomKey(s.roomId, s.bed),
      label: s.label,
      note: rank.has(s.roomId) ? '' : '不常用',
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
    note: String(key(v, 'note', draft.note) ?? '').trim() || null,
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

// 沒被畫出來的欄位讀回來是 undefined，那時要保留原值而不是清成 null
function key(values, name, fallback) {
  return name in values ? values[name] : fallback;
}

// ---------- 儲存 ----------

async function submit(ctx, draft) {
  const { el, customer, entitlements, all, customerVisits, sameDayVisits, isNew } = ctx;
  ctx.submitted = true;

  const { errors } = validateVisit(draft, {
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

  // SPEC 第 7 節規則 11：標記已壓表時要問這一句。app 看不到那幾個系統，
  // 這道確認就是她手寫的那兩個驚嘆號。
  //
  // 抬頭與後果由 `domain/consequences.js` 算：這裡以前寫死「Abovee」，
  // 而健檢壓的是 Examine ——「在哪壓」早就答得出來（`bookingSystemFor()`），
  // 只是沒有人用它。壓表那一頁走的是同一支。
  if (isNew) {
    const said = bookingConsequences({
      visit: draft,
      coursesById: Object.fromEntries(all.courses.map((c) => [c.id, c])),
      sheetSyncOn: isConfigured(ctx.settings),
    });
    const ok = await confirmAction({
      title: said.title,
      consequences: [
        ...draft.slots.map((s) => slotSummary(s, all)),
        ...said.lines,
        'app 看不到同事壓的東西，診間有沒有被佔用要以那邊為準',
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
      success: isNew ? '已記錄' : '已儲存',
      key: `visit:save:${payload.id ?? `${payload.customerId}:${payload.date}`}`,
    });
    leave(ctx);
    return id;
  } catch {
    return null; /* withSaveState 已顯示錯誤與重試 */
  }
}

function slotSummary(slot, all) {
  const course = all.courses.find((c) => c.id === slot.courseId);
  const room = all.rooms.find((r) => r.id === slot.roomId);
  const staff = all.staff.find((s) => s.id === slot.therapistId);
  const doctor = all.staff.find((s) => s.id === slot.doctorId);
  const where = room ? `${room.name}${slot.bed ?? ''}` : staff?.name ?? '';
  // 醫師接在診間後面而不是取代它：二返同時要診間和醫師，只印一個就少了一半。
  const who = doctor ? ` ${doctor.name}醫師` : '';
  return `${timeLabel(slot)} ${course?.name ?? ''}${where ? ` ${where}` : ''}${who}`;
}

// ---------- 狀態 ----------

function statusCard(draft, embedded = false) {
  const bare = embedded ? 'card--bare' : '';
  const options = nextStatuses(draft.status);
  if (!options.length) {
    return `
      <section class="card ${bare}">
        <h2 class="card__title">狀態</h2>
        <p class="muted">${esc(describeStatus(draft.status))}。這是終點，不會再往下走。
          要改期就取消後重新排一筆（SPEC 第 7 節規則 10）。</p>
      </section>`;
  }
  return `
    <section class="card ${bare}">
      <h2 class="card__title">狀態</h2>
      <p class="muted">現在是「${esc(describeStatus(draft.status))}」。</p>
      <p>${options
        .map((s) => `<button class="btn" type="button" data-status="${s}">${describeStatus(s)}</button>`)
        .join(' ')}</p>
      <label class="field">
        <span class="field__label">取消理由（選填）</span>
        <input type="text" data-cancel-reason placeholder="客人要改時間" />
      </label>
    </section>`;
}

/** 課程主檔的 id → 課程。這一支檔案裡有三個地方要它。 */
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

function wireStatus(ctx, draft) {
  ctx.el.querySelectorAll('[data-status]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const to = btn.dataset.status;
      const reason = ctx.el.querySelector('[data-cancel-reason]')?.value?.trim() || null;

      if (to === 'cancelled') {
        // 那幾句話走 `domain/consequences.js`，跟日曆的長按選單是**同一份**
        // （ADR-0056）。以前兩邊各寫一次「Abovee／Examine／耀聖」三個並列，
        // 而 `bookingSystemsForVisit()` 早就答得出來是哪一個。
        const ok = await confirmAction({
          title: '取消這筆來訪？',
          consequences: cancelConsequences({
            visit: draft,
            coursesById: coursesByIdOf(ctx.all),
            tasks: await visitTasks(draft),
            sheetSyncOn: isConfigured(ctx.settings),
          }),
          confirmLabel: '取消這筆來訪',
          danger: true,
        });
        if (!ok) return;
      }

      // 換狀態之後長什麼樣全部在 `domain/visits.js` 的 `applyStatus()` ——
      // 這一段與日曆的快捷選單（ADR-0060）共用同一份。兩邊各寫一次的話，
      // 遲早有一邊忘了補 `cancelledAt`，而那一筆從此在稽核紀錄裡看不出
      // 是什麼時候取消的。收尾（done／no_show）在那裡整筆一起標，
      // 要逐段分開記走待辦中心的「簽療程單」（ADR-0025）。
      const next = applyStatus(draft, to, { reason });

      try {
        await toast.withSaveState(() => visitsData.save(next, ctx.customerVisits), {
          success: `已改成「${describeStatus(to)}」`,
          // 存來訪的四個地方都要有 key（同一支檔案上面那個存檔鈕也有）——
          // 取消那一條有二次確認框擋著，其餘幾個轉移沒有。
          key: `visit:save:${next.id}`,
        });
        leave(ctx);
      } catch {
        /* 已處理 */
      }
    }),
  );
}

// ---------- 已完成的更正流程 ----------

function lockedCard(embedded = false) {
  return `
    <section class="card ${embedded ? 'card--bare' : ''}">
      <h2 class="card__title">這筆已經完成，是唯讀的</h2>
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

// ---------- 刪除 ----------

function dangerZone(embedded = false) {
  return `
    <section class="card danger ${embedded ? 'card--bare' : ''}">
      <h2 class="card__title">刪除這筆紀錄</h2>
      <p class="muted">誤建才用刪除。客人改時間或不來，請用上面的狀態按鈕，
        那些會留下為什麼。</p>
      <p><button class="btn btn--danger" type="button" data-delete>刪除</button></p>
    </section>`;
}

function wireDangerZone(ctx, draft) {
  ctx.el.querySelector('[data-delete]').addEventListener('click', async () => {
    const ok = await confirmAction({
      title: '刪除這筆來訪紀錄？',
      consequences: [
        ...cancelConsequences({
          visit: draft,
          coursesById: coursesByIdOf(ctx.all),
          tasks: await visitTasks(draft),
          removing: true,
          sheetSyncOn: isConfigured(ctx.settings),
        }),
        '如果是客人不來或改時間，用「取消」比較好 —— 那會留下理由',
      ],
      confirmLabel: '刪除',
      danger: true,
    });
    if (!ok) return;

    try {
      await toast.withSaveState(() => visitsData.remove(draft, ctx.customerVisits), {
        success: '已刪除',
      });
      leave(ctx);
    } catch {
      /* 已處理 */
    }
  });
}
