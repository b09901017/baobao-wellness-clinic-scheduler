// 防護第 4 道：我們自己數的上限（ADR-0100）。**純函式**，Firestore 那一層只負責
// 讀 → 呼叫這裡 → 寫回去，所以規則全部測得到。
//
// 為什麼要自己數：Google 的預算警示只會寄信不會停，而 Gemini 每分鐘配額在
// Standard PayGo 是共用額度、調不了。真正擋得住的上限只有這一份。

import { KINDS } from '../transcripts/index.js';
import { roundUsd } from './pricing.js';

/** 她在設定頁沒填時的每月上限（美元）。跟她 2026-09-17 設的預算警示同一個數字。 */
export const DEFAULT_MONTHLY_CAP_USD = 10;

/** 程式裡的天花板：她填再大，也當成這個。 */
export const CEILING_USD = 30;

/** 每天最多叫幾次模型（台灣時間的一天）。被擋下來的不算。 */
export const DAILY_LIMIT = 150;

/** 一張照片最大幾個位元組（base64 解開之後）。瀏覽器先縮成長邊 ~2000px。 */
export const MAX_IMAGE_BYTES = 1_500_000;

/** 這一支 Function 丟出去的錯誤。`index.js` 換成 HttpsError；這裡不 import SDK。 */
export class ExtractError extends Error {
  /**
   * @param {string} code HttpsError 的 code（`unauthenticated`、`resource-exhausted`…）
   * @param {string} reason 畫面要講哪一句（`data/ai.js` 讀它）
   * @param {object} [details]
   */
  constructor(code, reason, details = {}) {
    super(reason);
    this.code = code;
    this.reason = reason;
    this.details = details;
  }
}

const TZ = 'Asia/Taipei';

function taipeiParts(now) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { y: get('year'), m: get('month'), d: get('day') };
}

/** `aiUsage/{這一格}`：台灣時間的年月。 */
export function monthKey(now = new Date()) {
  const { y, m } = taipeiParts(now);
  return `${y}-${m}`;
}

/** 每天次數的那一格：台灣時間的日期。 */
export function dayKey(now = new Date()) {
  const { y, m, d } = taipeiParts(now);
  return `${y}-${m}-${d}`;
}

/**
 * 這個月真正的上限。她填的數字，但不超過天花板；沒填或填壞了就是預設值。
 * @param {{monthlyCapUsd?: unknown}} config `config/ai`
 */
export function resolveCap(config = {}) {
  const raw = config?.monthlyCapUsd;
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : DEFAULT_MONTHLY_CAP_USD;
  return Math.min(Math.max(0, n), CEILING_USD);
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * 防護第 3 條（在登入與白名單之後）：這一次要辨識的東西長得對不對。
 * **一次一張** —— 收到陣列一律拒絕，不是只取第一張。
 *
 * @param {unknown} data callable 收到的 `data`
 * @returns {{kind: string, image: string, bytes: number}}
 */
export function validateRequest(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ExtractError('invalid-argument', 'badRequest');
  }
  const extra = Object.keys(data).filter((k) => k !== 'kind' && k !== 'image');
  if (extra.length) throw new ExtractError('invalid-argument', 'badRequest');
  const { kind, image } = data;
  if (!KINDS.includes(kind)) throw new ExtractError('invalid-argument', 'badKind');
  if (typeof image !== 'string' || !image || !BASE64.test(image)) {
    throw new ExtractError('invalid-argument', 'badImage');
  }
  // base64 四個字元 = 三個位元組，先用長度擋掉大的，不必真的解開
  const bytes = Math.floor((image.length * 3) / 4) - (image.endsWith('==') ? 2 : image.endsWith('=') ? 1 : 0);
  if (bytes > MAX_IMAGE_BYTES) throw new ExtractError('invalid-argument', 'tooLarge');
  const head = Buffer.from(image.slice(0, 8), 'base64');
  if (!(head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff)) {
    throw new ExtractError('invalid-argument', 'notJpeg');
  }
  return { kind, image, bytes };
}

