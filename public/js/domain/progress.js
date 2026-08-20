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
 * @returns {{month:string, range:object|null, rows:object[], idle:object[], totals:object}}
 */
export function buildProgress({ customers = [], visits = [], month }) {
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
    rows.push(rowFor(customer, mine));
    byCustomer.delete(customer.id);
  }

  // 來訪指到一位不存在（或已刪除）的客戶。孤兒資料資料健檢會報，
  // 但這一頁不能因此把那幾段吞掉 —— 看不見的壞資料比看得見的難修。
  for (const [customerId, mine] of byCustomer) {
    rows.push(rowFor({ id: customerId, name: mine[0]?.customerName ?? null }, mine, true));
  }

  rows.sort(byName);
  idle.sort(byName);

  return { month, range, rows, idle, totals: totalsOf(rows, idle) };
}

function rowFor(customer, visits, orphan = false) {
  const days = visits
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(dayFor);

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

function dayFor(visit) {
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
        courseName: slot.courseName ?? null,
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
