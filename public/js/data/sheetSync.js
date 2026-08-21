// 把報表推給 Google 試算表的 Apps Script。
//
// 方向很重要：**app 推出去，Apps Script 不進來拿。** ADR-0010 擋掉的是
// 「Apps Script 拿一把 Firestore 服務帳號金鑰去讀整個資料庫」，因為那把鑰匙
// 外洩等於全部客戶的資料外洩。這條路上 Apps Script 什麼都不需要知道，
// 它只是一個收件口 —— 沒有 Google 憑證、沒有排程、沒有第二份業務邏輯。
// 見 docs/adr/0013-sheet-sync-is-a-push-not-a-pull.md。
//
// 排版與次數在 domain/sheetReport.js 的 syncBundle()，這一層只負責送。

import * as config from './config.js';
import * as customersData from './customers.js';
import * as visitsData from './visits.js';
import * as tasksData from './tasks.js';
import * as repo from './repo.js';
import { syncBundle } from '../domain/sheetReport.js';
import { todayISO, addDays } from '../domain/dates.js';

/** 報表往回涵蓋多久的來訪。跟 #/settings/report 同一個數字：會籍是一年。 */
const LOOKBACK_DAYS = 400;

/**
 * 寫入之後等多久才推。
 *
 * 不是每次寫入都推：她一次壓表會連續存十幾筆，那樣就是十幾次往外打。
 * 等安靜下來再推一次整包 —— 整包是冪等的，所以「少推幾次」不會少資料。
 */
const QUIET_MS = 10_000;

/** 上次成功推出去的時間。存在這台裝置上，換裝置看到的可能不一樣，無所謂。 */
const LAST_KEY = 'sheetSync.lastAt';
/** 有資料變了但還沒推成功。離線時會一直是 true，連上網之後補推。 */
const DIRTY_KEY = 'sheetSync.dirty';
/**
 * 上次推送**被拒絕**的原因。跟 DIRTY_KEY 是兩件事：
 * 那個說「還沒推」，這個說「推了，對面不收」——處理方式完全不同。
 */
const ERROR_KEY = 'sheetSync.lastError';
/** `.gs` 認不出來、所以沒有更新的那幾張分頁。那幾位的次數是舊的，要講出來。 */
const SKIPPED_KEY = 'sheetSync.lastSkipped';

let timer = null;
let inFlight = null;

const read = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key, value) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // 無痕模式之類的，同步照樣可以動，只是狀態顯示不出來
  }
};

const readJson = (key) => {
  try {
    return JSON.parse(read(key) ?? 'null');
  } catch {
    return null;
  }
};

export const lastSyncedAt = () => read(LAST_KEY);
export const isDirty = () => read(DIRTY_KEY) === '1';

/** 上次失敗的原因，{ at, error }。沒失敗過或上次成功了就是 null。 */
export const lastError = () => readJson(ERROR_KEY);
/** 上次推送有幾張沒更新，{ at, names }。一張都沒有就是 null。 */
export const lastSkipped = () => readJson(SKIPPED_KEY);

/**
 * 推失敗了。**留下來的是痕跡，不是彈窗** —— 自動推送是每次存檔後十秒觸發的，
 * 網路差的時候跳 toast 會把她洗版，然後她就學會忽略它，那比不說還糟。
 * 待推標記照舊留著，下次寫入或下次開 app 會補推（ADR-0013）。
 */
function noteFailure(error) {
  write(DIRTY_KEY, '1');
  write(ERROR_KEY, JSON.stringify({ at: new Date().toISOString(), error }));
  return { ok: false, error };
}

/** 設定齊了才算開著。網址或密鑰少一個都推不出去。 */
export function isConfigured(settings) {
  return Boolean(settings?.sheetSync?.url && settings?.sheetSync?.token);
}

/**
 * 整包資料。**整包**是刻意的：漏推一次下一次會補回來，
 * 不需要在兩邊維護「哪些變了」—— 那種帳一定會對不起來。
 */
