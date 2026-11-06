import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  browserPopupRedirectResolver,
  signOut as fbSignOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

import { getAuthInstance, getDb } from './firebase.js';

const provider = new GoogleAuthProvider();

// 裝到主畫面的那幾種。manifest 寫的是 `fullscreen`（ADR-0147）：Android 照做，
// iOS 不認得、退回 `standalone` —— 兩種都要問，只問 standalone 的話 Android 上裝好的那一顆
// 會被當成瀏覽器分頁，登入從 redirect 悄悄換成 popup。`tests/immersive-display.test.js` 盯著。
const INSTALLED = '(display-mode: fullscreen), (display-mode: standalone)';

// 轉頁登入（redirect）還是彈窗（popup）。
//
// - **裝到主畫面的那一顆**：iOS 的 standalone 模式關不掉 popup，會卡住
// - **iPad、手機、Safari 的瀏覽器分頁**（ADR-0173）：彈窗要在按下去的那一刻同步打開，那幾種擋非同步開的窗。
//   Firebase 本來是一打開 app 就先載好登入那一塊來趕上這一刻 —— 那正是她 iPad 上打開慢的原因，
//   所以開機不再先載（`firebase.js`），那幾種改走轉頁（ADR-0168 之後轉頁走 app 自己的網址，分頁也登得進去）
// - 其餘（桌機的 Chrome／Edge／Firefox）照舊彈窗：不用離開這一頁。E2E 走這一條
const BLOCKS_LATE_POPUPS = /iPad|iPhone|iPod|Android|Mobi/i;

function prefersRedirect() {
  if (window.matchMedia(INSTALLED).matches || window.navigator.standalone === true) return true;
  const ua = window.navigator.userAgent || '';
  // iPadOS 的 Safari 預設自稱 Macintosh：用觸控點認出來
  const ipadAsMac = /Macintosh/.test(ua) && (window.navigator.maxTouchPoints ?? 0) > 1;
  const safari = /Safari/.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|Edg|Android/.test(ua);
  return BLOCKS_LATE_POPUPS.test(ua) || ipadAsMac || safari;
}

export async function signIn() {
  const auth = getAuthInstance();
  if (prefersRedirect()) return signInWithRedirect(auth, provider, browserPopupRedirectResolver);
  return signInWithPopup(auth, provider, browserPopupRedirectResolver);
}

/**
 * 轉頁登入回來的那一次把它收下來（ADR-0173）。以前 `getAuth()` 開機時自己收；現在不帶登入那一塊，要自己叫。
 * **沒有轉頁登入時它不載任何東西**：先看 SDK 自己記在這一頁 sessionStorage 的那一筆，沒有就回 null。
 * 收不下來（取消、網路）不講：她看到的就是還在登入頁，再按一次就好 —— 以前也是一句都不講。
 */
let redirectDone = null;
function finishRedirect() {
  redirectDone ??= getRedirectResult(getAuthInstance(), browserPopupRedirectResolver).catch(() => null);
  return redirectDone;
}

export function signOut() {
  // 先忘掉再登出：登出到一半她重新整理的話，不可以先畫出上一個人的殼
  forgetAllowed();
  return fbSignOut(getAuthInstance());
}

// ---------- 這一台上次通過了（ADR-0167，after-golive 07）----------
//
// 開機要等登入（還原登入、跟伺服器確認帳號；ADR-0173 之前手機上還先載一個 iframe）＋白名單（讀一次伺服器）才畫殼，全部是網路來回，
// 而她 99% 的打開都是「同一台、同一個帳號、還在白名單裡」。所以白名單說可以的時候在這一台記下 uid，
// 下次打開先畫殼（`app.js`），登入在背景確認；確認出來不是同一位、或沒有權限、或被登出，才換掉。
//
// **只記 uid，不記任何資料**：殼本身一筆資料都沒有，資料要等 Firestore 讀 —— 而 Firestore 的讀取本來就排隊等登入，
// 伺服器那一側由 Rules 擋。**唯一一條不經過 Rules 的路是只讀手機裡的快取**（`repo.listCached()`，首頁先畫那一下），
// 那一條先問 `confirmedAsRemembered()`。
//
// 讀寫包 try：網站資料被擋掉時就是「沒記著」，照舊等登入。

