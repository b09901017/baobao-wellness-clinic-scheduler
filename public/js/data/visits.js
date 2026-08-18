// 來訪的存取。第 4 步會長出建立、狀態機與衝突檢查，
// 現在只有客戶詳情頁需要的那一支：某位客戶的全部來訪。
//
// 額度的三段式次數（已完成 / 已排未上 / 剩餘）是從這些來訪現算出來的，
// 見 domain/entitlements.js 的 counts()。

import { where } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

import * as repo from './repo.js';

const PATH = 'visits';

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
