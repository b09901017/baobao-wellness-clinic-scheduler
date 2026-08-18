// 壓表佇列：這個月這個課程還沒排的人有誰，先看誰。純函式。
//
// 兩件事要分清楚（docs/adr/0001-scheduling-queue-state-is-derived.md）：
//
// - **「待壓表」是推導出來的**，不存欄位：有剩餘次數、而且該月還沒有這個課程的來訪。
//   存成欄位就要在每次建立／取消／改期／完成來訪時同步維護，漏改就會自相矛盾。
// - **佇列順序是凍結的**：批次建立當下算好就固定，換裝置回來不會跳動。
//   但每一列的即時資訊（剩餘次數、可用天數）仍然現算。
//
// 排序只是預設順序，不是規定的處理順序 —— 她隨時可以跳著點
// （docs/adr/0002-app-records-decisions-it-does-not-make-them.md）。
// 所以每一項的貢獻都要攤成人話標籤，讓她看得懂為什麼這人排第一，不同意就跳過去。

import { counts } from './entitlements.js';
import { availableDates, currentCollection } from './availability.js';
import { isActive } from './visits.js';
import { daysBetween, isValidDate, lastDayOf } from './dates.js';

export const DEFAULT_WEIGHTS = { w1: 1.0, w2: 0.8, w3: 0.6, w4: 0.3 };

/** 喜好程度 0–5（SPEC 第 5.3 節）。0 是還沒評，不是最低。 */
const MAX_PRIORITY = 5;

/** 距上次上課超過這個天數就算「很久沒來」，再久也不會更急。 */
const STALE_DAYS = 30;

