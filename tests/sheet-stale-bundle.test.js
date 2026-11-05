// 兩台裝置幾乎同時推：比較舊的那一包不畫（.scratch/sheet-push-gaps 的 04，ADR-0174）。
//
// 以前 `.gs` 只用鎖讓請求排隊、不比新舊：新的那一包先拿到鎖畫完，舊的那一包等到鎖接著畫 —— 試算表停在舊的，要等下一次推送。
// 現在 app 每一包附 `dataAt`（稽核紀錄最新那一則的伺服器時間，打包之前讀的），`.gs` 記畫過最新的，比較舊的不畫。
//
// 判準：**這一行會不會讓比較新的那一包被當成舊的不畫？會不會讓舊的那一包蓋掉新的？**
// 例子一律假名。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { loadAppsScript, snapshotOf } from './helpers/appsScriptStub.js';
import { dataAtOf, pushBody } from '../public/js/domain/sheetPushTiming.js';
import { pushedSay, skippedPushSay } from '../public/js/domain/sheetReport.js';

const page = (name, fp, label) => ({
  name, fingerprint: fp, chartNo: null, dateLabels: ['11/1'],
  rows: [{ label, total: 1, done: 0, booked: 1, remaining: 0, marks: ['△'] }],
  log: [], tasks: { todo: [], finished: [] }, totals: { total: 1, done: 0, booked: 1, remaining: 0 },
});
const bundleOf = (label, fp, generatedAt = '2026/11/05 上午10:00:00') => ({
  format: 8, generatedAt, legend: '✓ 做完', notice: '⚠ 這張表由系統自動產生', sheets: [page('客戶A', fp, label)],
});
const NEW = bundleOf('ILIB(60)', 'new');
const OLD = bundleOf('健檢', 'old');
const post = (app, body) => app.post({ token: 'secret', ...body });

describe('.gs：比較舊的那一包不畫', () => {
  test('先推新的、再推舊的 → 第二次一格都不動、回 stale', () => {
    const app = loadAppsScript();
    assert.equal(post(app, { bundle: NEW, dataAt: 2000 }).ok, true);
    const before = JSON.stringify(snapshotOf(app.ss));
    const reply = post(app, { bundle: OLD, dataAt: 1000 });
    assert.deepEqual(reply, { ok: true, stale: true });
    assert.equal(JSON.stringify(snapshotOf(app.ss)), before, '一格都不動（連第三列的產生時間）');
    assert.equal(app.docProps.get('lastDataAt'), '2000');
    assert.equal(app.ss.getSheetByName('客戶A').at('A6'), 'ILIB(60)');
  });

  test('先推舊的、再推新的 → 照畫、記新的時間', () => {
    const app = loadAppsScript();
    post(app, { bundle: OLD, dataAt: 1000 });
    assert.equal(post(app, { bundle: NEW, dataAt: 2000 }).sheets, 1);
    assert.equal(app.ss.getSheetByName('客戶A').at('A6'), 'ILIB(60)');
    assert.equal(app.docProps.get('lastDataAt'), '2000');
  });

  test('一樣的時間照畫（整包是冪等的；同一台重推、兩台讀到同一則稽核）', () => {
    const app = loadAppsScript();
    post(app, { bundle: OLD, dataAt: 2000 });
    const reply = post(app, { bundle: NEW, dataAt: 2000 });
    assert.equal(reply.stale, undefined);
    assert.equal(reply.sheets, 1);
  });

  test('整份重畫（force）比較舊照樣不畫', () => {
    const app = loadAppsScript();
    post(app, { bundle: NEW, dataAt: 2000 });
    assert.deepEqual(post(app, { bundle: OLD, dataAt: 1000, force: true }), { ok: true, stale: true });
  });

  test('舊版 app（沒帶時間）照畫、不記；之後新版的照常比', () => {
    const app = loadAppsScript();
    post(app, { bundle: NEW, dataAt: 2000 });
    assert.equal(post(app, { bundle: OLD }).sheets, 1, '沒帶時間 → 照畫');
    assert.equal(app.docProps.get('lastDataAt'), '2000', '沒帶時間 → 不記');
    assert.equal(post(app, { bundle: OLD, dataAt: 1500 }).stale, true);
  });

  test('看不懂的時間（字串、null）當成沒帶：照畫、不記', () => {
    for (const dataAt of ['2000', null]) {
      const app = loadAppsScript();
      post(app, { bundle: NEW, dataAt: 2000 });
      const reply = post(app, { bundle: OLD, dataAt });
      assert.equal(reply.ok, true, String(dataAt));
      assert.equal(reply.stale, undefined, String(dataAt));
      assert.equal(app.docProps.get('lastDataAt'), '2000');
    }
  });

  test('畫到一半出事 → 不記那一包的時間（下一次舊一點的那一包照樣畫得上去）', () => {
    const app = loadAppsScript();
    post(app, { bundle: OLD, dataAt: 1000 });
    const real = app.context.renderCustomer;
    app.context.renderCustomer = () => { throw new Error('逾時'); };
    assert.equal(post(app, { bundle: NEW, dataAt: 3000 }).ok, false);
    app.context.renderCustomer = real;
    assert.equal(app.docProps.get('lastDataAt'), '1000');
    assert.equal(post(app, { bundle: NEW, dataAt: 2000 }).sheets, 1);
  });

  test('記的時間不會被「刪掉的客戶」那一圈清掉（它不是 fp: 開頭）', () => {
    const app = loadAppsScript();
    post(app, { bundle: NEW, dataAt: 2000 });
    post(app, { bundle: { ...NEW, sheets: [] }, dataAt: 2100 });
    assert.equal(app.docProps.get('lastDataAt'), '2100');
  });

  test('拿不到鎖照舊退回，不比也不記', () => {
    const app = loadAppsScript({ lock: false });
    assert.equal(post(app, { bundle: NEW, dataAt: 2000 }).ok, false);
    assert.equal(app.docProps.has('lastDataAt'), false);
  });

  test('isStaleBundle()：任何一邊沒有時間都照畫', () => {
    const { context } = loadAppsScript();
    assert.equal(context.isStaleBundle(1000, '2000'), true);
    assert.equal(context.isStaleBundle(2000, '2000'), false);
    assert.equal(context.isStaleBundle(3000, '2000'), false);
    assert.equal(context.isStaleBundle(null, '2000'), false);
    assert.equal(context.isStaleBundle(1000, undefined), false);
    assert.equal(context.isStaleBundle(1000, ''), false);
    assert.equal(context.isStaleBundle(1000, 'x'), false);
  });
});

