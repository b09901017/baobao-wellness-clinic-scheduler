// 試算表的版面（.scratch/sheet-push-gaps 第三輪，issues/08～12；她 11/5 看過示意圖、說「都照建議」）。
//
// 判準寫在每一支 issue 的「判準」：日期欄寬、數字四欄跟日期分開、格線藏起來、名字大字、抬頭只有號碼、
// 待辦區的日期是文字 —— 都在替身裡量（`tests/helpers/appsScriptStub.js`）。替身量不到的（真的 Google 畫出來
// 長怎樣、折行的列夠不夠高）寫在 issue 的「做完時留下的」最後一段。例子一律假名、1234。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { loadAppsScript } from './helpers/appsScriptStub.js';

const LEGEND = '✓ 做完　△ 排了還沒做　○ 待確認　✗ 沒來';
const NOTICE = '⚠ 這張表由系統自動產生，請不要在這裡改資料 —— 改了也不會回到 app';

/** 一頁什麼都有：額度好幾列、器材與記一句、二返註記、買過什麼、營養品、備註、來訪紀錄、TODO、FINISHED。 */
export function page(over = {}) {
  return {
    name: '客戶A',
    fingerprint: 'a1',
    chartNo: '1234',
    source: '8萬方案',
    membershipExpiresAt: '2027-03-01',
    dateLabels: ['9/1(二)', '9/8(二)', '9/15(二)', '10/29(四)'],
    rows: [
      { label: '健檢', total: 2, done: 1, booked: 0, remaining: 1, marks: ['', '✓', '', ''] },
      { label: '復能-三選一(60)', total: 10, done: 3, booked: 1, remaining: 6, marks: ['✓', '✓2', '✓', '△'] },
      { label: 'ILIB(60)', total: 4, done: 0, booked: 0, remaining: 4, marks: ['', '', '', ''] },
      { label: 'EECP(60)', total: 1, done: 1, booked: 0, remaining: 0, marks: ['', '', '✗', ''] },
      { label: '三返（不算次數）', total: '—', done: 1, booked: 0, remaining: '—', marks: ['', '', '', '✓'], extra: true },
      { label: '心臟科評估（體驗）', total: '—', done: 5, booked: 0, remaining: '—', marks: ['✓', '', '', ''], extra: true },
    ],
    equipmentNotes: [{ rowIndex: 1, label: '復能-三選一(60)', cells: [{ dateIndex: 0, text: 'IN' }, { dateIndex: 1, text: 'SIS' }, { dateIndex: 9, text: '表外' }] }],
    slotNotes: [
      { rowIndex: 1, label: '復能-三選一(60)', cells: [{ dateIndex: 1, text: '14:30 SIS、15:45 ILIB\n第二行' }] },
      { rowIndex: 3, label: 'EECP(60)', cells: [{ dateIndex: 2, text: '他忘記了' }] },
    ],
    followupNotes: [{ dateIndex: 1, text: '9/15 二返(某明)' }],
    purchases: ['0801　8萬方案x1'],
    products: [
      { label: '營養品A', amount: 12000, months: 3, items: ['魚油', '益生菌'], deliveredAt: '9/1', delivery: '還差 益生菌', done: false },
      { label: '營養品B', amount: null, months: null, items: [], deliveredAt: null, delivery: '都給了', done: true },
    ],
    flags: ['體內金屬'],
    notes: '住附近\n偏好早上',
    log: [{ label: '9/1(二)', items: [{ status: '已完成', time: '10:00–11:00', course: '復能', equipment: 'IN', ivProduct: null, room: '治3', bed: null, therapist: '某明', doctor: null, note: null }] }],
    tasks: {
      todo: [{ label: '9/8 健檢', kind: '追蹤健檢報告', dueDate: '2026-09-15' }],
      finished: [{ label: '9/1 復能', kind: '寫紀錄', doneAt: '2026-09-01T10:00:00Z' }],
    },
    totals: { total: 17, done: 5, booked: 1, remaining: 11 },
    ...over,
  };
}

export const bundleOf = (sheets) => ({ format: 8, generatedAt: '2026/11/05 上午10:00:00', legend: LEGEND, notice: NOTICE, sheets });

export function draw(sheets = [page()]) {
  const app = loadAppsScript();
  const reply = app.post({ token: 'secret', bundle: bundleOf(sheets) });
  assert.equal(reply.ok, true, reply.error);
  return { app, sheet: app.ss.getSheetByName(sheets[0].name) };
}

