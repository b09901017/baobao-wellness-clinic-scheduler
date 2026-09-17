// 拍照辨識那一支 Function 的五道防護，在真的模擬器上（ADR-0100）。
//
// 單元測試（`tests/ai-function.test.js`）已經一道一道測過本體；這一支盯的是
// **只有接起來才看得出來的**：App Check 真的在本體之前擋、白名單讀的是真的
// Firestore、用量真的寫進 `aiUsage`、瀏覽器那一側的錯誤翻得出原因。
//
// 每一條都問同一句：**擋下來的時候，假模型有沒有被叫到？**

import { test, expect } from '../fixtures/app.js';
import {
  TINY_JPEG_BASE64, callExtractRaw, extractInApp, fakeAiCalls, idTokenFor, queueAi,
} from '../fixtures/ai/index.js';
import { monthKey } from '../../functions/lib/guard.js';

// **Function 用的是真的時鐘**，不是測試固定的「今天」（那個只在瀏覽器裡）
const thisMonth = () => monthKey(new Date());

test('G1 沒登入、登入了但不在白名單、沒有 App Check → 三種都擋，假模型一次都沒被叫', async ({ app }) => {
  await queueAi([]);
  const data = { kind: 'planFlyer', image: TINY_JPEG_BASE64 };

  const anon = await callExtractRaw({ data });
  expect(anon.body?.error?.status).toBe('UNAUTHENTICATED');

  const stranger = await callExtractRaw({ idToken: await idTokenFor('e2e-stranger-uid'), data });
  expect(stranger.body?.error?.status).toBe('PERMISSION_DENIED');

  // 白名單裡的人，但不是從 app 來的（沒有 App Check 憑證）
  const noAppCheck = await callExtractRaw({ idToken: await idTokenFor(app.uid), appCheck: false, data });
  expect(noAppCheck.body?.error?.status).toBe('UNAUTHENTICATED');

  expect(await fakeAiCalls(), '擋下來的呼叫不可以叫到模型').toBe(0);
});

test('G2 從 app 叫一次：拿到抄字、用量記進 aiUsage，多吐出來的 id 與狀態被丟掉', async ({ app, page }) => {
  await queueAi(['extra-field']);
  await app.signIn('/');

  const res = await extractInApp(page);
  expect(res.ok, JSON.stringify(res)).toBe(true);
  expect(res.data.transcript.readable).toBe(true);
  expect(res.data.transcript).not.toHaveProperty('courseId');
  expect(res.data.transcript).not.toHaveProperty('status');
  expect(res.data.transcript).not.toHaveProperty('customerId');
  expect(res.data.usage.capUsd).toBe(10);
  expect(await fakeAiCalls()).toBe(1);

  const usage = await app.readDoc('aiUsage', thisMonth());
  expect(usage.calls).toBe(1);
  expect(usage.estUsd).toBeCloseTo(res.data.usage.estUsd, 6);
  expect(usage.byKind.planFlyer.calls).toBe(1);
});

test('G3 暫停中：app 收到的原因是 paused，假模型沒被叫', async ({ app, page }) => {
  await app.seed([{ path: 'config', id: 'ai', data: { paused: true } }]);
  await queueAi([]);
  await app.signIn('/');

  const res = await extractInApp(page);
  expect(res).toEqual({ ok: false, reason: 'paused' });
  expect(await fakeAiCalls()).toBe(0);
});

test('G4 上限 US$0.01：第一次過、第二次被擋，calls 那一筆寫著 monthCap', async ({ app, page }) => {
  await app.seed([{ path: 'config', id: 'ai', data: { monthlyCapUsd: 0.01 } }]);
  await queueAi([]);
  await app.signIn('/');

  expect((await extractInApp(page)).ok).toBe(true);
  expect(await extractInApp(page)).toEqual({ ok: false, reason: 'monthCap' });
  expect(await fakeAiCalls()).toBe(1);

  const calls = await app.readAll(`aiUsage/${thisMonth()}/calls`);
  expect(calls.map((c) => c.outcome).sort()).toEqual(['blocked', 'ok']);
  expect(calls.find((c) => c.outcome === 'blocked').reason).toBe('monthCap');
  // 沒有內容：只有時間、哪一種、結果、多少錢
  for (const c of calls) {
    expect(Object.keys(c).filter((k) => /image|transcript|text|prompt/i.test(k))).toEqual([]);
  }
});

test('G5 上限寫成 99999 → 實際上限是天花板 US$30', async ({ app, page }) => {
  await app.seed([{ path: 'config', id: 'ai', data: { monthlyCapUsd: 99999 } }]);
  await queueAi([]);
  await app.signIn('/');
  const res = await extractInApp(page);
  expect(res.data.usage.capUsd).toBe(30);
});

test('G6 模型那一側失敗：app 收到 failed，用量照樣記（token 照樣收錢）', async ({ app, page }) => {
  await queueAi(['model-fails']);
  await app.signIn('/');
  expect(await extractInApp(page)).toEqual({ ok: false, reason: 'failed' });
  const usage = await app.readDoc('aiUsage', thisMonth());
  expect(usage.failed).toBe(1);
  expect(usage.estUsd).toBeGreaterThan(0);
});
