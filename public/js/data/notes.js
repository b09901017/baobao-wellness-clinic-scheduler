// 隨手記的存取。
//
// 它要能在三秒內記完，所以這裡也做得很薄：一行字、一個勾、選填掛在誰身上。

import { where } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

import * as repo from './repo.js';
import {
  normalize, normalizePatch, linkedPeers, linkedChanges, copyPlan,
} from '../domain/notes.js';
import { withDelivery, isFullyDelivered, noteTextFor } from '../domain/products.js';

const PATH = 'notes';

// 營養品的交付規則全部在 domain/products.js，這一層只負責寫。

export const get = (id) => repo.getOne(PATH, id);

/**
 * 還沒勾掉的，新的在前。首頁那一塊用。
 * 需要 (deletedAt, done, createdAt desc) 複合索引。
 */
export function listOpen({ cacheOnly = false } = {}) {
  // `cacheOnly`：待辦首頁先用手機裡的畫（只拿來畫，`repo.listCached()`，ADR-0167）
  return (cacheOnly ? repo.listCached : repo.list)(PATH, {
    wheres: [where('done', '==', false)],
    order: ['createdAt', 'desc'],
  });
}

/**
 * 全部，**含已經勾掉的**。`#/todo/notes` 用。
 *
 * 首頁那一格照樣用 `listOpen()` —— 那一格只有四列，它要回答的是
 * 「還有什麼沒做」。這一頁不一樣：勾掉的不能消失，她會勾錯，
 * 而且她要能回頭看「這件事我處理掉了」（2026-08-24）。
 *
 * 需要 (deletedAt, createdAt desc) 複合索引。
 */
export function listAll() {
  return repo.list(PATH, { order: ['createdAt', 'desc'] });
}

/**
 * 某位客戶身上的，含已勾掉的。客戶詳情頁用。
 * 需要 (deletedAt, customerId, createdAt desc) 複合索引。
 */
export function listByCustomer(customerId) {
  return repo.list(PATH, {
    wheres: [where('customerId', '==', customerId)],
    order: ['createdAt', 'desc'],
  });
}

/**
 * 有日期、而且落在這段範圍裡的。日曆用。
 *
 * **含已經勾掉的** —— 日曆上勾掉的要畫成刪除線，不是消失。
 * 沒有日期的（`date` 是 null）不會被撈到，那是對的：沒掛日期就不上日曆。
 *
 * 需要 (deletedAt, date asc) 複合索引，已列在 firestore.indexes.json。
 */
export function listBetween(from, to) {
  return repo.list(PATH, {
    wheres: [where('date', '>=', from), where('date', '<=', to)],
    order: ['date', 'asc'],
  });
}

export async function listDeleted() {
  return (await repo.listWithDeleted(PATH)).filter((n) => n.deletedAt);
}

export function create(data) {
  return repo.create(PATH, { ...normalize(data), doneAt: null });
}

// ---------- 連在一起的那一組（ADR-0179） ----------
//
// **寫的那一刻照 `linkId` 重讀同一組**：畫面手上那一份都只是一部分（日曆一個月、首頁只讀還沒勾的、
// 客戶詳情一位、小工具的快取）—— 拿它去算「另外那幾天」，不在畫面上的那幾天就漏了（lessons 二）。
// 只用等號查、不加排序 → 不用新索引。一組一起變的寫在同一個 commit（每一筆照舊一則稽核）。
//
// 離線時重讀只拿得到快取裡剛好有的那幾筆 —— 隨手記不擋（ADR-0158 只管會算次數的寫入），照寫；
// 一組勾得不一樣的由資料健檢最後一項列出來。

/**
 * 同一組（同一個 `linkId`），**含已刪除的**（`linkId` 撞不撞要連刪掉的一起看；活著的由 domain 濾）。
 */
export function listLinked(linkId) {
  return repo.listWithDeleted(PATH, { wheres: [where('linkId', '==', linkId)] });
}

/** 重讀這一筆與它那一組還活著的其他筆。沒有 `linkId` 的不多讀那一趟。 */
async function freshWithPeers(id) {
  const before = await repo.getOne(PATH, id);
  if (!before?.linkId) return { before, peers: [] };
  return { before, peers: linkedPeers(before, await listLinked(before.linkId)) };
}

const writeAll = (writes) => repo.commit(
  writes.map((w) => ({ op: 'update', path: PATH, id: w.id, changes: w.changes })),
);