/** A 欄是那個字的第幾列（找不到 -1）。 */
export const rowOf = (sheet, text) => {
  for (let r = 1; r <= 120; r += 1) if (sheet.at(`A${r}`) === text) return r;
  return -1;
};

/** 那一個字寫在哪一格（找不到 null）。 */
const cellOf = (sheet, pred) => [...sheet.cells.entries()].find(([, v]) => pred(String(v)))?.[0] ?? null;

describe('08 欄寬、分隔、格線、抬頭', () => {
  test('日期欄 78 寬（「10/29(四)」一行放得下）', () => {
    const { sheet } = draw();
    for (let c = 6; c <= 9; c += 1) assert.equal(sheet.widths.get(c), 78, `第 ${c} 欄`);
  });

  test('應有～剩餘：表頭淺一階、格子淡灰底；狀態色照舊蓋在上面', () => {
    const { sheet } = draw();
    for (const c of ['B', 'C', 'D', 'E']) assert.equal(sheet.backgrounds.get(`${c}5`), '#546E7A', `${c}5`);
    assert.equal(sheet.backgrounds.get('A5'), '#37474F', '療程項目那一格照舊');
    const r = rowOf(sheet, 'ILIB(60)');
    for (const c of ['B', 'C', 'D', 'E']) assert.equal(sheet.backgrounds.get(`${c}${r}`), '#EEF2F5', `${c}${r}：沒做過那一列四格都淡灰`);
    const fn = rowOf(sheet, '復能-三選一(60)');
    assert.equal(sheet.backgrounds.get(`C${fn}`), '#C8E6C9', '已完成 > 0 綠');
    assert.equal(sheet.backgrounds.get(`D${fn}`), '#FFF2CC', '已排未上 > 0 黃');
    assert.equal(sheet.backgrounds.get(`E${rowOf(sheet, 'EECP(60)')}`), '#FFCDD2', '剩餘 ≤ 0 紅');
    assert.equal(sheet.backgrounds.get(`E${rowOf(sheet, '三返（不算次數）')}`), '#EEF2F5', '一槓不紅');
  });

  test('剩餘右邊一條粗線，畫在矩陣的格線之後', () => {
    const { sheet } = draw();
    const calls = sheet.borderCalls;
    const divider = calls.findIndex((b) => b.args[7] === 'SOLID_MEDIUM');
    assert.ok(divider > 0, '要有一條粗線');
    assert.match(calls[divider].range, /^E5:E\d+$/);
    assert.deepEqual(calls[divider].args.slice(0, 6), [null, null, null, true, null, null], '只畫右邊');
    assert.ok(calls.slice(0, divider).some((b) => b.args[7] === 'SOLID'), '格線先畫');
  });

  test('格線藏起來', () => {
    assert.equal(draw().sheet.gridlinesHidden, true);
  });

  test('名字 18 號、那一列加高', () => {
    const { sheet } = draw();
    assert.equal(sheet.at('A2'), '客戶A');
    assert.equal(sheet.formats.fontSize.get('A2'), 18);
    assert.ok(sheet.rowHeights.get(2) >= 40, `名字那一列 ${sheet.rowHeights.get(2)} 高`);
  });

  test('抬頭只寫號碼、不寫「病歷號」；沒有號碼的不寫那一段', () => {
    const { app, sheet } = draw([page(), page({ name: '王小明', chartNo: null })]);
    const info = cellOf(sheet, (v) => v.includes('合計'));
    assert.match(sheet.at(info), /^1234　·　購買名稱：8萬方案/);
    const other = app.ss.getSheetByName('王小明');
    assert.match(other.at(cellOf(other, (v) => v.includes('合計'))), /^購買名稱：/);
    assert.equal(cellOf(sheet, (v) => v.includes('病歷號')), null);
  });

  test('待辦區的日期是文字（不讓 Google 認成日期格）', () => {
    const { sheet } = draw();
    const due = cellOf(sheet, (v) => v === '2026-09-15');
    const doneAt = cellOf(sheet, (v) => v === '2026-09-01');
    assert.ok(due && doneAt);
    assert.equal(sheet.formats.numberFormat.get(due), '@');
    assert.equal(sheet.formats.numberFormat.get(doneAt), '@');
  });
});
