// 拍照辨識：叫那一支 Cloud Function（ADR-0100）。**瀏覽器裡沒有任何 AI 的 key。**
//
// 這裡只做兩件事：把照片變成 base64 送出去、把錯誤翻成畫面講得出來的幾種原因。
// 畫面上那一句話不寫在這裡（`domain/aiUsage.js` 的 `failureSentence()`）。
//
// App Check 等到第一次要辨識才初始化：它會載入 reCAPTCHA，而 app 打開的時候
// 絕大部分時間用不到 AI —— 為了它讓每一次開 app 都多載一包、多問一次 Google 不值得。

import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
  httpsCallableFromURL,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js';
import {
  CustomProvider,
  ReCaptchaEnterpriseProvider,
  initializeAppCheck,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app-check.js';

import { initFirebase } from './firebase.js';
import { appCheckSiteKey, firebaseConfig, projectIdFor, usingEmulator } from '../firebase-config.js';

const REGION = 'asia-east1';
/** 模型最多想 50 秒、Function 60 秒，再多留一點給網路。 */
const TIMEOUT_MS = 75_000;

/** 辨識沒做到的原因。畫面照這幾種講話。 */
export class AiError extends Error {
  /**
   * @param {'offline'|'paused'|'monthCap'|'dailyLimit'|'notAllowed'|'verify'|'tooLarge'|'failed'} reason
   * @param {object} [details] 例如 `capUsd`
   */
  constructor(reason, details = {}) {
    super(reason);
    this.reason = reason;
    this.details = details;
  }
}

let call = null;

/**
 * 模擬器裡的 App Check 憑證：一個沒有簽章的 JWT。模擬器不驗簽章
 * （firebase-tools 開了 `skipTokenVerification`），只讀 `sub` 當 app id。
 */
function fakeAppCheckToken() {
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: firebaseConfig.appId, iat: now, exp: now + 3600 })}.fake`;
}

function callable() {
  if (call) return call;
  const { app } = initFirebase();

  if (usingEmulator()) {
    initializeAppCheck(app, {
      provider: new CustomProvider({
        getToken: async () => ({ token: fakeAppCheckToken(), expireTimeMillis: Date.now() + 3_600_000 }),
      }),
      isTokenAutoRefreshEnabled: false,
    });
  } else if (appCheckSiteKey) {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  }

  const functions = getFunctions(app, REGION);
  if (usingEmulator()) {
    connectFunctionsEmulator(functions, '127.0.0.1', 5001);
    // 模擬器的 Function 只認啟動它的那個專案（`start-emulators.sh` 開的是 0 號），
    // 而 app 在平行 E2E 裡的專案是 `…-wN`。照 app 的專案 id 叫會 404，所以寫死 0 號那一份的網址。
    // 代價：平行跑的時候 Function 寫的用量落在 0 號命名空間（現在 `workers: 1`，不影響）。
    call = httpsCallableFromURL(
      functions,
      `http://127.0.0.1:5001/${projectIdFor(0)}/${REGION}/extract`,
      { timeout: TIMEOUT_MS },
    );
  } else {
    call = httpsCallable(functions, 'extract', { timeout: TIMEOUT_MS });
  }
  return call;
}

async function toBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

const KNOWN = new Set(['paused', 'monthCap', 'dailyLimit', 'notAllowed', 'tooLarge']);

/** SDK 的錯誤 → 幾種講得出來的原因。 */
export function reasonOf(error, online = true) {
  if (!online) return 'offline';
  const reason = error?.details?.reason;
  if (KNOWN.has(reason)) return reason;
  const code = String(error?.code ?? '').replace(/^functions\//, '');
  // 沒有 details 的 unauthenticated：App Check 或登入憑證被拒（進到本體之前就擋了）
  if (code === 'unauthenticated') return 'verify';
  if (code === 'permission-denied') return 'notAllowed';
  // 送不出去（斷線、逾時）時 SDK 回 internal／unavailable／deadline-exceeded 而且沒有 details
  if (!reason && ['internal', 'unavailable', 'deadline-exceeded'].includes(code)) {
    return globalThis.navigator?.onLine === false ? 'offline' : 'failed';
  }
  return 'failed';
}

/**
 * 辨識一張照片。
 *
 * @param {'orderForm'|'planFlyer'|'aboveeList'|'treatmentSheet'} kind
 * @param {Blob} blob 已經縮好、重新編碼過的 JPEG（`ui/components/camera.js`）
 * @returns {Promise<{transcript: object, usage: {estUsd: number, monthUsd: number, capUsd: number}}>}
 * @throws {AiError}
 */
export async function extract(kind, blob) {
  // 沒網路就不送：這一次是真的沒做到，可以直接說（跟離線寫入不說失敗是兩件事）
  if (globalThis.navigator?.onLine === false) throw new AiError('offline');
  const image = await toBase64(blob);
  try {
    const { data } = await callable()({ kind, image });
    return data;
  } catch (e) {
    throw new AiError(reasonOf(e, globalThis.navigator?.onLine !== false), e?.details ?? {});
  }
}
