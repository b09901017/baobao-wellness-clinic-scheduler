// Firebase 初始化。整個專案只有 /data 底下的檔案可以 import firebase SDK。
// 這條規則由 tests/layering.test.js 自動檢查，違反會讓測試紅掉。

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import {
  getAuth,
  connectAuthEmulator,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
  connectFirestoreEmulator,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

import { firebaseConfig, isConfigured } from '../firebase-config.js';

export { isConfigured };

let app = null;
let auth = null;
let db = null;

function usingEmulator() {
  return ['localhost', '127.0.0.1'].includes(location.hostname);
}

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

export function getDb() {
  if (!db) throw new Error('initFirebase() 還沒被呼叫');
  return db;
}

export function getAuthInstance() {
  if (!auth) throw new Error('initFirebase() 還沒被呼叫');
  return auth;
}
