// 試算表報表。SPEC 第 4.8 節。
//
// 這一支盯的是「報表不能騙人」：次數要跟客戶詳情頁算出來的一樣，
// 勾選格要對得上日期，而且逗號、引號、換行不可以把表格拆散 ——
// 錯位的報表比沒有報表更糟，因為她會照著它去對帳。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  customerReport, overviewReport, toTSV, toCSV, READONLY_NOTICE,
} from '../public/js/domain/sheetReport.js';

const TODAY = '2026-09-18';

const customer = (over = {}) => ({
  id: 'c1', name: '客戶一', source: '0522 顧客會-8',
  membershipExpiresAt: '2027-05-21', flags: ['體內金屬'], ...over,
});

const ent = (over = {}) => ({
  id: 'e1', label: '復能', totalQty: 12, doneCount: 0, bookedCount: 0, ...over,
});

const visit = (over = {}) => ({
  id: 'v1', customerId: 'c1', date: '2026-09-10', status: 'done',
  slots: [{ entitlementId: 'e1', courseName: '復能' }], ...over,
});

const header = (rows) => rows.find((r) => r[0] === '療程項目');
const rowOf = (rows, label) => rows.find((r) => r[0] === label);

describe('一位客戶一張表', () => {
  test('表頭有那句「請勿手動編輯」（SPEC 第 4.8 節）', () => {
    const { rows } = customerReport({ customer: customer(), entitlements: [ent()] });
    assert.equal(rows[0][0], READONLY_NOTICE);
  });

  test('基本資料、三段式次數與日期欄都在', () => {
    const { name, rows } = customerReport({
      customer: customer(),
      entitlements: [ent()],
      visits: [visit(), visit({ id: 'v2', date: '2026-09-24', status: 'confirmed' })],
      generatedAt: '2026-09-18 10:00',
    });

    assert.equal(name, '客戶一');
    assert.deepEqual(rowOf(rows, '購買通路'), ['購買通路', '0522 顧客會-8']);
    assert.deepEqual(rowOf(rows, '永久限制'), ['永久限制', '體內金屬']);

    assert.deepEqual(header(rows), [
      '療程項目', '應有', '已完成', '已排未上', '剩餘', '9/10(四)', '9/24(四)',
    ]);
    // 一次 done、一次 confirmed → 12 - 1 - 1 = 10
    assert.deepEqual(rowOf(rows, '復能'), ['復能', '12', '1', '1', '10', '✓', '✓']);
  });

  test('同一天用兩次要看得出來，不是一個勾了事', () => {
    const { rows } = customerReport({
      customer: customer(),
      entitlements: [ent()],
      visits: [visit({ slots: [{ entitlementId: 'e1' }, { entitlementId: 'e1' }] })],
    });
    assert.equal(rowOf(rows, '復能').at(-1), '✓2');
  });

  test('次數用現算的，計數欄位歪掉不會被抄進報表（ADR-0004）', () => {
    const { rows } = customerReport({
      customer: customer(),
      entitlements: [ent({ doneCount: 99, bookedCount: 99 })],
      visits: [visit()],
    });
    assert.deepEqual(rowOf(rows, '復能').slice(1, 5), ['12', '1', '0', '11']);
  });

  test('取消、刪除的來訪不佔日期欄也不算次數', () => {
    const { rows } = customerReport({
      customer: customer(),
      entitlements: [ent()],
      visits: [
        visit({ id: 'v1', status: 'cancelled' }),
        visit({ id: 'v2', date: '2026-09-11', deletedAt: 'x' }),
      ],
    });
    assert.deepEqual(header(rows), ['療程項目', '應有', '已完成', '已排未上', '剩餘']);
    assert.deepEqual(rowOf(rows, '復能'), ['復能', '12', '0', '0', '12']);
  });

  test('已刪除的額度不列，完全沒有額度時講一句話而不是留白', () => {
    const { rows } = customerReport({
      customer: customer(),
      entitlements: [ent({ deletedAt: 'x' })],
    });
    assert.equal(rowOf(rows, '復能'), undefined);
    assert.ok(rows.some((r) => r[0] === '（還沒有額度）'));
  });

  test('別人的來訪不會被算進來（勾選格只認 entitlementId）', () => {
    const { rows } = customerReport({
      customer: customer(),
      entitlements: [ent()],
      visits: [visit({ slots: [{ entitlementId: 'e-other' }] })],
    });
    assert.deepEqual(rowOf(rows, '復能').slice(1, 5), ['12', '0', '0', '12']);
    assert.equal(rowOf(rows, '復能').at(-1), '');
  });
});

describe('總表', () => {
  const args = {
    customers: [customer({ id: 'c2', name: '客戶二' }), customer()],
    entitlementsBy: { c1: [ent()], c2: [ent({ id: 'e2', totalQty: 5 })] },
    visitsBy: {
      c1: [visit(), visit({ id: 'v2', date: '2026-09-24', status: 'confirmed' })],
      c2: [],
    },
    today: TODAY,
  };

  test('一位客戶一列，依姓名排序，合計是各池加起來', () => {
    const { rows } = overviewReport(args);
    const body = rows.slice(rows.findIndex((r) => r[0] === '姓名') + 1);

    assert.deepEqual(body.map((r) => r[0]), ['客戶一', '客戶二']);
    assert.deepEqual(body[0].slice(3, 7), ['12', '1', '1', '10']);
  });

  test('上次來訪與下次預約分得清楚', () => {
    const { rows } = overviewReport(args);
    const row = rows.find((r) => r[0] === '客戶一');
    assert.equal(row[7], '2026-09-10'); // 上次
    assert.equal(row[8], '2026-09-24'); // 下次
  });

  test('沒有來訪就留空，不要印 undefined', () => {
    const { rows } = overviewReport(args);
    const row = rows.find((r) => r[0] === '客戶二');
    assert.equal(row[7], '');
    assert.equal(row[8], '');
  });

  test('已刪除的客戶不列', () => {
    const { rows } = overviewReport({ ...args, customers: [customer({ deletedAt: 'x' })] });
    assert.equal(rows.find((r) => r[0] === '客戶一'), undefined);
  });
});

describe('貼上與下載的格式', () => {
  const report = { rows: [['a', 'b'], ['c', 'd']] };

  test('TSV 用定位分欄、換行分列', () => {
    assert.equal(toTSV(report), 'a\tb\nc\td');
  });

  test('儲存格裡的定位與換行換成空白，不然表格會錯位', () => {
    assert.equal(toTSV({ rows: [['前\t後', '上\n下']] }), '前 後\t上 下');
  });

  test('CSV 把逗號、引號、換行包起來，引號要跳脫', () => {
    assert.equal(toCSV({ rows: [['a,b', 'say "hi"', 'x\ny', 'plain']] }),
      '"a,b","say ""hi""","x\ny",plain');
  });

  test('空儲存格是空字串，不是 undefined 或 null', () => {
    assert.equal(toTSV({ rows: [[null, undefined, '']] }), '\t\t');
    assert.equal(toCSV({ rows: [[null, undefined, '']] }), ',,');
  });

  test('列數不同長也不會爆', () => {
    assert.equal(toTSV({ rows: [['a'], ['b', 'c']] }), 'a\nb\tc');
  });
});
