// 客戶與其額度的存取。所有讀寫都走 repo.js，所以自動有稽核紀錄與軟刪除。
//
// Firestore 路徑：
//   customers/{id}
//   customers/{id}/entitlements/{id}   子集合

import * as repo from './repo.js';
import * as config from './config.js';
import { expandPlan } from '../domain/entitlements.js';
import { missingPairs } from '../domain/followups.js';
import { deliveryNoteFor } from '../domain/products.js';

const PATH = 'customers';
const entPath = (customerId) => `${PATH}/${customerId}/entitlements`;

/**
 * 一次購買的 id。同一次展開出來的每一筆額度都帶著它。
 *
 * 「買過什麼」那一頁靠它分組，也靠它一次改整組的購買日 ——
 * 用「方案名 + 購買日」分組的話，她一改日期那一組就當場拆成兩組。
 * 借額度那條路的 id 產生器，形狀跟 Firestore 的自動 id 一樣。
 */
const newPurchaseId = () => repo.newId('purchases');
/** 隨手記是頂層集合（`data/notes.js` 的同一條路徑）。營養品的提醒就是一筆。 */
const NOTE_PATH = 'notes';

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

/**
 * 一批額度連同它們的二返與交付提醒，組成**一個 commit 的那幾筆寫入**。
 *
 * 三件事一起做，少任何一件都會留下「看起來正常、其實少了一半」的資料：
 *
 *   1. 那幾筆額度本身
 *   2. 健檢要配二返（ADR-0022）—— 少了它，她要幾週後真的想記一筆二返時才發現
 *   3. 營養品要配一筆「哪天順便給」的隨手記（ADR-0059）—— 少了它她會忘記給東西
 *
 * **三條路共用這一支**：加一筆（`createEntitlement()`）、加一批
 * （`addEntitlements()`，加購方案走這條）、建新客戶（`createWithPlan()`）。
 * 各寫一次的話遲早有一條忘了配二返，而這一支的檔頭以前就記過那個代價。
 *
 * 配對規則本身在 `domain/followups.js`，這裡只負責寫。
 */
async function entitlementWrites(customerId, dataList, { customer = null, deliverOn = null } = {}) {
  const courses = await config.listAll('courses', { includeDeleted: true });
  const coursesById = Object.fromEntries(courses.map((c) => [c.id, c]));

  // **一次呼叫就是一次購買**：沒有自己帶購買 id 的那幾筆共用同一個新的。
  // 蓋在這一層而不是交給三個呼叫端，是因為漏掉的症狀特別安靜 ——
  // 那一筆會在「買過什麼」上掉進「不知道哪裡來的」那一組。
  const stamp = newPurchaseId();

  // 額度的 id 先鑄好：二返那一筆要指回它配的是哪一筆健檢
  // （`followupForEntitlementId`），而那個 id 必須先於寫入存在。
  const rows = dataList.map((data) => ({
    id: repo.newId(entPath(customerId)),
    data: { ...data, purchaseId: data.purchaseId ?? stamp },
  }));
  const pairs = missingPairs(rows.map((r) => ({ ...r.data, id: r.id })), coursesById);
  const notes = rows
    .map((r) => deliveryNoteFor({
      entitlement: { ...r.data, id: r.id },
      customer: { id: customerId, name: customer?.name ?? null },
      date: deliverOn,
    }))
    .filter(Boolean);

  return {
    rows,
    writes: [
      ...rows.map((r) => ({ op: 'create', path: entPath(customerId), id: r.id, data: r.data })),
      ...pairs.map((p) => ({ op: 'create', path: entPath(customerId), data: p.draft })),
      ...notes.map((data) => ({ op: 'create', path: NOTE_PATH, data })),
    ],
  };
}

/**
 * 加一筆額度，需要的話連它的二返額度與交付提醒一起建。
 *
 * 全部寫在同一個 commit 裡：分開寫的話「健檢建好了、二返失敗」會留下一份
 * 看起來正常、其實少了一半的資料。同一個 commit 也讓復原退得回那幾筆。
 */
export async function createEntitlement(customerId, data, opts = {}) {
  const { writes } = await entitlementWrites(customerId, [data], opts);
  const [created] = await repo.commit(writes);
  return created;
}

