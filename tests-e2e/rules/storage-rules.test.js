// storage.rules 的真實測試：跑在 Storage 模擬器上（ADR-0101、0105）。
//
// 白名單跟 firestore.rules 是同一份 `allowedUsers/{uid}`（Storage 的 Rules 跨服務讀 Firestore），
// 所以這一支同時要 Firestore 模擬器（`npm run test:rules` 兩個一起開）。
//
// 用一個獨立的 projectId（demo-rules-test），跟 E2E 那份資料完全隔開。

import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';

import { MAX_PHOTO_BYTES } from '../../public/js/domain/treatmentSheets.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const OK_UID = 'uid-allowed';
const NOPE_UID = 'uid-stranger';
/**
 * 一支測試一個檔名。`clearStorage()` 在這一版的模擬器上不保證清掉上一支傳的檔案，而 Rules 不准覆蓋 ——
 * 共用一個檔名的話，後面那一支的上傳會因為「檔案已經在了」被擋，紅得跟 Rules 寫錯一模一樣。
 */
let seq = 0;
let PATH = '';

let env;
let allowed;
let stranger;
let anon;

/** 一張「JPEG」：Rules 只看 contentType 與大小，不解碼。 */
const jpeg = (bytes = 2048) => new Uint8Array(bytes).fill(7);
const put = (storage, path = PATH, data = jpeg(), contentType = 'image/jpeg') =>
  storage.ref(path).put(data, { contentType });

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-rules-test',
    firestore: { rules: read('../../firestore.rules'), host: '127.0.0.1', port: 8080 },
    storage: { rules: read('../../storage.rules'), host: '127.0.0.1', port: 9199 },
  });
  allowed = env.authenticatedContext(OK_UID).storage();
  stranger = env.authenticatedContext(NOPE_UID).storage();
  anon = env.unauthenticatedContext().storage();
});

after(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  seq += 1;
  PATH = `treatmentSheets/c1/s1/${1758100000000 + seq}.jpg`;
  await env.clearStorage();
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'allowedUsers', OK_UID), {});
  });
});

describe('S1 白名單是唯一的門（跟 firestore.rules 同一份）', () => {
  test('S1.1 白名單內傳得上去、讀得到、刪得掉', async () => {
    await assertSucceeds(put(allowed));
    await assertSucceeds(allowed.ref(PATH).getMetadata());
    await assertSucceeds(allowed.ref(PATH).getDownloadURL());
    await assertSucceeds(allowed.ref(PATH).delete());
  });

  test('S1.2 登入但不在白名單：讀寫刪都被擋', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.storage().ref(PATH).put(jpeg(), { contentType: 'image/jpeg' });
    });
    await assertFails(put(stranger, 'treatmentSheets/c1/s1/2.jpg'));
    await assertFails(stranger.ref(PATH).getMetadata());
    await assertFails(stranger.ref(PATH).getDownloadURL());
    await assertFails(stranger.ref(PATH).delete());
  });

  test('S1.3 沒登入：讀寫刪都被擋', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.storage().ref(PATH).put(jpeg(), { contentType: 'image/jpeg' });
    });
    await assertFails(put(anon, 'treatmentSheets/c1/s1/3.jpg'));
    await assertFails(anon.ref(PATH).getDownloadURL());
    await assertFails(anon.ref(PATH).delete());
  });

  test('S1.4 從白名單拿掉之後，已經傳上去的照片也讀不到', async () => {
    await assertSucceeds(put(allowed));
    await env.withSecurityRulesDisabled(async (ctx) => {
      const { deleteDoc } = await import('firebase/firestore');
      await deleteDoc(doc(ctx.firestore(), 'allowedUsers', OK_UID));
    });
    await assertFails(allowed.ref(PATH).getDownloadURL());
  });
});

describe('S2 只收療程單的照片', () => {
  test('S2.1 不是 JPEG 被擋', async () => {
    await assertFails(put(allowed, PATH, jpeg(), 'image/png'));
    await assertFails(put(allowed, PATH, jpeg(), 'application/pdf'));
  });

  test(`S2.2 大於 ${MAX_PHOTO_BYTES} bytes 被擋；剛好等於收`, async () => {
    await assertSucceeds(put(allowed, 'treatmentSheets/c1/s1/eq.jpg', jpeg(MAX_PHOTO_BYTES)));
    await assertFails(put(allowed, 'treatmentSheets/c1/s1/big.jpg', jpeg(MAX_PHOTO_BYTES + 1)));
  });

  test('S2.3 同一個檔名不覆蓋（上傳到一半斷線，舊的那一張不可以沒了）', async () => {
    await assertSucceeds(put(allowed));
    await assertFails(put(allowed));
  });

  test('S2.4 療程單以外的路徑一律拒絕 —— 訂購單、Abovee 的照片不存（ADR-0101）', async () => {
    await assertFails(put(allowed, 'orderForms/c1/1.jpg'));
    await assertFails(put(allowed, 'aboveeList/1.jpg'));
    await assertFails(put(allowed, 'treatmentSheets/c1/1.jpg'));
    await assertFails(put(allowed, 'x.jpg'));
  });
});

test('S3 這一支真的載到了 storage.rules（不是模擬器預設的全開）', () => {
  assert.match(read('../../storage.rules'), /firestore\.exists\(\/databases\/\(default\)\/documents\/allowedUsers\//);
});
