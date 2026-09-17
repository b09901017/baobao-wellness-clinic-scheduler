// 療程單的存放與搜尋（issue 14，ADR-0105）。`domain/treatmentSheets.js`。
//
// **這一支有沒有任何一條路，讓 AI 決定「這是同一張」？** —— 沒有：抄字格式裡沒有那一格
// （ADR-0099），`sameSheet()` 只比她確認過的課程與前幾列的日期、勾選。
//
// 例子一律假名、1234。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  MAX_PHOTO_BYTES, SAME_SHEET_ROWS, fillYears, headerYear, lastSignedDate, matchSheet, parseRowDate,
  readSheet, rowsAdded, sameSheet, sheetCourses, sheetFields, validateSheet,
} from '../public/js/domain/treatmentSheets.js';
import { SEED } from '../public/js/domain/seed.js';
import { fromRoot } from './helpers/paths.js';

const MASTER = { courses: SEED.courses, equipment: SEED.equipment, ivProducts: SEED.ivProducts };
const row = (date, over = {}) => ({ seq: '', date, signed: true, ...over });

describe('年份怎麼補', () => {
  test('民國年的表頭 → 西元', () => {
    assert.equal(headerYear('115.5.14'), 2026);
    assert.equal(headerYear('115/5/14'), 2026);
    assert.equal(headerYear('2026-05-14'), 2026);
    assert.equal(headerYear(''), null);
    assert.equal(headerYear('五月'), null);
  });

  test('列上的日期：有年沒年都讀得出來，讀不出來回 null', () => {
    assert.deepEqual(parseRowDate('7/28'), { year: null, month: 7, day: 28 });
    assert.deepEqual(parseRowDate('115/6/8'), { year: 2026, month: 6, day: 8 });
    assert.deepEqual(parseRowDate('115.6.8'), { year: 2026, month: 6, day: 8 });
    assert.deepEqual(parseRowDate(' 7 / 8 '), { year: null, month: 7, day: 8 });
    assert.equal(parseRowDate('13/2'), null);
    assert.equal(parseRowDate('IN'), null);
    assert.equal(parseRowDate(''), null);
  });

  test('表頭 115.5.14，列 11/20、12/3、1/8 → 跨年那一列 +1', () => {
    const out = fillYears([row('11/20'), row('12/3'), row('1/8')], { headerDate: '115.5.14' });
    assert.deepEqual(out.map((r) => r.date), ['2026-11-20', '2026-12-03', '2027-01-08']);
    assert.ok(out.every((r) => r.yearFrom === 'header'));
  });

  test('列上寫了年就用那一列的（跟表頭同一年或下一年）', () => {
    const out = fillYears([row('115/6/30'), row('116/1/3'), row('1/10')], { headerDate: '115.5.14' });
    assert.deepEqual(out.map((r) => r.date), ['2026-06-30', '2027-01-03', '2027-01-10']);
    assert.equal(out[0].yearFrom, 'row');
  });

  test('考試讀錯的年份（107、113）離表頭一年以上 → 不信，照表頭補', () => {
    const out = fillYears([row('107/7/8'), row('113/7/15')], { headerDate: '115.5.14' });
    assert.deepEqual(out.map((r) => r.date), ['2026-07-08', '2026-07-15']);
    assert.ok(out.every((r) => r.yearFrom === 'header'));
  });

  test('沒有表頭 → 以拍照那一天往回推（最後一列不會晚於拍照那天）', () => {
    const out = fillYears([row('11/20'), row('12/3'), row('1/8'), row('3/2')], { photoDate: '2027-03-10' });
    assert.deepEqual(out.map((r) => r.date), ['2026-11-20', '2026-12-03', '2027-01-08', '2027-03-02']);
    assert.ok(out.every((r) => r.yearFrom === 'photo'));
  });

  test('補不出來 → 那一列空著；日期不存在（2/30）也空著', () => {
    const out = fillYears([row('看不清楚'), row('2/30'), row('3/1')], { headerDate: '115.1.2' });
    assert.deepEqual(out.map((r) => r.date), [null, null, '2026-03-01']);
    const none = fillYears([row('7/28')], {});
    assert.equal(none[0].date, null);
  });
});

