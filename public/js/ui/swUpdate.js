// 「有新版本・點一下更新」（ADR-0167，after-golive 06）。
//
// `sw.js` 改成程式檔先用手機裡的之後，新版本是**在背景裝好、等著**的：她正在用的那一頁照舊跑舊的那一份，
// 等她點這一條才換。她 2026-10-20 選的：「跳一條『有新版本・點一下更新』」—— 不是下次打開自動換、不提示，
// 也不是當下自動重新整理（會打斷她正在打的字）。
//
// - 那一條不擋任何操作、可以收掉（`dismiss()`）。收掉之後：所有視窗都關掉時等著的新版會自己換上，
//   下次打開（從多工畫面滑掉再開）就是新的；app 一直開著就照舊是舊的，下次打開再跳一次
// - **第一次安裝時 `clients.claim()` 也會來一下 `controllerchange`** —— 只有她按了更新才重新載入，
//   不然第一次打開就會自己重新整理一次
// - app 開著一整天也要看得到新版：回到這個 app（`visibilitychange`）時請瀏覽器再比一次 `sw.js`
//
// 畫在哪裡是 `ui/shell.js` 的事（`onUpdateReady()`），這一支只管 service worker。

let waiting = null;
let reloading = false;
const listeners = new Set();

const sw = () => globalThis.navigator?.serviceWorker ?? null;

/** 開機叫一次（`app.js`）。註冊、盯著有沒有新版在等。 */
export function register() {
  const container = sw();
  if (!container) return;

  container.addEventListener('controllerchange', () => {
    if (!reloading) return;
    globalThis.location.reload();
  });

  const go = async () => {
    try {
      const reg = await container.register('/sw.js');
      watch(reg);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    } catch {
      /* 註冊失敗不影響使用，安靜略過 */
    }
  };
  if (document.readyState === 'complete') go();
  else globalThis.addEventListener('load', go, { once: true });
}

function watch(reg) {
  // 上一次打開時就裝好、一直在等的（她收掉了那一條、app 沒關乾淨）
  if (reg.waiting && sw()?.controller) found(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const next = reg.installing;
    next?.addEventListener('statechange', () => {
      // 沒有 controller ＝這一台第一次裝：裝好就直接用，不是「新版本」
      if (next.state === 'installed' && sw()?.controller) found(next);
    });
  });
}

function found(worker) {
  waiting = worker;
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* 畫那一條的人壞掉不可以擋住別人 */
    }
  }
}

/**
 * 有新版本在等的時候叫 `fn`（已經在等了就馬上叫）。
 * @returns {() => void} 取消
 */
export function onUpdateReady(fn) {
  listeners.add(fn);
  if (waiting) fn();
  return () => listeners.delete(fn);
}

/** 她點了那一條：叫等著的那一個接手，接手之後（`controllerchange`）重新載入。 */
export function applyUpdate() {
  reloading = true;
  if (waiting) waiting.postMessage({ type: 'skipWaiting' });
  else globalThis.location.reload();
}

/**
 * 設定頁「重新下載程式」：清掉這一台的程式檔、重新整理（萬一卡在舊版）。
 * **只清 app 的檔案**（`shell-*`）—— Firestore 的資料快取不在這裡，SDK 與字體那一格也留著（離線還要用）。
 */
export async function redownload() {
  try {
    const regs = (await sw()?.getRegistrations?.()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
    const keys = (await globalThis.caches?.keys?.()) ?? [];
    await Promise.all(keys.filter((k) => k.startsWith('shell-')).map((k) => caches.delete(k)));
  } finally {
    globalThis.location.reload();
  }
}
