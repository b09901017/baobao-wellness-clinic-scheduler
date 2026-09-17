// 拍照辨識：這個 repo 唯一一支伺服器程式（ADR-0100）。
//
// 這支檔案只負責接線：callable 的選項、Firestore、模型。規則在 `lib/`，
// 單元測試在 `tests/ai-function.test.js`。
//
// **五道防護**
//   1. 沒有任何 key —— 以 `ai-extract` 服務帳號執行，授權由 Google 在執行環境裡給
//   2. 登入 ＋ `allowedUsers`（`lib/extract.js`）
//   3. App Check（下面的 `enforceAppCheck: true`，進到本體之前就擋掉）
//   4. 我們自己數的上限（`lib/guard.js`）
//   5. Google 那一層的預算警示（只寄信，不在程式裡）

import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

import { makeExtract } from './lib/extract.js';
import { makeFakeModel } from './lib/fakeModel.js';
import { makeGeminiModel } from './lib/geminiModel.js';
import { ExtractError } from './lib/guard.js';
import { makeStore } from './lib/store.js';

initializeApp();
const db = getFirestore();

const backend = {
  exists: async (path) => (await db.doc(path).get()).exists,
  get: async (path) => {
    const snap = await db.doc(path).get();
    return snap.exists ? snap.data() : null;
  },
  transaction: (fn) => db.runTransaction((t) => fn({
    get: async (path) => {
      const snap = await t.get(db.doc(path));
      return snap.exists ? snap.data() : null;
    },
    set: (path, data) => t.set(db.doc(path), data),
  })),
  newId: () => db.collection('_').doc().id,
  stamp: () => FieldValue.serverTimestamp(),
};

// **模擬器裡不叫 Gemini**：照 `tests-e2e/fixtures/ai/` 回假抄字，五道防護照樣跑。
// 這個判斷只在載入時做一次；部署上去的那一份 `FUNCTIONS_EMULATOR` 不會是 'true'。
// （兩支都靜態 import：模擬器的 runtime 用 require() 載這支檔案，不吃頂層 await。）
const model = process.env.FUNCTIONS_EMULATOR === 'true'
  ? makeFakeModel(db)
  : makeGeminiModel();

const run = makeExtract({ store: makeStore(backend), model, log: logger });

export const extract = onCall(
  {
    region: 'asia-east1',
    // 跟著專案走：staging 與正式各有一個同名帳號，firebase-tools 會補上 `{專案}.iam.gserviceaccount.com`
    serviceAccount: 'ai-extract@',
    enforceAppCheck: true,
    maxInstances: 2,
    // 模型含重試最多 100 秒（`lib/geminiModel.js`），留時間記帳
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  async (request) => {
    try {
      return await run({ auth: request.auth, data: request.data });
    } catch (e) {
      if (e instanceof ExtractError) {
        throw new HttpsError(e.code, e.reason, { reason: e.reason, ...e.details });
      }
      // 沒想到的錯：只記種類，不記訊息（訊息裡可能帶著請求的內容）
      logger.error('extract crashed', { name: e?.name ?? 'unknown' });
      throw new HttpsError('internal', 'failed', { reason: 'failed' });
    }
  },
);
