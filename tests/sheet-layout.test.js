// 試算表的版面（.scratch/sheet-push-gaps 第三輪，issues/08～12；她 11/5 看過示意圖、說「都照建議」）。
//
// 判準寫在每一支 issue 的「判準」：日期欄寬、數字四欄跟日期分開、格線藏起來、名字大字、抬頭只有號碼、
// 待辦區的日期是文字 —— 都在替身裡量（`tests/helpers/appsScriptStub.js`）。替身量不到的（真的 Google 畫出來
// 長怎樣、折行的列夠不夠高）寫在 issue 的「做完時留下的」最後一段。例子一律假名、1234。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { loadAppsScript } from './helpers/appsScriptStub.js';
import { syncBundle } from '../public/js/domain/sheetReport.js';

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

describe('09 凍結前五欄', () => {
  /** 日期多到超過 26 欄、底下每一塊都有東西的一頁。 */
  const widePage = () => page({
    name: '客戶B',
    dateLabels: Array.from({ length: 30 }, (_, i) => `${1 + Math.floor(i / 28)}/${1 + (i % 28)}`),
    rows: page().rows.map((r) => ({ ...r, marks: Array.from({ length: 30 }, (_, i) => (i % 3 ? '' : '✓')) })),
    notes: '一段很長很長的備註，長到在五欄的寬度裡一定要折成好幾行才放得下，看看那一列有沒有跟著長高',
  });

  test('沒有任何一個合併跨過第 5 欄與第 6 欄之間（每一頁）', () => {
    const { app } = draw([page(), widePage()]);
    for (const sheet of app.ss.getSheets()) {
      const crossing = sheet.mergeBounds.filter((m) => m.left <= 5 && m.right >= 6);
      assert.deepEqual(crossing, [], `${sheet.name}：${sheet.merges.join(' ')}`);
    }
  });

  test('凍結 5 列 5 欄，而且凍結是在合併之後才設', () => {
    const app = loadAppsScript();
    const seen = [];
    const insert = app.ss.insertSheet.bind(app.ss);
    app.ss.insertSheet = (name) => {
      const sheet = insert(name);
      const freeze = sheet.setFrozenColumns.bind(sheet);
      sheet.setFrozenColumns = (n) => { seen.push({ name, n, merges: sheet.merges.length }); freeze(n); };
      return sheet;
    };
    assert.equal(app.post({ token: 'secret', bundle: bundleOf([page()]) }).ok, true);
    const sheet = app.ss.getSheetByName('客戶A');
    assert.equal(sheet.frozenRows, 5);
    assert.equal(sheet.frozenCols, 5);
    const last = seen.filter((s) => s.name === '客戶A').at(-1);
    assert.equal(last.n, 5);
    assert.equal(last.merges, sheet.merges.length, '凍結的那一刻合併已經全部在了');
  });

  test('第 1 列那句提醒照舊在 A1；沒變的那一頁改的是產生時間那一格（第 4 列）', () => {
    const app = loadAppsScript();
    const bundle = bundleOf([page()]);
    app.post({ token: 'secret', bundle });
    const reply = app.post({ token: 'secret', bundle: { ...bundle, generatedAt: '2026/11/05 下午9:00:00' } });
    assert.equal(reply.kept, 1);
    const sheet = app.ss.getSheetByName('客戶A');
    assert.equal(sheet.at('A1'), NOTICE);
    assert.match(sheet.at('A4'), /^產生時間 2026\/11\/05 下午9:00:00/);
    assert.equal(sheet.at('A2'), '客戶A');
    assert.match(sheet.at('A3'), /合計/);
  });

  test('折行的列跟著長高（不再整頁固定 26）', () => {
    const { app } = draw([widePage()]);
    const sheet = app.ss.getSheetByName('客戶B');
    const r = [...sheet.cells.entries()].find(([, v]) => String(v).startsWith('一段很長很長的備註'))[0].replace(/^A/, '');
    assert.ok(sheet.rowHeights.get(Number(r)) > 26, `那一列 ${sheet.rowHeights.get(Number(r))} 高`);
    assert.equal(sheet.rowHeights.get(5), 26, '表頭照舊');
  });

  test('rowHeightFor()：一行 26、兩行以上照行數長高；換行照算', () => {
    const { context } = loadAppsScript();
    assert.equal(context.rowHeightFor('短短的', 438, 11), 26);
    const two = context.rowHeightFor('字'.repeat(40), 438, 11);
    assert.ok(two > 26 && two < 60, String(two));
    assert.ok(context.rowHeightFor('一\n二\n三', 438, 11) > two);
    assert.ok(context.rowHeightFor('a'.repeat(40), 438, 11) === 26, '半形字比較窄');
  });
});

