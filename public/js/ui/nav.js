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
//
// ## handle 會失效，而且只有這一支知道
//
// 畫面常常把 `pushLayer()` 回來的東西存在模組層的變數裡（壓表的 `monthLayer`、
// 日曆的 `deckLayer`），下次要推之前先看「已經有一層了嗎」。而**換頁會把整個
// stack 清掉** —— 那是對的（那幾筆紀錄現在在新頁面的下面），但畫面那個變數
// 不會知道，於是它永遠是真的，永遠不再推新的一層。
//
// 症狀：離開壓表再回來，返回鍵直接跳出整頁而不是退回選月份，而且**一句錯誤
// 訊息都沒有**。所以每一條把層拿掉的路都要經過 `drop()`，handle 那邊問
// `layer.active`，不要問 `layer` 是不是 null。

/** 現在畫面上疊著哪幾層，由下往上。 */
const stack = [];

/**
 * 我們自己剛叫的那一趟 `history.go()` 要退到第幾層。沒有就是 `null`。
 *
 * `go()` 是非同步的，而在它回來之前畫面可能又疊了一層（兩道接在一起的
 * 確認框）。分不出「她按了返回鍵」與「我們自己退的」的話，新疊的那一層
 * 會被當成該收掉的那一層 —— 見 popstate 那一段。
 *
 * **存的是目標深度，不是計數器。** 計數器會卡住：`go()` 不一定回得來
 * （退無可退時瀏覽器什麼都不做），而卡住的計數器會把她**真的**按的返回鍵
 * 一起吃掉 —— 那比原本的 bug 更糟。目標深度對不上就當成是她按的。
 */
let goTarget = null;

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

/**
 * 從 stack 拿掉一層，**而且標成作廢**。
 *
 * 每一條拿掉的路都要走它 —— 少走一條，那條路上的 handle 就會一直說自己還在。
 */
function drop(layer) {
  layer.closed = true;
  const i = stack.indexOf(layer);
  if (i >= 0) stack.splice(i, 1);
  return layer;
}

function wire() {
  if (wired) return;
  wired = true;

  window.addEventListener('popstate', () => {
    physical = window.history.state?.__layer ?? 0;

    // **這一下是我們自己叫的嗎**（`reconcile()` 的 `history.go`）。
    //
    // `history.go()` 是非同步的，它排在後面才跑 —— 而在它回來之前，畫面
    // 可能又開了新的一層。**兩道接在一起的確認框就是這條路**（ADR-0086：
    // 先「這幾段先看一下」，按了才問 Abovee）：第一道關掉時排了一次 go，
    // 第二道在它回來之前就開好了，於是那一下 popstate 把**第二道**收掉。
    //
    // 症狀最壞的地方是它一句話都不說：她按了「知道了，繼續」，Abovee 那道
    // 閃一下就沒了，而那筆來訪從頭到尾沒有被記錄（SPEC 第 6.9 節）。
    //
    // 所以我們自己叫的那一下**只對帳，不收層** —— 收哪幾層由 `stack` 說了算，
    // 而 `stack` 在那一趟 go 排隊的時候已經是新的了。
    //
    // 判準是「退到的深度就是我們要的，而且 stack 在那之後長高了」。
    // 兩個條件都要：只比深度的話，她**真的**按返回鍵那一下會被吃掉。
    const mine = goTarget !== null && physical === goTarget && stack.length > physical;

    // **還在路上的那一趟**（2026-09-17，issue 09）：兩層在不同的微任務裡收掉（確認框按「離開」，
    // 接著底下那一層），`reconcile()` 會排兩趟 go，而瀏覽器兩趟都會走完。第一趟停在中途那一格時
    // 深度比目標高、stack 也沒有長高 —— 那不是「還差一格」，是第二趟還沒到。這時候再對帳會多退一次，
    // 三格一退就退出 app 了。所以只記下現在在哪一格，等下一個 popstate。
    //
    // stack 長高了（中途又疊了一層）就不是這一種，照下面的舊路走。
    if (goTarget !== null && physical > goTarget && stack.length <= goTarget) return;

    goTarget = null;
    if (mine) {
      schedule();
      return;
    }

    // 退到哪一層就收掉它上面的每一層。她可能長按返回鍵一次退兩層。
    // **只收按下去那一刻疊著的**：被收的那一層可能在 onPop 裡問一句（拍訂購單的「還有 N 位沒建立」），
    // 那一道確認框是新疊的，不可以被同一圈收掉（2026-09-17，issue 09）
    // 上面那一層的 onPop 可能順手收掉下面那一層 —— 已經收掉的不再叫一次
    for (const layer of stack.slice(physical).reverse()) {
      if (!layer.closed) drop(layer).onPop();
    }

    schedule();
  });

  // 換頁（換路由）時把還開著的層忘掉。它們自己會被 hashchange 收掉
  // （`sheet.js` / `card.js` 都有那個監聽），而且**那一路不可以退紀錄** ——
  // 它們的那幾筆現在在新頁面的下面，退掉會把換頁一起退掉。
  //
  // **忘掉也要標作廢**：手上還抓著 handle 的畫面（壓表的 `monthLayer`）
  // 要問得出「我那一層還在嗎」，不然它回來時不會再推一層。
  window.addEventListener('hashchange', () => {
    while (stack.length) drop(stack[stack.length - 1]);
    physical = window.history.state?.__layer ?? 0;
    // **換頁把那一趟也忘掉。** `go()` 不一定回得來（退無可退時瀏覽器什麼都
    // 不做），而一個沒有人來認領的目標深度會在下一頁把她真的按的返回鍵
    // 吃掉一次 —— 那比原本要修的 bug 更糟。
    goTarget = null;
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
    // 記著這一趟要退到哪一層：它回來的時候不可以收掉在那之後才疊的（見 popstate）。
    goTarget = want;
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
 * @returns {{pop: Function, active: boolean}} `pop()` 給「用叉叉或手勢關掉」
 *   那條路用；`active` 是「我那一層還在嗎」——
 *   **存著 handle 的畫面一律問它，不要問 handle 是不是 null**（見檔頭）。
 */
export function pushLayer(onPop) {
  wire();
  const layer = { onPop, closed: false };
  stack.push(layer);
  schedule();

  return {
    get active() { return !layer.closed; },
    pop() {
      if (layer.closed) return;
      drop(layer);
      schedule();
    },
  };
}

/**
 * 等收層那一趟 `history.go()` 回來。
 *
 * 確認框按下去之後**馬上**換頁的話，確認框收掉時排的那一趟 go 會晚到、把換頁退掉
 * （刪客戶被擋下來時「去批次取消」那一顆，prelaunch-audit-2026-09-23/issues/08）。
 * 中間有一次寫入的那幾條路（存完才換頁）本來就等到了。最多等一秒，不會卡住。
 */
export function whenSettled() {
  const until = Date.now() + 1000;
  return new Promise((resolve) => {
    const check = () => {
      if ((goTarget === null && !scheduled && physical === stack.length) || Date.now() > until) resolve();
      else setTimeout(check, 16);
    };
    // 對帳排在微任務裡（`schedule()`），先讓它跑
    queueMicrotask(check);
  });
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
    if (stack[i].screenKey) drop(stack[i]);
  }
  if (stack.length !== before) schedule();
}