describe('app 那一側：時間從哪裡來、怎麼送', () => {
  test('dataAtOf()：稽核那一則的伺服器時間（Timestamp → 毫秒）；還沒送上雲端（null）、沒有任何稽核 → null', () => {
    assert.equal(dataAtOf({ at: { toMillis: () => 1730790000000 } }), 1730790000000);
    assert.equal(dataAtOf({ at: new Date(5000) }), 5000);
    assert.equal(dataAtOf({ at: null }), null);
    assert.equal(dataAtOf(undefined), null);
    assert.equal(dataAtOf({ at: '2026-11-05T00:00:00Z' }), null, '字串不認（伺服器時間一定是 Timestamp）');
  });

  test('pushBody()：dataAt 放最外層、沒有就不帶那個鍵；force 照帶', () => {
    assert.deepEqual(pushBody({ token: 't', bundle: { a: 1 }, dataAt: 5 }), { token: 't', bundle: { a: 1 }, dataAt: 5 });
    assert.deepEqual(pushBody({ token: 't', bundle: { a: 1 }, dataAt: null }), { token: 't', bundle: { a: 1 } });
    assert.deepEqual(pushBody({ token: 't', bundle: {}, dataAt: 5, force: true }), { token: 't', bundle: {}, dataAt: 5, force: true });
  });

  test('設定頁那一句：講得出「試算表上已經是更新的，這一次沒畫」，不是「更新了 0 張」', () => {
    const say = pushedSay({ ok: true, stale: true, sheets: 0, kept: null, skipped: [] });
    assert.match(say, /試算表上已經是更新的/);
    assert.doesNotMatch(say, /0 張/);
    assert.match(skippedPushSay({ stale: true, skipped: [] }), /已經是更新的/);
  });

  const src = readFileSync(new URL('../public/js/data/sheetSync.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export async function buildBundle'), src.indexOf('export function push'));

  test('buildBundle()：先讀稽核最新那一則、再讀資料；那一讀在「讀到快取就不推」那一套裡', () => {
    const since = body.indexOf('const since = repo.cacheReads();');
    const audit = body.indexOf('await auditData.listRecent(1)');
    const data = body.indexOf('await Promise.all([');
    const check = body.indexOf('readsIncomplete(');
    assert.ok(since !== -1 && audit !== -1 && data !== -1 && check !== -1, '四樣都要在');
    assert.ok(since < audit && audit < data && data < check, '順序：記下快取讀了幾次 → 稽核 → 資料 → 問有沒有讀到快取');
    assert.match(body, /return \{ bundle, dataAt: dataAtOf\(latest\) \};/);
  });

  test('新舊的依據不可以是資料的 updatedAt（刪掉的那一筆讀不進來，刪除之後那一包會被當成舊的）', () => {
    assert.doesNotMatch(body, /updatedAt/);
    assert.doesNotMatch(src.slice(src.indexOf('async function run')), /updatedAt/);
  });

  test('run()：stale 算成功、清待推標記照舊看 version、不動「有幾張沒更新」', () => {
    const run = src.slice(src.indexOf('async function run'), src.indexOf('function afterRun'));
    const stale = run.slice(run.indexOf('if (reply.stale)'), run.indexOf('return { ok: true, at, stale: true'));
    assert.ok(stale.length > 0);
    assert.match(stale, /if \(version === packedAt\) write\(DIRTY_KEY, null\);/);
    assert.match(stale, /write\(ERROR_KEY, null\);/);
    assert.doesNotMatch(stale, /SKIPPED_KEY/);
  });
});
