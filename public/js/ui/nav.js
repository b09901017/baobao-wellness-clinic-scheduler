// 返回鍵。
//
// 她的原話：「我按手機的返回鍵，很常不是真的回到剛剛那個頁面而是跳到奇怪的頁面，
// 有時候我按返回鍵就是要關掉我剛打開的東西或是回到我點開某個東西之前的頁面。」
//
// 那是三個各自獨立的問題（見 `.scratch/back-button/spec.md`），這一支處理其中兩個：
//
// 1. **疊上來的東西不吃返回鍵。** 抽屜、卡片、對話框打開時沒有推任何一筆瀏覽器
//    紀錄，所以按返回鍵不是關掉它們，是直接跳走上一頁。
// 3. **原地換掉的畫面沒有自己的位置。** 客戶詳情按「編輯」是把同一個 el 的
//    innerHTML 換掉、網址沒動，所以在編輯表單上按返回鍵會整個離開這個人。
//
// 兩個是同一件事：**畫面上多出來一層東西，就多一筆返回鍵退得掉的紀錄。**
// 所以它們共用 `pushLayer()`，不管那一層是一張抽屜還是一整頁換掉的 innerHTML。
//
// 第 2 個問題（「回上一頁」走的是 location.hash，那是往前推不是往回退）在
// `back()`，由 `router.js` 的 `go()` 一起維護計數器。
//
// ## 為什麼是 pushState 而不是換網址
//
// 網址一個字都不會變（`pushState(state, '', location.hash)`），所以不會觸發
// `hashchange`，路由不會重畫。hash 路由是刻意選的（見 `router.js` 的檔頭），
// 這一支沒有動它。
//
// ## 為什麼是「對帳」而不是一層一個 back
//
// 第一版是「開一層就 pushState，關一層就 history.back()」。那會壞，而且壞得
// 很難查：**`history.back()` 是非同步的**，它排在後面才跑。所以「關掉卡片 →
// 關掉抽屜 → 開一張新抽屜」（她在日曆上點一筆再按鉛筆就是這條路）這一連串
// 同步動作跑完之後，兩個排隊中的 back 才輪到，把剛開好的那張新抽屜也退掉了。
// 同一種 race 也發生在「關掉面板然後換頁」上。
//
// 所以改成：畫面那邊只管維護 `stack`（現在疊著哪幾層），這一支在**微任務**裡
// 跟瀏覽器紀錄對一次帳 —— 一個 tick 裡開開關關幾次都無所謂，對帳只看最後的結果。

/** 現在畫面上疊著哪幾層，由下往上。 */
const stack = [];

/**
 * 瀏覽器紀錄裡目前有幾層（也就是 `history.state.__layer`）。
 * 對帳就是把它推成等於 `stack.length`。
 */
let physical = 0;

let scheduled = false;

/**
 * 我們自己推過幾筆**路由**紀錄。`back()` 用它判斷「有沒有東西可以退」。
 *
 * 不用 `history.length` —— 它算得到使用者在這個分頁上逛過的別的網站，
 * 從 LINE 點連結進來時那個數字是一個跟這個 app 無關的值。
 */
let routeDepth = 0;

let wired = false;

function wire() {
  if (wired) return;
  wired = true;

  window.addEventListener('popstate', () => {
    physical = window.history.state?.__layer ?? 0;

    // 退到哪一層就收掉它上面的每一層。她可能長按返回鍵一次退兩層。
    while (stack.length > physical) stack.pop().onPop();

    schedule();
  });

  // 換頁（換路由）時把還開著的層忘掉。它們自己會被 hashchange 收掉
  // （`sheet.js` / `card.js` 都有那個監聽），而且**那一路不可以退紀錄** ——
  // 它們的那幾筆現在在新頁面的下面，退掉會把換頁一起退掉。
  window.addEventListener('hashchange', () => {
    stack.length = 0;
    physical = window.history.state?.__layer ?? 0;
  });
}

/** 對帳排在微任務裡：一個 tick 裡開開關關幾次都只對一次。 */
function schedule() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    reconcile();
  });
}

