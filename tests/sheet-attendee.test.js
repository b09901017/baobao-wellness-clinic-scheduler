// 試算表：家人來的那一格，附註帶「先生來」（family-merge-round 02，ADR-0183）。
//
// kickoff（11/9）她照建議：太太那一頁那一天照樣打勾，那一格的附註帶「先生來」。
// 走既有的附註管道（`slotNoteCells()`、來訪紀錄那一行的 `note`），`.gs` 不用改、不升 `SYNC_FORMAT`。
// 同一天同一筆額度是同一格（`✓2`、附註換行接）→ 看的是「先生那一行有前綴」，不是整格。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { slotNoteCells, syncBundle, SYNC_FORMAT } from '../public/js/domain/sheetReport.js';

const DATES = ['2026-11-12'];
const ent = { id: 'e1', type: 'single', courseId: 'c-rec', label: '復健門診(60)', totalQty: 10 };

const slot = (o = {}) => ({
  courseId: 'c-rec', courseName: '復健門診', entitlementId: 'e1', startsAt: '14:30', endsAt: '15:30', status: 'done', ...o,
});
const day = (slots, o = {}) => ({
  id: 'v1', customerId: 'c1', customerName: '客戶A', date: DATES[0], status: 'done', slots, ...o,
});

describe('附註那一格（slotNoteCells）', () => {
  test('只有誰來的、沒有記一句：照樣出附註「先生來」', () => {
    assert.deepEqual(slotNoteCells(ent, [day([slot({ attendee: '先生' })])], DATES), [{ dateIndex: 0, text: '先生來' }]);
  });

  test('誰來的＋記一句：兩個都在、一行', () => {
    assert.deepEqual(
      slotNoteCells(ent, [day([slot({ attendee: '先生', note: '下次改週五' })])], DATES),
      [{ dateIndex: 0, text: '先生來：下次改週五' }],
    );
  });

  test('太太本人一段＋先生一段：先生那一行有前綴，太太那一行不帶', () => {
    const v = day([slot({ note: '腰比較緊' }), slot({ attendee: '先生', startsAt: '15:30', endsAt: '16:30' })]);
    assert.deepEqual(slotNoteCells(ent, [v], DATES), [{ dateIndex: 0, text: '腰比較緊\n先生來' }]);
  });

  test('舊資料那一句在整筆身上：只印一次，先生那一行只寫先生來', () => {
    const v = day([slot(), slot({ attendee: '先生', startsAt: '15:30', endsAt: '16:30' })], { note: '她說想換一台' });
    assert.deepEqual(slotNoteCells(ent, [v], DATES), [{ dateIndex: 0, text: '她說想換一台\n先生來' }]);
  });

  test('先生那一段取消了：不印', () => {
    assert.deepEqual(slotNoteCells(ent, [day([slot({ attendee: '先生', status: 'cancelled' })])], DATES), []);
  });

  test('舊資料（沒有誰來的）：一個字都不變', () => {
    assert.deepEqual(slotNoteCells(ent, [day([slot({ note: '女兒代打' })])], DATES), [{ dateIndex: 0, text: '女兒代打' }]);
    assert.deepEqual(slotNoteCells(ent, [day([slot()])], DATES), []);
  });
});

describe('整頁（syncBundle）', () => {
  const COURSES = [
    { id: 'c-rec', name: '復健門診' },
    { id: 'c-fm', name: '功醫門診', uncounted: true },
  ];
  const bundle = (slots) => syncBundle({
    customers: [{ id: 'c1', name: '客戶A' }],
    entitlementsBy: { c1: [ent] },
    visitsBy: { c1: [day(slots)] },
    today: '2026-11-20',
    master: { courses: COURSES, equipment: [], ivProducts: [], rooms: [], staff: [] },
    generatedAt: '2026-11-20T00:00:00Z',
  });

  test('先生那一段照樣打勾在太太那一頁、那一格附註看得到', () => {
    const [sheet] = bundle([slot({ attendee: '先生' })]).sheets;
    assert.equal(sheet.rows[0].label, '復健門診(60)');
    assert.equal(sheet.rows[0].marks[0], '✓', '照樣打勾、算客戶A的');
    assert.deepEqual(sheet.slotNotes, [{ rowIndex: 0, label: '復健門診(60)', cells: [{ dateIndex: 0, text: '先生來' }] }]);
  });

  test('沒有額度的段（體驗）：來訪紀錄那一行的 note 帶先生來', () => {
    const [sheet] = bundle([slot({ courseId: 'c-fm', courseName: '功醫門診', entitlementId: null, attendee: '先生' })]).sheets;
    const item = sheet.log[0].items[0];
    assert.equal(item.note, '先生來');
  });

  test('來訪紀錄那一行的課程後面也寫 (先生來)（跟日曆同一種名字）', () => {
    const [sheet] = bundle([slot({ attendee: '先生' })]).sheets;
    assert.equal(sheet.log[0].items[0].course, '復健門診(先生來)');
  });

  test('指紋跟著變（不然推送以為沒變、不重畫）', () => {
    const a = bundle([slot()]).sheets[0].fingerprint;
    const b = bundle([slot({ attendee: '先生' })]).sheets[0].fingerprint;
    assert.notEqual(a, b);
  });

  test('舊資料（沒有誰來的）：整頁一個字都不變', () => {
    const plain = bundle([slot({ note: '女兒代打' })]).sheets[0];
    const blank = bundle([slot({ note: '女兒代打', attendee: '' })]).sheets[0];
    assert.deepEqual(blank, plain);
  });

  test('格式沒升（.gs 不用重貼）', () => {
    assert.equal(SYNC_FORMAT, 8);
  });
});
