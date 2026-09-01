// 進入點。只做三件事：初始化 Firebase、看登入狀態、決定畫哪個畫面。
// 業務規則不寫在這裡，也不寫在任何事件處理器裡 —— 那些都在 /domain。

import { initFirebase, isConfigured } from './data/firebase.js';
import { watchAuth, signIn, signOut } from './data/auth.js';
import { renderGate, renderShell } from './ui/shell.js';
import * as sheetSync from './data/sheetSync.js';
import * as toast from './ui/toast.js';
import './ui/views.js'; // 註冊路由，必須在 renderShell 之前

const root = document.getElementById('root');

/**
 * 告訴 index.html 的逾時保險絲：不用顯示載入失敗了。
 *
 * **一定要等真的畫出東西之後才叫。** 以前這一行寫在 module 頂層，
 * 所以只要 module 載得進來就算「開好了」—— 而 `main()` 自己丟例外的時候
 * （config 壞掉、`initializeApp()` 拒收），保險絲已經被解除，
 * 畫面會永遠停在「載入中…」。保險絲存在的理由就是最壞情況下還能講話，
 * 那個最壞情況不可以是它自己造成的。
 */
function booted() {
  window.__appBooted = true;
}

async function handleSignIn() {
  try {
    await signIn();
  } catch (err) {
    toast.failed(`登入失敗：${err.message}`, handleSignIn);
  }
}

function handleSignOut() {
  signOut().catch((err) => toast.failed(`登出失敗：${err.message}`));
}

function main() {
  if (!isConfigured()) {
    renderGate(root, { state: 'unconfigured' });
    return booted();
  }

  initFirebase();

  let shellMounted = false;
  watchAuth(({ user, access }) => {
    if (!user) {
      shellMounted = false;
      renderGate(root, { state: 'signedOut', onSignIn: handleSignIn });
      return booted();
    }
    // 連不上不是沒有權限（見 data/auth.js 的 accessState）。
    // 這一頁給的是「等一下再試」，不是「去 Console 加白名單」。
    if (access === 'unreachable') {
      shellMounted = false;
      renderGate(root, {
        state: 'unreachable',
        email: user.email,
        onRetry: () => location.reload(),
        onSignOut: handleSignOut,
      });
      return booted();
    }
    if (access !== 'allowed') {
      shellMounted = false;
      renderGate(root, {
        state: 'notAllowed',
        email: user.email,
        uid: user.uid,
        onSignOut: handleSignOut,
      });
      return booted();
    }
    // 已登入且在白名單內。auth 狀態每次刷新都會觸發，不要重畫整個殼。
    if (!shellMounted) {
      shellMounted = true;
      renderShell(root, { onSignOut: handleSignOut });
      // 寫入成功後安靜地把報表推一份給試算表。推不出去不影響任何事，
      // 資料的真相在 Firestore（SPEC 第 4.8 節）。
      sheetSync.wire();
    }
    return booted();
  });
}

// `main()` 本身丟例外的話**不要**解除保險絲 —— 那正是它要接住的情況。
// 12 秒後 index.html 會把「載入失敗」畫出來，而不是永遠停在「載入中…」。
main();

// Service worker 只快取 app 殼，資料一律走 Firestore 自己的離線快取。
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* 註冊失敗不影響使用，安靜略過 */
    });
  });
}