/** 'YYYY-MM' → { from, to } */
export function monthRange(targetMonth) {
  const [y, m] = String(targetMonth ?? '').split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDayOf(y, m))}` };
}

/**
 * 這筆額度是不是這個課程的。
 *
 * 擇一池上沒有 courseId（ADR-0005），它對應的是「需要選器材的課程」。
 * 這裡沿用同一個推導，不另外存欄位。
 */
export function entitlementCovers(entitlement, course) {
  if (!entitlement || entitlement.deletedAt) return false;
  if (entitlement.type === 'pool') return !!course?.requiresEquipment;
  return entitlement.courseId === course?.id;
}

/**
 * 一位客戶在這個月、這個課程上待不待壓表。
 *
 * @returns {{pending:boolean, entitlement:object|null, remaining:number,
 *            total:number, scheduled:number}}
 *   scheduled 是該月已經排了幾次 —— 有排過不代表排夠了，
 *   但第一版照 ADR-0001 的定義：該月有對應來訪就不算待壓表。
 */
export function pendingFor({ course, entitlements = [], visits = [], targetMonth, cached = true }) {
  const range = monthRange(targetMonth);
  const mine = entitlements.filter((e) => entitlementCovers(e, course));
  if (!mine.length || !range) {
    return { pending: false, entitlement: null, remaining: 0, total: 0, scheduled: 0 };
  }

  // 清單頁讀計數欄位、詳情與工單現算 —— ADR-0004
  const remainingOf = (e) =>
    cached
      ? (e.totalQty ?? 0) - (e.doneCount ?? 0) - (e.bookedCount ?? 0)
      : counts(e, visits, e.id).remaining;

  const entitlement = mine.slice().sort((a, b) => remainingOf(b) - remainingOf(a))[0];
  const remaining = remainingOf(entitlement);

  const scheduled = visits.filter(
    (v) =>
      isActive(v)
      && isValidDate(v.date)
      && v.date >= range.from
      && v.date <= range.to
      && (v.slots ?? []).some((s) => s.courseId === course?.id),
  ).length;

  return {
    pending: remaining > 0 && scheduled === 0,
    entitlement,
    remaining,
    total: entitlement.totalQty ?? 0,
    scheduled,
  };
}

/**
 * 建立一個批次的佇列：算出待排的人並排好序。
 *
 * 每一項的貢獻都會出現在 reasons 裡（SPEC 第 9 節：不要只給黑盒分數）。
 *
 * @param {object} ctx
 * @param {object} ctx.course 這批在壓哪個課程
 * @param {object[]} ctx.customers 在服務中的客戶
 * @param {Record<string, object[]>} ctx.entitlementsBy 客戶 id → 額度
 * @param {Record<string, object[]>} ctx.visitsBy 客戶 id → 來訪（近期即可）
 * @param {Record<string, object[]>} ctx.availabilityBy 客戶 id → 可用性收集
 * @param {string} ctx.targetMonth 'YYYY-MM'
 * @param {string} ctx.today
 * @param {object} [ctx.weights]
 * @param {boolean} [ctx.includeNotPending] 連已經排過的也算一份即時資訊。
 *   開著的批次要用：佇列順序是凍結的，已經處理掉的那幾位仍然要看得到目前狀況。
 * @returns {object[]} 依分數由高到低，同分時姓名排序（每次算出來要一樣）
 */
export function buildQueue({
  course, customers = [], entitlementsBy = {}, visitsBy = {}, availabilityBy = {},
  targetMonth, today, weights = DEFAULT_WEIGHTS, includeNotPending = false,
}) {
  const range = monthRange(targetMonth);
  if (!course || !range) return [];

  const rows = [];
  for (const customer of customers) {
    if (customer.active === false || customer.deletedAt) continue;

    const visits = visitsBy[customer.id] ?? [];
    const state = pendingFor({
      course,
      entitlements: entitlementsBy[customer.id] ?? [],
      visits,
      targetMonth,
    });
    if (!state.pending && !includeNotPending) continue;

    rows.push({
      ...rowFor({ customer, state, visits, availability: availabilityBy[customer.id] ?? [], range, today }),
      pending: state.pending,
      scheduledThisMonth: state.scheduled,
    });
  }

  // 「最少」是跟同一批人比出來的，所以要等全部算完才知道是誰
  const fewest = Math.min(...rows.map((r) => r.availableDays ?? Infinity));

  return rows
    .map((row) => scoreRow(row, weights, range, fewest))
    .sort((a, b) => b.score - a.score || String(a.customerName).localeCompare(String(b.customerName), 'zh-TW'));
}

function rowFor({ customer, state, visits, availability, range, today }) {
  const collection = currentCollection(availability, today);
  const rules = collection?.rules ?? [];

  // 可用日只算在這個月裡面的 —— 她問的就是這個月
  const from = collection?.validFrom && collection.validFrom > range.from ? collection.validFrom : range.from;
  const to = collection?.validTo && collection.validTo < range.to ? collection.validTo : range.to;
  const free = collection ? availableDates(rules, from, to) : null;

  const last = visits
    .filter((v) => isActive(v) && isValidDate(v.date) && v.date <= today)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0] ?? null;

  const expiresAt = state.entitlement?.expiresAt ?? customer.membershipExpiresAt ?? null;

  return {
    customerId: customer.id,
    customerName: customer.name,
    priority: customer.priority ?? 0,
    flags: customer.flags ?? [],
    entitlementId: state.entitlement?.id ?? null,
    entitlementLabel: state.entitlement?.label ?? null,
    remaining: state.remaining,
    total: state.total,
    availableDays: free ? free.length : null,
    availableDates: free ?? [],
    rules,
    rawText: collection?.rawText ?? null,
    collectedAt: collection?.collectedAt ?? null,
    needsAvailability: !collection,
    daysSinceLast: last ? daysBetween(last.date, today) : null,
    lastVisitDate: last?.date ?? null,
    expiresAt,
    daysToExpiry: isValidDate(expiresAt) ? daysBetween(today, expiresAt) : null,
    reasons: [],
  };
}

/**
 * SPEC 第 9 節的公式。
 *
 * 每一項都夾在 0–1 之間再乘權重 —— 公式原文沒有夾，但不夾的話「距上次 180 天」
 * 會貢獻 6 倍，其他三項就等於不存在了，權重也失去意義。
 */
function scoreRow(row, weights, range, fewest) {
  const w = { ...DEFAULT_WEIGHTS, ...(weights ?? {}) };
  const monthDays = daysBetween(range.from, range.to) + 1;
  const reasons = [];

  // 限制越多越優先
  const tightness = row.availableDays === null ? 0 : clamp(1 - row.availableDays / monthDays);
  if (row.needsAvailability) {
    reasons.push({ key: 'ask', label: '還沒問這輪的時間', contribution: 0 });
  } else {
    reasons.push({
      key: 'available',
      label: `可用 ${row.availableDays} 天${row.availableDays === fewest ? '・最少' : ''}`,
      contribution: w.w1 * tightness,
    });
  }

  const liking = clamp((row.priority ?? 0) / MAX_PRIORITY);
  if (row.priority) {
    reasons.push({ key: 'priority', label: `喜好 ★${row.priority}`, contribution: w.w2 * liking });
  }

  // 快到期又剩很多次
  let urgency = 0;
  if (row.daysToExpiry !== null && row.remaining > 0) {
    urgency = clamp(row.remaining / Math.max(row.daysToExpiry, 1) );
    reasons.push({
      key: 'expiry',
      label: `${row.expiresAt} 到期・剩 ${row.remaining} 次`,
      contribution: w.w3 * urgency,
    });
  }

  // 太久沒來。沒來過的當成很久沒來 —— 買了方案卻一次都沒上，會籍照樣在跑。
  const gap = row.daysSinceLast === null ? 1 : clamp(row.daysSinceLast / STALE_DAYS);
  reasons.push({
    key: 'gap',
    label: row.daysSinceLast === null ? '還沒上過課' : `距上次 ${row.daysSinceLast} 天`,
    contribution: w.w4 * gap,
  });

  const score = w.w1 * tightness + w.w2 * liking + w.w3 * urgency + w.w4 * gap;
  return { ...row, score, reasons: reasons.sort((a, b) => b.contribution - a.contribution) };
}

const clamp = (n) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

/** 手機一列只放得下一個標籤，放貢獻最大的那個。 */
export function strongestReason(row) {
  return (row?.reasons ?? [])[0] ?? null;
}

// ---------- 批次 ----------

export const QUEUE_STATES = ['pending', 'done', 'skipped'];

/** 從佇列建一個新批次。順序在這一刻凍結。 */
export function newBatch({ course, targetMonth, rows }) {
  return {
    courseId: course.id,
    courseName: course.name,
    targetMonth,
    queue: rows.map((r) => ({
      customerId: r.customerId,
      customerName: r.customerName,
      state: 'pending',
      skippedReason: null,
    })),
    cursor: null,
    status: 'active',
    lastDeviceHint: null,
  };
}

/**
 * 進度。**由每一筆的 state 推導，不從 cursor 推** ——
 * 她是跳著處理的，cursor 只記「最後停在哪一位」。
 */
export function progressOf(batch) {
  const queue = batch?.queue ?? [];
  const done = queue.filter((q) => q.state === 'done').length;
  const skipped = queue.filter((q) => q.state === 'skipped').length;
  return { total: queue.length, done, skipped, handled: done + skipped, pending: queue.length - done - skipped };
}

/** 標記某一位的狀態。回傳新的 queue，不改原本的。 */
export function markInQueue(batch, customerId, state, skippedReason = null) {
  return (batch?.queue ?? []).map((q) =>
    q.customerId === customerId
      ? { ...q, state, skippedReason: state === 'skipped' ? skippedReason : null }
      : q,
  );
}

/** 下一位還沒處理的。處理完可以直接往下一位，也可以回綜覽自己挑。 */
export function nextPending(batch, afterCustomerId = null) {
  const queue = batch?.queue ?? [];
  const start = afterCustomerId ? queue.findIndex((q) => q.customerId === afterCustomerId) + 1 : 0;
  return (
    queue.slice(start).find((q) => q.state === 'pending')
    ?? queue.find((q) => q.state === 'pending')
    ?? null
  );
}
