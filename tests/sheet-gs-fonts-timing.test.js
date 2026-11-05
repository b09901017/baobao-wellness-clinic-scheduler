// 試算表的字級與「每一步花幾秒」（.scratch/sheet-push-gaps/issues/05）。
//
// 字級：`finish()` 以前最後整頁 `setFontSize(11)`，把名字的 14 號、註記列與第 3 列的 9 號都蓋掉了 —— 她 11/5：「要，量完秒數再改」。
// 計時：重畫比估的慢（寫少了四分之三、時間只少三分之一），要知道慢在哪一步才決定下一步（開 Sheets API 還是改某一步）。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { loadAppsScript, snapshotOf } from './helpers/appsScriptStub.js';

const NOTICE = '⚠ 系統自動產生的唯讀報表';
const LEGEND = '✓ 已完成';

/** 一頁：兩筆額度、第一筆底下一列器材、二返註記寫在第 2 個日期底下。 */
function page() {
  return {
    name: '客戶A',
    fingerprint: 'fp1',
    chartNo: '1234',
    source: '',
    membershipExpiresAt: '',
    dateLabels: ['0901', '0908', '0915'],
    rows: [
      { label: '復能-三選一(60)', total: 10, done: 2, booked: 1, remaining: 7, marks: ['✓', '✓', '△'] },
      { label: '健檢', total: 1, done: 1, booked: 0, remaining: 0, marks: ['', '✓', ''] },
    ],
    equipmentNotes: [{ rowIndex: 0, label: '器材', cells: [{ dateIndex: 0, text: 'SIS' }] }],
    slotNotes: [],
    followupNotes: [{ dateIndex: 1, text: '9/20 二返(某明)' }],
    purchases: [],
    products: [],
    flags: [],
    notes: '',
    log: [],
    tasks: { todo: [], finished: [] },
    totals: { total: 11, done: 3, booked: 1, remaining: 7 },
  };
}

const bundle = (generatedAt = '2026/11/05 下午3:00:00') => ({
  format: 8, generatedAt, legend: LEGEND, notice: NOTICE, sheets: [page()],
});

function render(body = {}) {
  const app = loadAppsScript();
  const reply = app.post({ token: 'secret', bundle: bundle(), ...body });
  assert.equal(reply.ok, true, reply.error);
  const sheet = snapshotOf(app.ss).find((s) => s.name === '客戶A');
  const size = Object.fromEntries(sheet.formats.fontSize);
  return { app, sheet, size };
}

describe('字級：名字 18 號（第三輪 08 從 14 放大）、產生時間那一列與二返註記 9 號，其餘 11 號', () => {
  test('名字那一格 18 號', () => {
    const { size } = render();
    assert.equal(size.A2, 18);
  });

  test('產生時間那一列（第三輪 09 起第 4 列）9 號', () => {
    const { size } = render();
    assert.equal(size.A4, 9);
  });

  test('器材併進那一格（第三輪 11 起不再多一列）：額度那幾列與那一格都 11 號', () => {
    // 表頭第 5 列；第 6 列是復能那一筆（G6「✓ SIS」：F 是空白欄，issues/14）、第 7 列是健檢
    const { size, app } = render();
    assert.equal(app.ss.getSheetByName('客戶A').at('G6'), '✓ SIS');
    assert.equal(size.A6, 11);
    assert.equal(size.G6, 11);
    assert.equal(size.A7, 11);
  });

  test('二返註記（矩陣底下那一列、寫在那次健檢那一欄）9 號', () => {
    // 矩陣 2 列（6～7）→ 註記在第 8 列，日期第 2 個 → H 欄（F 是空白欄，日期從 G 起）
    const { size } = render();
    assert.equal(size.H8, 9);
  });

  test('第 1 列的提醒、表頭照舊 11 號', () => {
    const { size } = render();
    assert.equal(size.A1, 11);
    assert.equal(size.A5, 11);
  });

  test('改了畫法：LAYOUT_VERSION 至少 3（部署之後第一次推送每一頁重畫一次，字級才換得過去）', () => {
    const { app } = render();
    assert.ok(app.context.LAYOUT_VERSION >= 3);
  });
});

describe('每一步花幾秒：寫進執行紀錄（console.log 一行「計時」）', () => {
  const timingOf = (app) => {
    const line = app.logs.find((l) => l.startsWith('計時 '));
    assert.ok(line, `沒有計時那一行：${JSON.stringify(app.logs)}`);
    return JSON.parse(line.slice('計時 '.length));
  };

  test('重畫的那一次：每一步都有，數字是毫秒，重畫幾頁、沒變幾頁一起記', () => {
    const { app } = render();
    const t = timingOf(app);
    for (const step of ['總共', '等鎖', '讀', '原始資料', '清空', '排版', '寫值', '格式', '合併', '框線欄寬', '上鎖', '指紋', '改時間', '刪舊頁']) {
      assert.equal(typeof t.ms[step], 'number', `少了「${step}」`);
      assert.ok(t.ms[step] >= 0);
    }
    assert.deepEqual({ drawn: t.drawn, kept: t.kept }, { drawn: 1, kept: 0 });
  });

  test('都沒變的那一次也記（平常推慢在哪）', () => {
    const app = loadAppsScript();
    app.post({ token: 'secret', bundle: bundle() });
    app.logs.length = 0;
    app.post({ token: 'secret', bundle: bundle('2026/11/05 下午4:00:00') });
    const t = timingOf(app);
    assert.deepEqual({ drawn: t.drawn, kept: t.kept }, { drawn: 0, kept: 1 });
  });

  test('計時那一行也寫進藏起來的 _data 分頁的 B1（執行作業那一頁看不到紀錄時，打開那一頁就看得到）', () => {
    const { app } = render();
    const b1 = String(app.ss.getSheetByName('_data').at('B1'));
    assert.ok(b1.startsWith('計時 '), b1);
    assert.equal(JSON.parse(b1.slice('計時 '.length)).drawn, 1);
  });

  test('比較舊的那一包不畫：_data 的 B1 留著上一次畫的那一趟', () => {
    const app = loadAppsScript();
    app.post({ token: 'secret', bundle: bundle(), dataAt: 2000 });
    const before = app.ss.getSheetByName('_data').at('B1');
    app.post({ token: 'secret', bundle: bundle(), dataAt: 1000 });
    assert.equal(app.ss.getSheetByName('_data').at('B1'), before);
  });

  test('比較舊的那一包不畫：也記一行（只有等鎖與總共），看得出它很快就回了', () => {
    const app = loadAppsScript();
    app.post({ token: 'secret', bundle: bundle(), dataAt: 2000 });
    app.logs.length = 0;
    const reply = app.post({ token: 'secret', bundle: bundle(), dataAt: 1000 });
    assert.equal(reply.stale, true);
    const t = timingOf(app);
    assert.equal(t.stale, true);
    assert.equal(typeof t.ms.總共, 'number');
  });
});
