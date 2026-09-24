// 組一段時段只有一支（issue 10）。純函式。
//
// 「一段時段長什麼樣」以前寫在壓表的畫面裡（`ui/views/schedule.js` 的 `addSlot()`）：
// 從畫面上讀她按了哪幾顆，依序問課程、指派、n返、時長，組出一個物件。
// 拍 Abovee（issue 13）是第三個會建立時段的入口，而且一次建十幾段 —— 照抄一份的話，
// CLAUDE.md 那張表上「兩個入口共用」的每一列（課程由器材決定、指派誰、n返清乾淨、
// 營養點滴時長、新段自己寫 `INITIAL_STATUS`）都會多一個會漏的地方，
// 而症狀是**畫面看起來對、存進去的是錯的**。
//
// 所以這一支只收「她選了什麼」（`picks`），**一行規則都不在這裡重寫** ——
// 每一條都呼叫原本那一支：`coursesForEntitlement()`／`courseForEquipment()`（ADR-0075）、
// `assignsFor()`（ADR-0079）、`picksDoctor()`、`slotMinutes()`（ADR-0098）、`nthSlotFields()`（ADR-0063）。
//
// 來訪編輯器的 `blankSlot()`／`readDraft()` 還沒改走這一支（issue 10 刻意留著）。

import {
  INITIAL_STATUS, assignsFor, courseForEquipment, coursesForEntitlement, picksEquipment,
  sameDayVisitFor, slotMinutes, withExtraSlot,
} from './visits.js';
import { picksDoctor } from './masterData.js';
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
 * @param {string|null} [picks.equipmentId] 擇一池選的那一台
 * @param {string|null} [picks.ivProductId] 營養點滴的品項
 * @param {string|null} picks.startsAt 'HH:MM'
 * @param {string|null} [picks.roomId]
 * @param {string|null} [picks.bed]
 * @param {string|null} [picks.therapistId]
 * @param {string|null} [picks.doctorId]
 * @param {number|null} [picks.nth] 第幾返
 * @param {string|null} [picks.followupForVisitId] 接在哪一次健檢後面（二返、n返）
 * @param {string|null} [picks.note] 那一段身上那一句話（ADR-0084）
 * @param {{courses: object[], equipment: object[], ivProducts?: object[],
 *          entitlements: object[], visits: object[]}} ctx 主檔，與這位客戶的額度、來訪
 * @returns {{slot: object|null, errors: string[], course: object|null, assigns: string|null}}
 *   `assigns` 是 `assignsFor()` 的答案：擇一池還沒選器材時是 null（兩種都不挑）
 */
export function slotFromPicks(picks, ctx) {
  const {
    entitlementId = null, isNth = false, equipmentId = null, ivProductId = null, startsAt = null,
    roomId = null, bed = null, therapistId = null, doctorId = null, nth = null,
    followupForVisitId = null, note = null,
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
    // 候選連沒做完的也列（標狀態、按不下去，issues/11）—— 預設看第一個按得下去的
    const wanted = followupForVisitId ?? exams.find((c) => c.pickable)?.visitId ?? null;
    nthExam = exams.length ? (visits.find((v) => v.id === wanted) ?? null) : null;
    course = coursesById[courseIdForNth(nthExam, entitlements, coursesById)] ?? null;
  } else if (entitlement) {
    // 四選一會推出兩個課程，取第一個當還沒選器材時的預設；選了器材就換（ADR-0075）
    const fallback = coursesForEntitlement(entitlement, courses, equipment)[0] ?? null;
    course = fallback && entitlement.type === 'pool'
      ? (coursesById[courseForEquipment(equipmentId, equipment, fallback.id)] ?? fallback)
      : fallback;
  }

  if (!course) return fail('先選要做什麼');
  if (!isValidTime(startsAt)) return fail('先選幾點開始');
  if (isNth && !nth) return fail('先選第幾返');
  if (isNth && !followupForVisitId) {
    return fail('先選這是哪一次健檢的 —— 沒有它，試算表上這一場沒有位置可以印');
  }

  const assigns = assignsFor(entitlement, course, equipmentId);
  const ivProduct = course.requiresIvProduct ? (ivProducts.find((p) => p.id === ivProductId) ?? null) : null;

  const slot = {
    entitlementId: entitlement?.id ?? null,
    courseId: course.id,
    courseName: course.name,
    equipmentId: picksEquipment(entitlement, course) ? (equipmentId ?? null) : null,
    ivProductId: course.requiresIvProduct ? (ivProductId ?? null) : null,
    startsAt,
    endsAt: endOf(startsAt, slotMinutes({ entitlement, course, ivProduct })),
    roomId: assigns === 'room' ? (roomId || null) : null,
    bed: assigns === 'room' ? (bed || null) : null,
    therapistId: assigns === 'therapist' ? (therapistId ?? null) : null,
    doctorId: picksDoctor(course) ? (doctorId ?? null) : null,
    // 這一段二返接在哪一次健檢後面。不是二返就一定是 null ——
    // 帶著一個不相干的 id 會讓試算表把註記寫到別人底下
    followupForVisitId: entitlement?.followupForEntitlementId ? (followupForVisitId ?? null) : null,
    attended: null,
    // n返 覆蓋掉上面那幾樣（沒有額度、返數、哪一次健檢）。**放在最後不是隨便放的** ——
    // 上面那一份是「一段普通的來訪」的形狀，這一份只換掉真的不一樣的三樣
    ...(isNth ? nthSlotFields({
      nth,
      examVisitId: followupForVisitId,
      courseId: courseIdForNth(visits.find((v) => v.id === followupForVisitId) ?? null, entitlements, coursesById)
        ?? course.id,
    }) : {}),
    note,
    // **新的一段一定還沒問過客人**（CLAUDE.md「新增一個會建立時段的入口」）：不寫的話
    // 併進一筆已確認的來訪時，它會繼承整筆的狀態，被靜默標成談定了
    status: INITIAL_STATUS,
  };

  return { slot, errors: [], course, assigns };
}

/**
 * 這一段要放進哪一筆來訪：那一天已經有收得下的就併進去（ADR-0083，`withExtraSlot()`
 * 會把已確認的整筆退回待確認），沒有就組一筆新的。
 *
 * @param {{customerId: string, customerName: string}} customer
 * @param {string} date
 * @param {object} slot `slotFromPicks()` 組好的
 * @param {object[]} customerVisits 這位客戶的來訪
 * @returns {{visit: object, merged: {visit: object, reopened: boolean}|null}}
 */
export function visitWithSlot(customer, date, slot, customerVisits = []) {
  const sameDay = sameDayVisitFor(customerVisits, customer.customerId, date);
  const merged = sameDay ? withExtraSlot(sameDay, slot) : null;
  return {
    merged,
    visit: merged?.visit ?? {
      customerId: customer.customerId,
      customerName: customer.customerName,
      date,
      status: INITIAL_STATUS,
      confirmedAt: null, cancelledAt: null, statusAt: null, cancelReason: null, released: null,
      note: null,
      slots: [slot],
    },
  };
}
