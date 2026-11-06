// 試算表的版面（.scratch/sheet-push-gaps 第三輪，issues/08～12；她 11/5 看過示意圖、說「都照建議」）。
//
// 判準寫在每一支 issue 的「判準」：日期欄寬、數字四欄跟日期分開、格線藏起來、名字大字、抬頭只有號碼、
// 待辦區的日期是文字 —— 都在替身裡量（`tests/helpers/appsScriptStub.js`）。替身量不到的（真的 Google 畫出來
// 長怎樣、折行的列夠不夠高）寫在 issue 的「做完時留下的」最後一段。例子一律假名、1234。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { loadAppsScript } from './helpers/appsScriptStub.js';
import { syncBundle } from '../public/js/domain/sheetReport.js';
import { MARK_COLORS } from '../public/js/domain/customerMarks.js';

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
      { purchasedAt: '0901', label: '營養品A', amount: 12000, months: 3, items: ['魚油', '益生菌'], deliveredAt: '9/1', delivery: '還差 益生菌', done: false },
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

/** 「A5:E11」→ 欄的範圍（從 1 起）。 */
const colsOf = (range) => {
  const col = (ref) => [...ref.replace(/\d+$/, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  const [a, b = a] = range.split(':');
  return { left: col(a), right: col(b) };
};

describe('08／14 欄寬、數字四欄與日期中間的空白欄、格線、抬頭', () => {
  test('日期欄 78 寬（「10/29(四)」一行放得下）；日期從第 7 欄（G）起', () => {
    const { sheet } = draw();
    for (let c = 7; c <= 10; c += 1) assert.equal(sheet.widths.get(c), 78, `第 ${c} 欄`);
    assert.equal(sheet.at('G5'), '9/1(二)');
  });

  // 她 11/5 晚：「那個灰色巨醜」→ 挑了「A 全白＋窄空白欄」（.scratch/sheet-push-gaps/issues/14、mock-count-columns-2026-11-05.html）
  test('應有～剩餘：不塗底色、表頭跟療程項目同色；斑馬紋跟整列一樣；狀態色照舊', () => {
    const { sheet } = draw();
    for (const c of ['A', 'B', 'C', 'D', 'E']) assert.equal(sheet.backgrounds.get(`${c}5`), '#37474F', `${c}5`);
    const ilib = rowOf(sheet, 'ILIB(60)');
    const eecp = rowOf(sheet, 'EECP(60)');
    for (const r of [ilib, eecp]) {
      for (const c of ['B', 'C', 'D']) {
        if (c === 'C' && r === eecp) continue;   // EECP 已完成 1 → 綠
        assert.equal(sheet.backgrounds.get(`${c}${r}`) ?? null, sheet.backgrounds.get(`A${r}`) ?? null, `${c}${r} 跟那一列的療程項目一樣`);
      }
    }
    const fn = rowOf(sheet, '復能-三選一(60)');
    assert.equal(sheet.backgrounds.get(`C${fn}`), '#C8E6C9', '已完成 > 0 綠');
    assert.equal(sheet.backgrounds.get(`D${fn}`), '#FFF2CC', '已排未上 > 0 黃');
    assert.equal(sheet.backgrounds.get(`E${eecp}`), '#FFCDD2', '剩餘 ≤ 0 紅');
    const fu = rowOf(sheet, '三返（不算次數）');
    assert.equal(sheet.backgrounds.get(`E${fu}`) ?? null, sheet.backgrounds.get(`A${fu}`) ?? null, '一槓不紅');
    assert.ok(![...sheet.backgrounds.values()].includes('#EEF2F5'), '那層淡灰不見了');
    assert.ok(![...sheet.backgrounds.values()].includes('#546E7A'), '淺一階的表頭色不見了');
  });

  test('第 6 欄（F）是空白欄：寬 8、沒有字、白底（表頭那一格也白）、框線分兩塊畫、沒有粗線', () => {
    const { sheet } = draw();
    assert.equal(sheet.widths.get(6), 8);
    const last = rowOf(sheet, '心臟科評估（體驗）');
    for (let r = 5; r <= last; r += 1) {
      assert.equal(sheet.at(`F${r}`), '', `F${r} 沒有字`);
      assert.equal(sheet.backgrounds.get(`F${r}`), '#FFFFFF', `F${r} 白底`);
    }
    const calls = sheet.borderCalls;
    assert.ok(!calls.some((b) => b.args[7] === 'SOLID_MEDIUM'), '剩餘右邊那條粗線拿掉了');
    const matrix = calls.filter((b) => b.args[7] === 'SOLID').map((b) => b.range);
    assert.deepEqual(matrix, [`A5:E${last}`, `G5:J${last}`]);
    for (const range of matrix) {
      const { left, right } = colsOf(range);
      assert.ok(right < 6 || left > 6, `${range} 不碰空白欄`);
    }
  });

  test('一個日期都沒有：沒有日期那一塊的框線、空白欄照舊白', () => {
    const { sheet } = draw([page({ dateLabels: [], rows: page().rows.map((r) => ({ ...r, marks: [] })), equipmentNotes: [], slotNotes: [], followupNotes: [] })]);
    const last = rowOf(sheet, '心臟科評估（體驗）');
    assert.deepEqual(sheet.borderCalls.filter((b) => b.args[7] === 'SOLID').map((b) => b.range), [`A5:E${last}`]);
    assert.equal(sheet.backgrounds.get('F5'), '#FFFFFF');
  });

  test('格線藏起來', () => {
    assert.equal(draw().sheet.gridlinesHidden, true);
  });

  // 她 11/5 晚：「名子旁邊直接也是一樣大的病歷號」（issues/14）
  test('名字那一格是「名字＋全形空白＋號碼」、18 號、那一列加高；沒有號碼的只有名字', () => {
    const { app, sheet } = draw([page(), page({ name: '王小明', chartNo: null })]);
    assert.equal(sheet.at('A2'), '客戶A　1234');
    assert.equal(sheet.formats.fontSize.get('A2'), 18);
    assert.equal(sheet.formats.fontWeight.get('A2'), 'bold');
    assert.ok(sheet.rowHeights.get(2) >= 40, `名字那一列 ${sheet.rowHeights.get(2)} 高`);
    assert.equal(app.ss.getSheetByName('王小明').at('A2'), '王小明');
  });

  test('抬頭那一行沒有號碼了（號碼在名字那一格）、也不寫「病歷號」', () => {
    const { app, sheet } = draw([page(), page({ name: '王小明', chartNo: null })]);
    assert.match(sheet.at('A3'), /^購買名稱：8萬方案　·　/);
    assert.ok(!sheet.at('A3').includes('1234'));
    assert.match(app.ss.getSheetByName('王小明').at('A3'), /^購買名稱：/);
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

// 2026-11-05 晚她：「這頁分裂感太重了，我寧願不要中間那個分隔線好了，不要全部都凍結線左邊（A～E）太奇怪了」
//（.scratch/sheet-push-gaps/issues/14，ADR-0176 推翻 ADR-0175 的「凍結前五欄」）
describe('14 欄不凍結、上下那幾塊整頁寬', () => {
  /** 日期多到超過 26 欄、底下每一塊都有東西的一頁。 */
  const widePage = () => page({
    name: '客戶B',
    dateLabels: Array.from({ length: 30 }, (_, i) => `${1 + Math.floor(i / 28)}/${1 + (i % 28)}`),
    rows: page().rows.map((r) => ({ ...r, marks: Array.from({ length: 30 }, (_, i) => (i % 3 ? '' : '✓')) })),
  });

  test('每一個合併不是整頁寬，就是 TODO（A～C）／FINISHED（K～M）那兩塊（每一頁）', () => {
    const { app } = draw([page(), widePage()]);
    for (const sheet of app.ss.getSheets()) {
      if (sheet.name === '_data') continue;
      const width = Math.max(...sheet.mergeBounds.map((m) => m.right));
      // 4 個日期：矩陣到 J（10），表照舊留到 FINISHED 那一塊的右邊（M＝13）；30 個日期：6＋30
      assert.equal(width, sheet.name === '客戶B' ? 36 : 13, sheet.name);
      const odd = sheet.mergeBounds.filter((m) => !(m.left === 1 && m.right === width)
        && !(m.right - m.left === 2 && (m.left === 1 || m.left === 11)));
      assert.deepEqual(odd, [], `${sheet.name}：${sheet.merges.join(' ')}`);
      for (const title of ['買過什麼', '營養品', '備註', '來訪紀錄']) {
        const r = rowOf(sheet, title);
        assert.ok(sheet.merges.includes(`A${r}:${sheet.name === '客戶B' ? 'AJ' : 'M'}${r}`), `${sheet.name} ${title}`);
      }
    }
  });

  // 2026-11-06 她：「我也不想要1~5欄被凍結，就都不要有凍結，太割裂了」（issues/16，ADR-0178）—— 列也不凍結了
  test('列與欄都不凍結（從來沒有凍結過任何一列、一欄）', () => {
    const app = loadAppsScript();
    const seen = [];
    const insert = app.ss.insertSheet.bind(app.ss);
    app.ss.insertSheet = (name) => {
      const sheet = insert(name);
      const rows = sheet.setFrozenRows.bind(sheet);
      const cols = sheet.setFrozenColumns.bind(sheet);
      sheet.setFrozenRows = (n) => { seen.push(n); rows(n); };
      sheet.setFrozenColumns = (n) => { seen.push(n); cols(n); };
      return sheet;
    };
    assert.equal(app.post({ token: 'secret', bundle: bundleOf([page()]) }).ok, true);
    const sheet = app.ss.getSheetByName('客戶A');
    assert.equal(sheet.frozenRows, 0);
    assert.equal(sheet.frozenCols, 0);
    assert.ok(seen.every((n) => n === 0), String(seen));
  });

  test('以前畫的凍結了五列（第四輪）或五列五欄（第三輪）：重畫之後都拿掉', () => {
    const app = loadAppsScript();
    app.post({ token: 'secret', bundle: bundleOf([page()]) });
    const sheet = app.ss.getSheetByName('客戶A');
    sheet.frozenRows = 5;
    sheet.frozenCols = 5;   // 假裝是第三輪畫的
    app.post({ token: 'secret', bundle: bundleOf([page({ fingerprint: 'a2' })]) });
    assert.equal(app.ss.getSheetByName('客戶A').frozenRows, 0);
    assert.equal(app.ss.getSheetByName('客戶A').frozenCols, 0);
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
    assert.equal(sheet.at('A2'), '客戶A　1234');
    assert.match(sheet.at('A3'), /合計/);
  });

  test('折行的列跟著長高（整頁寬之後要很長才折）', () => {
    const long = '一段很長很長的備註'.repeat(14);
    const { sheet } = draw([page({ noteLines: [{ text: long, color: 'grey' }] })]);
    const r = rowOf(sheet, long);
    assert.ok(sheet.rowHeights.get(r) > 26, `那一列 ${sheet.rowHeights.get(r)} 高`);
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

describe('11 器材併進那一格、記一句改成那一格的附註', () => {
  test('擇一池那一列：「✓ IN」「✓2 SIS」，底色照符號；器材那一列不見了', () => {
    const { sheet } = draw();
    const r = rowOf(sheet, '復能-三選一(60)');
    assert.equal(r, 6, '做最多的那一筆排第一（原本在第 2 個，10）');
    // 日期從 G 起（F 是空白欄，issues/14）
    assert.deepEqual(['G', 'H', 'I', 'J'].map((c) => sheet.at(`${c}${r}`)), ['✓ IN', '✓2 SIS', '✓', '△']);
    assert.equal(sheet.backgrounds.get(`G${r}`), '#C8E6C9');
    assert.equal(sheet.backgrounds.get(`H${r}`), '#C8E6C9');
    assert.equal(sheet.backgrounds.get(`J${r}`), '#FFF2CC');
    // 矩陣緊接著下一筆額度，沒有夾註記列
    assert.equal(sheet.at(`A${r + 1}`), '健檢');
    const all = [...sheet.cells.values()].map(String);
    assert.ok(!all.includes('IN') && !all.includes('SIS'), '不再有單獨寫器材的格子');
    assert.ok(!all.some((v) => v.includes('表外')), '落在表外的照舊丟掉');
  });

  test('記一句在那一格的附註裡：全文、換行照留；同一格又有器材也兩樣都在；跟著它那一筆額度走', () => {
    const { sheet } = draw();
    const fn = rowOf(sheet, '復能-三選一(60)');
    assert.equal(sheet.noteAt(`H${fn}`), '14:30 SIS、15:45 ILIB\n第二行');
    assert.equal(sheet.at(`H${fn}`), '✓2 SIS');
    const eecp = rowOf(sheet, 'EECP(60)');
    assert.equal(sheet.noteAt(`I${eecp}`), '他忘記了');
    assert.equal(sheet.notes.size, 2, '只有那兩格有備註');
    // 那一格的字照舊只有符號（記一句另外疊在矩陣底下那一欄，issues/15）
    assert.equal(sheet.at(`I${eecp}`), '✗');
  });

  test('重畫時記一句搬了位置：舊的那一格不留備註（clear() 不清備註，要另外清）', () => {
    const app = loadAppsScript();
    app.post({ token: 'secret', bundle: bundleOf([page()]) });
    const moved = page({ fingerprint: 'a2', slotNotes: [{ rowIndex: 3, label: 'EECP(60)', cells: [{ dateIndex: 3, text: '他忘記了' }] }] });
    app.post({ token: 'secret', bundle: bundleOf([moved]) });
    const sheet = app.ss.getSheetByName('客戶A');
    const eecp = rowOf(sheet, 'EECP(60)');
    assert.equal(sheet.noteAt(`I${eecp}`), '');
    assert.equal(sheet.noteAt(`J${eecp}`), '他忘記了');
    assert.equal(sheet.notes.size, 1);
  });

  test('沒有額度的段的記一句照舊在來訪紀錄那一行（那一條路不動）', () => {
    const log = [{ label: '9/15(二)', items: [{ status: '已完成', time: '15:00–15:30', course: '三返', equipment: null, ivProduct: null, room: null, bed: null, therapist: null, doctor: '某華', note: '報告看完了' }] }];
    const { sheet } = draw([page({ log })]);
    assert.ok([...sheet.cells.values()].includes('　已完成　15:00–15:30　三返　某華醫師　記一句：報告看完了'));
  });
});

describe('15 記一句也疊在那一個日期的最下面、塗淡色', () => {
  // 她 11/6：「附註也可以像是現在重複的「二返」記一句那樣記在這表格他那一個日期的最下方……如果有多個那就在往下」
  // 「in sis 那種做了什麼的就不用」「附註的那一個可以用舒服的顏色填滿，你就隨機填顏色就好」
  // 夾具：矩陣第 6～11 列（復能、健檢、EECP、ILIB、三返、心臟科評估），所以底下從第 12 列起
  const BELOW = 12;
  const fills = () => loadAppsScript().context.NOTE_FILLS;

  test('有附註的記一句也寫在那一個日期那一欄的矩陣底下，塗淡色；小黑三角照留', () => {
    const { sheet } = draw();
    const eecp = rowOf(sheet, 'EECP(60)');
    assert.equal(sheet.noteAt(`I${eecp}`), '他忘記了', '附註照留');
    assert.equal(sheet.at(`I${BELOW}`), '他忘記了');
    assert.ok(fills().includes(sheet.backgrounds.get(`I${BELOW}`)), String(sheet.backgrounds.get(`I${BELOW}`)));
    assert.equal(sheet.formats.hAlign.get(`I${BELOW}`), 'center');
  });

  test('同一欄：二返註記在最上面（照舊的字、不塗底），記一句接在底下；同一天好幾句照矩陣的先後往下疊', () => {
    const slotNotes = [
      { rowIndex: 3, label: 'EECP(60)', cells: [{ dateIndex: 1, text: 'EECP 那一句' }] },
      { rowIndex: 1, label: '復能-三選一(60)', cells: [{ dateIndex: 1, text: '復能那一句\n第二行' }] },
    ];
    const { sheet } = draw([page({ slotNotes })]);
    // 矩陣上面復能在 EECP 上面（做最多的在上面，issues/10）→ 疊的時候也是
    assert.deepEqual([0, 1, 2].map((k) => sheet.at(`H${BELOW + k}`)), ['9/15 二返(某明)', '復能那一句\n第二行', 'EECP 那一句']);
    assert.equal(sheet.backgrounds.get(`H${BELOW}`), undefined, '二返註記不塗底');
    assert.equal(sheet.formats.fontSize.get(`H${BELOW}`), 9);
    const [a, b] = [sheet.backgrounds.get(`H${BELOW + 1}`), sheet.backgrounds.get(`H${BELOW + 2}`)];
    assert.ok(fills().includes(a) && fills().includes(b) && a !== b, `上下兩格 ${a}／${b}`);
  });

  test('一欄一欄各自從矩陣底下開始疊（不是接在別欄後面）', () => {
    const { sheet } = draw();
    assert.equal(sheet.at(`H${BELOW}`), '9/15 二返(某明)');
    assert.equal(sheet.at(`H${BELOW + 1}`), '14:30 SIS、15:45 ILIB\n第二行');
    assert.equal(sheet.at(`I${BELOW}`), '他忘記了', 'I 欄沒有二返註記：從第一格開始');
  });

  test('沒有額度的段（體驗、n返）記的那一句也疊在它那一天底下；來訪紀錄那一行照舊', () => {
    const log = [
      { date: '2026-09-15', label: '9/15(二)', items: [
        { status: '已完成', time: '15:00–15:30', course: '三返', equipment: null, ivProduct: null, room: null, bed: null, therapist: null, doctor: '某華', note: '報告看完了' },
        { status: '已完成', time: '16:00–17:00', course: '心臟科評估(體驗)', equipment: null, ivProduct: null, room: null, bed: null, therapist: null, doctor: null, note: null },
      ] },
    ];
    const dates = ['2026-09-01', '2026-09-08', '2026-09-15', '2026-10-29'];
    const { sheet } = draw([page({ log, dates })]);
    // 9/15 是第 3 個日期（I 欄）：EECP 那一句（有額度、照矩陣）在上、三返那一句在下
    assert.deepEqual([0, 1].map((k) => sheet.at(`I${BELOW + k}`)), ['他忘記了', '報告看完了']);
    assert.equal(sheet.at(`I${BELOW + 2}`), '');
    assert.ok([...sheet.cells.values()].includes('　已完成　15:00–15:30　三返　某華醫師　記一句：報告看完了'));
  });

  test('器材不疊下去（照舊只在那一格的字裡）', () => {
    const { sheet } = draw();
    for (let r = BELOW; r < rowOf(sheet, '買過什麼'); r += 1) {
      for (const c of ['G', 'H', 'I', 'J']) assert.ok(!/^(IN|SIS)$/.test(String(sheet.at(`${c}${r}`))), `${c}${r}`);
    }
  });

  test('疊下去的每一格都是文字格式（一句「10/15」不會被認成日期）', () => {
    const slotNotes = [{ rowIndex: 3, label: 'EECP(60)', cells: [{ dateIndex: 2, text: '10/15' }] }];
    const { sheet } = draw([page({ slotNotes })]);
    assert.equal(sheet.at(`I${BELOW}`), '10/15');
    assert.equal(sheet.formats.numberFormat.get(`I${BELOW}`), '@');
    assert.equal(sheet.formats.numberFormat.get(`H${BELOW}`), '@', '二返註記那一格也是');
  });

  test('疊最深的那一欄有四格：「買過什麼」從它底下再空一列才開始，沒有蓋到', () => {
    const slotNotes = [0, 1, 3].map((rowIndex) => ({ rowIndex, label: String(rowIndex), cells: [{ dateIndex: 1, text: `第 ${rowIndex} 句` }] }));
    const { sheet } = draw([page({ slotNotes })]);
    assert.equal(sheet.at(`H${BELOW + 3}`), '第 3 句', '二返＋三句');
    assert.equal(rowOf(sheet, '買過什麼'), BELOW + 5);
  });

  test('只有二返註記、沒有記一句：位置跟以前一樣（底下一列、「買過什麼」再空一列）', () => {
    const { sheet } = draw([page({ slotNotes: [] })]);
    assert.equal(sheet.at(`H${BELOW}`), '9/15 二返(某明)');
    assert.equal(rowOf(sheet, '買過什麼'), BELOW + 2);
  });

  // 11/6 staging 匯出檔：18 句要折兩行以上的記一句，那一列照舊 26 高 —— 設過高度的列 Google 不會自己長高，只看得到第一行。
  // 照字數估高（同合併的那幾格，`rowHeightFor()`；日期欄 78 寬、記一句 10 號、二返註記 9 號），那一列取最高的
  test('疊下去的那一句要折行：那一列照字數長高；短的那幾列照舊 26', () => {
    const long = '十月十五他忘記了又加了醫美顧客會';
    const slotNotes = [
      { rowIndex: 3, label: 'EECP(60)', cells: [{ dateIndex: 2, text: long }] },
      { rowIndex: 1, label: '復能-三選一(60)', cells: [{ dateIndex: 3, text: '好' }] },
    ];
    const { app, sheet } = draw([page({ slotNotes, followupNotes: [] })]);
    const want = app.context.rowHeightFor(long, 78, 10);
    assert.ok(want > 26, String(want));
    assert.equal(sheet.at(`I${BELOW}`), long);
    assert.equal(sheet.rowHeights.get(BELOW), want, '那一列取最高的那一句');
    assert.equal(sheet.at(`J${BELOW + 1}`), '', '第二列沒有東西');
    assert.equal(sheet.rowHeights.get(BELOW + 1) ?? 26, 26);
  });

  test('二返註記那一格太長也算（9 號字）', () => {
    const text = '10/24 二返(某明)、11/30 三返(某華)';
    const { app, sheet } = draw([page({ slotNotes: [], followupNotes: [{ dateIndex: 1, text }] })]);
    assert.equal(sheet.rowHeights.get(BELOW), app.context.rowHeightFor(text, 78, 9));
  });

  // 同一份記一句輪流塗色時每一頁都從第一色開始 → 大部分頁只有一兩句，25 句裡 17 句淡紫（11/6 staging）。
  // 改成照「第幾個日期＋疊在第幾格」錯開：只有一句的那幾頁也不會全是同一色；上下、左右挨著的不同色
  test('顏色照日期那一欄錯開：一句一頁的也不會全是同一色；上下、左右挨著的不同色', () => {
    const { context } = loadAppsScript();
    const one = (dateIndex) => {
      const { sheet } = draw([page({ followupNotes: [], slotNotes: [{ rowIndex: 3, label: 'EECP(60)', cells: [{ dateIndex, text: '一句' }] }] })]);
      return sheet.backgrounds.get(`${'GHIJ'[dateIndex]}${BELOW}`);
    };
    assert.equal(new Set([0, 1, 2, 3].map(one)).size, 4, '四個日期各一句：四種顏色');
    const slotNotes = [
      { rowIndex: 1, label: '復能', cells: [{ dateIndex: 1, text: '上' }, { dateIndex: 2, text: '左右' }] },
      { rowIndex: 3, label: 'EECP', cells: [{ dateIndex: 1, text: '下' }] },
    ];
    const { sheet } = draw([page({ followupNotes: [], slotNotes })]);
    const at = (a1) => sheet.backgrounds.get(a1);
    assert.notEqual(at(`H${BELOW}`), at(`H${BELOW + 1}`), '上下');
    assert.notEqual(at(`H${BELOW}`), at(`I${BELOW}`), '左右');
    for (const a1 of [`H${BELOW}`, `H${BELOW + 1}`, `I${BELOW}`]) assert.ok(context.NOTE_FILLS.includes(at(a1)), a1);
  });

  test('NOTE_FILLS 避開狀態色（綠、黃、淡藍、灰、紅）與斑馬紋、白', () => {
    const { context } = loadAppsScript();
    const status = Object.values(context.COLOR).map((c) => String(c).toUpperCase());
    assert.ok(context.NOTE_FILLS.length >= 4);
    for (const c of context.NOTE_FILLS) assert.ok(!status.includes(c.toUpperCase()), c);
  });
});

describe('12 營養品一筆一行、備註一則一列上色', () => {
  // 購買日在最前面（她 11/5 晚：「營養品那一行，我想加上日期」，issues/14）；沒有購買日的不印那一段
  test('營養品一筆一行、最前面是購買日（沒有的不印）、沒給完的那一行淡黃；那張五欄的表不見了', () => {
    const { sheet } = draw();
    const top = rowOf(sheet, '營養品');
    assert.equal(sheet.at(`A${top + 1}`), '0901　營養品A　12,000 元・3 個月・魚油、益生菌　——　9/1　還差 益生菌');
    assert.equal(sheet.at(`A${top + 2}`), '營養品B　——　都給了');
    assert.equal(sheet.backgrounds.get(`A${top + 1}`), '#FFF2CC');
    assert.equal(sheet.backgrounds.get(`A${top + 2}`) ?? null, null);
    assert.ok(sheet.merges.includes(`A${top + 1}:M${top + 1}`), '整頁寬（issues/14）');
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

  test('一則一格之後，看起來像數字、日期、公式的那一則照字寫（文字格式）—— 新包、舊包、營養品、買過什麼、來訪紀錄都是', () => {
    // 段二審查：12 把每一則放進自己一格，Google 寫進去的那一刻把「0912345678」認成數字（掉前面的 0）、「5/20」認成日期、
    // 「=…」「+…」當公式 —— 同待辦的日期（08）。替身照字存，所以斷言的是那一格的格式
    const lines = ['0912345678', '5/20', '=1+1'];
    for (const over of [
      { noteLines: lines.map((text) => ({ text, color: 'grey' })) },
      { noteLines: undefined, notes: lines.join('\n') },
    ]) {
      const { sheet } = draw([page({ flags: [], ...over })]);
      const top = rowOf(sheet, '備註');
      assert.deepEqual([1, 2, 3].map((i) => [sheet.at(`A${top + i}`), sheet.formats.numberFormat.get(`A${top + i}`)]),
        lines.map((t) => [t, '@']));
    }
    const { sheet } = draw();
    for (const title of ['買過什麼', '營養品', '來訪紀錄']) {
      assert.equal(sheet.formats.numberFormat.get(`A${rowOf(sheet, title) + 1}`), '@', title);
    }
  });

  test('MARK_TINT 是 app 那六色（MARK_COLORS ＋ tokens.css 淺色主題的 --mark-*）跟白色 15:85 混出來的 —— 那六色改了這裡會紅', () => {
    // `.gs` 讀不到 tokens.css，只好另寫一份（CLAUDE.md「試算表的 SYNC_FORMAT」那一列）；這一條釘著兩邊（段二審查）
    const { app } = draw();
    const tint = app.context.MARK_TINT;
    const css = readFileSync(new URL('../public/css/tokens.css', import.meta.url), 'utf8');
    const light = css.slice(0, css.indexOf(":root[data-theme='dark']"));
    const mix = (hex) => `#${[1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * 0.15 + 255 * 0.85)
      .toString(16).toUpperCase().padStart(2, '0')).join('')}`;
    assert.deepEqual(Object.keys(tint).sort(), MARK_COLORS.map((c) => c.id).sort());
    for (const c of MARK_COLORS) {
      const hex = new RegExp(`${c.token}:\\s*(#[0-9a-fA-F]{6})`).exec(light)?.[1];
      assert.ok(hex, `tokens.css 淺色主題沒有 ${c.token}`);
      assert.equal(tint[c.id], mix(hex), c.id);
    }
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

  test('syncBundle() 的 products：購買日寫成「買過什麼」那一種（0901）；沒有購買日的是 null', () => {
    const product = (id, purchasedAt) => ({
      id, type: 'product', label: `營養品${id}`, purchasedAt, totalQty: 3, amount: 1000, items: [{ name: '魚油' }],
    });
    const b = syncBundle({
      customers: [{ id: 'c1', name: '客戶A' }],
      entitlementsBy: { c1: [product('A', '2026-09-01'), product('B', null)] },
      visitsBy: {}, today: '2026-11-05',
    });
    assert.deepEqual(b.sheets[0].products.map((p) => [p.label, p.purchasedAt]), [['營養品A', '0901'], ['營養品B', null]]);
  });

  test('syncBundle() 的 noteLines：只有舊的 notes（沒有 marks）的客戶照行拆、灰色', () => {
    const b = syncBundle({ customers: [{ id: 'c1', name: '客戶A', notes: '一\n二' }], entitlementsBy: {}, visitsBy: {}, today: '2026-11-05' });
    assert.deepEqual(b.sheets[0].noteLines, [{ text: '一', color: 'grey' }, { text: '二', color: 'grey' }]);
  });
});
