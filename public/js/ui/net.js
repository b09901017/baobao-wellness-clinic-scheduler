// 「現在連得上嗎」。
//
// 這一支存在的理由，跟 `ui/toast.js` 的 `PENDING_MS` 是同一個：
// **Firestore 的寫入 Promise 在離線時既不 resolve 也不 reject**，所以
// 「存不進去」這件事沒有任何一條程式路徑會走到。app 從頭到尾不知道自己離線了。
//
// 兩者分工：
//
// - toast 的逾時回答「**這一筆**還沒送出去」—— 一次一句，跟著那個動作走
// - 這一支回答「**現在整台裝置**連不上」—— 常駐，跟著網路狀態走
//
// 只有 toast 的話，她離線連做十件事會看到十次同一句話卻不知道為什麼；
// 只有這一條的話，網路好但伺服器慢的那種情況一個字都不會說。
//
// `navigator.onLine` 的極限要講清楚：它只知道**這台裝置有沒有連上網路介面**，
// 連上了公司大樓的 wifi 但那個 wifi 出不去的時候它照樣回 true。
// 所以它是「說 false 就一定是真的離線」的單向訊號 —— 拿它來**確認**離線可以，
// 拿它來保證線上不行。真正接得上與否還是由 toast 的逾時負責。

/** 這台裝置現在確定是離線的嗎。不確定時回 false（見檔頭）。 */
export function isOffline() {
  return navigator.onLine === false;
}

/**
 * 盯著連線狀態。**掛上去的當下先回報一次現況** ——
 * app 可能是在已經離線的狀態下被打開的，等 `online`／`offline` 事件的話
 * 那一次永遠等不到。
 *
 * @param {(offline: boolean) => void} onChange
 * @returns {() => void} 取消訂閱
 */
export function watchOffline(onChange) {
  const fire = () => onChange(isOffline());

  window.addEventListener('online', fire);
  window.addEventListener('offline', fire);
  fire();

  return () => {
    window.removeEventListener('online', fire);
    window.removeEventListener('offline', fire);
  };
}
