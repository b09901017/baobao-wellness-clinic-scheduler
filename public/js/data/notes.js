// 隨手記的存取。
//
// 它要能在三秒內記完，所以這裡也做得很薄：一行字、一個勾、選填掛在誰身上。

import { where } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

import * as repo from './repo.js';
import { normalize, normalizePatch } from '../domain/notes.js';
import { withDelivery, isFullyDelivered, noteTextFor } from '../domain/products.js';

const PATH = 'notes';

// 營養品的交付規則全部在 domain/products.js，這一層只負責寫。

export const get = (id) => repo.getOne(PATH, id);

/**
 * 還沒勾掉的，新的在前。首頁那一塊用。
 * 需要 (deletedAt, done, createdAt desc) 複合索引。
 */
export function listOpen() {
  return repo.list(PATH, {
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

/**
 * 改一筆。**走 `normalizePatch()` 不是 `normalize()`** —— 呼叫端給的是
 * 「變了的那幾欄」，而 `normalize()` 吃的是一份完整的隨手記，
 * 少帶一欄就等於把它清掉（`domain/notes.js` 那一支的註解寫了是哪一次）。
 */
export function update(id, changes) {
  return repo.update(PATH, id, normalizePatch(changes));
}

export const remove = (id, reason) => repo.softDelete(PATH, id, reason);
export const restore = (id) => repo.restore(PATH, id);

/**
 * 勾掉／取消勾。
 *
 * 勾掉的不會馬上從清單消失 —— 她會勾錯，看得到才點得回來（見 domain/notes.js
 * 的 sortNotes）。
 */
export function setDone(id, done) {
  return repo.update(PATH, id, { done, doneAt: done ? new Date().toISOString() : null });
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
 * @param {object} note 那一筆提醒（要有 id、entitlementId、customerId）
 * @param {object} entitlement 那一筆營養品（要有 id）
 * @param {{at: string, productIds: string[]}} delivery
 */
export async function recordDelivery(note, entitlement, delivery) {
  const patch = withDelivery(entitlement, delivery);
  if (!patch) return;

  const after = { ...entitlement, ...patch };
  const finished = isFullyDelivered(after);
  const at = new Date().toISOString();

  await repo.commit([
    {
      op: 'update',
      path: `customers/${note.customerId}/entitlements`,
      id: entitlement.id,
      changes: patch,
    },
    {
      op: 'update',
      path: PATH,
      id: note.id,
      changes: finished
        ? { done: true, doneAt: at }
        : { done: false, doneAt: null, text: noteTextFor(after, note.customerName ?? '') },
    },
  ]);
}
