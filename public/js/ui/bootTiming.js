// 打開 app 每一步花多久（after-golive 05）。記在這一台，設定頁「打開要多久」那一張讀它。
//
// 她 2026-10-20：「剛打開app的時候，會卡在載入中5 6 秒，有辦法讓app先呈現畫面嗎」。
// 真正慢在哪只有她的手機上量得到：手機的 CPU、她那裡的網路、Auth 在手機上才先載的那個 iframe ——
// 桌機與無頭的 Chromium 都不準。改之前沒有數字，改完就說不出快了多少（06～09 的判準都讀這一張）。
//
// ## 記的是「幾毫秒的時候到了哪一步」，不是每一步的長度
//
// 從 `performance.timeOrigin` 起算（瀏覽器開始載這一頁那一刻）。五個里程碑：
//   程式　app.js 開始跑（＝一百多支程式檔全部到齊）
//   登入　Firebase 第一次告訴我們是誰
//   權限　白名單問完了
//   畫面　殼畫出來（底下那一排）
//   資料　待辦首頁第一次畫出數字 —— **只有從首頁打開的那幾次才有**，從別頁網址打開的只記到「畫面」
// 之後先畫殼、先用快取畫（07、08）各步會重疊，「加起來＝總數」就不成立 —— 所以記時間點、照先後排。
//
// ## 為什麼記在 localStorage
//
// 那是這一台的事，不是她的資料（同「外觀」）。最近 10 次。
// **一行都不擋開機**：每一個碰瀏覽器的地方都包 `try`，記不住就不記。
// 登入頁、沒有權限、連不上那三種畫面不記（`drop()`）—— 不然平均被拉歪。

import { dayOf } from '../domain/dates.js';

export const BOOT_KEY = 'scheduler.bootTimes';
export const KEEP = 10;

/** 照開機的先後。`label` 是卡上的字。 */
export const STEPS = Object.freeze([
  { id: 'code', label: '程式' },
  { id: 'auth', label: '登入' },
  { id: 'access', label: '權限' },
  { id: 'shell', label: '畫面' },
  { id: 'data', label: '資料' },
]);

const STEP_IDS = new Set(STEPS.map((s) => s.id));

/** 從首頁打開的嗎（`#/`，或沒有 hash）。 */
export const isHomeHash = (hash) => hash === '' || hash === '#' || hash === '#/';

// ---------- 純函式（`tests/boot-timing.test.js`）----------

/**
 * 這一次開機記好了 → 要存回去的那一份清單（新的在最前面，最多 `KEEP` 筆）。
 * 跟上一次比：是不是今天第一次、隔了幾分鐘。
 *
 * @param {object[]} list 存著的那一份
 * @param {{at: number, home: boolean, sw: boolean, marks: object}} boot
 */
export function withBoot(list, boot) {
  const prev = Array.isArray(list) ? list.filter((r) => r && Number.isFinite(r.at)) : [];
  const last = prev[0];
  const record = {
    at: boot.at,
    home: boot.home,
    sw: boot.sw,
    marks: { ...boot.marks },
    firstToday: !last || dayOf(last.at) !== dayOf(boot.at),
    gapMin: last ? Math.max(0, Math.round((boot.at - last.at) / 60000)) : null,
  };
  return [record, ...prev].slice(0, KEEP);
}

/**
 * 一筆紀錄 → 卡上要畫的：到了的那幾步（照時間先後）、最後一步是幾毫秒。
 * 認不得的步、不是數字的都略過。
 */
export function stepsOf(record) {
  const marks = record?.marks ?? {};
  const steps = STEPS.filter((s) => Number.isFinite(marks[s.id]))
    .map((s) => ({ id: s.id, label: s.label, ms: marks[s.id] }))
    .sort((a, b) => a.ms - b.ms);
  return { steps, total: steps.length ? steps[steps.length - 1].ms : null };
}

/** 毫秒 → 「2.8」（秒，一位小數）。 */
export const secs = (ms) => (Math.round(ms / 100) / 10).toFixed(1);

// ---------- 這一次開機 ----------

/** @type {{at: number, home: boolean, sw: boolean, marks: object, state: 'open'|'done'|'dropped'}|null} */
let boot = null;

const now = () => Math.round(performance.now());

/** app.js 一開始跑就叫：開一筆、記下「程式」那一步。 */
export function begin() {
  try {
    boot = {
      at: Math.round(performance.timeOrigin || Date.now() - performance.now()),
      home: isHomeHash(location.hash),
      sw: !!navigator.serviceWorker?.controller,
      marks: {},
      state: 'open',
    };
    mark('code');
  } catch {
    boot = null;
  }
}

/**
 * 到了哪一步。同一步只記第一次（登入每換一次 token 就回來一次）。
 * 「畫面」那一步：從別頁打開的到這裡就記好了；「資料」那一步記好整筆。
 */
export function mark(id) {
  try {
    if (boot?.state !== 'open' || !STEP_IDS.has(id) || id in boot.marks) return;
    boot.marks[id] = now();
    if (id === 'data' || (id === 'shell' && !boot.home)) finish();
  } catch {
    /* 記不住就不記 */
  }
}

/** 這一次不是正常開機（登入頁、沒有權限、連不上）：整筆不記。 */
export function drop() {
  if (boot?.state === 'open') boot.state = 'dropped';
}

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function finish() {
  boot.state = 'done';
  try {
    const store = storage();
    if (!store) return;
    store.setItem(BOOT_KEY, JSON.stringify(withBoot(readList(store), boot)));
  } catch {
    /* 記不住就不記 */
  }
}

function readList(store) {
  try {
    const list = JSON.parse(store.getItem(BOOT_KEY) ?? '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * 設定頁讀的：存著的那幾筆。`ok` 是 false ＝這一台記不住（網站資料被擋掉）。
 *
 * @returns {{ok: boolean, list: object[]}}
 */
export function readBoots() {
  const store = storage();
  if (!store) return { ok: false, list: [] };
  try {
    store.getItem(BOOT_KEY);
  } catch {
    return { ok: false, list: [] };
  }
  return { ok: true, list: readList(store) };
}
