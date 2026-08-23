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
import { availableDates, collectionFor, currentCollection, dayStatus } from './availability.js';
import { isActive } from './visits.js';
import { annotateOptions } from './contraindications.js';
import { overlaps, toMinutes } from './visitTime.js';
import { daysBetween, isValidDate, lastDayOf } from './dates.js';
import { readMarks } from './customerMarks.js';
import { bookingSystemFor } from './taskRules.js';

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
 * 一位客戶身上所有還算數的額度，一份一個數字。
 *
 * 壓表卡片上「一個課程一顆泡泡」用的就是這個。使用者說過「壓復能的時候只要看到
 * 復能的剩餘次數就好」，那句話講的是資訊密度不是批次切法（ADR-0014）——
 * 一列泡泡掃得完，不會變成十二種課程的大表。
 *
 * @param {object} ctx
 * @param {object[]} ctx.entitlements
 * @param {object[]} [ctx.visits] cached 為 false 時才需要，用來現算
 * @param {boolean} [ctx.cached] 清單頁讀計數欄位、詳情現算 —— ADR-0004
 * @returns {{pools: object[], totalRemaining: number, soonestExpiry: string|null}}
 */
export function customerPools({ entitlements = [], visits = [], cached = true }) {
  const pools = [];

  for (const e of entitlements) {
    if (!e || e.deletedAt) continue;

    const c = cached
      ? {
          done: e.doneCount ?? 0,
          booked: e.bookedCount ?? 0,
          remaining: (e.totalQty ?? 0) - (e.doneCount ?? 0) - (e.bookedCount ?? 0),
        }
      : counts(e, visits, e.id);

    pools.push({
      entitlementId: e.id,
      label: e.label ?? '（沒有名稱）',
      type: e.type ?? 'single',
      courseId: e.courseId ?? null,
      optionEquipmentIds: e.optionEquipmentIds ?? [],
      total: e.totalQty ?? 0,
      done: c.done,
      booked: c.booked,
      remaining: c.remaining,
      expiresAt: e.expiresAt ?? null,
    });
  }

  // 快用完的排前面 —— 她要先看到「這個只剩一次了」
  pools.sort((a, b) => a.remaining - b.remaining || String(a.label).localeCompare(String(b.label), 'zh-TW'));

  const withLeft = pools.filter((p) => p.remaining > 0 && isValidDate(p.expiresAt));
  const soonestExpiry = withLeft.length
    ? withLeft.map((p) => p.expiresAt).sort()[0]
    : null;

  return {
    pools,
    totalRemaining: pools.reduce((sum, p) => sum + Math.max(0, p.remaining), 0),
    soonestExpiry,
  };
}

/** 某一段期間內她自己排的來訪有幾次。 */
function visitCountIn(visits, from, to) {
  return (visits ?? []).filter(
    (v) => isActive(v) && isValidDate(v.date) && v.date >= from && v.date <= to,
  ).length;
}

/**
 * 建立一個批次的佇列：這個月還壓得動的人有誰，先看誰。
 *
 * **一批是一個月的一串客戶，不是一個課程**（ADR-0014）。她面對的是公司系統上
 * 的一張時段表，看到空的就搶，而且習慣把一個客人的所有課程壓完再換下一個人。
 *
 * 只要身上還有任何一份額度有剩就進來 —— 這個月已經排過的**不會**被排除，
 * 因為客戶一個月本來就會來好幾次。「這個月還沒壓過」是卡片牆上的一個篩選，
 * 不是進不進佇列的條件。
 *
 * 每一項的貢獻都會出現在 reasons 裡（SPEC 第 9 節：不要只給黑盒分數）。
 *
 * @param {object} ctx
 * @param {object[]} ctx.customers 在服務中的客戶
 * @param {Record<string, object[]>} ctx.entitlementsBy 客戶 id → 額度
 * @param {Record<string, object[]>} ctx.visitsBy 客戶 id → 來訪（近期即可）
 * @param {Record<string, object[]>} ctx.availabilityBy 客戶 id → 可用性收集
 * @param {string} ctx.targetMonth 'YYYY-MM'
 * @param {string} ctx.today
 * @param {object} [ctx.weights]
 * @param {boolean} [ctx.includeUsedUp] 連次數用完的也留著。開著的批次要用：
 *   佇列順序是凍結的，處理到一半把人弄不見比留著更難懂。
 * @returns {object[]} 依分數由高到低，同分時姓名排序（每次算出來要一樣）
 */
