// 進度追蹤頁的資料整理。純函式，不碰 IO。
//
// 這一頁只回答一個問題：**這個月每位客戶排了哪些時段，每一段走到哪一步了。**
// 它是唯讀的 —— 不改任何東西，也不重算次數。
//
// 狀態的判斷一律走 `domain/visits.js` 的 `slotStatus()`，顏色、符號與說明
// 一律走同一支的 `STATUS_VIEW`。這一支自己不認得任何一個狀態字串的意思 ——
// 使用者的原話是「這一頁要和 todo 日曆對的上」，而同一位客戶在兩個畫面
// 顯示成不同狀態，她不會知道哪個算數。

import { monthRange } from './scheduling.js';
import { isActive, slotStatus } from './visits.js';
import { slotName } from './naming.js';
import { isValidDate } from './dates.js';
import { isValidTime, toMinutes } from './visitTime.js';

/**
 * 這一頁畫得出來的狀態，照流程排。
 *
 * 取消不在裡面：時段已經還回去了，日曆上也不畫（`isActive()` 濾掉），
 * 這一頁跟著同一個規矩 —— 兩邊看到的東西要一樣多。
 */
export const PROGRESS_STATUSES = ['pending_confirm', 'confirmed', 'done', 'no_show'];

const emptyTally = () => Object.fromEntries(PROGRESS_STATUSES.map((s) => [s, 0]));

/**
 * 一個月的進度。
 *
 * @param {object} ctx
 * @param {object[]} ctx.customers 全部客戶（已停用的呼叫端先濾掉）
 * @param {object[]} ctx.visits 這個月的來訪（呼叫端照月份範圍撈好）
 * @param {string} ctx.month 'YYYY-MM'
 * @param {{courses?:object[], equipment?:object[], ivProducts?:object[]}} [ctx.master]
 *   那一段叫什麼要問主檔（`domain/naming.js`）。**沒帶就退回快照** ——
 *   既有呼叫端不會突然變成一片空白，只是印回舊的那個名字。
 * @returns {{month:string, range:object|null, rows:object[], idle:object[], totals:object}}
 */
export function buildProgress({ customers = [], visits = [], month, master = {} }) {
  const range = monthRange(month);
  if (!range) return { month, range: null, rows: [], idle: [], totals: emptyTotals() };

  const inMonth = (visits ?? []).filter(
    (v) => isActive(v)
      && isValidDate(v.date)
      && v.date >= range.from
      && v.date <= range.to,
  );

  const byCustomer = new Map();
  for (const visit of inMonth) {
    if (!byCustomer.has(visit.customerId)) byCustomer.set(visit.customerId, []);
    byCustomer.get(visit.customerId).push(visit);
  }

  const alive = (customers ?? []).filter((c) => !c.deletedAt);
  const rows = [];
  const idle = [];

  for (const customer of alive) {
    const mine = byCustomer.get(customer.id) ?? [];
    if (!mine.length) {
      idle.push({ id: customer.id, name: customer.name ?? '（沒有名字）' });
      continue;
    }
    rows.push(rowFor(customer, mine, false, master));
    byCustomer.delete(customer.id);
  }

  // 來訪指到一位不存在（或已刪除）的客戶。孤兒資料資料健檢會報，
  // 但這一頁不能因此把那幾段吞掉 —— 看不見的壞資料比看得見的難修。
  for (const [customerId, mine] of byCustomer) {
    rows.push(rowFor({ id: customerId, name: mine[0]?.customerName ?? null }, mine, true, master));
  }

  rows.sort(byName);
  idle.sort(byName);

  return { month, range, rows, idle, totals: totalsOf(rows, idle) };
}

function rowFor(customer, visits, orphan = false, master = {}) {
  const days = visits
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((v) => dayFor(v, master));

  const tally = emptyTally();
  let slotCount = 0;
  for (const day of days) {
    for (const slot of day.slots) {
      slotCount += 1;
      if (slot.status in tally) tally[slot.status] += 1;
    }
  }

  return {
    customerId: customer.id,
    customerName: customer.name ?? '（沒有名字）',
    orphan,
    days,
    slotCount,
    tally,
  };
}

/**
 * 一天一組、一段一列。
 *
 * ## 名字在這裡算好，不把 id 搬給畫面（2026-09-10）
 *
 * 這一支以前只搬了 `slot.courseName` 快照，於是進度追蹤那一列寫「復能」、
 * 月曆上寫「SIS(30)」，而她會以為那是兩筆（ADR-0078）。
 *
 * 修法有兩種：把 `courseId` / `equipmentId` / `ivProductId` 搬過去讓畫面自己算，
 * 或在這裡算好。**選了後者** —— `slotName()` 讀的不只那三個 id，還有
 * `followupNth`（n返讀快照，不然日曆上一段三返會印成「二返」）與
 * 起訖時間（後面那個分鐘）。搬一份子集等於在別的地方重寫一次
 * 「它要哪幾格」，而漏掉一格的症狀全都是安靜的。這裡收的是整個 `slot`，
 * 沒有東西可以漏。
 *
 * 同一個理由讓畫面那一支 `progressDayHtml()` 維持只收一個參數 ——
 * 它是**兩個畫面共用**的（進度追蹤與客戶詳情的「這個月」），
 * 多一個參數就是多一個會被忘記帶的地方。
 */
function dayFor(visit, master = {}) {
  return {
    visitId: visit.id,
    date: visit.date,
    status: visit.status,
    // 這個狀態是什麼時候變成現在這樣的。`statusAt` 是 2026-08 才加的欄位
    // （ADR-0025 那一批），舊來訪沒有 —— 沒有就說沒有，不要拿建立時間硬充。
    statusAt: visit.statusAt ?? null,
    note: visit.note ?? null,
    slots: (visit.slots ?? [])
      .map((slot, index) => ({
        index,
        // **那天做了什麼**（`SIS(30)`、`雪`），不是快照那一格（ADR-0078）
        name: slotName(slot, master, 'short'),
        startsAt: slot.startsAt ?? null,
        endsAt: slot.endsAt ?? null,
        status: slotStatus(visit, slot),
      }))
      .sort(byStart),
  };
}

/** 沒有時間的排最後 —— 匯入的舊來訪沒記過時間（ADR-0011），不是排在半夜。 */
function byStart(a, b) {
  const at = isValidTime(a.startsAt) ? toMinutes(a.startsAt) : Infinity;
  const bt = isValidTime(b.startsAt) ? toMinutes(b.startsAt) : Infinity;
  return at - bt || a.index - b.index;
}

const byName = (a, b) =>
  String(a.customerName ?? a.name ?? '').localeCompare(
    String(b.customerName ?? b.name ?? ''), 'zh-TW',
  );

function emptyTotals() {
  return { customers: 0, idle: 0, slots: 0, tally: emptyTally() };
}

function totalsOf(rows, idle) {
  const totals = emptyTotals();
  totals.customers = rows.length;
  totals.idle = idle.length;
  for (const row of rows) {
    totals.slots += row.slotCount;
    for (const status of PROGRESS_STATUSES) totals.tally[status] += row.tally[status];
  }
  return totals;
}
