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
import * as customersData from './customers.js';
import { touchedEntitlementIds, recount } from '../domain/visits.js';
import { syncTasksForVisit } from '../domain/taskRules.js';
import { syncFollowupTasks, DEFAULT_FOLLOWUP_DUE_DAYS } from '../domain/followups.js';
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
 * 日子已經過了、卻還沒結案的來訪。待辦中心的「客人來了嗎」用。
 *
 * 刻意**帶上日期上界**：未來的預約一筆都不需要，而她每天開待辦中心十幾次，
 * 一次抓回整個月的預約等於每次都在為畫不出來的東西付流量
 * —— 而她常常是在大樓裡用行動網路（SPEC 第 6.9 節）。
 *
 * 兩種狀態各查一次而不是用 `in`：吃的是同一個 (deletedAt, status, date asc)
 * 複合索引，那個索引已經在用了，不必為這件事多開一個。
 *
 * 哪幾筆真的要收尾由 `domain/visits.js` 的 `visitsToClose()` 決定，
 * 這裡只負責把可能的那些撈回來 —— 規則不寫在 /data。
 */
export function listUnclosed(today) {
  return Promise.all(
    ['confirmed', 'pending_confirm'].map((status) =>
      repo.list(PATH, {
        wheres: [where('status', '==', status), where('date', '<=', today)],
        order: ['date', 'asc'],
      }),
    ),
  ).then((groups) => groups.flat());
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
  const after = [...customerVisits.filter((v) => v.id !== id), next];

  const ops = [
    previous
      ? { op: 'update', path: PATH, id, changes: payloadOf(next) }
      : { op: 'create', path: PATH, id, data: payloadOf(next) },
    ...countOps(visit.customerId, [previous, next], after),
    ...(await taskOps(next, { isNew: !previous, visitsAfter: after })),
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
    ...(await taskOps({ ...visit, deletedAt: 'pending' }, { visitsAfter: rest })),
  ]);
}

export async function restore(visit, customerVisits = []) {
  const next = { ...visit, deletedAt: null };
  const after = [...customerVisits.filter((v) => v.id !== visit.id), next];
  await repo.commit([
    { op: 'update', path: PATH, id: visit.id, changes: { deletedAt: null } },
    ...countOps(visit.customerId, [visit], after),
    ...(await taskOps(next, { visitsAfter: after })),
  ]);
}

/**
 * 這筆來訪存下去之後，任務要跟著怎麼動。
 *
 * 課程刻意連已刪除的一起讀：主檔把課程刪掉，不代表已經排出去的來訪就不用去掛號了。
 * 少讀那一筆的代價是任務被靜默移除，那正是這個 app 要解決的問題。
 */
async function taskOps(visit, { isNew = false, visitsAfter = null } = {}) {
  const [existing, courses] = await Promise.all([
    isNew ? [] : tasksData.listByVisit(visit.id),
    config.listAll('courses', { includeDeleted: true }),
  ]);

  const coursesById = Object.fromEntries(courses.map((c) => [c.id, c]));

  const { create, update, remove: gone } = syncTasksForVisit(visit, existing, {
    coursesById,
    today: todayISO(),
  });

  return [
    ...toOps({ create, update, remove: gone }),
    ...(visitsAfter ? await followupOps(visit, visitsAfter, coursesById) : []),
  ];
}

/**
 * 「約二返」的待辦。跟上面那一段分開，因為它的視野不一樣。
 *
 * 掛號類的任務只看這一筆來訪：這次來訪有哪些課程，就該有哪些任務。
 * 「約二返」看的是整位客戶：買了 3 次健檢就有 3 次二返，做完第二次健檢時
 * 該不該長出待辦，取決於前面兩次的二返約掉了沒 —— 那是一筆來訪答不出來的問題。
 *
 * 所以這裡多讀三樣東西（這位客戶的額度、這位客戶的任務、設定裡的間隔），
 * 而且**每次存來訪都跑**，不是只在健檢那一筆上跑 —— 二返被約走的時候，
 * 要被收掉的待辦掛在另一筆來訪上（那次健檢），只看眼前這一筆看不到它。
 *
 * 規則本身一條都不在這裡，全部在 domain/followups.js。
 */
async function followupOps(visit, visitsAfter, coursesById) {
  // 主檔裡沒有任何課程設了「做完還要再約一次」就直接跳過，省下三次讀取。
  // 這是唯一安全的提前結束：沒有配對規則就不可能有配對，也就不可能有待辦。
  const hasPairing = Object.values(coursesById).some((c) => c?.followupCourseId);
  if (!hasPairing) return [];

  const [entitlements, tasks, settings] = await Promise.all([
    customersData.listEntitlements(visit.customerId),
    tasksData.listByCustomer(visit.customerId),
    config.getSettings(),
  ]);

  return toOps(
    syncFollowupTasks({
      customer: { id: visit.customerId, name: visit.customerName ?? null },
      entitlements,
      visits: visitsAfter,
      tasks,
      coursesById,
      dueDays: settings.followupDueDays ?? DEFAULT_FOLLOWUP_DUE_DAYS,
    }),
  );
}

function toOps({ create = [], update = [], remove = [] }) {
  return [
    ...create.map((data) => ({ op: 'create', path: TASK_PATH, data })),
    ...update.map((u) => ({ op: 'update', path: TASK_PATH, id: u.id, changes: u.changes })),
    ...remove.map((r) => ({ op: 'softDelete', path: TASK_PATH, id: r.id, reason: r.reason })),
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
