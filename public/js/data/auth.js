import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

import { getAuthInstance, getDb } from './firebase.js';

const provider = new GoogleAuthProvider();

// iOS 加到主畫面後的 standalone 模式關不掉 popup，會卡住。那裡改用 redirect。
function prefersRedirect() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export async function signIn() {
  const auth = getAuthInstance();
  if (prefersRedirect()) return signInWithRedirect(auth, provider);
  return signInWithPopup(auth, provider);
}

export function signOut() {
  return fbSignOut(getAuthInstance());
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
 */
export function watchAuth(cb) {
  return onAuthStateChanged(getAuthInstance(), async (user) => {
    if (!user) return cb({ user: null, access: 'denied' });
    cb({ user, access: await accessState(user.uid) });
  });
}
