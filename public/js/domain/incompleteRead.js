// 讀不完整時，會動到次數或健檢那一串待辦的寫入先不寫（ADR-0158）。
//
// 她 2026-10-19：「沒網路的時候存檔，會收掉健檢那條鏈的待辦，而且剩幾次會少算。 好 修」；
// 「我手機就有網路吃到飽，所以除非是短暫的網路不好，不然我一直都是有網路的」—— 所以**擋就好**，
// 不做「先存、連上再補算」。
//
// Firestore 開著本機快取（`data/firebase.js`）。離線、或網路不穩到 SDK 判定離線時，`getDocs()`
// **不會失敗**，回的是快取裡剛好有的那幾筆。存一筆來訪拿那一份當「這位客人的全部」：額度的次數照那一份算
// （少算），健檢那一筆不在手上就把它的「追蹤健檢報告」「約二返」收掉。
//
// 這一支只回答「擋不擋」與「講哪一句」。誰讀了什麼、從哪來的由 `data/` 記（`data/visits.js` 的 `visitsRead`、
// `data/repo.js` 的 `cacheReads()`），擋在 commit 之前。**隨手記、備註、客戶資料、主檔不擋** ——
// 它們不吃這位客人的全部來訪，離線照舊寫進本機快取、連上自己補送（SPEC 第 1 節）。

/** 一次讀回來的來源：`'server'`（伺服器的，完整）或 `'cache'`（本機快取裡剛好有的）。 */
export const readSource = (fromCache) => (fromCache ? 'cache' : 'server');

/**
 * 這一下的寫入要不要擋。
 *
 * @param {{offline?: boolean, sources?: Array<'server'|'cache'|null|undefined>}} [o]
 *   `offline`：這台裝置確定離線（`navigator.onLine === false`，單向訊號：說 false 就一定是真的）。
 *   `sources`：算這一筆要用的每一份讀回來的來源 —— **`null`／`undefined`＝這一台還沒讀過**（例如這位客人的
 *   全部來訪），不知道就不是「全部」，一樣擋。
 * @returns {boolean}
 */
export function readsIncomplete({ offline = false, sources = [] } = {}) {
  return offline === true || sources.some((s) => s !== 'server');
}

/**
 * 那一句。**不可以說「已經存在這台裝置上了」**（那是真的排進佇列的那一種，`ui/toast.js` 的 `queued()`）——
 * 這一筆一個位元都沒寫。
 */
export function incompleteReadSay(customerName) {
  const who = String(customerName ?? '').trim();
  return `網路不穩，讀不到${who ? ` ${who} ` : '這位客人'}的全部紀錄 —— 這一筆先不存，連上之後再按一次`;
}

/**
 * 擋下來時丟的那一個。`ui/toast.js` 認它的 `name`：照講那一句、**不給重試鈕** ——
 * 重試跑的是同一個閉包，打開時讀一次就沿用的那幾條路拿的還是快取來的那一份，永遠存不進去。
 */
export class IncompleteReadError extends Error {
  /**
   * @param {string} [customerName]
   * @param {string} [message] 不是一位客人的那種（資料健檢）自己給一句
   */
  constructor(customerName = '', message = null) {
    super(message ?? incompleteReadSay(customerName));
    this.name = 'IncompleteReadError';
  }
}