export function buildCustomerQueue({
  customers = [], entitlementsBy = {}, visitsBy = {}, availabilityBy = {},
  targetMonth, today, weights = DEFAULT_WEIGHTS, includeUsedUp = false,
}) {
  const range = monthRange(targetMonth);
  if (!range) return [];

  const prev = monthRange(prevMonthOf(targetMonth));

  const rows = [];
  for (const customer of customers) {
    if (customer.active === false || customer.deletedAt) continue;

    const visits = visitsBy[customer.id] ?? [];
    const { pools, totalRemaining, soonestExpiry } = customerPools({
      entitlements: entitlementsBy[customer.id] ?? [],
      visits,
    });

    if (totalRemaining <= 0 && !includeUsedUp) continue;

    // rowFor 要一份「代表性的額度」來算急迫度。用最快到期的那一份 ——
    // 會籍在跑而次數沒上完，急的是那一份。
    const lead = pools.find((p) => p.remaining > 0 && p.expiresAt === soonestExpiry) ?? pools[0] ?? null;
    const state = {
      entitlement: lead ? { id: lead.entitlementId, label: lead.label, expiresAt: lead.expiresAt } : null,
      remaining: totalRemaining,
      total: pools.reduce((sum, p) => sum + p.total, 0),
    };

    const scheduledThisMonth = visitCountIn(visits, range.from, range.to);

    rows.push({
      ...rowFor({
        customer, state, visits,
        availability: availabilityBy[customer.id] ?? [],
        range, today,
      }),
      pools,
      totalRemaining,
      scheduledThisMonth,
      visitsPrevMonth: prev ? visitCountIn(visits, prev.from, prev.to) : 0,
      // 她掛在這位客戶身上的備註。系統算出來的東西不要跟這些混在一起。
      marks: readMarks(customer),
      pending: scheduledThisMonth === 0,
    });
  }

  // 「最少」是跟同一批人比出來的，所以要等全部算完才知道是誰
  const fewest = Math.min(...rows.map((r) => r.availableDays ?? Infinity));

  return rows
    .map((row) => scoreRow(row, weights, range, fewest))
    .sort((a, b) => b.score - a.score || String(a.customerName).localeCompare(String(b.customerName), 'zh-TW'));
}

