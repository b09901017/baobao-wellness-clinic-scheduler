// 跟 Firebase 模擬器講話的那一層：建帳號、清資料、塞資料。
//
// 塞資料刻意**繞過 Security Rules**（withSecurityRulesDisabled）——
// 測試要的是「app 在這種資料下長什麼樣」，不是「這份資料寫不寫得進去」。
// 後者是 tests-e2e/rules/ 那一支在測的，兩件事分開。
//
// 這裡一個真名都不會出現。假名一律用 CLAUDE.md 說的那種（客戶A、王小明）。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { projectIdFor } from '../../public/js/firebase-config.js';
import { doc, setDoc, writeBatch } from 'firebase/firestore';

/**
 * 這個 worker 的命名空間。**一個 worker 一份 Firestore**，所以平行跑的時候
 * 每個測試開頭那個 `clearFirestore()` 只洗掉自己的。
 *
 * 三個地方要算出同一個值（這裡、`start-emulators.sh`、app 的 config），
 * 而**三邊呼叫的是同一支 `projectIdFor()`** —— 以前是各寫死一份字串，
 * 對不上時 fixture 塞進 A、app 讀 B，每個測試都是「畫面空的」而且沒有
 * 任何錯誤訊息。`tests/env.test.js` 盯著沒有人自己寫死。
 *
 * **用 `TEST_PARALLEL_INDEX` 不是 `TEST_WORKER_INDEX`。** 前者是 0..workers-1
 * 的槽號，同時在跑的 worker 一人一個；後者在 worker 重啟（測試失敗後）時會一直
 * 往上加，於是每重啟一次就長出一個新的命名空間 —— 隔離照樣成立，但模擬器裡
 * 會堆一堆再也沒人看的資料，而重試的那一次讀到的是全新的空資料庫。
 */
export const PROJECT_ID = projectIdFor(process.env.TEST_PARALLEL_INDEX);

/**
 * 建帳號／清帳號要打哪一個命名空間。**永遠是 0 號，跟 `PROJECT_ID` 不一樣。**
 *
 * Auth 模擬器的 `getProjectIdByApiKey()` 把 api key 丟掉，一律回
 * `--project` 那個預設專案（firebase-tools 的 `emulator/auth/server.js`）——
 * 也就是說**瀏覽器那側的 Auth 根本分不了專案**，不管 app 的 config 寫哪一個
 * projectId，登入都落在 0 號那一份裡。
 *
 * 這對我們是好事：全部 worker 共用同一個 uid，而 `ensureUser()` 是冪等的、
 * 也沒有人呼叫 `clearAuth()`，所以不會互相打架。真正要隔離的是 Firestore
 * （白名單 `allowedUsers/{uid}` 是 Firestore 文件，跟著 `PROJECT_ID` 走）。
 *
 * 這裡寫成 `projectIdFor(0)` 而不是 `PROJECT_ID`：打錯的話會清掉一個空的
 * 命名空間，然後每個 worker 都登不進去。
 */
export const AUTH_PROJECT_ID = projectIdFor(0);
export const AUTH_HOST = 'http://127.0.0.1:9099';
export const APP_ORIGIN = 'http://127.0.0.1:5000';

const RULES = readFileSync(
  fileURLToPath(new URL('../../firestore.rules', import.meta.url)),
  'utf8',
);

let env = null;

async function testEnv() {
  if (env) return env;
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: RULES, host: '127.0.0.1', port: 8080 },
  });
  return env;
}

export async function closeEnv() {
  await env?.cleanup();
  env = null;
}

// ---------- 帳號 ----------
//
// 用 signInWithIdp 配一個假的 google.com id_token，這樣 uid 是**我們自己決定的**
// （sub 就是 localId）。決定得了 uid，才塞得進 allowedUsers/{uid} ——
// 而那份白名單正是 app 判斷「這個人有沒有權限」的唯一依據。

/**
 * 在 Auth 模擬器裡建一個 google.com 帳號。已經存在就直接登入，回同一個 uid。
 * @returns {Promise<{uid: string, email: string}>}
 */
