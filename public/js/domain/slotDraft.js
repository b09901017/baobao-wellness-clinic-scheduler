// 組一段時段只有一支（issue 10）。純函式。
//
// 「一段時段長什麼樣」以前寫在壓表的畫面裡（`ui/views/schedule.js` 的 `addSlot()`）：
// 從畫面上讀她按了哪幾顆，依序問課程、指派、n返、時長，組出一個物件。
// 拍 Abovee（issue 13）是第三個會建立時段的入口，而且一次建十幾段 —— 照抄一份的話，
// CLAUDE.md 那張表上「兩個入口共用」的每一列（課程由器材決定、指派誰、n返清乾淨、
// 營養點滴時長、新段自己寫狀態）都會多一個會漏的地方，
// 而症狀是**畫面看起來對、存進去的是錯的**。
//
// 所以這一支只收「她選了什麼」（`picks`），**一行規則都不在這裡重寫** ——
// 每一條都呼叫原本那一支：`coursesForEntitlement()`／`courseForEquipment()`（ADR-0075）、
// `assignsFor()`（ADR-0079）、`picksDoctor()`、`slotMinutes()`（ADR-0098）、`nthSlotFields()`（ADR-0063）。
//
// 來訪編輯器的 `blankSlot()`／`readDraft()` 還沒改走這一支（issue 10 刻意留著）。

import {
  INITIAL_STATUS, assignsFor, courseForEquipment, coursesForEntitlement, picksEquipment,
  sameDayVisitFor, settle, slotMinutes, slotMinutesField, withExtraSlot,
} from './visits.js';
import { picksDoctor, canBeGift, GIFT_KINDS } from './masterData.js';
import { courseIdForNth, examChoicesForNth, nthSlotFields } from './nthFollowup.js';
import { endOf, isValidTime } from './visitTime.js';

/**
 * 她選的那幾樣 → 一段時段。
 *
 * **前面那幾道先擋**：句子是壓表那一頁一直在講的（她在那一頁看到的是一張卡片，
 * 沒有「第幾個時段」這個概念，所以不等 `validateVisit()`）。一次只講第一件。
 * 其餘（器材沒選、治療師沒選、次數不夠）照舊由 `validateVisit()` 講 —— 呼叫端存之前都要跑它。
 *
 * @param {object} picks
 * @param {string|null} picks.entitlementId 選了哪一筆額度（n返 沒有額度，給 null）
 * @param {boolean} [picks.isNth] 選的是「＋ n返」那一顆
 * @param {string|null} [picks.giftCourseId] 選的是「送的／體驗」那一門（gift-and-trial 01，延伸 ADR-0121）：
 *   課程就是它（擇一池那門課照器材重推，ADR-0075）、`entitlementId` 是 null、返數不碰。
 *   **任何一門課都可以，健檢與二返除外**（`canBeGift()`）—— 這一條路是唯一不靠額度也不靠健檢就組得出一段的地方
 * @param {'trial'|'gift'} [picks.giftKind] 體驗還是送的；沒給（或看不懂）就是體驗（她：「四門都寫體驗」）
 * @param {string|null} [picks.equipmentId] 擇一池選的那一台
 * @param {string|null} [picks.ivProductId] 營養點滴的品項
 * @param {string|null} picks.startsAt 'HH:MM'
 * @param {string|null} [picks.roomId]
 * @param {string|null} [picks.bed]
 * @param {string|null} [picks.therapistId]
 * @param {string|null} [picks.doctorId]
 * @param {number|null} [picks.nth] 第幾返
 * @param {string|null} [picks.followupForVisitId] 接在哪一次健檢後面（二返、n返）
 * @param {number|string|null} [picks.minutes] 約的時候選的時長（ADR-0122）。只在那門課有
 *   `bookingMinutes` 而且值在裡面時算數（`slotMinutes()`）；沒給就是預設那一顆
 * @param {string|null} [picks.note] 那一段身上那一句話（ADR-0084）
 * @param {string} [picks.status] 這一段一開始是什麼狀態（abovee-status-follows-photo 03）。**沒給就是 `INITIAL_STATUS`** ——
 *   壓表、來訪編輯器、日曆新增一律不給。只有拍 Abovee 照照片上的預約狀態給：`NEW_SLOT_STATUSES` 那四種，其餘當成沒給
 * @param {string|null} [picks.cancelReason] 狀態是已取消時那一段的取消理由（照片上的「取消原因」，issue 11 的 `slot.cancelReason`）
 * @param {{courses: object[], equipment: object[], ivProducts?: object[],
 *          entitlements: object[], visits: object[]}} ctx 主檔，與這位客戶的額度、來訪
 * @returns {{slot: object|null, errors: string[], course: object|null, assigns: string|null}}
 *   `assigns` 是 `assignsFor()` 的答案：擇一池還沒選器材時是 null（兩種都不挑）。
 *   **課程推得出來、卡在後面那幾道時，`course` 與 `assigns` 照樣交回去**（`slot` 是 null）——
 *   拍 Abovee 那一層還沒選齊（還沒選接哪一次健檢）時，要靠它畫接下來那幾排（醫師、第幾返）
 */
