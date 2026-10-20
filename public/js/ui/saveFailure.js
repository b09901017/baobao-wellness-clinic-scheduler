// 寫入沒成功、或等太久時，toast 要講什麼。純的那一半（`toast.js` 在 node 裡 import 不起來，同 `toastSwipe.js`）。

/**
 * 失敗那一句與給不給重試鈕。
 *
 * - **讀不完整**（`domain/incompleteRead.js`，ADR-0158）：照講那一句（它自己就說了「先不存」），不給重試 ——
 *   重試跑同一個閉包，打開時讀一次就沿用的那幾條路拿的還是快取來的那一份
 * - **別的地方剛改過**（`data/repo.js` 的 `StaleWriteError`）：重試拿的還是同一份舊的，不給重試
 * - 其餘：「儲存失敗：…」＋重試
 *
 * @param {Error|any} err
 * @returns {{text: string, retry: boolean}}
 */
export function failureOf(err) {
  if (err?.name === 'IncompleteReadError') return { text: err.message, retry: false };
  return { text: `儲存失敗：${err?.message ?? '不知道為什麼'}`, retry: err?.name !== 'StaleWriteError' };
}

/**
 * 等了 `PENDING_MS` 還沒回來，現在可以換成「還沒送出去 —— 已經存在這台裝置上了」嗎？
 *
 * 那一句只對**已經送出的寫入**成立（寫入先進本機快取、SDK 自己排隊重送）。網路不穩時 SDK 大約 10 秒才把讀取
 * 退回快取，而 `PENDING_MS` 是 8 秒 —— 還在讀的那幾秒講它就是假話，接著讀到快取被擋下來（ADR-0158）時，
 * 她會先看到「存好了」再看到「沒存」。所以**還沒送出任何一次寫入就再等**。
 *
 * 呼叫端自己給了一句（`slow`，傳照片到 Storage 的那幾條）照舊時間到就講：那一句講的就是「還在傳」。
 *
 * @param {{slow?: string, sentAtStart: number, sentNow: number}} o `data/repo.js` 的 `commitsSent()` 開始時與現在的值
 *   （全站共用一個數；別的動作剛好在這幾秒送出寫入時會早一點講 —— 只差在那一句什麼時候出現）
 */
export function slowSayNow({ slow, sentAtStart, sentNow }) {
  return slow != null || sentNow > sentAtStart;
}
