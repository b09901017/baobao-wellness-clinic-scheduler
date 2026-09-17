// 設定 → AI 用量（issue 05，ADR-0100）。
//
// **這一頁有沒有任何一個數字，會讓她以為那就是 Google 的帳單金額？**
// 數字本身沒辦法回答這一句（那是「估計」兩個字與 `?` 的事，E2E 盯），
// 這裡盯的是：數字跟 Function 真正擋人的那一份一樣、句子講得出去哪裡改。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import * as fnGuard from '../functions/lib/guard.js';
import {
  CEILING_USD, DAILY_LIMIT, DEFAULT_MONTHLY_CAP_USD, KIND_LABELS,
  dayKey, effectiveCap, failureSentence, formatUsd, monthKey, outcomeText, usageView, validateCap,
} from '../public/js/domain/aiUsage.js';
import { TRANSCRIPT_KINDS } from '../public/js/domain/transcripts.js';

describe('跟 Function 講同一組數字', () => {
  test('預設上限、天花板、每天次數', () => {
    assert.equal(DEFAULT_MONTHLY_CAP_USD, fnGuard.DEFAULT_MONTHLY_CAP_USD);
    assert.equal(CEILING_USD, fnGuard.CEILING_USD);
    assert.equal(DAILY_LIMIT, fnGuard.DAILY_LIMIT);
  });

  test('上限的算法一樣', () => {
    for (const cfg of [{}, { monthlyCapUsd: 0 }, { monthlyCapUsd: 7 }, { monthlyCapUsd: 99999 }, { monthlyCapUsd: '5' }, { monthlyCapUsd: -1 }]) {
      assert.equal(effectiveCap(cfg), fnGuard.resolveCap(cfg), JSON.stringify(cfg));
    }
  });

  test('月份與日期的算法一樣（台灣時間換日）', () => {
    for (const iso of ['2026-09-30T15:59:00Z', '2026-09-30T16:00:00Z', '2026-12-31T16:30:00Z']) {
      assert.equal(monthKey(new Date(iso)), fnGuard.monthKey(new Date(iso)));
      assert.equal(dayKey(new Date(iso)), fnGuard.dayKey(new Date(iso)));
    }
  });

  test('四種單子都有名字', () => {
    assert.deepEqual(Object.keys(KIND_LABELS).sort(), [...TRANSCRIPT_KINDS].sort());
  });
});

describe('每月上限那一格（跟 min 0 step 1 講同一句話）', () => {
  test('0、整數、天花板都收', () => {
    assert.deepEqual(validateCap(0), []);
    assert.deepEqual(validateCap(10), []);
    assert.deepEqual(validateCap(CEILING_USD), []);
  });

  test('超過天花板存不下去，而且講出天花板是多少', () => {
    const [err] = validateCap(CEILING_USD + 1);
    assert.match(err, new RegExp(`US\\$${CEILING_USD}`));
  });

  test('負數、小數、空白都擋', () => {
    assert.equal(validateCap(-1).length, 1);
    assert.equal(validateCap(2.5).length, 1);
    assert.equal(validateCap('').length, 1);
    assert.equal(validateCap(null).length, 1);
  });
});

describe('那一頁的數字', () => {
  const now = new Date('2026-09-17T04:00:00Z');
  const usage = {
    calls: 2, blocked: 1, estUsd: 8.5,
    days: { '2026-09-17': 2, '2026-09-16': 5 },
    byKind: { orderForm: { calls: 2, estUsd: 8.5 } },
  };

  test('估計花費跟 aiUsage 的合計一樣；次數是今天的', () => {
    const v = usageView(usage, { monthlyCapUsd: 10 }, [], now);
    assert.equal(v.monthUsd, 8.5);
    assert.equal(v.capUsd, 10);
    assert.equal(v.todayCalls, 2);
    assert.equal(v.percent, 85);
    assert.equal(v.warn, true, '80% 起變色');
    assert.equal(v.reached, false);
    assert.deepEqual(v.kinds.find((k) => k.kind === 'orderForm'), { kind: 'orderForm', label: '訂購單', calls: 2, estUsd: 8.5 });
    assert.equal(v.kinds.find((k) => k.kind === 'treatmentSheet').calls, 0);
  });

  test('這個月還沒有任何呼叫 → 全部是 0，不是壞掉', () => {
    const v = usageView(null, {}, [], now);
    assert.equal(v.monthUsd, 0);
    assert.equal(v.capUsd, DEFAULT_MONTHLY_CAP_USD);
    assert.equal(v.warn, false);
  });

  test('上限是 0 → 算到了', () => {
    assert.equal(usageView(null, { monthlyCapUsd: 0 }, [], now).reached, true);
  });

  test('最近那幾列：被擋的講出是哪一道', () => {
    const calls = [
      { at: new Date('2026-09-17T06:05:00Z'), kind: 'orderForm', outcome: 'blocked', reason: 'monthCap', estUsd: 0 },
      { at: new Date('2026-09-17T06:00:00Z'), kind: 'aboveeList', outcome: 'ok', estUsd: 0.021 },
    ];
    const [a, b] = usageView(usage, {}, calls, now).recent;
    assert.equal(a.outcome, '被擋：超過這個月的上限');
    assert.equal(a.time, '9/17 14:05');
    assert.equal(b.label, 'Abovee 畫面');
    assert.equal(b.outcome, '成功');
    assert.equal(outcomeText({ outcome: 'blocked', reason: 'paused' }), '被擋：AI 暫停中');
  });

  test('小於一分錢寫 <US$0.01，不寫 US$0.00', () => {
    assert.equal(formatUsd(0.003), '<US$0.01');
    assert.equal(formatUsd(0), 'US$0.00');
    assert.equal(formatUsd(1.234), 'US$1.23');
  });
});

describe('沒做到時講的那一句', () => {
  test('暫停講的是暫停，不是辨識失敗；而且講出去哪裡打開', () => {
    const s = failureSentence('paused');
    assert.match(s, /暫停/);
    assert.doesNotMatch(s, /失敗/);
    assert.match(s, /設定 → AI 用量/);
  });

  test('超過上限講出上限多少、去哪裡調', () => {
    assert.match(failureSentence('monthCap', { capUsd: 10 }), /US\$10\.00.*設定 → AI 用量/);
  });

  test('沒網路講要連網路', () => {
    assert.match(failureSentence('offline'), /連網路/);
  });
});
