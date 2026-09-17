// 模擬器用的假模型。**CI 與 E2E 永遠不送真照片、不叫 Gemini**（ADR-0101）。
//
// 回哪一份假抄字：
//   - E2E 先在 `__fakeAi/state` 的 `queue` 排好名字（`fixtures/emulator.js` 的 `queueAi()`），
//     一次取一個 → `tests-e2e/fixtures/ai/<名字>.json`
//   - 沒排就回 `<kind>.json`
//
// 叫了幾次記在同一份文件的 `calls` —— E2E 用它斷言「被擋下來的那幾次模型一次都沒被叫」。
//
// 為什麼不照圖片雜湊挑：瀏覽器縮圖重新編碼出來的位元組每一版 Chrome 都可能不一樣，
// 雜湊一變假抄字就對不上，而症狀會是一個看起來跟 app 無關的紅燈。

import { readFile } from 'node:fs/promises';

const FIXTURES = new URL('../../tests-e2e/fixtures/ai/', import.meta.url);
export const FAKE_STATE = '__fakeAi/state';

export function makeFakeModel(db) {
  return {
    async generate({ kind }) {
      const name = await db.runTransaction(async (t) => {
        const ref = db.doc(FAKE_STATE);
        const snap = await t.get(ref);
        const state = snap.exists ? snap.data() : {};
        const queue = Array.isArray(state.queue) ? [...state.queue] : [];
        const next = queue.shift() ?? kind;
        t.set(ref, { calls: (state.calls ?? 0) + 1, queue, last: next }, { merge: true });
        return next;
      });

      const fixture = JSON.parse(await readFile(new URL(`${name}.json`, FIXTURES), 'utf8'));
      const usage = fixture.usage ?? { inputTokens: 1_800, outputTokens: 1_200 };
      if (fixture.fail) throw Object.assign(new Error('fake failure'), { code: fixture.fail, usage });
      return { text: JSON.stringify(fixture.transcript ?? {}), usage };
    },
  };
}