export function slotFromPicks(picks, ctx) {
  const {
    entitlementId = null, isNth = false, giftCourseId = null, giftKind = 'trial',
    equipmentId = null, ivProductId = null, startsAt = null,
    roomId = null, bed = null, therapistId = null, doctorId = null, nth = null,
    followupForVisitId = null, note = null, minutes = null, status = INITIAL_STATUS, cancelReason = null,
  } = picks ?? {};
  const { courses = [], equipment = [], ivProducts = [], entitlements = [], visits = [] } = ctx ?? {};
  const fail = (error) => ({ slot: null, errors: [error], course: null, assigns: null });

  const coursesById = Object.fromEntries(courses.map((c) => [c.id, c]));
  const entitlement = isNth ? null : (entitlements.find((e) => e.id === entitlementId) ?? null);

  // 這一段算哪一個課程
  let course = null;
  let nthExam = null;
  if (isNth) {
    // n返 借那一次健檢配的二返課程；還沒選健檢就先看第一個候選（壓表那一排就是這樣決定畫不畫這一顆）
    const exams = examChoicesForNth({ entitlements, coursesById, visits });
    // 候選連取消、未到的也列（標狀態、按不下去，issues/11）—— 預設看第一個按得下去的（排著的與做完的，ADR-0145）
    const wanted = followupForVisitId ?? exams.find((c) => c.pickable)?.visitId ?? null;
    nthExam = exams.length ? (visits.find((v) => v.id === wanted) ?? null) : null;
    course = coursesById[courseIdForNth(nthExam, entitlements, coursesById)] ?? null;
  } else if (entitlement) {
    // 四選一會推出兩個課程，取第一個當還沒選器材時的預設；選了器材就換（ADR-0075）
    const fallback = coursesForEntitlement(entitlement, courses, equipment)[0] ?? null;
    course = fallback && entitlement.type === 'pool'
      ? (coursesById[courseForEquipment(equipmentId, equipment, fallback.id)] ?? fallback)
      : fallback;
  } else if (giftCourseId) {
    // 送的／體驗：沒有額度，課程就是她按的那一顆。**額度那一條排在前面** ——
    // 兩個都給了的話照額度（那一段會扣），兩種身分只挑一種。
    // **擇一池那門課（要選器材的，復能）照器材重推**（ADR-0075）：不然存得出「課程是復能、器材是 ILIB、指派治療師」。
    // 只有那一門重推 —— 別的課身上殘留一台器材（畫面上上一顆的），不可以把心臟科評估換成復能
    const wanted = coursesById[giftCourseId] ?? null;
    const home = wanted && !wanted.deletedAt && canBeGift(wanted, courses) ? wanted : null;
    const derived = home?.requiresEquipment
      ? (coursesById[courseForEquipment(equipmentId, equipment, home.id)] ?? home)
      : home;
    course = derived && canBeGift(derived, courses) ? derived : null;
  }
  const gift = !entitlement && !isNth && giftCourseId && course
    ? (GIFT_KINDS.includes(giftKind) ? giftKind : 'trial')
    : null;

  if (!course) return fail('先選要做什麼');
  const assigns = assignsFor(entitlement, course, equipmentId);
  const stop = (error) => ({ slot: null, errors: [error], course, assigns });
  if (!isValidTime(startsAt)) return stop('先選幾點開始');
  if (isNth && !nth) return stop('先選第幾返');
  if (isNth && !followupForVisitId) {
    return stop('先選這是哪一次健檢的 —— 沒有它，試算表上這一場沒有位置可以印');
  }

  const ivProduct = course.requiresIvProduct ? (ivProducts.find((p) => p.id === ivProductId) ?? null) : null;
  const begins = NEW_SLOT_STATUSES.includes(status) ? status : INITIAL_STATUS;

  const slot = {
    entitlementId: entitlement?.id ?? null,
    courseId: course.id,
    courseName: course.name,
    equipmentId: picksEquipment(entitlement, course) ? (equipmentId ?? null) : null,
    ivProductId: course.requiresIvProduct ? (ivProductId ?? null) : null,
    startsAt,
    endsAt: endOf(startsAt, slotMinutes({ entitlement, course, ivProduct, minutes, giftKind: gift })),
    // 她選的時長跟著這一段走（改期、只改醫師都不掉）。不給選的課是 null
    minutes: slotMinutesField({ entitlement, course, ivProduct, minutes, giftKind: gift }),
    roomId: assigns === 'room' ? (roomId || null) : null,
    bed: assigns === 'room' ? (bed || null) : null,
    therapistId: assigns === 'therapist' ? (therapistId ?? null) : null,
    doctorId: picksDoctor(course) ? (doctorId ?? null) : null,
    // 這一段二返接在哪一次健檢後面。不是二返就一定是 null ——
    // 帶著一個不相干的 id 會讓試算表把註記寫到別人底下
    followupForVisitId: entitlement?.followupForEntitlementId ? (followupForVisitId ?? null) : null,
    // 已完成、未到照簽療程單的形狀兩格一起寫（`closeVisit()`：`attended` 是 ADR-0025 的，對帳讀它）
    attended: ATTENDED[begins] ?? null,
    // 送的／體驗（gift-and-trial 01）。一般的段寫 null —— 不寫 undefined（Firestore 不收）
    giftKind: gift,
    // n返 覆蓋掉上面那幾樣（沒有額度、返數、哪一次健檢）。**放在最後不是隨便放的** ——
    // 上面那一份是「一段普通的來訪」的形狀，這一份只換掉真的不一樣的三樣
    ...(isNth ? nthSlotFields({
      nth,
      examVisitId: followupForVisitId,
      courseId: courseIdForNth(visits.find((v) => v.id === followupForVisitId) ?? null, entitlements, coursesById)
        ?? course.id,
    }) : {}),
    note,
    // **新的一段一定自己寫狀態**（CLAUDE.md「新增一個會建立時段的入口」）：不寫的話
    // 併進一筆已確認的來訪時，它會繼承整筆的狀態，被靜默標成談定了。
    // 沒給就是還沒問過客人；拍 Abovee 照照片上的給（03）
    status: begins,
    // 取消理由跟著那一段（issue 11）。只有記成已取消的段有這一格 —— 其餘的段長得跟以前一模一樣
    ...(begins === 'cancelled' ? { cancelReason: String(cancelReason ?? '').trim() || null } : {}),
  };

  return { slot, errors: [], course, assigns };
}