export async function ensureUser({ uid = 'e2e-manager-uid', email = 'manager@example.test' } = {}) {
  const res = await fetch(
    `${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        postBody: `id_token=${JSON.stringify({ sub: uid, email, email_verified: true, name: '健康管理師' })}&providerId=google.com`,
        requestUri: APP_ORIGIN,
        returnSecureToken: true,
      }),
    },
  );
  if (!res.ok) throw new Error(`建帳號失敗 ${res.status}: ${await res.text()}`);
  const body = await res.json();
  return { uid: body.localId, email: body.email ?? email };
}

/** 把 Auth 模擬器整個清空。每一個測試檔開頭跑一次就好。 */
export async function clearAuth() {
  await fetch(`${AUTH_HOST}/emulator/v1/projects/${AUTH_PROJECT_ID}/accounts`, { method: 'DELETE' });
}

// ---------- 資料 ----------

/**
 * 清空 Firestore，**而且等它真的清完**。
 *
 * `clearFirestore()` 的 HTTP 回來不代表模擬器那邊已經 truncate 完 ——
 * 清得比較慢的時候，它會把接下來剛塞好的種子一起洗掉，而症狀只是
 * 「畫面上什麼都沒有」，沒有任何錯誤。這一支害我查了兩次：
 * 第一次以為是假時鐘，第二次以為是測試之間互相污染。
 *
 * 作法：清完之後寫一顆 canary，確認它活得下來才回去。
 */
export async function clearFirestore() {
  const e = await testEnv();
  await e.clearFirestore();

  for (let i = 0; i < 20; i += 1) {
    const id = `canary-${Date.now()}-${i}`;
    // eslint-disable-next-line no-await-in-loop
    await e.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), '__canary', id), { at: Date.now() });
    });
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => { setTimeout(r, 60); });

    let alive = false;
    // eslint-disable-next-line no-await-in-loop
    await e.withSecurityRulesDisabled(async (ctx) => {
      const { getDoc } = await import('firebase/firestore');
      alive = (await getDoc(doc(ctx.firestore(), '__canary', id))).exists();
    });
    if (alive) return;
  }
  throw new Error('清空之後 Firestore 一直留不住東西 —— 模擬器可能掛了');
}

/**
 * 塞一批文件進去。
 *
 * 每一筆自動補上 `deletedAt: null` 與時間戳 —— 少了 `deletedAt` 的話
 * `repo.list()` 的 `where('deletedAt','==',null)` 一筆都撈不到，
 * 而畫面上看起來就只是「空的」，很難查。
 *
 * @param {{path: string, id?: string, data: object}[]} docs
 */
export async function seedDocs(docs = []) {
  const e = await testEnv();
  await e.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    // Firestore 一個 batch 上限 500
    for (let i = 0; i < docs.length; i += 400) {
      const batch = writeBatch(db);
      for (const d of docs.slice(i, i + 400)) {
        const parts = d.path.split('/').filter(Boolean);
        const ref = d.id ? doc(db, ...parts, d.id) : doc(db, ...parts);
        batch.set(ref, {
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: 'seed',
          ...d.data,
        });
      }
      // eslint-disable-next-line no-await-in-loop
      await batch.commit();
    }
  });
}

/** 讀一份文件回來，用來驗證「app 真的寫進去了什麼」。 */
export async function readDoc(path, id) {
  const e = await testEnv();
  let out = null;
  await e.withSecurityRulesDisabled(async (ctx) => {
    const parts = path.split('/').filter(Boolean);
    const { getDoc } = await import('firebase/firestore');
    const snap = await getDoc(doc(ctx.firestore(), ...parts, id));
    out = snap.exists() ? { id: snap.id, ...snap.data() } : null;
  });
  return out;
}

/** 讀一整個集合回來（含已刪除的）。 */
export async function readAll(path) {
  const e = await testEnv();
  let out = [];
  await e.withSecurityRulesDisabled(async (ctx) => {
    const parts = path.split('/').filter(Boolean);
    const { getDocs, collection } = await import('firebase/firestore');
    const snap = await getDocs(collection(ctx.firestore(), ...parts));
    out = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  });
  return out;
}

/** 允許某個 uid 使用 app。沒有這一筆，登入了也只會看到「這個帳號還沒有權限」。 */
export async function allowUser(uid) {
  await seedDocs([{ path: 'allowedUsers', id: uid, data: {} }]);
}
