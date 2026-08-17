// 寫入狀態要誠實：未確認前不顯示成功，失敗要看得見並且能重試。
// 她在公司大樓裡用行動網路，訊號不穩是常態，不能靜默失敗。 —— SPEC 6.9

const el = () => document.getElementById('toast');

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

export function saved(message = '已儲存') {
  show(`<span>${message}</span>`);
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
 * 包住一次寫入，自動處理「儲存中 → 已儲存 / 失敗可重試」。
 * 所有寫入都應該經過這裡，這樣就不會有人忘記處理失敗。
 */
export async function withSaveState(fn, { pending, success } = {}) {
  saving(pending);
  try {
    const result = await fn();
    saved(success);
    return result;
  } catch (err) {
    failed(`儲存失敗：${err.message}`, () => withSaveState(fn, { pending, success }));
    throw err;
  }
}
