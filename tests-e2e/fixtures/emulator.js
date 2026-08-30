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
import { doc, setDoc, writeBatch } from 'firebase/firestore';

export const PROJECT_ID = 'wellness-clinic-scheduler';
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
  await fetch(`${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: 'DELETE' });
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
