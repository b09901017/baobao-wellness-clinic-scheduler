// 淺色／深色。
//
// 深色那一整組值早就寫好了（`css/tokens.css`），問題是它以前只跟得上**裝置的
// 系統設定**，app 裡沒有任何開關。她的兩台裝置各自設定，而且她要的多半是
// 「現在這個場合切一下」：晚上在家看 iPad 想要深的，白天在院裡同一台想要淺的。
// 見 docs/adr/0055-she-can-switch-to-dark-herself.md。
//
// ## 為什麼記在 localStorage 不記在 Firestore
//
// 它是「這一台裝置現在想要什麼」，不是資料。兩台裝置本來就該各自設定，
// 而且切換要當場生效 —— 走 Firestore 等於為了一個開關付一次往返。
//
// ## 為什麼 `<head>` 裡還有一份
//
// `data-theme` 要在**第一次繪製之前**蓋上去，晚一步就會閃一下白的。
// 這一支是 module，module 是 defer 的，所以來不及。`index.html` 與 `form.html`
// 的 `<head>` 各有一段不到十行的行內腳本做同一件事。
// **改這裡的 key 或值，那兩段要跟著改** —— `tests/tokens.test.js` 盯著。

/** localStorage 的 key。行內腳本用的是同一個字串。 */
export const THEME_KEY = 'scheduler.theme';

/** 設定頁那一排。`system` 是預設值，也就是 2026-08-25 以前唯一的行為。 */
export const THEME_CHOICES = [
  { value: 'system', label: '跟著系統' },
  { value: 'light', label: '淺色' },
  { value: 'dark', label: '深色' },
];

/** 深色時網址列的顏色。淺色那一個跟 `--accent` 同一個墨綠。 */
const BAR_COLOR = { light: '#2f5d4c', dark: '#1a1714' };

/**
 * 她選的是哪一個。**讀不到就當「跟著系統」** —— 無痕視窗、清過網站資料、
 * 或瀏覽器把 localStorage 整個擋掉時，`localStorage` 會直接丟例外。
 */
export function readTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return THEME_CHOICES.some((c) => c.value === saved) ? saved : 'system';
  } catch {
    return 'system';
  }
}

/** 「跟著系統」現在是深的還是淺的。 */
function systemTheme() {
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** 現在畫面上實際是哪一種。`system` 會被解析成 light 或 dark。 */
export function resolvedTheme(choice = readTheme()) {
  return choice === 'system' ? systemTheme() : choice;
}

/**
 * 蓋上去。**永遠蓋一個確定的值**（`light` 或 `dark`），不留空白 ——
 * CSS 那邊只有一份深色（`:root[data-theme='dark']`），沒有 `@media` 的複本，
 * 所以「沒蓋」等於淺色，而那不是「跟著系統」的意思。
 */
export function applyTheme(choice = readTheme()) {
  const theme = resolvedTheme(choice);
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR_COLOR[theme]);
  return theme;
}

/**
 * 存起來並當場生效。存不進去（無痕視窗）也照樣換 —— 這一次還是對的，
 * 只是下次打開會回到預設。安靜地什麼都不做才是最糟的。
 */
export function setTheme(choice) {
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {
    /* 存不起來就只有這一次算數 */
  }
  return applyTheme(choice);
}

/**
 * 選「跟著系統」的時候，系統換了要跟著換。
 *
 * 只掛一次，掛在 app 啟動時（`ui/shell.js`）。她在 iPad 的控制中心切深色時
 * app 通常還開著，不重新整理就跟不上。
 */
export function watchSystemTheme() {
  globalThis.matchMedia?.('(prefers-color-scheme: dark)')
    ?.addEventListener?.('change', () => {
      if (readTheme() === 'system') applyTheme('system');
    });
}
