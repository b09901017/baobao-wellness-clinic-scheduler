// 一次建立一群客戶。純函式。
//
// 一場顧客會來了八位，她們的購買通路、購買日、方案全都一樣，只有姓名不一樣。
// `#/customers/new` 一次建一位、十個欄位，走八趟就是同一件事打八遍。
//
// 這一支的形狀是一句話：**共用的填一次，不一樣的才微調。**
//
// 兩半都要成立才有意義。只做前半（整批完全一樣）會逼她建完再一位一位進去改
// —— 她自己講的第二句就是「有人買這個方案＋健檢，或是沒有方案單純買復能，
// 或是單買 EECP」。只做後半（每一列什麼都能填）就變回八張表單並排，
// 那正是她說的「很雜」。
//
// 展開額度本身不在這裡，走 `domain/entitlements.js` 的 `expandPlan()` ——
// 「方案展開後與範本脫鉤」是 ADR-0003 的規則，只能有一份實作。
// 這裡只負責回答「這一位要用誰的數量、要不要套方案、加購接哪幾筆」。

import { expandPlan, validateEntitlement } from './entitlements.js';
import { toCustomerFields } from './customerMarks.js';
import { isValidDate } from './dates.js';

const trimmed = (v) => String(v ?? '').trim();

/** 一次最多貼幾位。超過通常是貼錯東西了（整張試算表之類的）。 */
export const MAX_ROWS = 60;

/**
 * 一段文字 → 一串名字。
 *
 * 她的名單在 LINE 上，一次貼進來八個名字要她自己拆開就等於沒有省到事。
 * 換行、逗號（半形與全形）、頓號、分號、Tab 都算分隔。
 *
 * **空白不算分隔** —— 中文姓名裡會有空白（「王 小明」是一個人），
 * 用空白切會把一位客戶切成兩位，而那兩位都會被建出來。
 */
