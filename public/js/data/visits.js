// 來訪的存取。
//
// 寫入一律經過 save()：一筆來訪動到的額度計數與它該產生的任務，必須跟它同進同出。
// 計數欄位是快取，真相是來訪本身（見 docs/adr/0004），但快取寫歪了
// 清單頁就會騙人；任務漏產生更糟，那是使用者最主要的痛點。
// 三件事放在同一個 batch 裡，不會只寫進去一半，也不用靠呼叫端記得。

import { where } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

import * as repo from './repo.js';
import * as config from './config.js';
import * as tasksData from './tasks.js';
import { touchedEntitlementIds, recount } from '../domain/visits.js';
import { syncTasksForVisit } from '../domain/taskRules.js';
import { todayISO } from '../domain/dates.js';

const PATH = 'visits';
const TASK_PATH = 'tasks';
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

/**
 * 某個狀態的全部來訪，日期近的在前。
 * 待辦中心用它抓「已壓表、還在等客戶回覆」的那些。
 * 需要 (deletedAt, status, date asc) 複合索引，已列在 firestore.indexes.json。
 */
export function listByStatus(status) {
  return repo.list(PATH, {
    wheres: [where('status', '==', status)],
    order: ['date', 'asc'],
  });
}

/**
 * 一段期間內的全部來訪。壓表模式要用：一次算出「這個月誰還沒排」
 * 與「上次來是多久以前」，不要每位客戶各查一次。
 * 用的是 (deletedAt, date) 複合索引。
 */
export function listBetween(from, to) {
  return repo.list(PATH, {
    wheres: [where('date', '>=', from), where('date', '<=', to)],
    order: ['date', 'asc'],
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
    ...(await taskOps(next, { isNew: !previous })),
  ];

  await repo.commit(ops);
  return id;
}

/** 軟刪除一筆來訪。次數要跟著還回去，任務也要跟著收掉。 */
export async function remove(visit, customerVisits = [], reason = null) {
  const rest = customerVisits.filter((v) => v.id !== visit.id);
  await repo.commit([
    { op: 'softDelete', path: PATH, id: visit.id, reason },
    ...countOps(visit.customerId, [visit], rest),
    ...(await taskOps({ ...visit, deletedAt: 'pending' })),
  ]);
}

export async function restore(visit, customerVisits = []) {
  const next = { ...visit, deletedAt: null };
  await repo.commit([
    { op: 'update', path: PATH, id: visit.id, changes: { deletedAt: null } },
    ...countOps(visit.customerId, [visit], [...customerVisits.filter((v) => v.id !== visit.id), next]),
    ...(await taskOps(next)),
  ]);
}

/**
 * 這筆來訪存下去之後，任務要跟著怎麼動。
 *
 * 課程刻意連已刪除的一起讀：主檔把課程刪掉，不代表已經排出去的來訪就不用去掛號了。
 * 少讀那一筆的代價是任務被靜默移除，那正是這個 app 要解決的問題。
 */
async function taskOps(visit, { isNew = false } = {}) {
  const [existing, courses] = await Promise.all([
    isNew ? [] : tasksData.listByVisit(visit.id),
    config.listAll('courses', { includeDeleted: true }),
  ]);

  const { create, update, remove: gone } = syncTasksForVisit(visit, existing, {
    coursesById: Object.fromEntries(courses.map((c) => [c.id, c])),
    today: todayISO(),
  });

  return [
    ...create.map((data) => ({ op: 'create', path: TASK_PATH, data })),
    ...update.map((u) => ({ op: 'update', path: TASK_PATH, id: u.id, changes: u.changes })),
    ...gone.map((r) => ({ op: 'softDelete', path: TASK_PATH, id: r.id, reason: r.reason })),
  ];
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
