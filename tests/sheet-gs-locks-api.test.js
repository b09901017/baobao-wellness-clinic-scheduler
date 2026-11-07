// 試算表重畫時鎖不拆了重上（issues/06）＋用 Google Sheets API 一次讀完每一頁的第一格（issues/07）。
//
// 她 11/5 量的「計時」：整份重畫 175 秒裡「上鎖」47 秒、「清空」44 秒（一頁先解鎖、畫完再上鎖）；
// 平常推 16.5 秒裡「讀」8.4 秒（35 頁各讀一次第一格）。她：「好」（兩件都做；Sheets API 要她在 Apps Script 加一個服務）。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { loadAppsScript, snapshotOf } from './helpers/appsScriptStub.js';
import { callCounter } from './helpers/countGsCalls.js';

const NOTICE = '⚠ 系統自動產生的唯讀報表';
const LEGEND = '✓ 已完成';
const PROTECT_NOTE = '由 app 產生，請勿手動編輯';

const page = (name, fp) => ({
  name,
  fingerprint: fp,
  chartNo: null,
  dateLabels: ['0901', '0908'],
  rows: [{ label: '復能-三選一(60)', total: 10, done: 1, booked: 1, remaining: 8, marks: ['✓', '△'] }],
  log: [],
  tasks: { todo: [], finished: [] },
  totals: { total: 10, done: 1, booked: 1, remaining: 8 },
});
const bundleOf = (sheets, generatedAt = '2026/11/05 下午3:00:00') => ({ format: 8, generatedAt, legend: LEGEND, notice: NOTICE, sheets });
const three = () => [page('客戶A', 'a'), page('客戶B', 'b'), page('客戶C', 'c')];

describe('06 鎖不拆了重上', () => {
  test('整份重畫：每一頁原本那一道鎖照留著（同一道），不叫 protect()、不拆', () => {
    const app = loadAppsScript();
    app.post({ token: 'secret', bundle: bundleOf(three()) });
    const before = Object.fromEntries(['客戶A', '客戶B', '客戶C'].map((n) => [n, app.ss.getSheetByName(n).protections[0]]));
    const count = callCounter(app);
    const stats = count(() => app.post({ token: 'secret', bundle: bundleOf(three()), force: true }));
    assert.equal(stats.result.sheets, 3);
    for (const n of ['客戶A', '客戶B', '客戶C']) {
      const sheet = app.ss.getSheetByName(n);
      assert.equal(sheet.protections.length, 1, n);
      assert.equal(sheet.protections[0], before[n], `${n} 的鎖被拆了重上`);
    }
    assert.ok(!stats.byName['Sheet.protect'], `protect() 叫了 ${stats.byName['Sheet.protect']} 次`);
    assert.ok(!stats.byName['Protection.remove'], `remove() 叫了 ${stats.byName['Protection.remove']} 次`);
  });

  test('第一次畫（新建的分頁）照樣上鎖：一道、說明對、只有我、網域不能改', () => {
    const app = loadAppsScript();
    app.post({ token: 'secret', bundle: bundleOf(three()) });
    const p = app.ss.getSheetByName('客戶A').protections;
    assert.equal(p.length, 1);
    assert.equal(p[0].getDescription(), PROTECT_NOTE);
    assert.deepEqual(p[0].getEditors().map((u) => u.getEmail()), ['owner@example.com']);
    assert.equal(p[0].canDomainEdit(), false);
  });

  for (const sheetsApi of ['off', 'on']) {
  test(`她把鎖拿掉了 → 那一頁下一次重畫時補上（Sheets API ${sheetsApi}）`, () => {
    const app = loadAppsScript({ sheetsApi });
    app.post({ token: 'secret', bundle: bundleOf(three()) });
    app.ss.getSheetByName('客戶B').protections[0].remove();
    app.post({ token: 'secret', bundle: bundleOf(three()), force: true });
    const p = app.ss.getSheetByName('客戶B').protections;
    assert.equal(p.length, 1);
    assert.equal(p[0].getDescription(), PROTECT_NOTE);
  });

  test(`一頁上面有兩道鎖 → 拆掉重上成一道（Sheets API ${sheetsApi}）`, () => {
    const app = loadAppsScript({ sheetsApi });
    app.post({ token: 'secret', bundle: bundleOf(three()) });
    app.ss.getSheetByName('客戶C').protect().setDescription('別的');
    app.post({ token: 'secret', bundle: bundleOf(three()), force: true });
    const p = app.ss.getSheetByName('客戶C').protections;
    assert.equal(p.length, 1);
    assert.equal(p[0].getDescription(), PROTECT_NOTE);
  });
  }
});

