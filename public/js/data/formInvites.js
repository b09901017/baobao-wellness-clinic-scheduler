// 表單邀請：一位客戶一個月一條連結。
//
// Firestore 路徑：formInvites/{token}
//
// **token 就是文件 id**，用 `repo.newId()` 產生（Firestore 自動 id，
// 20 個字元、62 種字元，約 119 bits）。這是客戶那一頁唯一的鑰匙，
// 所以它必須是猜不到的 —— 不要換成「客戶id-月份」那種看起來比較整齊的東西。

import * as repo from './repo.js';
import { newInvite } from '../domain/availabilityForm.js';
import { addDays } from '../domain/dates.js';

const PATH = 'formInvites';

/** 全部邀請。二十幾位客戶一個月一條，在 client 濾與排就夠了。 */
export const list = () => repo.list(PATH);

export const get = (token) => repo.getOne(PATH, token);

/**
 * 產生一條連結。**按下「複製訊息」的那一刻才呼叫這裡** ——
 * 她有二十幾位客戶但這一輪可能只問十二位，先全部產生等於留下一堆
 * 沒發出去的邀請。
 *
 * @returns {Promise<string|null>} token，月份不合法時回 null
 */
export async function create({ customerId, customerName, month, sentAt }) {
  const draft = newInvite({ customerId, customerName, month, sentAt });
  if (!draft) return null;

  const token = repo.newId(PATH);
  await repo.create(PATH, { ...draft, expiresAt: expiryOf(draft.validTo) }, token);
  return token;
}

/** 連結作廢。她重發一條新的時，舊的那條要收掉，不然客戶手上有兩條。 */
export const revoke = (token, reason) => repo.softDelete(PATH, token, reason);

/**
 * Rules 擋過期靠的是這個時間戳，不是 `validTo` 那個字串 ——
 * Rules 裡沒有辦法把 'YYYY-MM-DD' 跟 `request.time` 比大小。
 *
 * 刻意寬鬆：取「迄日的隔天 UTC 零時」，在 UTC+8 等於當地時間多留幾個小時。
 * 客戶當天晚上十一點才點開連結是很正常的事，而**卡在邊界上填不了**
 * 比多收幾個小時糟得多 —— 前端那一關才是精確的那一關，這裡只負責擋掉
 * 幾個月以後還被拿出來用的連結。
 */
function expiryOf(validTo) {
  return new Date(`${addDays(validTo, 1)}T00:00:00Z`);
}
