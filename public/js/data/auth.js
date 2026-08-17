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

// 登入成功不等於有權限。白名單是 Firestore 上的 allowedUsers/{uid}，
// Security Rules 也讀同一份，所以前端這裡只是為了給出好一點的錯誤訊息。
export async function isAllowed(uid) {
  try {
    const snap = await getDoc(doc(getDb(), 'allowedUsers', uid));
    return snap.exists();
  } catch {
    return false;
  }
}

/**
 * @param {(state: {user: object|null, allowed: boolean}) => void} cb
 */
export function watchAuth(cb) {
  return onAuthStateChanged(getAuthInstance(), async (user) => {
    if (!user) return cb({ user: null, allowed: false });
    cb({ user, allowed: await isAllowed(user.uid) });
  });
}