/** 'YYYY-MM' 的上一個月。 */
function prevMonthOf(targetMonth) {
  const [y, m] = String(targetMonth ?? '').split('-').map(Number);
  if (!y || !m) return '';
  const total = y * 12 + (m - 1) - 1;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/**
 * 一列的即時資訊。壓表與時段反查共用（見下面「時段反查」那一段的理由）。
 *
 * **可用性是照 `range` 挑的，不是照 `today`。** 她八月坐下來壓的是九月的表，
 * 而九月那一份在八月還沒生效；反過來，九月那一份也不該被拿去講八月的事。
 * 這一段期間沒問過就是 `needsAvailability`，而不是拿另一個月的答案硬算 ——
 * 見 `docs/adr/0036-availability-is-picked-by-the-month-being-scheduled.md`。
 */
function rowFor({ customer, state, visits, availability, range, today }) {
  const collection = collectionFor(availability, range.from, range.to);
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
    // 這一份講的是哪一段期間。UI 要講得出「問的是哪個月」，
    // 不然「還沒問」與「問過但那是別的月份」在畫面上長得一樣。
    askedFrom: collection?.validFrom ?? null,
    askedTo: collection?.validTo ?? null,
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

// ---------- 卡片牆的排序 ----------
//
// 預設順序是分數算出來的（上面那一段），而分數是一個把四件事揉成一個數字的東西。
// 她坐下來壓表的時候心裡想的常常只有其中一件：「先弄有問到時間的」「先弄喜歡的」
// 「先弄剩最多次的」。那時候她要的不是另一套分數，是**把同一份名單換個方式排**。
//
// 所以這裡只有比較函式，沒有第二組計分 —— `CLAUDE.md` 那條「先看誰用同一組計分」
// 沒有被推翻：每一種排法都是同一批 row、同一組 reasons，換的只是先看哪一欄。
// 見 `docs/adr/0037-the-wall-can-be-re-sorted-but-never-re-scored.md`。
//
// 每一種都是穩定排序，所以**同一個值的那幾位仍然照預設順序**（分數排出來的那個）。

export const QUEUE_SORTS = [
  { id: 'default', label: '預設' },
  { id: 'asked', label: '問到時間的先' },
  { id: 'priority', label: '喜好' },
  { id: 'remaining', label: '剩最多次' },
  { id: 'gap', label: '最久沒來' },
];

/**
 * 「還沒上過課」在「最久沒來」這一欄要排最前面 —— 買了方案一次都沒上，
 * 比上個月來過的更久。`scoreRow()` 的第四項也是這樣算的（給滿分）。
 */
const gapOf = (row) => (row?.daysSinceLast === null || row?.daysSinceLast === undefined
  ? Infinity
  : row.daysSinceLast);

const COMPARE = {
  default: null,
  asked: (a, b) => Number(!!a.needsAvailability) - Number(!!b.needsAvailability),
  priority: (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
  remaining: (a, b) => (b.totalRemaining ?? 0) - (a.totalRemaining ?? 0),
  gap: (a, b) => gapOf(b) - gapOf(a),
};

/**
 * 把卡片牆的順序換一種排法。
 *
 * @param {object[]} rows 已經照預設順序排好的那一份（批次是凍結的那個順序）
 * @param {string} [sortId] `QUEUE_SORTS` 的 id，不認得就當預設
 * @returns {object[]} 新的陣列，不改原本的
 */
export function sortQueueRows(rows = [], sortId = 'default') {
  const compare = COMPARE[sortId];
  return compare ? [...rows].sort(compare) : [...rows];
}

/**
 * 這一輪的時間還沒問到誰。待辦中心的「問這輪的時間」那一列。
 *
 * 在她的流程裡這是**第一步**，發生在壓表之前，所以不能只出現在壓表卡片牆上 ——
 * 她得先開一個批次才知道要問誰，而那時候已經太晚了。
 *
 * 兩道條件都不是新的，都用這一支既有的推導：
 *
 * - **值不值得問**：`customerPools()` 的 `totalRemaining > 0`，和
 *   `buildCustomerQueue()` 用的是同一道濾網。次數用完的人本來就不用排。
 * - **問到了沒**：`currentCollection()` 是不是 null。它已經把過期的濾掉了，
 *   所以「從來沒問過」和「問過但過期了」自動一起算進來 —— 過期即失效、
 *   需重新詢問（SPEC 第 4.3 節），那本來就是同一件待辦。
 *
 * **刻意不收 visits，也不算分數。** 這一頁不是「先看誰」而是「先問誰」：
 * 她是整批問完，不是挑一個。分數要的 `daysSinceLast` 得多讀半年的來訪，
 * 而沒有那份資料時每個人那一項都會拿滿分，排出來等於沒排 —— 用一個假的順序
 * 換一次查詢不划算。改成用手上就有的東西排：**從來沒問過的最前面，
 * 其餘最久沒問的先**。次數也走 `cached`（額度上的計數欄位，ADR-0004），
 * 同樣不必讀來訪。
 *
 * @param {object} ctx
 * @param {object[]} ctx.customers
 * @param {Record<string, object[]>} ctx.entitlementsBy 客戶 id → 額度
 * @param {Record<string, object[]>} ctx.availabilityBy 客戶 id → 可用性收集
 * @param {string} ctx.today
 * @returns {{customerId:string, customerName:string, remaining:number,
 *            state:'never'|'expired', lastAskedAt:string|null,
 *            daysSinceAsked:number|null}[]}
 */
export function customersToAsk({
  customers = [], entitlementsBy = {}, availabilityBy = {}, today,
}) {
  const rows = [];

  for (const customer of customers) {
    if (customer.active === false || customer.deletedAt) continue;

    const { totalRemaining } = customerPools({ entitlements: entitlementsBy[customer.id] ?? [] });
    if (totalRemaining <= 0) continue;

    const collections = (availabilityBy[customer.id] ?? []).filter((c) => !c.deletedAt);
    if (currentCollection(collections, today)) continue;

    // 最後一次是什麼時候問的。收集日期壞掉的那幾筆跳過 —— 那是「不知道什麼時候」，
    // 不是「今天」，而編一個日期出來會讓她以為最近問過。
    const lastAskedAt = collections
      .map((c) => c.collectedAt)
      .filter(isValidDate)
      .sort()
      .pop() ?? null;

    rows.push({
      customerId: customer.id,
      customerName: customer.name,
      remaining: totalRemaining,
      // 有紀錄但現在沒有一份有效 = 該重問了；一筆紀錄都沒有 = 從來沒問過。
      // 兩種是不一樣的問題，畫面上要分得出來。
      state: collections.length ? 'expired' : 'never',
      lastAskedAt,
      daysSinceAsked: lastAskedAt && isValidDate(today) ? daysBetween(lastAskedAt, today) : null,
    });
  }

  return rows.sort((a, b) => {
    if (a.state !== b.state) return a.state === 'never' ? -1 : 1;
    return String(a.lastAskedAt ?? '').localeCompare(String(b.lastAskedAt ?? ''))
      || String(a.customerName).localeCompare(String(b.customerName), 'zh-TW');
  });
}

/**
 * 這個月還有誰沒壓表，以及那一位要去哪個系統登記。
 *
 * 待辦中心那一列「壓表登記」（SPEC 第 8.1 節）。跟 `customersToAsk()` 一樣
 * 是**推導出來的提醒，不是佇列**：它不排序、不計分，只回答「還有誰」。
 * 「先壓誰」是壓表那一頁的事（ADR-0028 的同一個理由）。
 *
 * **按系統分，不是按課程分。** 一位客戶身上可能同時有健檢與復能還沒排，
 * 而那是要分別去做的兩件事：健檢直接在 Examine 上登記，其餘在 Abovee 上
 * 壓格子（ADR-0041）。所以同一位客戶兩區都會出現，那是對的。
 *
 * 剩餘次數讀計數欄位不現算（ADR-0004：清單頁讀快取）—— 這一列是提醒，
 * 不是對帳。
 *
 * @param {object} ctx
 * @param {object[]} ctx.customers 在服務中的客戶
 * @param {Record<string, object[]>} ctx.entitlementsBy 客戶 id → 額度
 * @param {Record<string, object[]>} ctx.visitsBy 客戶 id → 來訪
 * @param {Record<string, object>} ctx.coursesById 課程主檔
 * @param {string} ctx.targetMonth 'YYYY-MM'
 * @returns {{customerId:string, customerName:string, priority:number,
 *            flags:string[], marks:object[],
 *            systems:{system:string, pools:{label:string, remaining:number}[]}[]}[]}
 */
export function customersToBook({
  customers = [], entitlementsBy = {}, visitsBy = {}, coursesById = {}, targetMonth,
}) {
  const range = monthRange(targetMonth);
  if (!range) return [];

  const rows = [];

  for (const customer of customers) {
    if (customer.active === false || customer.deletedAt) continue;

    const { pools } = customerPools({ entitlements: entitlementsBy[customer.id] ?? [] });
    const visits = visitsBy[customer.id] ?? [];

    // 這個月已經動過哪幾個系統。一位客戶這個月已經排了復能，Abovee 那一區
    // 就沒有他了 —— 她那一格已經壓過了。
    const booked = new Set();
    for (const v of visits) {
      if (!isActive(v) || !isValidDate(v.date) || v.date < range.from || v.date > range.to) continue;
      for (const slot of v.slots ?? []) {
        booked.add(bookingSystemFor(coursesById[slot.courseId]?.category));
      }
    }

    const bySystem = new Map();
    for (const pool of pools) {
      if (pool.remaining <= 0) continue;
      const system = bookingSystemFor(systemCategoryOf(pool, coursesById));
      if (booked.has(system)) continue;
      if (!bySystem.has(system)) bySystem.set(system, []);
      bySystem.get(system).push({ label: pool.label, remaining: pool.remaining });
    }

    if (!bySystem.size) continue;

    rows.push({
      customerId: customer.id,
      customerName: customer.name,
      priority: customer.priority ?? 0,
      flags: customer.flags ?? [],
      marks: readMarks(customer),
      systems: [...bySystem].map(([system, poolsIn]) => ({ system, pools: poolsIn })),
    });
  }

  return rows.sort((a, b) =>
    String(a.customerName).localeCompare(String(b.customerName), 'zh-TW'));
}

/**
 * 一份額度對應到哪個課程類別。
 *
 * 擇一池沒有 `courseId`（ADR-0005），它對應的是「需要選器材的課程」＝ 復能，
 * 而那是 C 類。這裡不去反查主檔 —— 池子只有這一種，多繞一圈只是多一個
 * 對不上就靜默出錯的接縫。
 */
function systemCategoryOf(pool, coursesById) {
  if (pool.type === 'pool') return 'C';
  return coursesById[pool.courseId]?.category ?? null;
}

// ---------- 批次 ----------

export const QUEUE_STATES = ['pending', 'done', 'skipped'];

/**
 * 從佇列建一個新批次。順序在這一刻凍結。
 *
 * 沒有 courseId —— 一批是一個月的一串客戶，不是一個課程（ADR-0014）。
 */
export function newBatch({ targetMonth, rows }) {
  return {
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

// ---------- 時段反查 ----------
//
// SPEC 第 8.4 節：Abovee 上臨時空出一格、或有人取消釋出時段時，誰可以補。
//
// 刻意跟壓表佇列共用同一組 rowFor() / scoreRow()：兩個畫面問的是同一個問題
// （「這些人裡面先找誰」），只是範圍不一樣。分成兩套公式的話，同一位客戶
// 在壓表排第一、在反查排第五，而她沒有辦法知道哪一個才算數。
//
// 這裡仍然不做決定（ADR-0002）：排除掉的只有「那天他自己說不行」與醫療禁忌，
// 其餘一律列出來並附上理由，由她自己挑。

/** 一段時間碰到上午還是下午。中午 12 點以後算下午。 */
export function partsOfDay(startsAt, endsAt) {
  const start = toMinutes(startsAt);
  const end = toMinutes(endsAt ?? startsAt);
  const noon = 12 * 60;
  const parts = [];
  if (start < noon) parts.push('am');
  if (Math.max(end, start + 1) > noon) parts.push('pm');
  return parts;
}

/**
 * 誰可以補這一格。
 *
 * @param {object} ctx
 * @param {object} ctx.course 空出來的是哪個課程
 * @param {string} ctx.date 'YYYY-MM-DD'
 * @param {string} ctx.startsAt 'HH:MM'
 * @param {string} [ctx.endsAt]
 * @param {object[]} ctx.customers
 * @param {Record<string, object[]>} ctx.entitlementsBy
 * @param {Record<string, object[]>} ctx.visitsBy
 * @param {Record<string, object[]>} ctx.availabilityBy
 * @param {object[]} [ctx.equipment] 擇一池要看禁忌有沒有把器材全鎖死
 * @param {string} ctx.today
 * @param {object} [ctx.weights]
 * @returns {{candidates: object[], excluded: object[]}}
 *   excluded 也要回傳並顯示 —— 「他為什麼不在名單上」跟「誰在名單上」一樣重要，
 *   不然她會以為系統漏了人而不敢用。
 */
export function candidatesFor({
  course, date, startsAt, endsAt = null, customers = [], entitlementsBy = {},
  visitsBy = {}, availabilityBy = {}, equipment = [], today, weights = DEFAULT_WEIGHTS,
}) {
  const range = monthRange(String(date ?? '').slice(0, 7));
  if (!course || !isValidDate(date) || !range) return { candidates: [], excluded: [] };

  const parts = partsOfDay(startsAt, endsAt);
  const rows = [];
  const excluded = [];
  const drop = (customer, why) => excluded.push({ customerId: customer.id, customerName: customer.name, why });

  for (const customer of customers) {
    if (customer.active === false || customer.deletedAt) continue;

    const entitlements = entitlementsBy[customer.id] ?? [];
    const visits = visitsBy[customer.id] ?? [];
    const state = pendingFor({ course, entitlements, visits, targetMonth: range.from.slice(0, 7) });

    if (!state.entitlement) continue; // 根本沒買這個課程，不是「被排除」
    if (state.remaining <= 0) {
      drop(customer, `「${state.entitlement.label}」沒有剩餘次數了`);
      continue;
    }

    // 醫療禁忌是整個系統唯一的硬性阻擋（ADR-0002）。
    // 擇一池的器材被禁忌全部鎖死時，這個人真的不能來上這堂課。
    if (course.requiresEquipment && allEquipmentBlocked(customer, state.entitlement, equipment)) {
      drop(customer, '醫療禁忌把這個池裡的器材全部鎖住了');
      continue;
    }

    const clash = sameTimeVisit(visits, date, startsAt, endsAt);
    if (clash) {
      drop(customer, `${date} 這個時間他已經有來訪了`);
      continue;
    }

    // 那一天所在的那一份，不是今天有效的那一份 —— 空出來的格子可能在下個月。
    const collection = collectionFor(availabilityBy[customer.id] ?? [], date, date);
    const day = collection ? dayStatus(collection.rules ?? [], date) : null;

    if (day && !day.available) {
      drop(customer, `他說${date}不行：${day.reasons.join('、') || '這天不行'}`);
      continue;
    }
    if (day?.blockedPart && parts.includes(day.blockedPart)) {
      drop(customer, `他說${date}${day.blockedPart === 'am' ? '上午' : '下午'}不行`);
      continue;
    }

    const row = rowFor({
      customer, state, visits,
      availability: availabilityBy[customer.id] ?? [],
      range, today,
    });

    rows.push({
      ...row,
      // 這一格專屬的理由，跟排序理由分開放：她要先知道「這個人那天到底行不行」，
      // 再看「為什麼他排在前面」。
      fitNotes: fitNotes({ collection, day, visits, date }),
      sameDayVisit: sameDayVisit(visits, date),
    });
  }

  const fewest = Math.min(...rows.map((r) => r.availableDays ?? Infinity));
  const candidates = rows
    .map((row) => scoreRow(row, weights, range, fewest))
    .sort((a, b) => b.score - a.score || String(a.customerName).localeCompare(String(b.customerName), 'zh-TW'));

  return { candidates, excluded };
}

function fitNotes({ collection, day, visits, date }) {
  const notes = [];
  if (!collection) notes.push('沒問到那天的時間，不知道他那天行不行');
  else if (day?.preferred) notes.push('他說這天方便');
  else notes.push('這輪問到的條件沒有擋掉這天');

  if (sameDayVisit(visits, date)) notes.push('那天他本來就要來');
  return notes;
}

/** 那天他本來就有來訪。已經要來的人多排一個時段，比為了一格專程跑一趟容易答應。 */
function sameDayVisit(visits, date) {
  return (visits ?? []).find((v) => isActive(v) && v.date === date) ?? null;
}

/** 那個時間他人已經在別的療程上了。同一個人不可能同時在兩個地方。 */
function sameTimeVisit(visits, date, startsAt, endsAt) {
  const want = { startsAt, endsAt: endsAt ?? startsAt };
  return (visits ?? [])
    .filter((v) => isActive(v) && v.date === date)
    .find((v) => (v.slots ?? []).some((s) => overlaps(s, want))) ?? null;
}

function allEquipmentBlocked(customer, entitlement, equipment) {
  const ids = entitlement?.optionEquipmentIds ?? [];
  if (!ids.length) return false;
  const options = ids
    .map((id) => equipment.find((e) => e.id === id))
    .filter(Boolean);
  if (!options.length) return false;
  return annotateOptions(customer, options).every((o) => o.blocked);
}
