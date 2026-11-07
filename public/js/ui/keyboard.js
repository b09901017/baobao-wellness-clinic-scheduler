// 鍵盤開著的時候（ADR-0181）。
//
// 她 11/6：「點了鉛筆，他就會這樣，跳出鍵盤遮住輸入的地方 並且如果我將抽屜往上拉，整個頁面都會往上拉」。
// 裝到主畫面的那一顆是全螢幕的（ADR-0147），Chrome 在全螢幕裡預設**不縮版面**，只縮 visual viewport ——
// 貼在底部的抽屜整張被鍵盤蓋住，往上拉是在捲 visual viewport。
//
// 修法本身是 `index.html` viewport 那一行的 `interactive-widget=resizes-content`：鍵盤跳出來時版面跟著縮，
// 抽屜、卡片、整頁的表單全部自然落在鍵盤上面（HTC 實機量過：800 → 404）。**這一支只管它的副作用**：
// 版面縮成一半時，底部導覽列也跟著站到鍵盤上面、吃掉一截 —— 打字的時候她用不到它，所以收起來。
//
// 判斷「鍵盤開著」：**焦點在一格會叫出鍵盤的欄位裡，而且版面比這個寬度量過最高的矮了一截**。
// 「量過最高的」照寬度各記一份（`nextKeyboard()`）：打字時轉方向，轉過去那一刻的高度是扣掉鍵盤的那一截，不能當成最高的。
// iPad 與 iPhone 的 Safari 不縮版面（也不認 `interactive-widget`）→ 永遠不成立，那邊一個像素都不動 —— 不會讓開兩次。
// 桌機沒有螢幕鍵盤 → 一樣不成立。
//
// 畫法在 `app.css` 的 `html[data-keyboard]`；這一支只寫那一格。

/** 矮了多少才算鍵盤（螢幕鍵盤最矮也有兩百多；網址列、旋轉中途的跳動不到這個數）。 */
export const KEYBOARD_MIN_PX = 120;

/** 這一格聚焦時會不會叫出螢幕鍵盤（日期、時間、勾選框那幾種跳的是別的東西）。 */
export function typesText(el) {
  if (!el || el.disabled || el.readOnly) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  const type = (el.getAttribute('type') || 'text').toLowerCase();
  return ['text', 'search', 'tel', 'url', 'email', 'number', 'password'].includes(type);
}

/**
 * 現在算不算鍵盤開著。純函式，方便測。
 * @param {{tallest: number, height: number, focused: Element|null}} s
 */
export function keyboardOpen({ tallest, height, focused }) {
  return typesText(focused) && tallest - height >= KEYBOARD_MIN_PX;
}

/**
 * 量高度的那一份往下走一步。純函式（測試照著轉方向走一遍）。
 *
 * - 「量過最高的」照寬度各記一份：轉回原本的方向沿用那時候量過的
 * - 轉到還沒量過的方向、而那一刻鍵盤開著、還在打字 → 現在的高度是扣掉鍵盤的那一截（上 main 前最後健檢 C，2026-11-07：
 *   以前拿它當最高的，判成鍵盤沒開，底部導覽列站回鍵盤上面）。先照舊算開著（`lowest`），
 *   等它長回來一截（鍵盤收了）或不在打字了，再從那一刻起照一般的量
 *
 * @param {{width: number, tallestBy: Map<number, number>, lowest: number|null, open: boolean}} s
 * @param {{width: number, height: number, focused: Element|null}} now
 */
export function nextKeyboard(s, { width, height, focused }) {
  const tallestBy = new Map(s.tallestBy);
  const typing = typesText(focused);
  let lowest = width !== s.width
    ? (!tallestBy.has(width) && s.open && typing ? height : null)
    : s.lowest;
  if (lowest !== null) {
    lowest = Math.min(lowest, height);
    if (typing && height - lowest < KEYBOARD_MIN_PX) return { width, tallestBy, lowest, open: true };
  }
  const tallest = Math.max(tallestBy.get(width) ?? height, height);
  tallestBy.set(width, tallest);
  return { width, tallestBy, lowest: null, open: keyboardOpen({ tallest, height, focused }) };
}

let started = false;

/** 開始盯。**只掛一次**（殼可能畫第二次，ADR-0167；這一支掛在 `window` 上）。 */
export function watchKeyboard() {
  if (started || typeof window === 'undefined') return;
  started = true;
  const root = document.documentElement;
  let state = {
    width: window.innerWidth,
    tallestBy: new Map([[window.innerWidth, window.innerHeight]]),
    lowest: null,
    open: false,
  };

  const check = () => {
    state = nextKeyboard(state, { width: window.innerWidth, height: window.innerHeight, focused: document.activeElement });
    if (state.open) root.dataset.keyboard = '';
    else delete root.dataset.keyboard;
  };

  window.addEventListener('resize', check);
  document.addEventListener('focusin', check);
  // 失焦的那一下焦點還在半路上（`activeElement` 是 body），等這一輪事件跑完再看
  document.addEventListener('focusout', () => setTimeout(check, 0));
}
