// 隨手記的存取。
//
// 它要能在三秒內記完，所以這裡也做得很薄：一行字、一個勾、選填掛在誰身上。

import { where } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

import * as repo from './repo.js';
import { normalize } from '../domain/notes.js';

const PATH = 'notes';

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

export function update(id, changes) {
  return repo.update(PATH, id, normalize(changes));
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
