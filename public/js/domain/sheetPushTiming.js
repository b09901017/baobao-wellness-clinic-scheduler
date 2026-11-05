// 試算表自動推送「什麼時候再推」的規則（`.scratch/sheet-push-gaps/issues/01`）。
//
// 純的：`data/sheetSync.js` 一路 import 到 firebase 的 CDN 網址，node 裡跑不起來，規則放這裡才測得到。
// 那一支只管計時器與事件，這裡只回答「要不要排、排多久」。

/**
 * 推失敗之後隔多久再試：1 分、5 分、15 分，之後停 —— 等下一次寫入、回到 app、網路回來或打開 app。
 * 三次就停是為了一直失敗的那幾種（密鑰不對、試算表那一側的指令碼太舊）不要無限重試、洗 Apps Script 的執行紀錄。
 */
export const RETRY_MS = [60_000, 5 * 60_000, 15 * 60_000];

/**
 * 第 `failures` 次失敗之後（從 0 數）隔多久再試；試夠了回 `null`。
 * @param {number} failures 這一輪已經連續失敗幾次（成功或有新的寫入就歸零）
 * @returns {number|null}
 */
export function retryDelay(failures) {
  return RETRY_MS[failures] ?? null;
}

/**
 * 這一次推送的結果要不要排重試。**沒設定（`off`）不算失敗**：那張卡本來就說它沒開。
 * @param {{ok?: boolean, off?: boolean}|null|undefined} result
 */
export function wantsRetry(result) {
  return !result?.ok && !result?.off;
}

/**
 * 想在 `ms` 之內推一次時，已經排著的那一次要不要留著。
 * **已經排了更早的就不動** —— 不然回到 app 切來切去，會把排好的那一次一直往後延。
 * 「每次寫入都重設 10 秒」（安靜下來才推）是另一條路，不走這一支。
 *
 * @param {{dueAt: number|null, now: number, ms: number}} o `dueAt` 是排著的那一次什麼時候到（沒有排就是 null）
 */
export function keepsPending({ dueAt, now, ms }) {
  return dueAt != null && dueAt <= now + ms;
}