/**
 * 改一筆。**走 `normalizePatch()` 不是 `normalize()`** —— 呼叫端給的是
 * 「變了的那幾欄」，而 `normalize()` 吃的是一份完整的隨手記，
 * 少帶一欄就等於把它清掉（`domain/notes.js` 那一支的註解寫了是哪一次）。
 *
 * **連在一起的**：字、掛給誰同一組每一筆一起改，日期只改這一筆，照真的變了什麼寫（`linkedChanges()`）——
 * 日曆編輯器每次存都帶字、日期、掛給誰，只改日期那一下另外那幾天不寫。
 * 沒有連在一起的跟以前一模一樣（整份 patch 寫下去）。
 */
export async function update(id, changes) {
  const patch = normalizePatch(changes);
  const { before, peers } = await freshWithPeers(id);
  if (!peers.length) return repo.update(PATH, id, patch);
  const writes = linkedChanges(before, patch, peers);
  if (writes.length) await writeAll(writes);
  return undefined;
}

/** 刪掉**這一筆**（連在一起的也是只刪這一筆 —— spec 那張表）。 */
export const remove = (id, reason) => repo.softDelete(PATH, id, reason);
export const restore = (id) => repo.restore(PATH, id);

/**
 * 刪掉清單上的**一列**：一列代表一組時整組一起刪（HANDOFF「清單上一列＝一組時」：垃圾桶、「清掉這 N 筆」）。
 * 只刪跟這一筆勾法一樣的那幾筆 —— 那一列代表的就是它們（`groupLinked()` 照勾了沒分列）。
 *
 * @param {object} note 那一列代表的那一筆
 */
export async function removeRow(note, reason) {
  const { before, peers } = await freshWithPeers(note.id);
  const same = peers.filter((p) => Boolean(p.done) === Boolean(before?.done));
  if (!before || !same.length) return remove(note.id, reason);
  await repo.commit([before, ...same].map((n) => ({ op: 'softDelete', path: PATH, id: n.id, reason })));
  return undefined;
}

/**
 * 複製到別天。一個 commit 建好那幾筆（連在一起時原本那一筆補 `linkId`）。
 *
 * **重讀之後才算要建哪幾天**（`copyPlan()`）：同一組那一天已經有一筆就不再建 —— 重按、失敗重按、
 * 上一次其實寫進去了只是沒收到回應，都不多一份（lessons 三）。
 *
 * @param {object} note 要複製的那一筆
 * @param {string[]} dates
 * @param {{linked?: boolean}} [o] 預設連在一起
 * @returns {Promise<{created: number, skipped: string[], linkId: string|null}>}
 */
export async function copyTo(note, dates, { linked = true } = {}) {
  const fresh = await repo.getOne(PATH, note.id);
  if (!fresh) throw new Error('這一筆剛剛被刪掉了，沒有東西可以複製');
  const group = await listLinked(fresh.linkId || fresh.id);
  const plan = copyPlan(fresh, dates, { linked, group, newLinkId: repo.newId(PATH) });
  if (plan.blocked) throw new Error(plan.blocked);

  const ops = [
    ...(plan.link ? [{ op: 'update', path: PATH, id: plan.link.id, changes: plan.link.changes }] : []),
    ...plan.creates.map((data) => ({ op: 'create', path: PATH, data: { ...data, doneAt: null } })),
  ];
  if (ops.length) await repo.commit(ops);
  return { created: plan.creates.length, skipped: plan.skipped, linkId: plan.linkId };
}

/**
 * 拆開這一天：只有這一筆拿出來，以後各勾各的。同一組其他那幾筆照舊連著（還有兩筆以上的話）。
 */
export function unlink(id) {
  return repo.update(PATH, id, { linkId: null });
}

/**
 * 勾掉／取消勾。
 *
 * 勾掉的不會馬上從清單消失 —— 她會勾錯，看得到才點得回來（見 domain/notes.js
 * 的 sortNotes）。
 *
 * **連在一起的同一組一起勾、一起拿回來**（過去的、還沒到的、不在畫面上的都算 —— 重讀），同一個 commit。
 * 營養品的提醒不會連在一起（`validateNote()`），所以 `recordDelivery()` 那一條路不用管這件事。
 *
 * **回傳寫進去的那幾欄**，理由跟 `recordDelivery()` 同一條：呼叫端要重畫的話，
 * 讀的是寫入的人回報的結果，不是自己猜的。多一格 `linkedDays`：這一下作用在幾天（連在一起的那一組不同的日子，
 * 含它自己；沒連在一起是 0）—— toast「勾掉了（共 N 天）」讀它（重讀的那一組，不是畫面手上那一份）。
 * `prepareToggle()` 把它拿掉才併回那一筆，畫面手上的隨手記不會多那一格。
 *
 * @returns {Promise<{done: boolean, doneAt: string|null, linkedDays: number}>}
 */
