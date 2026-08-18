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

export const lastSyncedAt = () => read(LAST_KEY);
export const isDirty = () => read(DIRTY_KEY) === '1';

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
  const [customers, entitlementsBy, visits, master] = await Promise.all([
    customersData.list(),
    customersData.entitlementsByCustomer(),
    visitsData.listBetween(addDays(today, -LOOKBACK_DAYS), addDays(today, LOOKBACK_DAYS)),
    config.loadAll(),
  ]);

  const visitsBy = {};
  for (const v of visits) (visitsBy[v.customerId] ??= []).push(v);

  return syncBundle({
    customers,
    entitlementsBy,
    visitsBy,
    today,
    master,
    generatedAt: new Date().toLocaleString('zh-TW'),
  });
}

/**
 * 推一次。同時只會有一份在路上 —— 兩份整包互相覆蓋，後到的不一定比較新。
 *
 * @returns {Promise<{ok: boolean, skipped?: string, error?: string, at?: string}>}
 */
export function push() {
  inFlight ??= run().finally(() => { inFlight = null; });
  return inFlight;
}

async function run() {
  const settings = await config.getSettings();
  if (!isConfigured(settings)) return { ok: false, skipped: '還沒設定試算表的網址與密鑰' };

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
    write(DIRTY_KEY, '1');
    return { ok: false, error: `連不上試算表：${err.message}` };
  }

  const text = (await res.text()).trim();
  if (!res.ok) {
    write(DIRTY_KEY, '1');
    return { ok: false, error: `試算表回了 ${res.status}：${text.slice(0, 200)}` };
  }

  let reply;
  try {
    reply = JSON.parse(text);
  } catch {
    // Apps Script 出錯時回的是一整頁 HTML，直接印出來只會嚇到人
    write(DIRTY_KEY, '1');
    return { ok: false, error: '試算表回了看不懂的東西，請確認網頁應用程式的部署還在' };
  }

  if (!reply.ok) {
    write(DIRTY_KEY, '1');
    return { ok: false, error: reply.error ?? '試算表說失敗，但沒說為什麼' };
  }

  const at = new Date().toISOString();
  write(LAST_KEY, at);
  write(DIRTY_KEY, null);
  return { ok: true, at, sheets: reply.sheets ?? null };
}

/** 安靜 QUIET_MS 之後推一次。連續存十幾筆只會換來一次推送。 */
export function schedule() {
  write(DIRTY_KEY, '1');
  clearTimeout(timer);
  timer = setTimeout(() => { push().catch(() => {}); }, QUIET_MS);
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