describe('同一張還是新的一張', () => {
  const dates = ['2026-07-08', '2026-07-15', '2026-07-31', '2026-08-03', '2026-08-11', '2026-08-18', '2026-08-25', '2026-09-01'];
  const sheet = (n, over = {}) => ({
    customerId: 'c-wang', courseIds: ['course-recovery'],
    rows: dates.slice(0, n).map((d, i) => ({ seq: String(i + 1), date: d, signed: true, equipmentIds: ['eq-indiba'] })),
    ...over,
  });

  test('既有 5 列、新的 8 列而且前 5 列一樣 → 同一張', () => {
    assert.equal(sameSheet(sheet(5), sheet(8)), true);
    assert.equal(rowsAdded(sheet(5), sheet(8)), 3);
  });

  test('新的前 5 列有一列日期不一樣 → 新的一張', () => {
    const incoming = sheet(8);
    incoming.rows[2] = { ...incoming.rows[2], date: '2026-07-30' };
    assert.equal(sameSheet(sheet(5), incoming), false);
  });

  test('勾的器材不一樣也算不一樣', () => {
    const incoming = sheet(8);
    incoming.rows[0] = { ...incoming.rows[0], equipmentIds: ['eq-sis'] };
    assert.equal(sameSheet(sheet(5), incoming), false);
  });

  test(`只比前 ${SAME_SHEET_ROWS} 列：既有 7 列、第 6 列讀得不一樣照樣是同一張`, () => {
    const incoming = sheet(8);
    incoming.rows[5] = { ...incoming.rows[5], date: '2026-08-08' };
    assert.equal(sameSheet(sheet(7), incoming), true);
  });

  test('別的客戶、別的課程、新的比既有的還短 → 新的一張', () => {
    assert.equal(sameSheet(sheet(5), sheet(8, { customerId: 'c-lee' })), false);
    assert.equal(sameSheet(sheet(5), sheet(8, { courseIds: ['course-iv-laser'] })), false);
    assert.equal(sameSheet(sheet(5), sheet(3)), false);
  });

  test('既有的一列都沒有 → 新的一張（拿不準的時候不刪任何東西）', () => {
    assert.equal(sameSheet(sheet(0), sheet(3)), false);
  });

  test('營養點滴兩款各一張：品項不一樣就不是同一張', () => {
    const a = sheet(3, { courseIds: ['course-iv-drip'], ivProductIds: ['iv-snow'] });
    const b = sheet(5, { courseIds: ['course-iv-drip'], ivProductIds: ['iv-liver'] });
    assert.equal(sameSheet(a, b), false);
  });

  test('matchSheet 從那一位的療程單裡挑出同一張；已刪除的不算', () => {
    const old = { id: 's1', ...sheet(5) };
    const other = { id: 's2', ...sheet(2, { courseIds: ['course-eecp'] }) };
    assert.equal(matchSheet(sheet(8), [other, old])?.id, 's1');
    assert.equal(matchSheet(sheet(8), [other, { ...old, deletedAt: 'x' }]), null);
  });
});

