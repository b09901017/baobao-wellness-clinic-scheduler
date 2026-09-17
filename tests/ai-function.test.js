// 拍照辨識那一支 Cloud Function 的五道防護（ADR-0100）。
//
// 本體（`functions/lib/extract.js`）的依賴全部是塞進去的，所以這裡塞一個記憶體裡的
// Firestore 與一個會數次數的假模型，一道一道問：**擋下來的時候，模型有沒有被叫到？**
// 真的 Firestore 與模擬器那條路由 `tests-e2e/specs/35-ai-guard.spec.js` 盯著。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { makeExtract, parseJson } from '../functions/lib/extract.js';
import { makeStore } from '../functions/lib/store.js';
import {
  CEILING_USD, DAILY_LIMIT, DEFAULT_MONTHLY_CAP_USD, MAX_IMAGE_BYTES, ExtractError,
  dayKey, monthKey, planReservation, planSettle, resolveCap, validateRequest,
} from '../functions/lib/guard.js';
import { RESERVE_USD, estimateUsd } from '../functions/lib/pricing.js';
import { fromRoot } from './helpers/paths.js';

// 一張最小的「JPEG」：開頭三個位元組對了就好，Function 不解碼
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]).toString('base64');
const NOW = new Date('2026-09-17T04:00:00Z'); // 台灣 12:00

function memoryBackend(seed = {}) {
  const docs = new Map(Object.entries(seed));
  let n = 0;
  return {
    docs,
    exists: async (p) => docs.has(p),
    get: async (p) => (docs.has(p) ? structuredClone(docs.get(p)) : null),
    async transaction(fn) {
      const writes = [];
      const out = await fn({
        get: async (p) => (docs.has(p) ? structuredClone(docs.get(p)) : null),
        set: (p, d) => writes.push([p, d]),
      });
      for (const [p, d] of writes) docs.set(p, structuredClone(d));
      return out;
    },
    newId: () => `call-${(n += 1)}`,
    stamp: () => 'stamp',
  };
}

function fakeModel(reply = {}) {
  const m = {
    calls: 0,
    async generate() {
      m.calls += 1;
      if (reply.throw) throw reply.throw;
      return {
        text: reply.text ?? JSON.stringify({ readable: true, unreadable: [] }),
        usage: reply.usage ?? { inputTokens: 1_500, outputTokens: 800 },
      };
    },
  };
  return m;
}

const quiet = { info() {}, warn() {} };

function setup({ seed = { 'allowedUsers/me': {} }, reply } = {}) {
  const backend = memoryBackend(seed);
  const model = fakeModel(reply);
  const extract = makeExtract({ store: makeStore(backend), model, now: () => NOW, log: quiet });
  return { backend, model, extract };
}

const call = (extract, { uid = 'me', data = { kind: 'planFlyer', image: JPEG } } = {}) =>
  extract({ auth: uid ? { uid } : null, data });

async function rejects(p, code, reason) {
  await assert.rejects(p, (e) => {
    assert.ok(e instanceof ExtractError, `丟出來的不是 ExtractError：${e}`);
    assert.equal(e.code, code);
    assert.equal(e.reason, reason);
    return true;
  });
}

describe('第 2 道：登入與白名單', () => {
  test('沒登入 → unauthenticated，模型沒被叫', async () => {
    const { model, extract } = setup();
    await rejects(call(extract, { uid: null }), 'unauthenticated', 'signin');
    assert.equal(model.calls, 0);
  });

  test('登入了但不在 allowedUsers → permission-denied，模型沒被叫、用量一格都沒動', async () => {
    const { model, extract, backend } = setup();
    await rejects(call(extract, { uid: 'stranger' }), 'permission-denied', 'notAllowed');
    assert.equal(model.calls, 0);
    assert.equal([...backend.docs.keys()].filter((k) => k.startsWith('aiUsage')).length, 0);
  });
});

