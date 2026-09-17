// 寫入狀態要誠實：未確認前不顯示成功，失敗要看得見並且能重試。
// 她在公司大樓裡用行動網路，訊號不穩是常態，不能靜默失敗。 —— SPEC 6.9
//
// 寫入成功後給一顆「復原」按鈕（SPEC 6.3）。手機單手操作最容易誤觸，
// 而每一次寫入都留了 before，所以復原就是把它寫回去。

import { withUndo } from '../data/repo.js';
import { reload } from './router.js';
import { esc } from './components/form.js';

const el = () => document.getElementById('toast');

/** 復原按鈕留多久。SPEC 6.3 要求 5–10 秒。 */
const UNDO_MS = 8000;

/**
 * 寫入等多久還沒回來，就換一句話。
 *
 * **這個數字存在的理由**：Firestore 的寫入 Promise 只有在伺服器確認之後才
 * resolve，離線時它**既不 resolve 也不 reject** —— 它會一直等到網路回來，
 * 而且沒有內建逾時。所以底下 `withSaveState()` 的 `catch` 在離線時
 * 永遠不會被執行，「儲存中…」會停在畫面上直到她重新整理。
 *
 * 那正好違反 SPEC 6.9（「失敗要看得見」）—— 而她大部分時間在公司大樓裡
 * 用行動網路。8 秒是「慢一點的 4G 存得完」與「她已經開始懷疑」之間。
 */
const PENDING_MS = 8000;

let hideTimer = null;

function show(html, { timeout = 3000 } = {}) {
  const node = el();
  if (!node) return;
  clearTimeout(hideTimer);
  node.innerHTML = html;
  node.hidden = false;
  if (timeout) hideTimer = setTimeout(hide, timeout);
}

export function hide() {
  const node = el();
  if (node) node.hidden = true;
}

export function saving(message = '儲存中…') {
  show(`<span>${esc(message)}</span>`, { timeout: 0 });
}

/**
 * 等太久了。**這不是失敗，所以不可以說失敗。**
 *
 * 寫入這時候已經進了 Firestore 的本機快取，SDK 會自己排隊重送 ——
 * 資料是安全的，只是還沒到伺服器。說成「儲存失敗」會讓她再存一次，
 * 而那才真的會變成兩筆。
 *
 * 也不給重試鈕，理由同上：要重試的不是她，是 SDK。
 */
export function queued(message = '還沒送出去 —— 已經存在這台裝置上了，連上網路會自動補送') {
  show(`<span>${esc(message)}</span>`, { timeout: 0 });
}

/**
 * @param {string} message
 * @param {(() => Promise<void>)|null} [onUndo] 有的話就多一顆「復原」按鈕
 */
export function saved(message = '已儲存', onUndo = null) {
  if (!onUndo) {
    show(`<span>${esc(message)}</span>`);
    return;
  }

  show(`<span>${esc(message)}</span><button class="btn" type="button" data-undo>復原</button>`, {
    timeout: UNDO_MS,
  });

  el()?.querySelector('[data-undo]')?.addEventListener('click', async () => {
    saving('復原中…');
    try {
      await onUndo();
      // 復原本身不再給復原鈕 —— 一直往回按會分不清現在是哪個版本
      show('<span>已復原</span>');
      reload();
    } catch (err) {
      failed(`復原失敗：${err.message}`);
    }
  });
}

export function info(message) {
  show(`<span>${esc(message)}</span>`);
}

/**
 * 失敗時給一顆重試按鈕，而不是消失無蹤。
 * @param {string} message
 * @param {() => void} [onRetry]
 */
export function failed(message, onRetry) {
  // **一定要逃脫。** 這一句常常是 `儲存失敗：${err.message}`，而例外訊息裡
  // 帶得進使用者的資料 —— 例如 `data/legacyImport.js` 會把舊試算表的分頁名
  // 放進訊息，而那些分頁名就是客戶姓名。各個 view 的 `讀取失敗` 一直都有
  // `esc()`，只有這條路漏掉了。
  show(
    `<span>${esc(message)}</span>` +
      (onRetry ? '<button class="btn" type="button" data-retry>重試</button>' : ''),
    { timeout: onRetry ? 0 : 5000 },
  );
  if (onRetry) {
    el().querySelector('[data-retry]')?.addEventListener('click', () => {
      hide();
      onRetry();
    });
  }
}