describe('照片上的字 → 一張療程單', () => {
  const chart = (no) => [{ text: `病歷號 ${no}`, color: 'grey' }];
  const CUSTOMERS = [
    { id: 'c-wang', name: '王小明', marks: chart('1234') },
    { id: 'c-lee', name: '李小華', marks: [] },
    { id: 'c-lee2', name: '李小華', marks: [] },
  ];

  test('課程：單子的名字認得出課程；勾的器材推得出課程（ADR-0075）', () => {
    assert.deepEqual(sheetCourses({ title: 'EECP 體外反搏療程單' }, MASTER).courseIds, ['course-eecp']);
    assert.deepEqual(sheetCourses({ title: '筋骨強身', courseText: '經皮靜脈雷射課程 60min' }, MASTER).courseIds, ['course-iv-laser']);
    // 物理賦能是分類不是課程（CONTEXT）—— 靠每一列勾的器材
    assert.deepEqual(sheetCourses({
      title: '筋骨強身', courseText: '物理賦能課程（含徒手治療）60min',
      rows: [{ date: '7/8', signed: true, ticked: ['Indiba'] }],
    }, MASTER).courseIds, ['course-recovery']);
    // 四選一：復能那一張上有一列手寫 ILIB → 兩個課程
    assert.deepEqual(sheetCourses({
      title: '護理/復能療程單',
      rows: [{ date: '6/8', signed: true, itemText: 'IN' }, { date: '6/18', signed: true, itemText: 'ILIB' }],
    }, MASTER).courseIds.sort(), ['course-iv-laser', 'course-recovery']);
  });

  test('營養點滴的品項從單子的名字認', () => {
    const got = sheetCourses({ title: '營養點滴．雪顏亮彩' }, MASTER);
    assert.deepEqual(got.courseIds, ['course-iv-drip']);
    assert.deepEqual(got.ivProductIds, ['iv-snow']);
  });

  test('認不出來 → 空的，不猜', () => {
    assert.deepEqual(sheetCourses({ title: '療程單' }, MASTER).courseIds, []);
  });

  test('readSheet：認人走 identifyCustomer()、年份補好、同一張由 sameSheet() 算', () => {
    const existing = [{
      id: 's-old', customerId: 'c-wang', courseIds: ['course-eecp'], ivProductIds: [],
      rows: [
        { seq: '1', date: '2026-07-28', signed: true, equipmentIds: [] },
        { seq: '2', date: '2026-07-30', signed: true, equipmentIds: [] },
      ],
    }];
    const draft = readSheet({
      readable: true, title: 'EECP 體外反搏療程單', headerDate: '115.5.14',
      customerName: '王小明', customerNumber: '00001234',
      rows: [
        { seq: '1', date: '7/28', signed: true }, { seq: '2', date: '7/30', signed: true },
        { seq: '3', date: '8/4', signed: true }, { seq: '4', date: '8/6', signed: false },
      ],
    }, { customers: CUSTOMERS, master: MASTER, sheets: existing, today: '2026-09-17' });

    assert.equal(draft.who.how, 'both');
    assert.equal(draft.customerId, 'c-wang');
    assert.deepEqual(draft.courseIds, ['course-eecp']);
    assert.deepEqual(draft.rows.map((r) => r.date), ['2026-07-28', '2026-07-30', '2026-08-04', '2026-08-06']);
    assert.equal(draft.rows[0].dateText, '7/28');
    assert.equal(draft.replaces, 's-old');
    assert.equal(draft.suggested, 's-old');
  });

  test('readSheet：同名兩位 → 不挑人、也不猜同一張', () => {
    const draft = readSheet({
      readable: true, title: 'EECP', customerName: '李小華', rows: [{ date: '7/28', signed: true }],
    }, { customers: CUSTOMERS, master: MASTER, sheets: [], today: '2026-09-17' });
    assert.equal(draft.who.how, 'ambiguous');
    assert.equal(draft.customerId, null);
    assert.equal(draft.replaces, null);
  });

  test('存檔前要擋的：沒有人、沒有課程、有一列沒有日期', () => {
    const ok = {
      customerId: 'c-wang', courseIds: ['course-eecp'], rows: [{ date: '2026-07-28', signed: true, equipmentIds: [] }],
    };
    assert.deepEqual(validateSheet(ok), []);
    assert.equal(validateSheet({ ...ok, customerId: null }).length, 1);
    assert.equal(validateSheet({ ...ok, courseIds: [] }).length, 1);
    assert.match(validateSheet({ ...ok, rows: [{ seq: '3', date: null, signed: true }] })[0], /第 3 列/);
  });

  test('寫進資料庫的那一份：只有她確認過的，沒有照片上的名字', () => {
    const data = sheetFields({
      customerId: 'c-wang', courseIds: ['course-eecp'], ivProductIds: [], courseText: 'EECP 體外反搏療程單',
      headerDate: '2026-05-14',
      rows: [{ seq: '1', date: '2026-07-28', dateText: '7/28', signed: true, equipmentIds: [], yearFrom: 'header' }],
    }, { customers: CUSTOMERS, master: MASTER });
    assert.equal(data.customerName, '王小明');
    assert.equal(data.courseName, 'EECP');
    assert.deepEqual(data.rows, [{ seq: '1', date: '2026-07-28', signed: true, equipmentIds: [] }]);
    assert.ok(!('who' in data) && !JSON.stringify(data).includes('dateText'));
  });

  test('最後一列有簽名的日期', () => {
    assert.equal(lastSignedDate({ rows: [row('2026-07-01'), row('2026-08-25'), row('2026-09-01', { signed: false })] }), '2026-08-25');
    assert.equal(lastSignedDate({ rows: [] }), null);
  });
});

test('照片大小上限：storage.rules 與 domain 講同一個數字', () => {
  const rules = readFileSync(fromRoot('storage.rules'), 'utf8');
  assert.ok(rules.includes(`request.resource.size <= ${MAX_PHOTO_BYTES}`),
    `storage.rules 要寫 request.resource.size <= ${MAX_PHOTO_BYTES}`);
  assert.ok(rules.includes("request.resource.contentType == 'image/jpeg'"));
});