describe('請求的形狀', () => {
  test('不認得的 kind、不是 JPEG、一次好幾張、太大 → 都擋，模型沒被叫', async () => {
    const { model, extract } = setup();
    await rejects(call(extract, { data: { kind: 'receipt', image: JPEG } }), 'invalid-argument', 'badKind');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]).toString('base64');
    await rejects(call(extract, { data: { kind: 'planFlyer', image: png } }), 'invalid-argument', 'notJpeg');
    await rejects(call(extract, { data: { kind: 'planFlyer', images: [JPEG, JPEG] } }), 'invalid-argument', 'badRequest');
    await rejects(call(extract, { data: { kind: 'planFlyer', image: [JPEG] } }), 'invalid-argument', 'badImage');
    const big = 'A'.repeat(Math.ceil((MAX_IMAGE_BYTES + 10) / 3) * 4);
    await rejects(call(extract, { data: { kind: 'planFlyer', image: big } }), 'invalid-argument', 'tooLarge');
    assert.equal(model.calls, 0);
  });

  test('validateRequest 收得下剛好 1.5MB 的', () => {
    const exact = Buffer.alloc(MAX_IMAGE_BYTES, 1);
    exact[0] = 0xff; exact[1] = 0xd8; exact[2] = 0xff;
    assert.equal(validateRequest({ kind: 'orderForm', image: exact.toString('base64') }).bytes, MAX_IMAGE_BYTES);
  });
});

describe('第 4 道：暫停、每月上限、每天次數', () => {
  test('暫停中 → failed-precondition，模型沒被叫，calls 裡記著被暫停擋下', async () => {
    const { model, extract, backend } = setup({
      seed: { 'allowedUsers/me': {}, 'config/ai': { paused: true } },
    });
    await rejects(call(extract), 'failed-precondition', 'paused');
    assert.equal(model.calls, 0);
    const calls = [...backend.docs].filter(([k]) => k.includes('/calls/')).map(([, v]) => v);
    assert.deepEqual(calls.map((c) => [c.outcome, c.reason]), [['blocked', 'paused']]);
  });

  test('上限 US$0.01、叫兩次 → 第一次過、第二次被擋，calls 那一筆寫著 monthCap', async () => {
    const { model, extract, backend } = setup({
      seed: { 'allowedUsers/me': {}, 'config/ai': { monthlyCapUsd: 0.01 } },
      // 一張訂購單實際大約這麼多：US$0.018，第一次就花過 0.01
      reply: { usage: { inputTokens: 2_000, outputTokens: 2_000 } },
    });
    const first = await call(extract);
    assert.equal(first.usage.capUsd, 0.01);
    await rejects(call(extract), 'resource-exhausted', 'monthCap');
    assert.equal(model.calls, 1);
    const month = monthKey(NOW);
    const calls = [...backend.docs].filter(([k]) => k.startsWith(`aiUsage/${month}/calls/`)).map(([, v]) => v);
    assert.deepEqual(calls.map((c) => c.outcome).sort(), ['blocked', 'ok']);
    assert.equal(calls.find((c) => c.outcome === 'blocked').reason, 'monthCap');
  });

  test('上限 0 → 第一次就擋', async () => {
    const { model, extract } = setup({ seed: { 'allowedUsers/me': {}, 'config/ai': { monthlyCapUsd: 0 } } });
    await rejects(call(extract), 'resource-exhausted', 'monthCap');
    assert.equal(model.calls, 0);
  });

  test('上限寫成 99999 → 實際上限是天花板', async () => {
    assert.equal(resolveCap({ monthlyCapUsd: 99999 }), CEILING_USD);
    const { extract } = setup({ seed: { 'allowedUsers/me': {}, 'config/ai': { monthlyCapUsd: 99999 } } });
    assert.equal((await call(extract)).usage.capUsd, CEILING_USD);
  });

  test('沒填、填壞了 → 預設值；負的 → 0', () => {
    assert.equal(resolveCap({}), DEFAULT_MONTHLY_CAP_USD);
    assert.equal(resolveCap({ monthlyCapUsd: '10' }), DEFAULT_MONTHLY_CAP_USD);
    assert.equal(resolveCap({ monthlyCapUsd: -3 }), 0);
  });

  test('今天已經叫了每日上限那麼多次 → 擋，模型沒被叫', async () => {
    const month = monthKey(NOW);
    const { model, extract } = setup({
      seed: {
        'allowedUsers/me': {},
        [`aiUsage/${month}`]: { month, calls: DAILY_LIMIT, estUsd: 0, days: { [dayKey(NOW)]: DAILY_LIMIT }, byKind: {} },
      },
    });
    await rejects(call(extract), 'resource-exhausted', 'dailyLimit');
    assert.equal(model.calls, 0);
  });

  test('昨天叫滿了不影響今天', () => {
    const plan = planReservation(
      { estUsd: 0, days: { '2026-09-16': DAILY_LIMIT }, byKind: {} },
      { month: '2026-09', day: '2026-09-17', kind: 'orderForm', capUsd: 10, reserveUsd: 0.1 },
    );
    assert.equal(plan.blockedBy, null);
  });
});