function reconcile() {
  const want = stack.length;
  if (physical === want) return;

  if (physical > want) {
    // 多的一次退到位，不要一層一個 back。
    const n = physical - want;
    physical = want;
    window.history.go(-n);
    return;
  }

  while (physical < want) {
    physical += 1;
    window.history.pushState({ __layer: physical }, '', window.location.hash);
  }
}

/**
 * 畫面上疊了一層東西。
 *
 * @param {Function} onPop 按返回鍵時把這一層收掉。由畫面自己關掉時不會被呼叫。
 * @returns {{pop: Function}} `pop()` 給「用叉叉或手勢關掉」那條路用。
 */
export function pushLayer(onPop) {
  wire();
  const layer = { onPop, closed: false };
  stack.push(layer);
  schedule();

  return {
    pop() {
      if (layer.closed) return;
      layer.closed = true;
      const i = stack.indexOf(layer);
      if (i >= 0) stack.splice(i, 1);
      schedule();
    },
  };
}

/** `router.go()` 每推一筆路由就叫一次。 */
export function noteRoutePush() {
  routeDepth += 1;
}

/**
 * 回上一頁。**真的退，不是再推一筆。**
 *
 * `location.hash = path` 是推一筆新紀錄，所以
 * 「客戶列表 → 客戶詳情 → 按左上角的『客戶』」會在紀錄裡留下三筆，
 * 這時候按手機返回鍵會回到客戶詳情 —— 她剛剛才離開的地方。
 *
 * 只有在這一次工作階段裡我們自己推過紀錄時才 `history.back()`：
 * 她從 LINE 點連結直接落在客戶詳情的話，退回去是 LINE，不是客戶列表。
 * 那種情況走 fallback，而且用 `replace` 不用 push。
 *
 * @param {string} fallback 沒有東西可以退的時候去哪裡，例：'/customers'
 */
export function back(fallback) {
  if (routeDepth > 0) {
    routeDepth -= 1;
    window.history.back();
    return;
  }
  window.location.replace(`${window.location.pathname}#${fallback}`);
}

/**
 * 原地換掉整頁內容的畫面：客戶詳情的「編輯」「加購」、可用性的「記一次」、
 * 主檔的編輯表單。它們不換網址，所以在上面按返回鍵會整個離開這個人，
 * 而且打到一半的東西沒了。
 *
 * **這些畫面會重畫自己好幾次**（換了額度型態要換欄位、點一天要重畫日曆），
 * 所以要一把 key：同一個畫面重畫不再疊一層，不然按十次返回鍵才回得去。
 *
 * @param {string} key     這個畫面的身分，例：'customer-edit'
 * @param {Function} restore 回到上一個畫面（通常就是那一頁的 paint()）
 * @returns {Function} 「取消」那顆按鈕呼叫它。返回鍵走的是同一個 restore。
 */
export function pushScreen(key, restore) {
  wire();

  const top = stack[stack.length - 1];
  if (top?.screenKey === key) {
    // 同一個畫面重畫。restore 的 closure 可能換了（它抓著新的 draft），
    // 所以要換掉，但不再疊一層。
    top.onPop = restore;
    return top.leave;
  }

  const handle = pushLayer(restore);
  const entry = stack[stack.length - 1];
  entry.screenKey = key;
  // 讀 entry.onPop 而不是 restore —— 重畫過的話那個 closure 已經舊了。
  entry.leave = () => {
    handle.pop();
    entry.onPop();
  };
  return entry.leave;
}

/**
 * 存完了、要整頁重讀的時候呼叫。
 *
 * 原地換掉的那幾層（`pushScreen()`）如果留在紀錄裡，她存完之後按返回鍵
 * 會回到一張**已經存過的表單**，看起來像沒存進去。這一支把它們一起收掉，
 * 而且不呼叫它們的 restore —— 呼叫端正在做自己的重畫。
 */
export function popScreens() {
  const before = stack.length;
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    if (stack[i].screenKey) stack.splice(i, 1);
  }
  if (stack.length !== before) schedule();
}