describe('10 療程項目照「做最多的在上面」排', () => {
  /** 矩陣那幾列的療程項目（表頭底下、「買過什麼」上面，應有那一格是數字或一槓的）。 */
  const labels = (sheet) => {
    const out = [];
    for (let r = 6; r < rowOf(sheet, '買過什麼'); r += 1) {
      const total = sheet.at(`B${r}`);
      if (typeof total === 'number' || total === '—') out.push(sheet.at(`A${r}`));
    }
    return out;
  };

  test('已完成＋已排未上多的在上面、沒做過的在下面；沒有額度的那幾列永遠在最下面、照原本的先後', () => {
    const { sheet } = draw();
    // 復能 3+1、健檢 1+0、EECP 1+0（一樣多照原本的先後）、ILIB 0；心臟科評估做了 5 次但沒有額度 → 照舊在三返後面
    assert.deepEqual(labels(sheet), ['復能-三選一(60)', '健檢', 'EECP(60)', 'ILIB(60)', '三返（不算次數）', '心臟科評估（體驗）']);
  });

  test('合計（抬頭那一行）沒變', () => {
    const { sheet } = draw();
    assert.match(sheet.at('A3'), /合計　應有 17　已完成 5　已排未上 1　剩餘 11/);
  });

  test('rowOrder()：一樣多的照原本的先後；沒帶 extra 但應有是一槓的也算沒有額度', () => {
    const { context } = loadAppsScript();
    const row = (done, booked, total = 1, extra) => ({ done, booked, total, ...(extra ? { extra } : {}) });
    assert.deepEqual([...context.rowOrder([row(0, 0), row(1, 0), row(0, 1), row(2, 0)])], [3, 1, 2, 0]);
    assert.deepEqual([...context.rowOrder([row(9, 0, '—'), row(0, 0), row(1, 1, 3, true), row(1, 0)])], [3, 1, 0, 2]);
    assert.deepEqual([...context.rowOrder([])], []);
  });
});

describe('11 器材併進那一格、記一句改成那一格的備註', () => {
  test('擇一池那一列：「✓ IN」「✓2 SIS」，底色照符號；器材那一列不見了', () => {
    const { sheet } = draw();
    const r = rowOf(sheet, '復能-三選一(60)');
    assert.equal(r, 6, '做最多的那一筆排第一（原本在第 2 個，10）');
    assert.deepEqual(['F', 'G', 'H', 'I'].map((c) => sheet.at(`${c}${r}`)), ['✓ IN', '✓2 SIS', '✓', '△']);
    assert.equal(sheet.backgrounds.get(`F${r}`), '#C8E6C9');
    assert.equal(sheet.backgrounds.get(`G${r}`), '#C8E6C9');
    assert.equal(sheet.backgrounds.get(`I${r}`), '#FFF2CC');
    // 矩陣緊接著下一筆額度，沒有夾註記列
    assert.equal(sheet.at(`A${r + 1}`), '健檢');
    const all = [...sheet.cells.values()].map(String);
    assert.ok(!all.includes('IN') && !all.includes('SIS'), '不再有單獨寫器材的格子');
    assert.ok(!all.some((v) => v.includes('表外')), '落在表外的照舊丟掉');
  });

  test('記一句在那一格的備註裡：全文、換行照留；同一格又有器材也兩樣都在；跟著它那一筆額度走', () => {
    const { sheet } = draw();
    const fn = rowOf(sheet, '復能-三選一(60)');
    assert.equal(sheet.noteAt(`G${fn}`), '14:30 SIS、15:45 ILIB\n第二行');
    assert.equal(sheet.at(`G${fn}`), '✓2 SIS');
    const eecp = rowOf(sheet, 'EECP(60)');
    assert.equal(sheet.noteAt(`H${eecp}`), '他忘記了');
    assert.equal(sheet.notes.size, 2, '只有那兩格有備註');
    const all = [...sheet.cells.values()].map(String);
    assert.ok(!all.some((v) => v.includes('他忘記了')), '記一句不再寫成格子裡的字');
  });

  test('重畫時記一句搬了位置：舊的那一格不留備註（clear() 不清備註，要另外清）', () => {
    const app = loadAppsScript();
    app.post({ token: 'secret', bundle: bundleOf([page()]) });
    const moved = page({ fingerprint: 'a2', slotNotes: [{ rowIndex: 3, label: 'EECP(60)', cells: [{ dateIndex: 3, text: '他忘記了' }] }] });
    app.post({ token: 'secret', bundle: bundleOf([moved]) });
    const sheet = app.ss.getSheetByName('客戶A');
    const eecp = rowOf(sheet, 'EECP(60)');
    assert.equal(sheet.noteAt(`H${eecp}`), '');
    assert.equal(sheet.noteAt(`I${eecp}`), '他忘記了');
    assert.equal(sheet.notes.size, 1);
  });

  test('沒有額度的段的記一句照舊在來訪紀錄那一行（那一條路不動）', () => {
    const log = [{ label: '9/15(二)', items: [{ status: '已完成', time: '15:00–15:30', course: '三返', equipment: null, ivProduct: null, room: null, bed: null, therapist: null, doctor: '某華', note: '報告看完了' }] }];
    const { sheet } = draw([page({ log })]);
    assert.ok([...sheet.cells.values()].includes('　已完成　15:00–15:30　三返　某華醫師　記一句：報告看完了'));
  });
});

