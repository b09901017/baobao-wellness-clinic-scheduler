// Firebase 初始化。整個專案只有 /data 底下的檔案可以 import firebase SDK。
// 這條規則由 tests/layering.test.js 自動檢查，違反會讓測試紅掉。

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import {
  getAuth,
  connectAuthEmulator,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
  connectFirestoreEmulator,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

import { firebaseConfig, isConfigured, usingEmulator } from '../firebase-config.js';

export { isConfigured };

let app = null;
let auth = null;
let db = null;

export function initFirebase() {
  if (app) return { app, auth, db };

  app = initializeApp(firebaseConfig);
  auth = getAuth(app);

  // 離線快取：訊號差的時候讀取仍然打得開，寫入由 SDK 自行排隊重送。
  // 單分頁模式即可 —— 她一次只會開一個。
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }),
  });

  if (usingEmulator()) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }

  return { app, auth, db };
}

/**
 * 客戶那一頁（`/form.html`）用的初始化。ADR-0031。
 *
 * 跟上面那支的差別是**兩個都不要**：
 *
 * - **不要 Auth。** 客戶沒有帳號，載進來只是白白多一包 SDK，
 *   而他是在 LINE 裡點開的，訊號通常不好。
 * - **不要離線快取。** 那會在別人的手機上留下一份 IndexedDB，
 *   而那份東西沒有任何人需要。客戶送出一次就結束了。
 *
 * 這裡不設 `auth`，所以 `getAuthInstance()` 會丟例外 —— 那是對的：
 * 客戶那一頁走的是 `data/publicForm.js`，碰不到需要登入的東西。
 */
export function initPublicFirebase() {
  if (db) return { app, db };

  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  if (usingEmulator()) connectFirestoreEmulator(db, '127.0.0.1', 8080);

  return { app, db };
}

export function getDb() {
  if (!db) throw new Error('initFirebase() 還沒被呼叫');
  return db;
}

export function getAuthInstance() {
  if (!auth) throw new Error('initFirebase() 還沒被呼叫');
  return auth;
}