const ALLOWED_KEY = 'scheduler.allowedUid';

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** 這一台上次通過白名單的是誰（沒有就 null）。 */
export function lastAllowedUid() {
  try {
    return storage()?.getItem(ALLOWED_KEY) || null;
  } catch {
    return null;
  }
}

function rememberAllowed(uid) {
  try {
    storage()?.setItem(ALLOWED_KEY, uid);
  } catch {
    /* 記不住就下次照舊等登入 */
  }
}

/** 登出、沒有權限、沒登入：忘掉，下次打開照舊等登入。 */
export function forgetAllowed() {
  try {
    storage()?.removeItem(ALLOWED_KEY);
  } catch {
    /* 同上 */
  }
}

/**
 * 登入回答了（不管快慢），而且就是這一台記著通過白名單的那一位。
 * **只讀快取的那一條路先問它**：快取裡的東西不經過 Rules —— 沒登入、換了一個帳號時，Firestore 照樣讀得出上一個人留下的。
 */
export async function confirmedAsRemembered() {
  const auth = getAuthInstance();
  await auth.authStateReady();
  const uid = auth.currentUser?.uid;
  return !!uid && uid === lastAllowedUid();
}

/**
 * 登入成功不等於有權限。白名單是 Firestore 上的 allowedUsers/{uid}，
 * Security Rules 也讀同一份，所以前端這裡只是為了給出好一點的錯誤訊息。
 *
 * **三種答案，不是兩種。** 以前讀不到就回 `false`，於是「連不上」被畫成
 * 「這個帳號還沒有權限」，畫面上還教她去 Firebase Console 建 allowedUsers ——
 * 而她只是在電梯裡。新裝置第一次離線打開就會踩到（有離線快取的話 `getDoc`
 * 從快取答得出來，所以日常不會遇到，這也是它藏得住的原因）。
 *
 * 「讀不到」與「不在白名單」要做的事完全相反：一個是等一下再試，
 * 一個是去 Console 加一筆。講錯了她會照著錯的那一句做。
 *
 * Rules 那條是 `allow read: if signedIn() && request.auth.uid == uid` ——
 * 登入了就一定讀得到自己那一筆，不存在時 `exists()` 是 false 而不是丟例外。
 * 所以會走到 catch 的實務上只有連線問題。
 *
 * @returns {Promise<'allowed'|'denied'|'unreachable'>}
 */
export async function accessState(uid) {
  try {
    const snap = await getDoc(doc(getDb(), 'allowedUsers', uid));
    return snap.exists() ? 'allowed' : 'denied';
  } catch {
    return 'unreachable';
  }
}

/**
 * @param {(state: {user: object|null, access: 'allowed'|'denied'|'unreachable'}) => void} cb
 * @param {{onUser?: Function}} [o] `onUser`：Firebase 一回答是誰就叫（還沒問白名單）——
 *   量開機那一張要分開「登入」與「權限」兩步（after-golive 05）
 */
export function watchAuth(cb, { onUser } = {}) {
  // 先收轉頁登入回來的那一次再開始聽：不然回來那一下先聽到「沒登入」、閃一下登入頁才進去。
  // 平常（沒有轉頁登入）它跟第一次回答一樣只等這一台記著的登入還原好，不多等
  let off = null;
  let stopped = false;
  finishRedirect().then(() => {
    if (stopped) return;
    off = onAuthStateChanged(getAuthInstance(), async (user) => {
      onUser?.(user);
      if (!user) {
        forgetAllowed();
        return cb({ user: null, access: 'denied' });
      }
      const access = await accessState(user.uid);
      // 連不上不改記著的那一筆：不知道就不改（記著的是同一位時 app.js 留著殼）
      if (access === 'allowed') rememberAllowed(user.uid);
      else if (access === 'denied') forgetAllowed();
      cb({ user, access });
    });
  });
  return () => {
    stopped = true;
    off?.();
  };
}
