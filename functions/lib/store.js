// 防護第 2、4 道要讀寫的那幾份文件。規則在 `guard.js`，這裡只負責「讀 → 算 → 寫回去」。
//
// 底下接的是一個很小的介面（`backend`），`index.js` 接 Firestore Admin SDK，
// 單元測試接記憶體。**transaction 是必要的**：兩次呼叫同時進來時，
// 不包在一起的話兩邊都讀到「還沒到上限」然後一起叫模型。
//
// 寫進 `aiUsage` 的**沒有照片、沒有抄出來的字**（ADR-0101）。

import { planBlocked, planReservation, planSettle } from './guard.js';

export const USAGE = 'aiUsage';
export const CALLS = 'calls';
export const CONFIG_PATH = 'config/ai';

/** Firestore 的時間戳與 updatedAt 不參與計算，拿掉再算。 */
function plain(doc) {
  if (!doc) return null;
  const { updatedAt, ...rest } = doc;
  return rest;
}

/**
 * @param {{
 *   exists(path: string): Promise<boolean>,
 *   get(path: string): Promise<object|null>,
 *   transaction<T>(fn: (tx: {get(path: string): Promise<object|null>, set(path: string, data: object): void}) => Promise<T>): Promise<T>,
 *   newId(): string,
 *   stamp(): unknown,
 * }} backend
 */
export function makeStore(backend) {
  const usagePath = (month) => `${USAGE}/${month}`;
  const callPath = (month, id) => `${USAGE}/${month}/${CALLS}/${id}`;

  return {
    isAllowed: (uid) => backend.exists(`allowedUsers/${uid}`),

    readConfig: async () => (await backend.get(CONFIG_PATH)) ?? {},

    async recordBlocked({ month, kind, at, reason }) {
      await backend.transaction(async (tx) => {
        const usage = plain(await tx.get(usagePath(month)));
        tx.set(usagePath(month), { ...planBlocked(usage, month), updatedAt: backend.stamp() });
        tx.set(callPath(month, backend.newId()), {
          at, kind, outcome: 'blocked', reason, estUsd: 0,
        });
      });
    },

    async reserve({ month, day, kind, at, capUsd, dailyLimit, reserveUsd }) {
      return backend.transaction(async (tx) => {
        const usage = plain(await tx.get(usagePath(month)));
        const plan = planReservation(usage, { month, day, kind, capUsd, dailyLimit, reserveUsd });
        tx.set(usagePath(month), { ...plan.usage, updatedAt: backend.stamp() });
        const callId = backend.newId();
        tx.set(callPath(month, callId), plan.blockedBy
          ? { at, kind, outcome: 'blocked', reason: plan.blockedBy, estUsd: 0 }
          : { at, kind, outcome: 'pending', reason: null, estUsd: reserveUsd });
        return {
          blockedBy: plan.blockedBy,
          callId: plan.blockedBy ? null : callId,
          monthUsd: plan.usage.estUsd ?? 0,
        };
      });
    },

    async settle({ month, kind, callId, reserveUsd, actualUsd, inputTokens, outputTokens, ok, error }) {
      return backend.transaction(async (tx) => {
        // Firestore 的 transaction 要先讀完才能寫，兩份都先讀
        const usage = plain(await tx.get(usagePath(month)));
        const call = callId ? ((await tx.get(callPath(month, callId))) ?? {}) : null;
        const next = planSettle(usage, {
          month, kind, reserveUsd, actualUsd, inputTokens, outputTokens, ok,
        });
        tx.set(usagePath(month), { ...next, updatedAt: backend.stamp() });
        if (callId) {
          tx.set(callPath(month, callId), {
            ...call,
            outcome: ok ? 'ok' : 'failed',
            reason: ok ? null : error,
            estUsd: actualUsd,
            inputTokens,
            outputTokens,
          });
        }
        return { monthUsd: next.estUsd };
      });
    },
  };
}
