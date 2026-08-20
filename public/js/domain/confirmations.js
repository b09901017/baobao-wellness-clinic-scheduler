// 「跟客人確認時間」那一列的推導狀態。純函式。
//
// 這一列不是任務，是從 `visits(status === 'pending_confirm')` 推導出來的
// （ADR-0001）。它有三種樣子，不是兩種：
//
//   還沒問過      壓完表記進來，什麼都還沒發生
//   問過了，在等  她問了、客人還沒回，於是寫了一句「禮拜一再問問」
//   久了          等太久，該催了（幾天算久在設定頁的 noReplyDays）
//
// 第三種是原本就有的，第二種是使用者 2026-08-20 要的
// （見 .scratch/visit-lifecycle/issues/01-confirm-row-cannot-carry-a-note.md）。
//
// 規則放在這裡而不是放在 `ui/views/home.js`：「這一列現在是什麼狀態」
// 之後進度追蹤頁也要問同一句，而同一位客戶在兩個畫面顯示成不同狀態，
// 她不會知道哪個算數。

import { daysBetween } from './dates.js';

/**
 * 那一句話存在來訪上（`followupNote` / `followupAt`），不是任務也不是備註：
 *
 * - **任務**要有死線，而「再問問」沒有死線 —— 硬給一個等於編一個。
 * - **備註**（`customer.marks`）跟著人一輩子（ADR-0019），
 *   而這一句下禮拜一就過期了。
 * - `visit.note` 是她壓表當下記的「這一天」的事，只有來訪編輯器改得到。
 *
 * 命名對齊 `customers/{id}/availability` 上那一個 `followupNote` ——
 * 一邊 `followUp` 一邊 `followup` 遲早會有人抓錯欄位。
 */

/**
 * 這位客戶那一句話。
 *
 * 一位客戶好幾天的來訪帶的是同一句：她問的是「這個人回了沒」，
 * 不是「9/3 那天回了沒」—— 客人是一次講完一整天的。
 *
 * @param {object[]} visits 這位客戶還在等回覆的來訪
 * @returns {string|null}
 */
export function followupNoteOf(visits = []) {
  return visits.map((v) => v?.followupNote).find((t) => t) ?? null;
}

/**
 * 等了幾天。
 *
 * **問過了就從問的那天算，不是壓表那天。** 那個數字唯一的用途是
 * 「這個該催了嗎」，而她禮拜五才問過的人，禮拜六不該是紅的 ——
 * 不然紅字會一直掛著，然後她就不看它了。
 *
 * null 代表還不知道：`createdAt` 是 serverTimestamp，要等伺服器回來才有值，
 * 剛按下「已壓表」的那一筆讀回來是空的。那時要說「剛壓」，不要假裝是 0 天。
 *
 * @param {object} visit
 * @param {string} today 'YYYY-MM-DD'
 * @returns {number|null}
 */
export function waitedDays(visit, today) {
  const iso = dayOf(visit?.followupAt) ?? dayOf(visit?.createdAt);
  return iso ? daysBetween(iso, today) : null;
}

/**
 * 這一列現在是什麼樣子。畫面照這個結果決定文字與顏色，不要自己再判斷一次。
 *
 * @param {object[]} visits 這位客戶還在等回覆的來訪
 * @param {string} today 'YYYY-MM-DD'
 * @param {number} noReplyDays 幾天沒回覆就該催（設定頁可調）
 * @returns {{note: string|null, asked: boolean, waited: number|null,
 *            late: boolean, label: string}}
 */
export function waitState(visits = [], today, noReplyDays = 3) {
  const note = followupNoteOf(visits);
  const each = visits.map((v) => waitedDays(v, today)).filter((n) => n != null);
  // 最久的那一筆代表這一列 —— 這個人身上最舊的那件事還沒回，就是還沒回
  const waited = each.length ? Math.max(...each) : null;

  // 問過了就不算「久了」：她已經做了該做的事，剩下的是客人的回合。
  const late = !note && waited != null && waited >= noReplyDays;

  return { note, asked: Boolean(note), waited, late, label: label(note, waited, late) };
}

function label(note, waited, late) {
  if (note) return waited ? `問過了・${waited} 天前` : '剛問過';
  if (waited == null) return '剛壓';
  if (!waited) return '今天壓的';
  return late ? `已等 ${waited} 天・久了` : `已等 ${waited} 天`;
}

/**
 * Firestore 的 Timestamp 與 ISO 字串都吃得下，回 'YYYY-MM-DD'。
 *
 * `createdAt` 是伺服器寫的 Timestamp，`followupAt` 是她按下去那一刻由前端寫的
 * ISO 字串 —— 兩種形狀混在同一個判斷裡，所以這裡兩種都認。
 * 認不出來回 null，不要猜一個日期出來。
 */
function dayOf(ts) {
  if (!ts) return null;
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
