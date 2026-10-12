// 拍 Abovee 左右兩半：左半張切到一半的「診間」欄，不可以蓋掉右半張完整的（prelaunch-fixes-2026-10-08/13）。
//
// 「診間」那一欄剛好在兩半的交界，左半張常會切到一半。10/5 那次考試 AI 把被切掉的字照抄成「治療」——
// 以前的規則是「左半那一格空著才用右半的」，所以右半完整的「治療室5」被丟掉。點滴與 ILIB 還能從服務資源推回診間，
// EECP 的服務資源寫的是機器（EECP1），推不回來 → 那幾段存進去沒有診間。
//
// **這一支有沒有任何一條路，讓比較短的那一格蓋掉比較長的？** —— 沒有（被切掉的一定比完整的短，兩個方向都對）。
// 例子一律假名、1234。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { mergeAboveePhotos, readAbovee } from '../public/js/domain/aboveeImport.js';
import { ABOVEE_COLUMNS, TRANSCRIPT_FIELDS } from '../public/js/domain/transcripts.js';
import { aboveeList } from '../functions/transcripts/aboveeList.js';
import { SEED } from '../public/js/domain/seed.js';

const LEFT = ['預約狀態', '預約日期', '預約時段', '姓名', '病歷號', '課程'];
const RIGHT = ['診間', '服務資源', '取消原因'];
const ROW = ['確認前往', '2026-10-20', '14:00 - 15:15', '王小明', '00001234', 'EECP60'];
const halves = (leftExtra, right, { leftCols = ['診間'], rightCols = RIGHT } = {}) => mergeAboveePhotos([
  { readable: true, columns: [...LEFT, ...leftCols], rows: [[...ROW, ...leftExtra]] },
  { readable: true, columns: rightCols, rows: [right] },
]);

describe('左右兩半：診間、服務資源、取消原因兩邊都有字時取比較長的', () => {
  test('左半「治療」（被切掉）＋右半「治療室5」→ 右半', () => {
    const { rows, pairing } = halves(['治療'], ['治療室5', 'EECP1', '']);
    assert.equal(pairing, 'halves');
    assert.equal(rows[0].room, '治療室5');
  });

  test('鏡像：右半只有後半個字「室5」＋左半完整 → 左半', () => {
    assert.equal(halves(['治療室5'], ['室5', 'EECP1', '']).rows[0].room, '治療室5');
  });

  test('一樣長才取右半（那幾欄本來就在右半）', () => {
    assert.equal(halves(['治療室8'], ['治療室5', 'EECP1', '']).rows[0].room, '治療室5');
  });

  test('只有一邊有字就用那一邊', () => {
    assert.equal(halves(['治療室5'], ['', 'EECP1', '']).rows[0].room, '治療室5');
    assert.equal(halves([''], ['治療室5', 'EECP1', '']).rows[0].room, '治療室5');
  });

  test('服務資源與取消原因同一條', () => {
    const { rows } = halves(['EEC', '客人'], ['', 'EECP1', '客人有事'], { leftCols: ['服務資源', '取消原因'] });
    assert.deepEqual([rows[0].resource, rows[0].cancelReason], ['EECP1', '客人有事']);
  });

  test('「合併扣課」照舊：左半有字的不會被右半蓋掉，左半空著才補', () => {
    const merged = (l, r) => halves([l], [r, ''], { leftCols: ['合併扣課'], rightCols: ['合併扣課', '診間'] }).rows[0].merged;
    assert.equal(merged('是', '否否否'), '是');
    assert.equal(merged('', '是'), '是');
    assert.equal(merged('是', ''), '是');
  });
});

describe('存進去有診間（10/5 考試那兩列的形狀：EECP、服務資源是機器）', () => {
  const master = { courses: SEED.courses, equipment: SEED.equipment, rooms: SEED.rooms, staff: SEED.staff, ivProducts: SEED.ivProducts };
  const ctx = {
    customers: [{ id: 'c1', name: '王小明', marks: [{ text: '病歷號 1234', color: 'grey' }] }],
    entitlementsBy: { c1: [{ id: 'E', type: 'single', label: 'EECP', courseId: 'course-eecp', totalQty: 40 }] },
    visitsBy: {}, master, today: '2026-10-08',
  };
  const read = (leftRoom, rightRoom) => readAbovee([
    { readable: true, columns: [...LEFT, '診間'], rows: [[...ROW, leftRoom]] },
    { readable: true, columns: RIGHT, rows: [[rightRoom, 'EECP1', '']] },
  ], ctx).items[0];

  test('左半「治療」＋右半完整 → 認得那一間', () => {
    const item = read('治療', '治療室5');
    assert.equal(item.row.room, '治療室5');
    assert.equal(item.roomId, 'room-t5');
  });

  test('兩邊都認不得（都被切掉）：那一格空著，照片上的原字留著讓她對', () => {
    const item = read('治療', '治');
    assert.equal(item.roomId, null);
    assert.equal(item.row.room, '治療');
  });
});

describe('兩張都有姓名（左右範圍不同的拍法）也是取比較長的', () => {
  const named = (cols, cells) => ({ readable: true, columns: [...LEFT, ...cols], rows: [[...ROW, ...cells]] });

  test('第一張的診間被切掉、第二張完整 → 第二張的', () => {
    const { rows, pairing } = mergeAboveePhotos([named(['診間'], ['治療']), named(['診間', '服務資源'], ['治療室5', 'EECP1'])]);
    assert.equal(pairing, 'pages');
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].room, rows[0].resource], ['治療室5', 'EECP1']);
  });

  test('一樣長、或第一張比較長：留第一張的', () => {
    assert.equal(mergeAboveePhotos([named(['診間'], ['治療室5']), named(['診間'], ['治療室8'])]).rows[0].room, '治療室5');
    assert.equal(mergeAboveePhotos([named(['診間'], ['治療室5']), named(['診間'], ['室5'])]).rows[0].room, '治療室5');
  });

  test('別的欄（課程、姓名）照舊留第一張的，不比長短', () => {
    const a = { readable: true, columns: LEFT, rows: [ROW] };
    const b = { readable: true, columns: LEFT, rows: [ROW.map((c, i) => (i === 3 ? '王小明明' : c))] };
    assert.equal(mergeAboveePhotos([a, b]).rows[0].name, '王小明');
  });
});

describe('提示詞：被切掉一半的欄不要抄；格式一格都沒有變', () => {
  test('提示詞講了', () => {
    assert.match(aboveeList.prompt, /切掉/);
    assert.match(aboveeList.prompt, /不要抄/);
  });

  test('欄位（schema）沒有變：還是那十欄、那五格（ADR-0099：不長出新欄位）', () => {
    assert.deepEqual([...ABOVEE_COLUMNS], ['預約狀態', '預約日期', '預約時段', '姓名', '病歷號', '課程', '合併扣課', '診間', '服務資源', '取消原因']);
    assert.deepEqual(Object.keys(aboveeList.schema.properties).sort(), ['columns', 'dateFromText', 'dateToText', 'pageText', 'rows']);
    assert.deepEqual(Object.keys(TRANSCRIPT_FIELDS.aboveeList).sort(), ['columns', 'dateFromText', 'dateToText', 'pageText', 'rows']);
  });

  test('提示詞只有 Function 那一份有（domain 那一份只有欄位）', () => {
    const src = readFileSync(new URL('../public/js/domain/transcripts.js', import.meta.url), 'utf8');
    assert.ok(!src.includes('prompt'));
  });
});
