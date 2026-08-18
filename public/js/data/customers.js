// 客戶與其額度的存取。所有讀寫都走 repo.js，所以自動有稽核紀錄與軟刪除。
//
// Firestore 路徑：
//   customers/{id}
//   customers/{id}/entitlements/{id}   子集合

import * as repo from './repo.js';
import { expandPlan } from '../domain/entitlements.js';

const PATH = 'customers';
const entPath = (customerId) => `${PATH}/${customerId}/entitlements`;

/**
 * 全部在服務中的客戶，依姓名排序。
 *
 * 排序刻意在 client 做：Firestore 排的是 UTF-8 位元組順序，中文姓名排出來
 * 不是人看的順序；而且這份清單只有二十幾筆，排序成本可以忽略。
 */
export async function list() {
  const rows = await repo.list(PATH);
  return rows.sort((a, b) =>
    String(a.name ?? '').localeCompare(String(b.name ?? ''), 'zh-TW'),
  );
}

export const get = (id) => repo.getOne(PATH, id);
export const update = (id, changes) => repo.update(PATH, id, changes);
export const remove = (id, reason) => repo.softDelete(PATH, id, reason);
export const restore = (id) => repo.restore(PATH, id);

/** 已刪除的客戶。設定頁的「已刪除項目」用。 */
export async function listDeleted() {
  return (await repo.listWithDeleted(PATH)).filter((r) => r.deletedAt);
}

// ---------- 額度 ----------

export const listEntitlements = (customerId) => repo.list(entPath(customerId));
export const createEntitlement = (customerId, data) => repo.create(entPath(customerId), data);
export const updateEntitlement = (customerId, id, changes) =>
  repo.update(entPath(customerId), id, changes);
export const removeEntitlement = (customerId, id, reason) =>
  repo.softDelete(entPath(customerId), id, reason);
export const restoreEntitlement = (customerId, id) => repo.restore(entPath(customerId), id);

/**
 * 一次拿到所有客戶的額度，回傳 { customerId: 額度[] }。
 * 客戶總覽要畫二十幾列進度，逐位查就是二十幾次往返。
 */
export async function entitlementsByCustomer() {
  const rows = await repo.listGroup('entitlements');
  const out = {};
  for (const row of rows) {
    if (!row.parentId) continue;
    (out[row.parentId] ??= []).push(row);
  }
  return out;
}

/** 已刪除的額度，含它屬於哪位客戶。設定頁的「已刪除項目」用。 */
export async function listDeletedEntitlements() {
  const rows = await repo.listGroup('entitlements', { includeDeleted: true });
  return rows.filter((r) => r.deletedAt && r.parentId);
}

// ---------- 本輪可用性 ----------
//
// 一位客戶會有很多份收集，一個月問一次。收集日期新的在前 ——
// 她要看的永遠是最近問到的那一份，舊的是歷史。

const availPath = (customerId) => `${PATH}/${customerId}/availability`;

export function listAvailability(customerId) {
  return repo.list(availPath(customerId), { order: ['collectedAt', 'desc'] });
}

export const createAvailability = (customerId, data) => repo.create(availPath(customerId), data);
export const updateAvailability = (customerId, id, changes) =>
  repo.update(availPath(customerId), id, changes);
export const removeAvailability = (customerId, id, reason) =>
  repo.softDelete(availPath(customerId), id, reason);
export const restoreAvailability = (customerId, id) => repo.restore(availPath(customerId), id);

/** 已刪除的可用性收集，含它屬於哪位客戶。設定頁的「已刪除項目」用。 */
export async function listDeletedAvailability() {
  const rows = await repo.listGroup('availability', { includeDeleted: true });
  return rows.filter((r) => r.deletedAt && r.parentId);
}

// ---------- 建立 ----------

/**
 * 建立客戶，同時把方案展開成額度，全部在同一個 batch。
 *
 * plan 給 null 也可以 —— 她可以先建人，之後再單項加購。
 * 展開後的額度與範本再無關聯，見 docs/adr/0003-plan-templates-have-no-version.md。
 *
 * @param {object} customer
 * @param {{plan?: object|null, quantity?: number}} [purchase]
 * @returns {Promise<string>} 新客戶的 id
 */
export async function createWithPlan(customer, { plan = null, quantity = 1 } = {}) {
  const id = repo.newId(PATH);

  const entitlements = expandPlan(plan, quantity, {
    purchasedAt: customer.purchasedAt ?? null,
    expiresAt: customer.membershipExpiresAt ?? null,
  });

  await repo.createMany([
    { path: PATH, id, data: { ...customer, active: true } },
    ...entitlements.map((data) => ({ path: entPath(id), data })),
  ]);

  return id;
}
