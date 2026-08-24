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

/** 每一層一個遞增的號碼。history.state 上存的就是它。 */
let seq = 0;

/** @type {{key: number, onPop: Function, closing: boolean}[]} 由下往上 */
const stack = [];

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
    const target = window.history.state?.__layer ?? 0;

    // 退到哪一層就收掉它上面的每一層。她可能長按返回鍵一次退兩層。
    while (stack.length && stack[stack.length - 1].key > target) {
      const layer = stack.pop();
      // 由畫面自己關掉的那一層（叉叉、手勢、取消）已經收好了，
      // 這裡只是把它的紀錄吃掉，不要再關一次。
      if (!layer.closing) layer.onPop();
    }

    // 換頁時留下來的舊層。它們的畫面早就被 hashchange 收掉了，
    // 紀錄卻還在 —— 不跳過的話她會按到一次「什麼都沒發生」的返回鍵。
    if (window.history.state?.__layer && !stack.length) window.history.back();
  });

  // 換頁（換路由）時把還開著的層忘掉。它們自己會被 hashchange 收掉
  // （`sheet.js` / `card.js` 都有那個監聽），這裡只是不要再持有它們。
  window.addEventListener('hashchange', () => {
    stack.length = 0;
  });
}

/**
 * 畫面上疊了一層東西。
 *
 * @param {Function} onPop 按返回鍵時把這一層收掉。由畫面自己關掉時不會被呼叫。
 * @returns {{pop: Function}} `pop()` 給「用叉叉或手勢關掉」那條路用 ——
 *   它把剛剛推的那一筆紀錄退掉，不然紀錄會越積越多。
 */
export function pushLayer(onPop) {
  wire();
  seq += 1;
  const layer = { key: seq, onPop, closing: false };
  stack.push(layer);
  window.history.pushState({ __layer: layer.key }, '', window.location.hash);

  return {
    pop() {
      if (layer.closing) return;
      layer.closing = true;
      // 只有最上面那一層退得掉。不是最上面的（理論上不該發生）就讓它留在
      // 堆疊裡由 popstate 收掉 —— 硬退會把別人的紀錄也吃掉。
      if (stack[stack.length - 1] === layer) window.history.back();
      else stack.splice(stack.indexOf(layer), 1);
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
 * **這些畫面會重畫自己好幾次**（換了額度型態要換欄位、重新解析規則要重列），
 * 所以要一把 key：同一個畫面重畫不再疊一層，不然按五次返回鍵才回得去。
 *
 * @param {string} key     這個畫面的身分，例：'customer-edit'
 * @param {Function} restore 回到上一個畫面（通常就是那一頁的 paint()）
 * @returns {Function} 「取消」那顆按鈕呼叫它。返回鍵走的是同一個 restore。
 */
export function pushScreen(key, restore) {
  wire();

  const top = stack[stack.length - 1];
  if (top && top.screenKey === key && !top.closing) {
    // 同一個畫面重畫。restore 的 closure 可能換了（它抓著新的 draft），
    // 所以要換掉，但不再推一筆紀錄。
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
 * 會回到一張**已經存過的表單**，看起來像沒存進去。這一支把它們的紀錄
 * 一起退掉，而且不呼叫它們的 restore —— 呼叫端正在做自己的重畫。
 */
export function popScreens() {
  const live = stack.filter((l) => l.screenKey && !l.closing);
  if (!live.length) return;
  for (const l of live) l.closing = true;
  window.history.go(-live.length);
}