export async function setDone(id, done) {
  const changes = { done, doneAt: done ? new Date().toISOString() : null };
  const { before, peers } = await freshWithPeers(id);
  if (!peers.length) {
    await repo.update(PATH, id, changes);
    return { ...changes, linkedDays: 0 };
  }
  const writes = linkedChanges(before, changes, peers);
  if (writes.length) await writeAll(writes);
  const linkedDays = new Set([before, ...peers].map((n) => n.date).filter(Boolean)).size;
  return { ...changes, linkedDays };
}

/**
 * 勾掉一筆營養品的提醒，**連同「給了哪些」一起記進那筆額度**。
 *
 * 兩件事寫在同一個 commit 裡：分開寫的話「勾好了、交付沒記到」會留下一筆
 * 看起來做完、其實查不出給了什麼的紀錄 —— 而那正是要進試算表的東西。
 * 同一個 commit 也讓復原退得回兩筆（見 `data/repo.js` 的 withUndo）。
 *
 * 沒給完的那幾種**留著那一筆提醒不勾掉**，只把文字換成剩下的：
 * 她的原話是「假設我當天忘記給了，然後可以記我給了那些多少」。
 * 日期不動 —— 隨手記的日期不是死線（`domain/notes.js`），過了也不會變紅字，
 * 而自己往後跳一天會讓她以為是系統排的。
 *
 * **回傳這一筆提醒變成什麼樣**，因為「勾不勾得掉」是這裡決定的：呼叫端猜
 * `!note.done` 的話，只給了一部分時畫面會說一件資料庫沒有發生的事
 * （SPEC 第 6.9 節，日曆的待辦卡片就這樣說過謊）。判斷仍然只有這一份。
 *
 * @param {object|null} note 那一筆提醒（要有 id、entitlementId、customerId）。
 *   **沒有也可以** —— 她可能從來沒約過時間就直接給了（客戶詳情的「已經給了」
 *   那一顆）。那時候只寫額度那一半：交付紀錄是要進試算表的那一份，
 *   提醒只是提醒（ADR-0059）。
 * @param {object} entitlement 那一筆營養品（要有 id）
 * @param {{at: string, productIds: string[]}} delivery
 * @param {{customerId?: string, customerName?: string, products?: object[]}} [ctx]
 *   沒有提醒時要靠它知道這一包是誰的。`products` 是主檔，
 *   舊資料的空名字靠它認回來（`domain/products.js` 的 `itemsOf()`）。
 * @returns {Promise<object|null>} 寫完之後的那一筆提醒（沒有提醒就回 null）
 */
export async function recordDelivery(note, entitlement, delivery, ctx = {}) {
  const customerId = note?.customerId ?? ctx.customerId;
  const path = `customers/${customerId}/entitlements`;
  // **寫之前重讀那一筆額度、拿重讀的那一份判斷給過了沒**（2026-11-05，11/4 健檢 #4）：呼叫端手上那一份是打開畫面那一刻的 ——
  // 第一次寫完、畫面還沒重讀（或 toast 按重試）就再記一次同一款，`deliveries` 就多一筆一樣的，而那一份會進試算表。
  // 讀回來的帶著這一台還沒送出的寫入；`ifUpdatedAt` 擋不住這一種（還沒回到伺服器的 serverTimestamp 讀回來是 null）。
  // 讀不到就照手上那一份（跟以前一樣）
  const fresh = customerId ? await repo.getOne(path, entitlement.id).catch(() => null) : null;
  const current = fresh ?? entitlement;
  const patch = withDelivery(current, delivery);
  // 沒有東西要記（她點成一款都沒給、或那幾款早就給過了）：不寫，
  // 那一筆提醒也就原封不動。
  if (!patch) return note ? { ...note } : null;

  const customerName = note?.customerName ?? ctx.customerName ?? '';
  const master = ctx.products ? { products: ctx.products } : undefined;

  const after = { ...current, ...patch };
  const finished = isFullyDelivered(after);
  const at = new Date().toISOString();
  const changes = finished
    ? { done: true, doneAt: at }
    : { done: false, doneAt: null, text: noteTextFor(after, customerName, master) };

  await repo.commit([
    {
      op: 'update',
      path,
      id: entitlement.id,
      changes: patch,
    },
    // 沒有提醒就只寫額度那一半。**額度那一筆一定要寫**（那是要進試算表的紀錄），
    // 提醒是可有可無的那一半。
    ...(note ? [{ op: 'update', path: PATH, id: note.id, changes }] : []),
  ]);

  return note ? { ...note, ...changes } : null;
}
