// 登出處理器的掛勾。
//
// 登出鈕從畫面頂端那條橫幅搬進了設定頁 —— 那條橫幅上的標題跟每一頁自己的
// 大標重複，在手機上白白吃掉一整列。但設定頁讀不到 app.js 手上的登出函式，
// 所以用這個極小的模組把它接起來，而不是讓設定頁自己 import auth。
//
// 這裡刻意只存一個函式，不存任何使用者資料 —— 誰登入了是 data/auth.js 的事。

let handler = null;

/** app.js 啟動時掛上去。 */
export function setSignOut(fn) {
  handler = fn;
}

/** 設定頁按下登出時呼叫。還沒掛上去就安靜不做事，不要丟例外。 */
export function signOutNow() {
  handler?.();
}
