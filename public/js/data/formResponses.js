// 客戶送出的那一份時間。收件匣。
//
// Firestore 路徑：formResponses/{token}   —— id 就是 token，一條連結一份答案
//
// 這裡**只有她這一側**：讀收件匣、收下、丟掉。客戶送出那一側在
// `data/publicForm.js`，那一支不走 repo（未登入寫不進稽核，見 ADR-0031）。

import * as repo from './repo.js';
import { collectionFrom } from '../domain/availabilityForm.js';

const PATH = 'formResponses';

/**
 * 全部還沒處理掉的回覆。
 *
 * 刻意不用 `where('takenAt','==',null)`：那要多開一個複合索引，
 * 而這裡永遠只有二十幾筆，在 client 濾便宜得多（同 `repo.listGroup()` 的理由）。
 */
export async function listInbox() {
  const rows = await repo.list(PATH);
  return rows
    .filter((r) => !r.takenAt)
    .sort((a, b) => millisOf(b.submittedAt) - millisOf(a.submittedAt));
}

/**
 * **全部**回覆，含已經收下的。`#/todo/ask` 那一頁用。
 *
 * 跟 `listInbox()` 不一樣的地方就是那一句 `!r.takenAt`：收件匣問的是
 * 「還有幾份要處理」，而問時間那一頁問的是「這個月每一位走到哪一步了」——
 * 收下的那幾份正是它要標成「已確認排定」的那些（ADR-0033 的延伸，
 * 她的原話：「都不要消失 就把狀態呈現在已發連結這邊」）。
 *
 * 一樣不加 where：這裡永遠只有二十幾筆，在 client 濾便宜得多。
 */
export const list = () => repo.list(PATH);

export const get = (token) => repo.getOne(PATH, token);

/**
 * 收下：把客戶填的變成一份本輪可用性，同時把這一筆標成處理過了。
 *
 * **兩筆寫在同一個 commit 裡。** 分開寫的話「收集建好了、標記失敗」會讓
 * 同一份答案下次再出現在收件匣一次，她會收下兩份互相重複的可用性 ——
 * 而那要到壓表的時候才看得出來。同一個 commit 也讓復原退得回兩筆。
 *
 * @returns {Promise<object>} 寫進去的那份收集，回覆客戶的訊息要用它
 */
export async function take(response, invite, { today }) {
  const record = collectionFrom(response, invite, { today });

  await repo.commit([
    { op: 'create', path: `customers/${response.customerId}/availability`, data: record },
    { op: 'update', path: PATH, id: response.token, changes: { takenAt: today } },
  ]);

  return record;
}

/** 這一份不要。軟刪除 —— 按錯了還原得回來（設定頁的「已刪除項目」）。 */
export const discard = (token, reason) => repo.softDelete(PATH, token, reason);

/** Firestore 的 Timestamp 與離線時的 null 都要接得住。 */
function millisOf(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  return new Date(value).getTime() || 0;
}
