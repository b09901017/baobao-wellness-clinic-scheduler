// 來訪的存取。
//
// 寫入一律經過 save()：一筆來訪動到的額度計數必須跟它同進同出。
// 計數欄位是快取，真相是來訪本身（見 docs/adr/0004），但快取寫歪了
// 清單頁就會騙人，所以兩者放在同一個 batch 裡。

import { where } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

import * as repo from './repo.js';
import { touchedEntitlementIds, recount } from '../domain/visits.js';

const PATH = 'visits';
const entPath = (customerId) => `customers/${customerId}/entitlements`;

export const get = (id) => repo.getOne(PATH, id);

/**
 * 某位客戶的全部來訪，新的在前。
 * 需要 (deletedAt, customerId, date desc) 複合索引，已列在 firestore.indexes.json。
 */
export function listByCustomer(customerId) {
  return repo.list(PATH, {
    wheres: [where('customerId', '==', customerId)],
    order: ['date', 'desc'],
  });
}

/** 某一天她自己排的全部來訪。診間與治療師的自撞提示要用。 */
export function listByDate(date) {
  return repo.list(PATH, { wheres: [where('date', '==', date)] });
}

/** 已刪除的來訪。設定頁的「已刪除項目」用。 */
export async function listDeleted() {
  return (await repo.listWithDeleted(PATH)).filter((v) => v.deletedAt);
}

// 這些欄位由 repo 維護，不要從畫面上寫回去
function payloadOf(visit) {
  const { id, createdAt, createdBy, updatedAt, deletedAt, ...rest } = visit;
  return rest;
}

/**
 * 存一筆來訪，連同它動到的額度計數。
 *
 * @param {object} visit 要存的內容，沒有 id 就是新增
 * @param {object[]} customerVisits 這位客戶現有的全部來訪（含這一筆的舊版本）
 * @returns {Promise<string>} 來訪 id
 */
export async function save(visit, customerVisits = []) {
  const id = visit.id ?? repo.newId(PATH);
  const previous = customerVisits.find((v) => v.id === id) ?? null;
  const next = { ...visit, id };

  const ops = [
    previous
      ? { op: 'update', path: PATH, id, changes: payloadOf(next) }
      : { op: 'create', path: PATH, id, data: payloadOf(next) },
    ...countOps(visit.customerId, [previous, next], [
      ...customerVisits.filter((v) => v.id !== id),
      next,
    ]),
  ];

  await repo.commit(ops);
  return id;
}

/** 軟刪除一筆來訪。次數要跟著還回去，所以也要重算。 */
export async function remove(visit, customerVisits = [], reason = null) {
  const rest = customerVisits.filter((v) => v.id !== visit.id);
  await repo.commit([
    { op: 'softDelete', path: PATH, id: visit.id, reason },
    ...countOps(visit.customerId, [visit], rest),
  ]);
}

export async function restore(visit, customerVisits = []) {
  const next = { ...visit, deletedAt: null };
  await repo.commit([
    { op: 'update', path: PATH, id: visit.id, changes: { deletedAt: null } },
    ...countOps(visit.customerId, [visit], [...customerVisits.filter((v) => v.id !== visit.id), next]),
  ]);
}

function countOps(customerId, touched, visitsAfter) {
  const ids = touchedEntitlementIds(...touched.filter(Boolean));
  const recounted = recount(ids, visitsAfter);
  const at = new Date().toISOString();
  return ids.map((entId) => ({
    op: 'update',
    path: entPath(customerId),
    id: entId,
    changes: { ...recounted[entId], lastReconciledAt: at },
  }));
}