describe('07 Google Sheets API：一次讀完每一頁的名字、第一格、大小、鎖；沒開就照舊', () => {
  /** 一串推送（她自己的同名分頁、第一列清掉、名字有單引號的她自己的分頁、整份重畫），每一步拍一張。 */
  const story = (sheetsApi) => {
    const app = loadAppsScript({ sheetsApi, sheetNames: ["她's 筆記", '客戶D'] });
    app.ss.getSheetByName("她's 筆記").set(1, 1, '我自己的');
    app.ss.getSheetByName('客戶D').set(1, 1, '我自己的同名');
    const shots = [];
    const step = (body) => {
      const reply = app.post({ token: 'secret', ...body });
      shots.push({ reply, snap: snapshotOf(app.ss), props: Object.fromEntries(app.docProps) });
    };
    const pages = [...three(), page('客戶D', 'd')];
    step({ bundle: bundleOf(pages) });
    step({ bundle: bundleOf(pages, '2026/11/05 下午4:00:00') });
    app.ss.getSheetByName('客戶A').set(1, 1, '');
    step({ bundle: bundleOf(pages, '2026/11/05 下午5:00:00') });
    step({ bundle: bundleOf(pages, '2026/11/05 下午6:00:00'), force: true });
    return { shots, app };
  };

  test('開了 API 畫出來跟沒開一模一樣（每一步整份試算表、回報、文件屬性）', () => {
    assert.deepEqual(story('on').shots, story('off').shots);
  });

  test('API 丟錯（服務沒開好、配額）→ 退回逐頁讀，結果一樣', () => {
    const on = story('throw');
    assert.deepEqual(on.shots, story('off').shots);
    assert.ok(on.app.apiCalls.length > 0, '有試著叫 API');
  });

  test('都沒變的那一次：API 叫兩次（名字＋大小＋鎖、第一格），不再一頁一頁讀第一格與名字', () => {
    const app = loadAppsScript({ sheetsApi: 'on' });
    app.post({ token: 'secret', bundle: bundleOf(three()) });
    app.apiCalls.length = 0;
    const count = callCounter(app);
    const stats = count(() => app.post({ token: 'secret', bundle: bundleOf(three(), '2026/11/05 下午4:00:00') }));
    assert.equal(stats.result.kept, 3);
    assert.deepEqual(app.apiCalls, ['Spreadsheets.get', 'Spreadsheets.Values.batchGet']);
    assert.ok(!stats.byName['Range.getValue'], `第一格逐頁讀了 ${stats.byName['Range.getValue']} 次`);
    assert.ok(!stats.byName['Sheet.getName'], `名字逐頁讀了 ${stats.byName['Sheet.getName']} 次`);
    assert.ok(!stats.byName['Sheet.isSheetHidden'], '藏起來了沒也從 API 那一份拿');
  });

  test('整份重畫：大小與鎖也從 API 那一份拿，不再一頁一頁問', () => {
    const app = loadAppsScript({ sheetsApi: 'on' });
    app.post({ token: 'secret', bundle: bundleOf(three()) });
    const count = callCounter(app);
    const stats = count(() => app.post({ token: 'secret', bundle: bundleOf(three()), force: true }));
    assert.equal(stats.result.sheets, 3);
    for (const one of ['Sheet.getMaxRows', 'Sheet.getMaxColumns', 'Sheet.getProtections']) {
      assert.ok(!stats.byName[one], `${one} 叫了 ${stats.byName[one]} 次`);
    }
  });
});
