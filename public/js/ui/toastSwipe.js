// 底下那一條（toast）滑得掉：往左或往下拖、或一甩就收（staging-polish 05）。
//
// 她 10/18 的原話：
//
// > 最底下會跑出來的那個復原按鈕，能不能左滑或是下滑關掉，不然每次都要等他自己消失，
// > 或是其他方式可以提前消失他，如果要滑掉的話好像就可以長一點之類的不知道，比較好滑，比較不會誤按
//
// 數字與「哪幾種給滑」放在這一支純的小模組裡：`toast.js` import 了 `data/repo.js`（從 gstatic 的網址
// import Firebase），在 node 裡 import 不起來，E2E 也不能裝假時鐘等 12 秒 —— 這幾個數字只有這裡量得到。

/** 復原那一條留多久。SPEC 6.3（她 10/18：滑得掉之後「好」停久一點）。 */
export const UNDO_MS = 12_000;

/** 手指移動超過幾個像素就算在滑 —— 那一下不再是點「復原」（她：「比較不會誤按」）。 */
export const TAP_SLOP_PX = 8;

/** 往左或往下拖多遠放開就收。 */
export const DISMISS_PX = 72;

/** 拖不夠遠、但甩得夠快也收（px／ms）…… */
export const FLICK_PX_PER_MS = 0.6;

/** ……可是至少要甩這麼遠：手指在「復原」上滑了一下就收掉，比等它自己消失還糟。 */
export const FLICK_MIN_PX = 32;

/**
 * 哪幾種給滑。
 *
 * - `saving`（儲存中…）：正在飛，收掉她就不知道寫完了沒
 * - `retry`（失敗、重試）：SPEC 6.9，失敗要看得見；收掉就沒有重試的入口了
 * - `queued`（已經存在這台裝置上了）：沒有逾時、是她要知道的狀態
 *
 * 其餘（已儲存、可以復原的那一條、已復原、一般的一句話）都給滑。
 *
 * @param {'saving'|'retry'|'queued'|'failed'|'saved'|'undo'|'info'} kind
 */
export function swipeable(kind) {
  return !['saving', 'retry', 'queued'].includes(kind);
}

/**
 * 只算往左與往下的那一半 —— 往右、往上拖不收（往上是畫面裡別的東西，往右沒有地方去）。
 *
 * @param {number} dx 從按下去到現在，往右為正
 * @param {number} dy 往下為正
 */
export function pull(dx, dy) {
  return { x: Math.min(0, dx), y: Math.max(0, dy) };
}

/** 手指動了沒（超過 `TAP_SLOP_PX` 就是在滑，那一下的 click 不算）。 */
export function isDrag(dx, dy) {
  return Math.hypot(dx, dy) > TAP_SLOP_PX;
}

/**
 * 放開的那一下：收掉還是彈回去。
 *
 * @param {{dx: number, dy: number, ms: number}} g 從按下去到放開的位移與時間
 * @returns {'dismiss'|'back'}
 */
export function release({ dx, dy, ms }) {
  const { x, y } = pull(dx, dy);
  const far = Math.max(-x, y);
  if (far >= DISMISS_PX) return 'dismiss';
  if (far >= FLICK_MIN_PX && ms > 0 && far / ms >= FLICK_PX_PER_MS) return 'dismiss';
  return 'back';
}

/** 拖的時候跟著降的透明度：拖到 `DISMISS_PX` 那麼遠時剩一半，看得出「這樣會收掉」。 */
export function fadeAt(dx, dy) {
  const { x, y } = pull(dx, dy);
  const far = Math.max(-x, y);
  return Math.max(0.2, 1 - (far / DISMISS_PX) * 0.5);
}
