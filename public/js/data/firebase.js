// Firebase 初始化。整個專案只有 /data 底下的檔案可以 import firebase SDK。
// 這條規則由 tests/layering.test.js 自動檢查，違反會讓測試紅掉。

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import {
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  connectAuthEmulator,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
  connectFirestoreEmulator,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

import { emulatorPorts, firebaseConfig, isConfigured, usingEmulator } from '../firebase-config.js';

export { isConfigured };

let app = null;
let auth = null;
let db = null;

export function initFirebase() {
  if (app) return { app, auth, db };

  app = initializeApp(firebaseConfig);
  // 不用 `getAuth()`（ADR-0173）：它帶著彈窗／轉頁登入用的那一塊，而在 iPad、手機、Safari 上會**先**載好它
  // （apis.google.com 的腳本＋一個 iframe）才去還原這一台記著的登入 —— 一年登入一次，卻每次打開都等它
  // （她 iPad 上「登入」那一格 1.4～3.1 秒）。那一塊改成按「登入」時才帶（`auth.js`）。
  // 存登入的地方跟 `getAuth()` 同一組、同一個順序：既有的登入照樣讀得到，不用重新登入。
  auth = initializeAuth(app, {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
  });

  // 離線快取：訊號差的時候讀取仍然打得開，寫入由 SDK 自行排隊重送。
  // 單分頁模式即可 —— 她一次只會開一個。
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }),
  });

  if (usingEmulator()) {
    // port 照 `emulatorPorts`：E2E 一個 worker 一組模擬器時每組不一樣，平常就是 9099／8080
    connectAuthEmulator(auth, `http://127.0.0.1:${emulatorPorts.auth}`, { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', emulatorPorts.firestore);
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
  if (usingEmulator()) connectFirestoreEmulator(db, '127.0.0.1', emulatorPorts.firestore);

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
