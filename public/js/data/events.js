// 行事備註的存取。ADR-0015。
//
// 這一層刻意碰不到額度與任務 —— 行事備註不扣次數、不產生任務，
// 而「不可能扣錯」比「共用一份程式碼」重要（見那支 ADR）。

import { where } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

import * as repo from './repo.js';
import { normalize } from '../domain/events.js';

const PATH = 'events';

export const get = (id) => repo.getOne(PATH, id);

/**
 * 跟 from–to 這段有重疊的行事備註。
 *
 * 查的是「結束日期在範圍起點之後」，開始日期比範圍終點晚的由呼叫端夾掉 ——
 * Firestore 一次只能對一個欄位做範圍查詢，而反過來查 startDate <= to
 * 會把過去所有的行事備註都撈回來，越用越慢。
 *
 * 需要 (deletedAt, endDate asc) 複合索引，已列在 firestore.indexes.json。
 */
export async function listInRange(from, to) {
  const rows = await repo.list(PATH, {
    wheres: [where('endDate', '>=', from)],
    order: ['endDate', 'asc'],
  });
  return rows
    .filter((e) => e.startDate <= to)
    .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
}

export async function listDeleted() {
  return (await repo.listWithDeleted(PATH)).filter((e) => e.deletedAt);
}

/**
 * 存一筆行事備註。
 *
 * 形狀整理在 `domain/events.js` 的 `normalize()`，這一層只負責寫進去 ——
 * 那一支原本住在這裡，於是沒有測試看得到它，而它漏掉的欄位讓她挑的顏色
 * 一路走到最後一刻才被丟掉（2026-08-24）。
 */
export function create(data) {
  return repo.create(PATH, normalize(data));
}

export function update(id, changes) {
  return repo.update(PATH, id, normalize(changes));
}

export const remove = (id, reason) => repo.softDelete(PATH, id, reason);
export const restore = (id) => repo.restore(PATH, id);