/**
 * 一段新的時段一開始可以是哪幾種狀態（`slotFromPicks()` 的 `status`）。**沒有已確認** —— 已確認是她問過客人，
 * 照片上「確認前往」只是 Abovee 上的字（ADR-0027、spec 的對照表），記成待確認。
 */
export const NEW_SLOT_STATUSES = Object.freeze(['pending_confirm', 'done', 'no_show', 'cancelled']);

/** 已完成、未到那一段的 `attended`（`closeVisit()` 同一個形狀）。 */
const ATTENDED = Object.freeze({ done: true, no_show: false });

/**
 * 這一段要放進哪一筆來訪：那一天已經有收得下的就併進去（ADR-0083，`withExtraSlot()`
 * 會把已確認的整筆退回待確認），沒有就組一筆新的。
 *
 * 新的那一筆的整筆狀態**照時段推**（`newVisitWith()`，abovee-status-follows-photo 03）：
 * 時段是待確認的（壓表、日曆新增）一個字都不變；拍 Abovee 記一段照片上已經做完的，整筆就是已完成。
 *
 * @param {{customerId: string, customerName: string}} customer
 * @param {string} date
 * @param {object} slot `slotFromPicks()` 組好的
 * @param {object[]} customerVisits 這位客戶的來訪
 * @param {{at?: string}} [o] 整筆不是待確認時蓋的時間
 * @returns {{visit: object, merged: {visit: object, reopened: boolean}|null}}
 */
