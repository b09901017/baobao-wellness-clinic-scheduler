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
// 先畫殼、先用快取畫（07、08，ADR-0167）之後各步會重疊（畫面、資料比登入、權限早到），「加起來＝總數」就不成立 ——
// 所以記時間點、照先後排；**總數是她等到的那一步**（從首頁打開＝資料、從別頁＝畫面），不是最後到的那一步。
// 走完之後晚到的「登入」「權限」照樣記（看 09 要不要做就是看它們），只是不算進總數。
//
// ## 為什麼記在 localStorage
//
// 那是這一台的事，不是她的資料（同「外觀」）。最近 10 次。
// **一行都不擋開機**：每一個碰瀏覽器的地方都包 `try`，記不住就不記。
// 登入頁、沒有權限、連不上那三種畫面、首頁讀不到資料不記（`drop()`）—— 不然平均被拉歪。
//
// **每到一步就寫一次**（不是走完才寫）：她等不及、在「載入中」就把 app 關掉的那幾次正是最慢的，
// 只記走完的，這一張就偏向快的。沒等到數字的那一筆卡上標出來（`missedData()`）。
// 還沒走完就換頁（她點了底下那一排）：那一筆停在換頁之前，之後回首頁畫出數字不算進去。

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

// ---------- 純函式（`tests/boot-timing.test.js`）----------

/** 存著的那一份裡認得的紀錄。壞掉的、少了時間或步驟的略過 —— 設定頁不可以因為它畫不出來。 */
export function cleanBoots(list) {
  return Array.isArray(list)
    ? list.filter((r) => r && typeof r === 'object' && Number.isFinite(r.at) && r.marks && typeof r.marks === 'object')
    : [];
}

/**
 * 這一次開機到了某一步 → 要存回去的那一份清單（新的在最前面，最多 `KEEP` 筆）。
 * 同一次開機（同一個 `at`）寫過就換掉那一筆。跟上一次比：是不是今天第一次、隔了幾分鐘。
 *
 * @param {object[]} list 存著的那一份
 * @param {{at: number, home: boolean, sw: boolean, marks: object, done?: boolean}} boot
 */
export function withBoot(list, boot) {
  const prev = cleanBoots(list).filter((r) => r.at !== boot.at);
  const last = prev[0];
  const record = {
    at: boot.at,
    home: boot.home,
    sw: boot.sw,
    done: !!boot.done,
    marks: { ...boot.marks },
    firstToday: !last || dayOf(last.at) !== dayOf(boot.at),
    gapMin: last ? Math.max(0, Math.round((boot.at - last.at) / 60000)) : null,
  };
  return [record, ...prev].slice(0, KEEP);
}

/** 拿掉這一次開機那一筆（`drop()`：寫過幾步之後才知道它不算）。 */
export function withoutBoot(list, at) {
  return cleanBoots(list).filter((r) => r.at !== at);
}

/** 從首頁打開、可是沒等到待辦的數字（還在載入就關掉，或先換了頁）。 */
export const missedData = (record) => !!record?.home && !Number.isFinite(record?.marks?.data);

/**
 * 一筆紀錄 → 卡上要畫的：到了的那幾步（照時間先後）、總數是幾毫秒。
 * **總數是她等到的那一步**：從首頁打開＝「資料」、從別頁＝「畫面」；那一步沒到（還在載入就關掉）才退回最後到的那一步。
 * 認不得的步、不是數字的都略過。
 */
export function stepsOf(record) {
  const marks = record?.marks ?? {};
  const steps = STEPS.filter((s) => Number.isFinite(marks[s.id]))
    .map((s) => ({ id: s.id, label: s.label, ms: marks[s.id] }))
    .sort((a, b) => a.ms - b.ms);
  const end = record?.home === false ? marks.shell : marks.data;
  const total = Number.isFinite(end) ? end : steps.length ? steps[steps.length - 1].ms : null;
  return { steps, total };
}

/** 毫秒 → 「2.8」（秒，一位小數）。 */
export const secs = (ms) => (Math.round(ms / 100) / 10).toFixed(1);

// ---------- 這一次開機 ----------

/** @type {{at: number, home: boolean, sw: boolean, marks: object, done: boolean, state: 'open'|'done'|'left'|'dropped'}|null} */
let boot = null;

const now = () => Math.round(performance.now());

/**
 * app.js 一開始跑就叫：開一筆、記下「程式」那一步。
 *
 * @param {{home: boolean}} o 這一次打開的是不是待辦首頁 —— **照路由認**（`router.resolve()`：認不得的網址也畫首頁），
 *   不在這裡自己比 hash
 */
export function begin({ home } = {}) {
  try {
    boot = {
      at: Math.round(performance.timeOrigin || Date.now() - performance.now()),
      home: !!home,
      sw: !!navigator.serviceWorker?.controller,
      marks: {},
      done: false,
      state: 'open',
    };
    // 還沒走完就換頁：那一筆停在這裡
    globalThis.addEventListener?.('hashchange', () => {
      if (boot?.state === 'open') boot.state = 'left';
    }, { once: true });
    mark('code');
  } catch {
    boot = null;
  }
}

/** 走完之後還收的那兩步：先畫殼、先用快取畫之後它們常常比畫面、數字晚到（ADR-0167） */
const LATE_OK = new Set(['auth', 'access']);

/**
 * 到了哪一步。同一步只記第一次（登入每換一次 token 就回來一次）。每到一步就寫一次。
 * 「畫面」那一步：從別頁打開的到這裡就走完了；「資料」那一步走完整筆。走完之後只再收「登入」「權限」。
 */
export function mark(id) {
  try {
    const late = boot?.state === 'done' && LATE_OK.has(id);
    if ((boot?.state !== 'open' && !late) || !STEP_IDS.has(id) || id in boot.marks) return;
    boot.marks[id] = now();
    if (id === 'data' || (id === 'shell' && !boot.home)) {
      boot.state = 'done';
      boot.done = true;
    }
    write((list) => withBoot(list, boot));
  } catch {
    /* 記不住就不記 */
  }
}

/**
 * 這一次不算一次正常開機（登入頁、沒有權限、連不上、首頁讀不到資料）：已經寫了的那幾步也拿掉。
 * **走完了也拿掉**：先畫殼的那一次（ADR-0167）畫面早就到了，登入回來才知道是登入頁
 */
export function drop() {
  try {
    if (boot?.state !== 'open' && boot?.state !== 'done') return;
    boot.state = 'dropped';
    write((list) => withoutBoot(list, boot.at));
  } catch {
    /* 記不住就不記 */
  }
}

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** 存著的那一份。**讀不到（網站資料被擋掉）照樣丟例外**，交給呼叫端；內容壞掉的當成空的。 */
function readList(store) {
  const raw = store.getItem(BOOT_KEY);
  try {
    return cleanBoots(JSON.parse(raw ?? '[]'));
  } catch {
    return [];
  }
}

function write(change) {
  try {
    const store = storage();
    if (store) store.setItem(BOOT_KEY, JSON.stringify(change(readList(store))));
  } catch {
    /* 記不住就不記 */
  }
}

/**
 * 設定頁讀的：存著的那幾筆。`ok` 是 false ＝這一台記不住（網站資料被擋掉）。
 *
 * @returns {{ok: boolean, list: object[]}}
 */
export function readBoots() {
  try {
    const store = storage();
    return store ? { ok: true, list: readList(store) } : { ok: false, list: [] };
  } catch {
    return { ok: false, list: [] };
  }
}