/** 一份還沒有任何呼叫的月份合計。 */
export function emptyUsage(month) {
  return {
    month,
    calls: 0,
    blocked: 0,
    failed: 0,
    estUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    byKind: {},
    days: {},
  };
}

const kindSlot = (usage, kind) => usage.byKind?.[kind] ?? { calls: 0, estUsd: 0 };

/**
 * 叫模型之前：擋不擋？不擋的話先預留。
 *
 * **判準是「這個月（含還在跑的預留）已經花到上限了沒」**，不是「加上這一次會不會超過」——
 * 後者會讓一個小於一次預留額的上限（例如 US$0.01）連第一次都叫不出去，
 * 而她在設定頁看到的會是「一次都沒用、但被擋」。最多超過上限的量是
 * 同時在跑的那幾次（`maxInstances: 2`）的實際花費。
 *
 * @param {object|null} usage `aiUsage/{month}` 現在的內容
 * @param {{month: string, day: string, kind: string, capUsd: number, dailyLimit?: number, reserveUsd: number}} p
 * @returns {{blockedBy: 'monthCap'|'dailyLimit', usage: object} | {blockedBy: null, usage: object}}
 */
export function planReservation(usage, p) {
  const base = usage ? structuredClone(usage) : emptyUsage(p.month);
  const dailyLimit = p.dailyLimit ?? DAILY_LIMIT;
  const today = base.days?.[p.day] ?? 0;

  let blockedBy = null;
  if ((base.estUsd ?? 0) >= p.capUsd) blockedBy = 'monthCap';
  else if (today >= dailyLimit) blockedBy = 'dailyLimit';

  if (blockedBy) {
    base.blocked = (base.blocked ?? 0) + 1;
    return { blockedBy, usage: base };
  }

  const slot = kindSlot(base, p.kind);
  base.calls = (base.calls ?? 0) + 1;
  base.estUsd = roundUsd((base.estUsd ?? 0) + p.reserveUsd);
  base.days = { ...(base.days ?? {}), [p.day]: today + 1 };
  base.byKind = {
    ...(base.byKind ?? {}),
    [p.kind]: { calls: slot.calls + 1, estUsd: roundUsd(slot.estUsd + p.reserveUsd) },
  };
  return { blockedBy: null, usage: base };
}

/**
 * 被暫停開關擋下來時的合計：只加一次「被擋」，其他都不動。
 * （上限與每日次數被擋走 `planReservation()`，同一個 transaction 裡決定。）
 */
export function planBlocked(usage, month) {
  const base = usage ? structuredClone(usage) : emptyUsage(month);
  base.blocked = (base.blocked ?? 0) + 1;
  return base;
}

/**
 * 模型回來之後（成功或失敗都要跑）：把預留額換成實際值。
 * 失敗也記 —— token 照樣收錢。
 *
 * @param {object|null} usage
 * @param {{month: string, kind: string, reserveUsd: number, actualUsd: number, inputTokens?: number, outputTokens?: number, ok: boolean}} p
 */
export function planSettle(usage, p) {
  const base = usage ? structuredClone(usage) : emptyUsage(p.month);
  const delta = p.actualUsd - p.reserveUsd;
  const slot = kindSlot(base, p.kind);
  base.estUsd = roundUsd(Math.max(0, (base.estUsd ?? 0) + delta));
  base.inputTokens = (base.inputTokens ?? 0) + (p.inputTokens ?? 0);
  base.outputTokens = (base.outputTokens ?? 0) + (p.outputTokens ?? 0);
  if (!p.ok) base.failed = (base.failed ?? 0) + 1;
  base.byKind = {
    ...(base.byKind ?? {}),
    [p.kind]: { calls: slot.calls, estUsd: roundUsd(Math.max(0, slot.estUsd + delta)) },
  };
  return base;
}
