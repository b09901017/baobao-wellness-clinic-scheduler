// 寫入狀態要誠實：未確認前不顯示成功，失敗要看得見並且能重試。
// 她在公司大樓裡用行動網路，訊號不穩是常態，不能靜默失敗。 —— SPEC 6.9
//
// 寫入成功後給一顆「復原」按鈕（SPEC 6.3）。手機單手操作最容易誤觸，
// 而每一次寫入都留了 before，所以復原就是把它寫回去。

import { withUndo } from '../data/repo.js';
import { reload } from './router.js';

const el = () => document.getElementById('toast');

/** 復原按鈕留多久。SPEC 6.3 要求 5–10 秒。 */
const UNDO_MS = 8000;

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
  show(`<span>${message}</span>`, { timeout: 0 });
}

/**
 * @param {string} message
 * @param {(() => Promise<void>)|null} [onUndo] 有的話就多一顆「復原」按鈕
 */
export function saved(message = '已儲存', onUndo = null) {
  if (!onUndo) {
    show(`<span>${message}</span>`);
    return;
  }

  show(`<span>${message}</span><button class="btn" type="button" data-undo>復原</button>`, {
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
  show(`<span>${message}</span>`);
}

/**
 * 失敗時給一顆重試按鈕，而不是消失無蹤。
 * @param {string} message
 * @param {() => void} [onRetry]
 */
export function failed(message, onRetry) {
  show(
    `<span>${message}</span>` +
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
 * 包住一次寫入，自動處理「儲存中 → 已儲存（可復原）／ 失敗可重試」。
 * 所有寫入都應該經過這裡，這樣就不會有人忘記處理失敗，也不用逐個記得接復原。
 *
 * @param {() => Promise<T>} fn
 * @param {{pending?:string, success?:string, undoable?:boolean}} [options]
 *   undoable 預設為真。寫了好幾批的動作 repo 會自己判斷給不出復原，這裡不用管。
 * @template T
 */
export async function withSaveState(fn, { pending, success, undoable = true } = {}) {
  saving(pending);
  try {
    const { result, undo } = await withUndo(fn);
    saved(success, undoable ? undo : null);
    return result;
  } catch (err) {
    failed(`儲存失敗：${err.message}`, () =>
      withSaveState(fn, { pending, success, undoable }));
    throw err;
  }
}
