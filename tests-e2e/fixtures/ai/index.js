// 拍照辨識的 E2E 小工具（ADR-0100、0101）。
//
// **模擬器裡的 Function 不叫 Gemini**：它照 `__fakeAi/state` 排好的名字回這個資料夾
// 底下的 `<名字>.json`，沒排就回 `<kind>.json`（`functions/lib/fakeModel.js`）。
// 叫了幾次也記在那一份文件，E2E 用它斷言「被擋下來的那幾次模型一次都沒被叫」。
//
// 這裡一個真名都沒有；假抄字裡的人一律王小明、客戶A，病歷號 1234。

import { AUTH_HOST, APP_ORIGIN, readDoc, seedDocs } from '../emulator.js';
import { projectIdFor } from '../../../public/js/firebase-config.js';

/** 模擬器的 Function 只認啟動它的那個專案（`start-emulators.sh` 開 0 號）。 */
export const EXTRACT_URL = `http://127.0.0.1:5001/${projectIdFor(0)}/asia-east1/extract`;

/** 一張最小的「JPEG」：Function 只看開頭三個位元組，不解碼。 */
export const TINY_JPEG_BASE64 = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]).toString('base64');

/** 下幾次辨識依序回哪幾份假抄字。 */
export async function queueAi(names) {
  await seedDocs([{ path: '__fakeAi', id: 'state', data: { calls: 0, queue: names } }]);
}

/** 假模型到現在被叫了幾次（這個命名空間清空之後算起）。 */
export async function fakeAiCalls() {
  return (await readDoc('__fakeAi', 'state'))?.calls ?? 0;
}

/** 在 Auth 模擬器裡拿一張某個 uid 的 ID token（不經過 app）。 */
export async function idTokenFor(uid) {
  const res = await fetch(
    `${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        postBody: `id_token=${JSON.stringify({ sub: uid, email: `${uid}@example.test`, email_verified: true })}&providerId=google.com`,
        requestUri: APP_ORIGIN,
        returnSecureToken: true,
      }),
    },
  );
  if (!res.ok) throw new Error(`拿不到 ID token ${res.status}`);
  return (await res.json()).idToken;
}

/** 模擬器不驗 App Check 的簽章，只讀 `sub`。跟 `data/ai.js` 的 `fakeAppCheckToken()` 同一個形狀。 */
export function fakeAppCheckToken(appId = '1:000000000000:web:0000000000000000000000') {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: appId, iat: now, exp: now + 3600 })}.fake`;
}

/**
 * 不經過瀏覽器，直接敲那一支 callable。用來測「不是從 app 來的人」。
 * @returns {Promise<{status: number, body: any}>}
 */
export async function callExtractRaw({ idToken = null, appCheck = true, data }) {
  const headers = { 'Content-Type': 'application/json' };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  if (appCheck) headers['X-Firebase-AppCheck'] = fakeAppCheckToken();
  const res = await fetch(EXTRACT_URL, { method: 'POST', headers, body: JSON.stringify({ data }) });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}
