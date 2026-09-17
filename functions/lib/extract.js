// `extract({ kind, image })` 的本體（ADR-0100）。
//
// **依賴全部由外面塞進來**（存放、模型、時鐘、log）：`index.js` 塞真的 Firestore 與
// Gemini，單元測試塞記憶體裡的假貨。所以「哪一道擋下來、擋下來時有沒有叫到模型」
// 在 `tests/ai-function.test.js` 裡一條一條測得到，不必開模擬器。
//
// 五道防護的第 1 道（沒有 key）與第 3 道（App Check，`enforceAppCheck: true`）
// 在這支外面：前者是根本沒有東西，後者由 firebase-functions 在進到這裡之前擋掉。
//
// **log 與錯誤一個字的照片、抄出來的字都不帶**（ADR-0101）。只記 kind 與原因。

import {
  DAILY_LIMIT,
  ExtractError,
  dayKey,
  monthKey,
  resolveCap,
  validateRequest,
} from './guard.js';
import { MAX_OUTPUT_TOKENS, RESERVE_USD, estimateUsd } from './pricing.js';
import { promptFor, sanitize, schemaFor } from '../transcripts/index.js';

/**
 * @param {{
 *   store: {
 *     isAllowed(uid: string): Promise<boolean>,
 *     readConfig(): Promise<object>,
 *     recordBlocked(p: object): Promise<void>,
 *     reserve(p: object): Promise<{blockedBy: string|null, callId?: string, monthUsd: number}>,
 *     settle(p: object): Promise<{monthUsd: number}>,
 *   },
 *   model: { generate(p: object): Promise<{text: string, usage: {inputTokens: number, outputTokens: number}}> },
 *   now?: () => Date,
 *   log?: { info: Function, warn: Function },
 * }} deps
 */
export function makeExtract({ store, model, now = () => new Date(), log = console }) {
  return async function extract({ auth, data }) {
    // 第 2 道：登入 ＋ 白名單（跟 firestore.rules 讀同一份 allowedUsers）
    if (!auth?.uid) throw new ExtractError('unauthenticated', 'signin');
    if (!(await store.isAllowed(auth.uid))) {
      log.warn('extract blocked', { reason: 'notAllowed' });
      throw new ExtractError('permission-denied', 'notAllowed');
    }

    const { kind, image } = validateRequest(data);
    const at = now();
    const month = monthKey(at);
    const config = (await store.readConfig()) ?? {};
    const capUsd = resolveCap(config);

    // 第 4 道：暫停開關、每月上限、每天次數。**全部在叫模型之前。**
    if (config.paused === true) {
      await store.recordBlocked({ month, kind, at, reason: 'paused' });
      log.warn('extract blocked', { kind, reason: 'paused' });
      throw new ExtractError('failed-precondition', 'paused');
    }

    const reservation = await store.reserve({
      month,
      day: dayKey(at),
      kind,
      at,
      capUsd,
      dailyLimit: DAILY_LIMIT,
      reserveUsd: RESERVE_USD,
    });
    if (reservation.blockedBy) {
      log.warn('extract blocked', { kind, reason: reservation.blockedBy });
      throw new ExtractError('resource-exhausted', reservation.blockedBy, {
        capUsd,
        monthUsd: reservation.monthUsd,
      });
    }

    let transcript = null;
    let usage = { inputTokens: 0, outputTokens: 0 };
    let error = null;
    try {
      const out = await model.generate({
        kind,
        image,
        schema: schemaFor(kind),
        prompt: promptFor(kind),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      });
      usage = out.usage ?? usage;
      const parsed = parseJson(out.text);
      if (parsed) transcript = sanitize(kind, parsed);
      else error = 'unparsable';
    } catch (e) {
      error = typeof e?.code === 'string' ? e.code : 'model';
      if (e?.usage) usage = e.usage;
    }

    // 沒有 usage 的失敗（連線斷在半路）當作輸入那一半有收錢：寧可估多
    const actualUsd = error && !usage.inputTokens
      ? estimateUsd({ inputTokens: 2_000, outputTokens: 0 })
      : estimateUsd(usage);

    const settled = await store.settle({
      month,
      kind,
      callId: reservation.callId,
      reserveUsd: RESERVE_USD,
      actualUsd,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      ok: !error,
      error,
    });

    if (error) {
      log.warn('extract failed', { kind, reason: error });
      throw new ExtractError('internal', 'failed');
    }
    log.info('extract ok', { kind });
    return {
      transcript,
      usage: { estUsd: actualUsd, monthUsd: settled.monthUsd, capUsd },
    };
  };
}

/** 模型回來的字。responseMimeType 是 JSON，但偶爾會包一層 ```json。 */
export function parseJson(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try {
    const v = JSON.parse(trimmed);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}