/**
 * 加一批額度。**加購一整個方案走這一條。**
 *
 * 跟 `createEntitlement()` 是同一段身體，差別只有「幾筆」——
 * 而那正是它們必須共用的理由：一個方案裡可能同時有健檢（要配二返）
 * 與營養品（要配提醒），漏掉任何一種都要等她幾週後才會發現。
 */
export async function addEntitlements(customerId, dataList = [], opts = {}) {
  const { customerChanges = null } = opts;
  if (!dataList.length && !customerChanges) return [];
  const { writes } = await entitlementWrites(customerId, dataList, opts);
  // 拍訂購單加購到既有客戶（issue 09）：尾款那則紅色備註、便利貼上的警示跟額度**同一個 commit** ——
  // 分開寫的話額度建好、備註失敗，她按重試就多一整份額度
  const also = customerChanges ? [{ op: 'update', path: PATH, id: customerId, changes: customerChanges }] : [];
  return repo.commit([...writes, ...also]);
}
export const updateEntitlement = (customerId, id, changes) =>
  repo.update(entPath(customerId), id, changes);

/**
 * 一次改一組額度。「買過什麼」那一頁改購買日用。
 *
 * **同一個 commit**：一次購買的那幾筆購買日必須一起變 —— 改到一半失敗的話，
 * 那一組會在畫面上當場裂成兩組，而她看不出發生了什麼事。
 * 復原也退得回整組。
 *
 * @param {string} customerId
 * @param {{id:string, changes:object}[]} patches
 */
export const updateEntitlements = (customerId, patches = []) =>
  repo.commit(patches.map((p) => ({
    // **update 讀的是 `changes`，不是 `data`**（`repo.commit()`）。2026-09-06 到 09-13 這裡寫的是
    // `data:`，於是改購買日一次都沒存成功過：寫進去的只有 updatedAt，稽核那一筆還因為
    // `after: undefined` 整批被 Firestore 拒收（`tests/commit-ops.test.js` 盯著）。
    op: 'update', path: entPath(customerId), id: p.id, changes: p.changes,
  })));
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

/**
 * 一次拿到所有客戶的可用性收集，回傳 { customerId: 收集[] }。
 * 壓表綜覽要算每個人的可用天數，逐位查就是二十幾次往返。
 */
export async function availabilityByCustomer() {
  const rows = await repo.listGroup('availability');
  const out = {};
  for (const row of rows) {
    if (!row.parentId) continue;
    (out[row.parentId] ??= []).push(row);
  }
  return out;
}

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
export async function createWithPlan(customer, { plan = null, quantity = 1, extras = [] } = {}) {
  const id = repo.newId(PATH);

  // `extras` 是方案之外的單項加購（批次建立那一頁的「微調」用，
  // 也可以是「不套方案、只買復能」那種整批沒有方案的路）。
  //
  // **它們一定要跟方案展開的那幾筆走同一條路**，因為 `entitlementWrites()`
  // 裡的 `missingPairs()` 要看得到它們：加購的健檢也有二返（ADR-0022）。
  // 另外寫一支去建加購的話，那幾筆健檢就會少掉二返，而那件事要等她幾週後
  // 真的要記一筆二返才會被發現 —— README 記過這個代價。
  //
  // **購買 id 分開給**（`newPurchaseId()`）：方案那幾筆是一次購買，
  // 每一筆加購各自是一次。「買過什麼」那一頁靠它分組。
  const entitlements = [
    ...expandPlan(plan, quantity, {
      purchasedAt: customer.purchasedAt ?? null,
      expiresAt: customer.membershipExpiresAt ?? null,
      purchaseId: plan ? newPurchaseId() : null,
    }),
    ...extras.map((data) => ({ ...data, purchaseId: data.purchaseId ?? newPurchaseId() })),
  ];

  // 日期留空白的交付提醒：新客戶身上還沒有任何來訪，猜一天出來會讓她以為
  // 那天客人真的會來（`nextDeliveryDate()` 的同一條判斷）。
  const { writes } = await entitlementWrites(id, entitlements, { customer });

  await repo.createMany([
    { path: PATH, id, data: { ...customer, active: true } },
    // `entitlementWrites()` 給的是 commit 的形狀（帶 `op`），這一條路走
    // `createMany()`（整批建立，不混改寫），所以把那一個欄位拿掉。
    ...writes.map(({ op, ...rest }) => rest),
  ]);

  return id;
}
