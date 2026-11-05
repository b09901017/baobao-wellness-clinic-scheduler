// 試算表推失敗自己再推；回到 app、網路回來、打開 app 都補推（.scratch/sheet-push-gaps/issues/01）。
//
// 規則在 `domain/sheetPushTiming.js`（純的）；`data/sheetSync.js` 在 node 裡跑不起來（一路 import 到 firebase 的 CDN），
// 接線只能掃原始碼 —— 真的計時器與事件由 E2E `45-sheet-push-race` 的 P2～P4 跑。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RETRY_MS, retryDelay, wantsRetry, keepsPending } from '../public/js/domain/sheetPushTiming.js';

describe('retryDelay()：1 分、5 分、15 分，之後停', () => {
  test('三次之內各隔 1／5／15 分', () => {
    assert.deepEqual([0, 1, 2].map(retryDelay), [60_000, 300_000, 900_000]);
    assert.deepEqual(RETRY_MS, [60_000, 300_000, 900_000]);
  });
  test('一直失敗（密鑰不對、指令碼太舊）不會無限重試：第四次起 null', () => {
    assert.equal(retryDelay(3), null);
    assert.equal(retryDelay(10), null);
  });
});

describe('wantsRetry()', () => {
  test('失敗要重試；讀到的不是全部（partial）也是失敗', () => {
    assert.equal(wantsRetry({ ok: false, error: '連不上試算表' }), true);
    assert.equal(wantsRetry({ ok: false, partial: true, error: '網路不穩' }), true);
    assert.equal(wantsRetry({ ok: false, error: '另一份同步還在進行中' }), true);
  });
  test('成功、沒設定（off）不重試', () => {
    assert.equal(wantsRetry({ ok: true }), false);
    assert.equal(wantsRetry({ ok: false, off: true }), false);
  });
  test('沒有結果（丟了例外）算失敗', () => {
    assert.equal(wantsRetry(undefined), true);
  });
});

describe('keepsPending()：已經排了更早的就不動', () => {
  const now = 1_000_000;
  test('沒有排 → 要排', () => assert.equal(keepsPending({ dueAt: null, now, ms: 10_000 }), false));
  test('排著的比這一次早 → 留著（回到 app 切來切去不會一直往後延）', () => {
    assert.equal(keepsPending({ dueAt: now + 3_000, now, ms: 10_000 }), true);
    assert.equal(keepsPending({ dueAt: now + 10_000, now, ms: 10_000 }), true);
  });
  test('排著的是 5 分後的重試 → 換成 10 秒內', () => {
    assert.equal(keepsPending({ dueAt: now + 300_000, now, ms: 10_000 }), false);
  });
});

describe('sheetSync.js 的接線（原始碼）', () => {
  // CRLF 的工作目錄也要對（Windows 的 checkout），先統一成 LF
  const src = readFileSync(new URL('../public/js/data/sheetSync.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const fn = (name) => {
    const at = src.indexOf(name);
    assert.ok(at >= 0, `找不到 ${name}`);
    const rest = src.slice(at);
    const end = rest.search(/\n}\n/);
    return rest.slice(0, end);
  };

  test('push()：每一趟跑完都問要不要重試（設定頁「立刻推一次」失敗也算），不是只有計時器那一條路', () => {
    assert.match(fn('export function push('), /run\(at, \{ force \}\)\.then\(afterRun,/);
    assert.match(fn('function afterRun('), /wantsRetry\(result\)/);
    assert.match(fn('function afterRun('), /retryDelay\(failures\)/);
  });

  test('重試、喚醒不加 version（version 只記寫入，run() 靠它判斷能不能清待推標記）', () => {
    assert.doesNotMatch(fn('function afterRun('), /version/);
    assert.doesNotMatch(fn('function kick('), /version/);
    assert.match(fn('export function schedule('), /version \+= 1/);
  });

  test('寫入照舊每次重設 10 秒（安靜下來才推），而且重新數失敗次數', () => {
    const body = fn('export function schedule(');
    assert.match(body, /arm\(QUIET_MS\)/);
    assert.match(body, /failures = 0/);
  });

  test('kick() 已經排了更早的就不動', () => {
    assert.match(fn('function kick('), /keepsPending\(\{ dueAt, now: Date\.now\(\), ms \}\)/);
  });

  test('wire()：打開 app 不管有沒有待推標記都推一次；離線時等網路回來；回到 app、網路回來有待推就推', () => {
    const body = fn('export function wire(');
    assert.match(body, /repo\.onCommitted\(schedule\)/);
    assert.doesNotMatch(body, /if \(isDirty\(\)\) schedule\(\)/);
    assert.match(body, /navigator\?\.onLine === false/);
    assert.match(body, /addEventListener\?\.\('online'/);
    assert.match(body, /addEventListener\('visibilitychange'/);
    assert.match(body, /visibilityState === 'visible' && isDirty\(\)/);
  });
});
