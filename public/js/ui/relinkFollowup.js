// 另約一次健檢之後，把那一場還接在取消／未到的健檢上的二返接到這一次（ADR-0146）。
//
// 她 2026-10-12：「另約健檢時，如果剛好只有一場二返還接在被取消的那一次上，確認框多一顆
// 『順便把那一場接到這一次』。你按了才改，仍然不是自動搬」。
//
// **壓表「加這一段」與日曆新增共用這一支**：她按了確認框上多的那一顆（`consequences.js` 的
// `bookingConsequences()` 回的 `relink`）、健檢照舊存好之後才走到這裡。規則一條都不在這裡：
// 哪一場算得上（`followups.js` 的 `relinkOffer()`）、改哪一格（`relinkSlot()`）、存不存得下去
// （`validateVisit()`）、那兩句（`consequences.js`）。這一支只做「重讀 → 套 → 驗 → 存 → 講」。
//
// **兩次寫入、兩個 commit**：健檢那一次照舊（照舊有復原），這一次只動二返那一格、自己一句、自己的復原。
// 不硬塞成同一個 commit —— 這一格接不過來（別的裝置剛改過、驗證擋下來）時健檢不該跟著存不進去。

import * as visitsData from '../data/visits.js';
import { relinkSlot } from '../domain/followups.js';
import { validateVisit } from '../domain/visits.js';
import { relinkedSay, notRelinkedSay } from '../domain/consequences.js';
import * as toast from './toast.js';

/**
 * @param {object} relink `bookingConsequences()` 回的那一格（確認框那一刻算的：哪一場、原本接在哪一次）
 * @param {{id: string, date: string}} exam 剛存好的那一次健檢（來訪的 id 與日期）
 * @param {object} check `validateVisit()` 要的那幾份
 * @param {{id: string, flags?: string[]}} check.customer
 * @param {object[]} check.entitlements 這位客戶的額度
 * @param {{courses: object[], equipment: object[], rooms: object[], staff: object[], ivProducts: object[]}} check.master
 * @returns {Promise<boolean>} 接過來了沒。沒接過來時已經講過一句（健檢照樣記好了）
 */
export async function relinkAfterSave(relink, exam, { customer, entitlements = [], master = {} } = {}) {
  if (!relink || !exam?.id || !customer?.id) return false;

  // **套在剛讀回來的那一份上**：確認框開著的時候，那一場可能在別的地方被改過（`relinkSlot()` 會認出來）。
  // 讀不完整（離線、讀到快取）也走「沒接過來」那一句（ADR-0158）：健檢記好了，這一格之後去日曆接
  let fresh;
  try {
    fresh = await visitsData.listWhole(customer.id);
  } catch {
    toast.info(notRelinkedSay(relink, [], { unread: true }));
    return false;
  }
  const next = relinkSlot(fresh, relink, exam.id);
  if (!next) {
    toast.info(notRelinkedSay(relink));
    return false;
  }

  // 那一次健檢接不接得上、有沒有被別場接走：照常問存檔驗證，不另寫一份。提醒不看 —— 排在健檢之前那一句
  // 確認框上已經講過了（`relink.ahead`），其餘的跟這一格無關
  const { errors } = validateVisit(next, {
    customer: { id: customer.id, flags: customer.flags ?? [] },
    entitlements,
    courses: master.courses ?? [], equipment: master.equipment ?? [], rooms: master.rooms ?? [],
    staff: master.staff ?? [], ivProducts: master.ivProducts ?? [],
    customerVisits: fresh,
    sameDayVisits: [],
  });
  if (errors.length) {
    toast.info(notRelinkedSay(relink, errors));
    return false;
  }

  try {
    await toast.withSaveState(() => visitsData.save(next, fresh), {
      success: relinkedSay(relink, exam.date),
      key: `visit:save:${next.id}`,
    });
    return true;
  } catch {
    return false; /* withSaveState 已顯示錯誤與重試 */
  }
}