describe('記帳', () => {
  test('成功一次：預留換成實際值，合計與那一種的小計一樣', async () => {
    const { extract, backend } = setup();
    const out = await call(extract);
    const expected = estimateUsd({ inputTokens: 1_500, outputTokens: 800 });
    assert.equal(out.usage.estUsd, expected);
    const usage = backend.docs.get(`aiUsage/${monthKey(NOW)}`);
    assert.equal(usage.calls, 1);
    assert.equal(usage.estUsd, expected);
    assert.equal(usage.byKind.planFlyer.estUsd, expected);
    assert.equal(usage.days[dayKey(NOW)], 1);
  });

  test('模型失敗也記：token 照樣收錢，calls 那一筆是 failed，前端收到 internal', async () => {
    const err = Object.assign(new Error('boom'), { usage: { inputTokens: 1_000, outputTokens: 0 } });
    const { extract, backend } = setup({ reply: { throw: err } });
    await rejects(call(extract), 'internal', 'failed');
    const usage = backend.docs.get(`aiUsage/${monthKey(NOW)}`);
    assert.equal(usage.failed, 1);
    assert.equal(usage.estUsd, estimateUsd({ inputTokens: 1_000 }));
  });

  test('回來的不是 JSON → failed，不是把一坨字交給畫面', async () => {
    const { extract } = setup({ reply: { text: '我看不懂這張照片' } });
    await rejects(call(extract), 'internal', 'failed');
  });

  test('並發兩次各自預留：第一次還沒回來時合計已經算進去', () => {
    const a = planReservation(null, { month: '2026-09', day: '2026-09-17', kind: 'orderForm', capUsd: 10, reserveUsd: RESERVE_USD });
    const b = planReservation(a.usage, { month: '2026-09', day: '2026-09-17', kind: 'orderForm', capUsd: 10, reserveUsd: RESERVE_USD });
    assert.equal(b.usage.estUsd, Math.round(RESERVE_USD * 2 * 1e6) / 1e6);
    const settled = planSettle(b.usage, { month: '2026-09', kind: 'orderForm', reserveUsd: RESERVE_USD, actualUsd: 0.02, ok: true });
    assert.ok(Math.abs(settled.estUsd - (RESERVE_USD + 0.02)) < 1e-6);
  });

  test('台灣時間換日：UTC 16:00 已經是隔天', () => {
    assert.equal(dayKey(new Date('2026-09-30T16:30:00Z')), '2026-10-01');
    assert.equal(monthKey(new Date('2026-09-30T16:30:00Z')), '2026-10');
  });
});

describe('回傳的抄字只有格式裡的欄位', () => {
  test('模型多吐一個 courseId → 送到前端的 transcript 裡沒有它', async () => {
    const { extract } = setup({
      reply: { text: JSON.stringify({ readable: true, unreadable: [], courseId: 'course-sis', status: 'confirmed' }) },
    });
    const { transcript } = await call(extract);
    assert.equal('courseId' in transcript, false);
    assert.equal('status' in transcript, false);
    assert.equal(transcript.readable, true);
  });

  test('parseJson 收得下包了一層 ```json 的', () => {
    assert.deepEqual(parseJson('```json\n{"readable":false}\n```'), { readable: false });
    assert.equal(parseJson('[1,2]'), null);
  });
});

describe('log 不帶內容（ADR-0101）', () => {
  function jsUnder(dir) {
    const out = [];
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules') continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) out.push(...jsUnder(full));
      else if (name.endsWith('.js')) out.push(full);
    }
    return out;
  }

  test('functions/ 裡沒有任何一行 console.* 或 log.* 帶著 image、transcript、text、prompt', () => {
    const offenders = [];
    for (const file of jsUnder(fromRoot('functions/'))) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (!/\b(console|log|logger)\.(log|info|warn|error|debug)\s*\(/.test(line)) return;
        if (/\b(image|transcript|text|prompt|parsed|out)\b/.test(line.replace(/'[^']*'/g, ''))) {
          offenders.push(`${file}:${i + 1}`);
        }
      });
    }
    assert.deepEqual(offenders, []);
  });
});