export function visitWithSlot(customer, date, slot, customerVisits = [], { at = new Date().toISOString() } = {}) {
  const sameDay = sameDayVisitFor(customerVisits, customer.customerId, date);
  const merged = sameDay ? withExtraSlot(sameDay, slot, { at }) : null;
  return {
    merged,
    visit: merged?.visit ?? newVisitWith(customer, date, [slot], { at }),
  };
}

/**
 * 同一組（一位一天）接下來的那幾段：**一律接進這一組自己那一筆**，不再問那一天收不收得下（03）。
 *
 * 以前每一段都重問 `visitWithSlot()`：第一段把新的那一筆推成已完成（結案了）之後，第二段找不到收得下的，
 * 另開一筆、把第一筆蓋掉 —— **第一段就不見了**。要不要併進 app 上那一天既有的那一筆只在第一段問。
 *
 * - 併進既有那一筆的（有 id）→ `withExtraSlot()`（已確認的那一天接一段待確認的照舊退回待確認）
 * - 這一次才要組的新一筆（沒有 id）→ 照時段重推一次（`newVisitWith()`）：取消的三格不會留在一筆已完成的身上
 *
 * @param {object} visit 這一組到目前為止的那一筆
 * @param {object} slot
 * @param {{at?: string}} [o]
 * @returns {{visit: object, reopened: boolean}}
 */
export function withPlannedSlot(visit, slot, { at = new Date().toISOString() } = {}) {
  if (visit?.id) return withExtraSlot(visit, slot, { at });
  return {
    reopened: false,
    visit: newVisitWith(visit, visit.date, [...(visit.slots ?? []), slot], { at }),
  };
}

/**
 * 一筆新的來訪，整筆狀態照時段推（`settle()` 的形狀：不是待確認才蓋 `statusAt`；全部取消時寫取消的三格，
 * 理由是那幾段自己的 —— 只有一段的那一天跟只取消一段時一樣，兩邊都有）。
 */
function newVisitWith({ customerId, customerName }, date, slots, { at }) {
  const reasons = [...new Set(slots.map((s) => s?.cancelReason).filter(Boolean))];
  return settle({
    customerId,
    customerName,
    date,
    status: INITIAL_STATUS,
    confirmedAt: null, cancelledAt: null, statusAt: null, cancelReason: null, released: null,
    note: null,
    slots,
  }, { at, reason: reasons.join('；') || null });
}