export async function buildBundle() {
  const today = todayISO();
  const [customers, entitlementsBy, visits, tasks, master] = await Promise.all([
    customersData.list(),
    customersData.entitlementsByCustomer(),
    visitsData.listBetween(addDays(today, -LOOKBACK_DAYS), addDays(today, LOOKBACK_DAYS)),
    tasksData.listAll(),
    config.loadAll(),
  ]);

  const visitsBy = {};
  for (const v of visits) (visitsBy[v.customerId] ??= []).push(v);

  const tasksBy = {};
  for (const t of tasks) (tasksBy[t.customerId] ??= []).push(t);

  return syncBundle({
    customers,
    entitlementsBy,
    visitsBy,
    tasksBy,
    today,
    master,
    generatedAt: new Date().toLocaleString('zh-TW'),
  });
}

/**
 * 推一次。同時只會有一份在路上 —— 兩份整包互相覆蓋，後到的不一定比較新。
 *
 * **不 throw。** 失敗是回傳值，而且一定會被 noteFailure() 記下來 ——
 * 自動推送那條路沒有人在看回傳值，只有痕跡留得住。
 *
 * @returns {Promise<{ok: boolean, off?: boolean, error?: string,
 *                    at?: string, sheets?: number|null, skipped?: string[]}>}
 */
export function push() {
  inFlight ??= run().finally(() => { inFlight = null; });
  return inFlight;
}

async function run() {
  const settings = await config.getSettings();
  // 「沒有開」不是失敗，不留失敗痕跡 —— 那張卡本來就會說它沒開。
  if (!isConfigured(settings)) return { ok: false, off: true, error: '還沒設定試算表的網址與密鑰' };

  const { url, token } = settings.sheetSync;
  const bundle = await buildBundle();

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      // 刻意用 text/plain：換成 application/json 會觸發 CORS 預檢，
      // 而 Apps Script 的網頁應用程式不回應 OPTIONS，預檢一送就整個失敗。
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token, bundle }),
      redirect: 'follow',
    });
  } catch (err) {
    // 離線就是這一條。留著待推標記，下次寫入或下次開 app 再補。
    return noteFailure(`連不上試算表：${err.message}`);
  }

  const text = (await res.text()).trim();
  if (!res.ok) return noteFailure(`試算表回了 ${res.status}：${text.slice(0, 200)}`);

  let reply;
  try {
    reply = JSON.parse(text);
  } catch {
    // Apps Script 出錯時回的是一整頁 HTML，直接印出來只會嚇到人
    return noteFailure('試算表回了看不懂的東西，請確認網頁應用程式的部署還在');
  }

  if (!reply.ok) return noteFailure(reply.error ?? '試算表說失敗，但沒說為什麼');

  const at = new Date().toISOString();
  // `.gs` 的 resetSheet() 認不出來、所以沒有清空重畫的那幾張。那條守衛做出來
  // 就是為了講話的：那幾位的次數還是上一次的，而畫面上看起來跟推好了一模一樣。
  const skipped = Array.isArray(reply.skipped) ? reply.skipped : [];
  write(LAST_KEY, at);
  write(DIRTY_KEY, null);
  write(ERROR_KEY, null);
  write(SKIPPED_KEY, skipped.length ? JSON.stringify({ at, names: skipped }) : null);
  return { ok: true, at, sheets: reply.sheets ?? null, skipped };
}

/** 安靜 QUIET_MS 之後推一次。連續存十幾筆只會換來一次推送。 */
export function schedule() {
  write(DIRTY_KEY, '1');
  clearTimeout(timer);
  timer = setTimeout(() => {
    // push() 失敗時回的是 `{ ok: false, error }`，不是 throw —— 以前這裡
    // 只有一個 `.catch(() => {})`，所以那個回傳值從頭到尾沒有人讀，
    // 密鑰錯了、格式版本不對、`.gs` 丟例外，畫面上全都長得一模一樣。
    // 現在痕跡由 run() 自己留，這裡只要接住真的意外。
    push().catch((err) => noteFailure(`推送時出了意外：${err.message}`));
  }, QUIET_MS);
}

/**
 * 開機時掛上去：以後每次寫入成功就排一次推送，並且把上次沒推成功的補掉。
 *
 * **同步失敗永遠不會讓寫入看起來失敗** —— 資料在 Firestore 裡是安全的，
 * 試算表只是報表（SPEC 第 4.8 節）。推不出去就留著待推標記，安靜地下次再試。
 */
export function wire() {
  repo.onCommitted(schedule);
  if (isDirty()) schedule();
}