/**
 * 同一個 `key` 的動作正在飛的時候，那一趟的 Promise 放在這裡。
 *
 * 走二次確認的路徑本來就防得住連點 —— `confirmAction()` 一按下去就把整個
 * 對話框節點移除，後面幾下落在不存在的元素上（`07-chaos.spec.js` 的 C12／C13
 * 會過就是靠這個）。**沒有確認框的那幾條路完全沒有保護**：
 * 「儲存中…」只是一條 toast，既不遮蔽也不鎖表單，而她在公司大樓裡用行動網路，
 * 慢一拍就多按一下是常態。雙擊「建立」＝ 兩位同名客戶，各自展開一整份方案額度。
 */
const inFlight = new Map();

/**
 * 包住一次寫入，自動處理「儲存中 → 已儲存（可復原）／ 失敗可重試」。
 * 所有寫入都應該經過這裡，這樣就不會有人忘記處理失敗，也不用逐個記得接復原。
 *
 * @param {() => Promise<T>} fn
 * @param {{pending?:string, success?:string, undoable?:boolean, key?:string|null}} [options]
 *   undoable 預設為真。寫了好幾批的動作 repo 會自己判斷給不出復原，這裡不用管。
 *
 *   `key` 給**同一下不可以做兩次**的動作用（建客戶、存來訪、加額度這種
 *   會長出新資料或動到次數的）。同一個 key 還在飛的時候，第二次呼叫
 *   **接到的是同一趟**，不是再跑一趟 —— 回傳值照樣拿得到，
 *   所以呼叫端那句 `go(\`/customers/${id}\`)` 不會拿到 undefined。
 *
 *   勾掉、還原這種「做兩次結果一樣」的動作不用給 key：全域鎖住一次一個寫入
 *   會讓她連續勾三筆待辦時後兩筆安靜地不見，那比連點嚴重得多。
 *
 *   `slow` 是等太久時換上的那一句。預設的「已經存在這台裝置上了」**只對 Firestore 成立**
 *   （寫入先進本機快取）；傳照片到 Storage 的那幾條要自己給一句 —— 傳到一半的照片不在這台裝置上，
 *   她這時候收起來就沒了（`tests/save-guards.test.js` 盯著）。
 * @template T
 */
export function withSaveState(fn, { pending, success, undoable = true, key = null, slow } = {}) {
  if (key !== null) {
    const running = inFlight.get(key);
    if (running) return running;
  }

  const run = (async () => {
    saving(pending);

    // 等太久就換一句話。**計時器不會取消那一趟寫入** —— 它還在飛，
    // 而且離線時它會一直飛到網路回來（見 PENDING_MS 的說明）。
    // 這裡換掉的只有畫面上那一句，因為「儲存中…」停在那裡三分鐘等於沒說話。
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) queued(slow);
    }, PENDING_MS);

    try {
      const { result, undo } = await withUndo(fn);
      settled = true;
      clearTimeout(timer);
      saved(success, undoable ? undo : null);
      return result;
    } catch (err) {
      settled = true;
      clearTimeout(timer);
      failed(`儲存失敗：${err.message}`, () =>
        withSaveState(fn, { pending, success, undoable, key, slow }));
      throw err;
    }
  })();

  if (key !== null) {
    inFlight.set(key, run);
    // **成功或失敗都要放開**，否則存失敗一次之後那顆按鈕就永遠按不動了 ——
    // 而「失敗可重試」正是這一支存在的理由。這裡的 catch 只是為了掛得上
    // finally，真正的錯誤照樣從 `run` 丟出去給呼叫端。
    run.catch(() => {}).finally(() => {
      if (inFlight.get(key) === run) inFlight.delete(key);
    });
  }

  return run;
}