export function parseNames(text) {
  return String(text ?? '')
    .split(/[\n\r,，、;；\t]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 名單上的一列。`overrides` 是空的就代表「跟大家一樣」。
 *
 * @param {string} name
 * @returns {{key:string, name:string, quantity:null, usePlan:true, extras:[]}}
 */
export function newRow(name, key) {
  return {
    key: key ?? `r${Math.random().toString(36).slice(2, 9)}`,
    name: trimmed(name),
    // null 代表「用整批的」。填了數字才是這一位自己的。
    quantity: null,
    usePlan: true,
    // 加購：[{ courseId, qty }]。方案之外多買的那幾筆。
    extras: [],
  };
}

/** 這一列有沒有被動過。沒動過的列在畫面上什麼都不多寫 —— 預設不需要標籤。 */
export function isAdjusted(row) {
  return row?.quantity != null || row?.usePlan === false || (row?.extras ?? []).length > 0;
}

/**
 * 重複的名字。
 *
 * **只提示不阻擋**（ADR-0002）—— 真的有兩位王小明是會發生的，
 * 而系統分不出「打錯了」跟「真的有兩位」。
 *
 * @param {object[]} rows
 * @param {object[]} existing 現有客戶
 * @returns {Map<string, {inList:number, existing:number}>} key → 重複狀況
 */
export function duplicatesOf(rows = [], existing = []) {
  const byName = new Map();
  for (const row of rows) {
    const name = trimmed(row.name);
    if (!name) continue;
    byName.set(name, (byName.get(name) ?? 0) + 1);
  }

  const existingCount = new Map();
  for (const c of existing) {
    if (c?.deletedAt) continue;
    const name = trimmed(c.name);
    if (!name) continue;
    existingCount.set(name, (existingCount.get(name) ?? 0) + 1);
  }

  const out = new Map();
  for (const row of rows) {
    const name = trimmed(row.name);
    if (!name) continue;
    const inList = (byName.get(name) ?? 1) - 1;
    const already = existingCount.get(name) ?? 0;
    if (inList || already) out.set(row.key, { inList, existing: already });
  }
  return out;
}

/**
 * 這一位實際要用的購買數量。她自己的優先，沒填就用整批的。
 * 兩處都沒有合法數字時回 1 —— 不要讓一個空欄位變成零額度。
 */
export function quantityFor(row, shared) {
  const own = Number(row?.quantity);
  if (Number.isInteger(own) && own > 0) return own;
  const batch = Number(shared?.quantity);
  return Number.isInteger(batch) && batch > 0 ? batch : 1;
}

/**
 * 一筆加購 → 一筆額度。
 *
 * 這裡只問兩件事：哪一個課程、幾次。其餘（型態、顯示名稱、時長）從課程主檔推。
 *
 * 客戶詳情頁那張加購表單有七個欄位，是給「這筆額度長得跟任何範本都不一樣」
 * 的情況用的。她在這一頁要的是「再給他三次健檢」，那張表單在這裡是噪音 ——
 * 真的要調那七欄，客戶建好之後進詳情頁調，那是一年兩次的事。
 *
 * @returns {object|null} 課程不存在就回 null，不要湊一筆出來
 */
export function extraToEntitlement(extra, coursesById, { purchasedAt = null } = {}) {
  const course = coursesById?.[extra?.courseId];
  if (!course) return null;

  const qty = Number(extra?.qty);
  return {
    type: 'single',
    label: course.name,
    courseId: course.id,
    optionEquipmentIds: null,
    totalQty: Number.isInteger(qty) && qty > 0 ? qty : 1,
    durationMin: course.durationMin ?? null,
    frequencyRule: course.frequencyRule ?? null,
    // 單項加購，不是從範本展開的
    sourcePlanName: null,
    purchasedAt,
    expiresAt: null,
    doneCount: 0,
    bookedCount: 0,
    lastReconciledAt: null,
  };
}

/**
 * 這一位身上會長出哪幾筆額度。
 *
 * 方案的部分交給 `expandPlan()`（ADR-0003），加購接在後面。
 * 兩者合起來才是完整的一份 —— 分開回傳的話呼叫端遲早會有一條路只寫了一半，
 * 而那一半的症狀是「她的健檢沒有二返」，要等幾週後她真的要記一筆二返才發現。
 *
 * @param {object} row 名單上的一列
 * @param {object} shared 整批共用的欄位
 * @param {{plan?: object|null, coursesById?: object}} ctx
 * @returns {object[]}
 */
export function entitlementsFor(row, shared, ctx = {}) {
  return [...planEntitlementsFor(row, shared, ctx), ...extrasFor(row, shared, ctx)];
}

/** 方案展開的那幾筆。不套方案、或整批就沒選方案時是空的。 */
export function planEntitlementsFor(row, shared, { plan = null } = {}) {
  if (row?.usePlan === false || !plan) return [];
  return expandPlan(plan, quantityFor(row, shared), {
    purchasedAt: isValidDate(shared?.purchasedAt) ? shared.purchasedAt : null,
  });
}

/**
 * 加購的那幾筆。
 *
 * 跟 `planEntitlementsFor()` 分開回傳，是因為 `data/customers.js` 的
 * `createWithPlan()` 吃的就是「方案 + extras」這兩半 —— 呼叫端不該為了拆開它們
 * 而去數方案有幾個項目（那是一條會在有人改 `expandPlan()` 的那天安靜壞掉的耦合）。
 */
export function extrasFor(row, shared, { coursesById = {} } = {}) {
  const purchasedAt = isValidDate(shared?.purchasedAt) ? shared.purchasedAt : null;
  return (row?.extras ?? [])
    .map((x) => extraToEntitlement(x, coursesById, { purchasedAt }))
    .filter(Boolean);
}

/**
 * 這一位的客戶主檔欄位。
 *
 * 這一頁不填電話／LINE／喜好程度／永久限制／備註 —— 她說「其他的都不用」。
 * 那幾個欄位是一位一位認識客戶之後才會填的，建立當下她手上只有一張名單。
 * 會籍到期日一樣不在（ADR-0019）。
 */
export function customerFor(row, shared) {
  return {
    name: trimmed(row?.name),
    phone: null,
    lineId: null,
    source: trimmed(shared?.source) || null,
    purchasedAt: isValidDate(shared?.purchasedAt) ? shared.purchasedAt : null,
    membershipExpiresAt: null,
    priority: 0,
    flags: [],
    // marks 與 notes 永遠一起寫，走同一支 —— 只改到一邊的路徑不要存在
    ...toCustomerFields([]),
  };
}

/**
 * 第三段那兩個數字與明細。
 *
 * @returns {{people:number, entitlements:number, rows:{key:string,name:string,
 *            count:number,total:number,adjusted:boolean}[]}}
 */
export function summarizeRoster(rows = [], shared = {}, ctx = {}) {
  const detail = rows.map((row) => {
    const ents = entitlementsFor(row, shared, ctx);
    return {
      key: row.key,
      name: trimmed(row.name),
      count: ents.length,
      total: ents.reduce((n, e) => n + (e.totalQty ?? 0), 0),
      adjusted: isAdjusted(row),
    };
  });

  return {
    people: rows.length,
    entitlements: detail.reduce((n, d) => n + d.count, 0),
    rows: detail,
  };
}

/**
 * 存檔前的檢查。回空陣列代表可以建。
 *
 * 重複的名字不在這裡 —— 那是提示，走 `duplicatesOf()`。
 */
export function validateRoster(rows = [], shared = {}, ctx = {}) {
  const errors = [];

  if (!rows.length) errors.push('還沒有人。上面打一個名字按 Enter，或直接貼一串名字進去');
  if (rows.length > MAX_ROWS) {
    errors.push(`一次最多 ${MAX_ROWS} 位（現在 ${rows.length} 位）。這麼多通常是貼錯東西了`);
  }

  const blank = rows.filter((r) => !trimmed(r.name)).length;
  if (blank) errors.push(`有 ${blank} 列沒有名字`);

  if (shared.purchasedAt && !isValidDate(shared.purchasedAt)) {
    errors.push('購買日的日期格式不對');
  }

  const batchQty = Number(shared.quantity);
  if (!(Number.isInteger(batchQty) && batchQty > 0)) errors.push('購買數量要是大於 0 的整數');

  for (const row of rows) {
    const name = trimmed(row.name) || '（沒有名字）';

    if (row.quantity != null) {
      const q = Number(row.quantity);
      if (!(Number.isInteger(q) && q > 0)) errors.push(`${name} 的數量要是大於 0 的整數`);
    }

    for (const e of entitlementsFor(row, shared, ctx)) {
      const why = validateEntitlement(e, {
        courses: Object.values(ctx.coursesById ?? {}),
        equipment: ctx.equipment ?? [],
      });
      for (const w of why) errors.push(`${name}・${e.label ?? '某一筆額度'}：${w}`);
    }
  }

  return errors;
}

/**
 * 不阻擋、只提示的事。跟 `domain/customers.js` 的 `warnings()` 同一個分工：
 * 「可能是錯、也可能是真的」一律只提示（ADR-0002）。
 *
 * 電話與 LINE 不在這裡。單建一位時「沒有電話也沒有 LINE」是有用的提醒，
 * 八位一起唸八次就是八行噪音 —— 而且這一頁本來就不問那兩欄。
 *
 * @returns {string[]}
 */
export function rosterWarnings(rows = [], shared = {}, ctx = {}) {
  const out = [];

  // 沒套方案又沒加購 = 這一位建出來身上是空的。
  // 不擋 —— `#/customers/new` 也允許「不選方案（之後單項加購）」，
  // 同一件事在兩頁一頁擋一頁不擋，比兩頁都不擋更糟。
  const empty = rows
    .filter((r) => !entitlementsFor(r, shared, ctx).length)
    .map((r) => trimmed(r.name) || '（沒有名字）');
  if (empty.length) {
    out.push(`${empty.join('、')} 身上不會有任何額度 —— 沒套方案也沒加購，建好之後要自己補`);
  }

  if (!trimmed(shared.source)) {
    out.push('沒填購買通路。那是舊試算表 B2 那一欄，之後對帳會找不到這一批是哪一場');
  }

  return out;
}