describe('12 營養品一筆一行、備註一則一列上色', () => {
  test('營養品一筆一行、沒給完的那一行淡黃；那張五欄的表不見了', () => {
    const { sheet } = draw();
    const top = rowOf(sheet, '營養品');
    assert.equal(sheet.at(`A${top + 1}`), '營養品A　12,000 元・3 個月・魚油、益生菌　——　9/1　還差 益生菌');
    assert.equal(sheet.at(`A${top + 2}`), '營養品B　——　都給了');
    assert.equal(sheet.backgrounds.get(`A${top + 1}`), '#FFF2CC');
    assert.equal(sheet.backgrounds.get(`A${top + 2}`) ?? null, null);
    assert.ok(sheet.merges.includes(`A${top + 1}:E${top + 1}`));
    assert.ok(![...sheet.cells.values()].includes('品名'));
  });

  test('備註一則一列，用那一則在 app 裡的顏色（淡色版）；沒挑的、認不得的灰；永久限制那一行淡紅', () => {
    const noteLines = [
      { text: '住附近', color: 'green' }, { text: '偏好早上', color: 'grey' },
      { text: '怕冷', color: 'violet' }, { text: '舊的顏色', color: 'pink' },
    ];
    const { sheet } = draw([page({ noteLines })]);
    const top = rowOf(sheet, '備註');
    const rows = [1, 2, 3, 4, 5].map((i) => [sheet.at(`A${top + i}`), sheet.backgrounds.get(`A${top + i}`)]);
    assert.deepEqual(rows, [
      ['永久限制：體內金屬', '#FDE7E7'],
      ['住附近', '#E2EBE7'],
      ['偏好早上', '#EBEAE8'],
      ['怕冷', '#EBE7EF'],
      ['舊的顏色', '#EBEAE8'],
    ]);
    assert.equal(sheet.at(`A${top + 6}`), '', '後面空一列');
  });

  test('沒有 noteLines 的舊包（還沒更新的 app）：照 notes 一行一列、淡灰', () => {
    const { sheet } = draw([page({ flags: [], notes: '住附近\n\n偏好早上' })]);
    const top = rowOf(sheet, '備註');
    assert.deepEqual([1, 2].map((i) => [sheet.at(`A${top + i}`), sheet.backgrounds.get(`A${top + i}`)]),
      [['住附近', '#EBEAE8'], ['偏好早上', '#EBEAE8']]);
    assert.equal(sheet.at(`A${top + 3}`), '');
  });

  test('一則都沒有：照舊寫「（沒有）」', () => {
    const { sheet } = draw([page({ flags: [], notes: '', noteLines: [] })]);
    assert.equal(sheet.at(`A${rowOf(sheet, '備註') + 1}`), '（沒有）');
  });

  test('syncBundle() 的 noteLines：照短備註的順序與顏色；長備註沒有跑進去；notes 照舊送', () => {
    const b = syncBundle({
      customers: [{
        id: 'c1', name: '客戶A', notes: '住附近\n偏好早上',
        marks: [{ text: '住附近', color: 'green' }, { text: '偏好早上', color: 'nope' }],
        longNotes: [{ id: 'l1', title: '長的', body: '很長的一段' }],
      }],
      entitlementsBy: {}, visitsBy: {}, today: '2026-11-05',
    });
    const one = b.sheets[0];
    assert.deepEqual(one.noteLines, [{ text: '住附近', color: 'green' }, { text: '偏好早上', color: 'grey' }]);
    assert.equal(one.notes, '住附近\n偏好早上');
    assert.ok(!JSON.stringify(one).includes('很長的一段'));
  });

  test('syncBundle() 的 noteLines：只有舊的 notes（沒有 marks）的客戶照行拆、灰色', () => {
    const b = syncBundle({ customers: [{ id: 'c1', name: '客戶A', notes: '一\n二' }], entitlementsBy: {}, visitsBy: {}, today: '2026-11-05' });
    assert.deepEqual(b.sheets[0].noteLines, [{ text: '一', color: 'grey' }, { text: '二', color: 'grey' }]);
  });
});
