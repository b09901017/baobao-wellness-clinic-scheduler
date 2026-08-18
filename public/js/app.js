// 進入點。只做三件事：初始化 Firebase、看登入狀態、決定畫哪個畫面。
// 業務規則不寫在這裡，也不寫在任何事件處理器裡 —— 那些都在 /domain。

import { initFirebase, isConfigured } from './data/firebase.js';
import { watchAuth, signIn, signOut } from './data/auth.js';
import { renderGate, renderShell } from './ui/shell.js';
import * as sheetSync from './data/sheetSync.js';
import * as toast from './ui/toast.js';
import './ui/views.js'; // 註冊路由，必須在 renderShell 之前

// 告訴 index.html 的逾時保險絲：module 有成功載入，不用顯示載入失敗。
window.__appBooted = true;

const root = document.getElementById('root');

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
    return renderGate(root, { state: 'unconfigured' });
  }

  initFirebase();

  let shellMounted = false;
  watchAuth(({ user, allowed }) => {
    if (!user) {
      shellMounted = false;
      return renderGate(root, { state: 'signedOut', onSignIn: handleSignIn });
    }
    if (!allowed) {
      shellMounted = false;
      return renderGate(root, {
        state: 'notAllowed',
        email: user.email,
        uid: user.uid,
        onSignOut: handleSignOut,
      });
    }
    // 已登入且在白名單內。auth 狀態每次刷新都會觸發，不要重畫整個殼。
    if (!shellMounted) {
      shellMounted = true;
      renderShell(root, { onSignOut: handleSignOut });
      // 寫入成功後安靜地把報表推一份給試算表。推不出去不影響任何事，
      // 資料的真相在 Firestore（SPEC 第 4.8 節）。
      sheetSync.wire();
    }
  });
}

main();

// Service worker 只快取 app 殼，資料一律走 Firestore 自己的離線快取。
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* 註冊失敗不影響使用，安靜略過 */
    });
  });
}
