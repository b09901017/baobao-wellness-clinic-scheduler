// 合併扣課：兩列記成一段 60 分、扣一次、記一句寫出來（abovee-and-master-2026-10-05/09，ADR-0123）。
//
// 她 2026-10-05：
// > 我選一段 60 分並且「記一句」自動寫「合併扣課：IN 30＋SIS 30」，試算表也要呈現合併扣課
// > 拍照時要有寫說"合併扣課"或是可以多問一句
//
// **這一支有沒有任何一條路，讓兩列半小時被記成兩段、扣兩次？** —— 照片上兩列都勾了、或沒有那一欄但長得像一對，
// 一律合成一段。**反過來，有沒有一條路讓不是一對的兩列被合起來？** —— 課程不一樣、治療師不一樣、
// 接不上、各扣各的 30 分額度，都不合。例子一律假名。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  aboveeEnd, mergedLine, mergedMark, mergedNotices, needsAttention, newRowSay, planAbovee, readAbovee, summarizeAbovee,
} from '../public/js/domain/aboveeImport.js';
import { aboveeConsequences } from '../public/js/domain/consequences.js';
import { slotNoteCells } from '../public/js/domain/sheetReport.js';
import { SEED } from '../public/js/domain/seed.js';

const COLS = ['預約狀態', '預約日期', '預約時段', '姓名', '病歷號', '課程', '合併扣課', '服務資源'];
const NO_COL = ['預約狀態', '預約日期', '預約時段', '姓名', '病歷號', '課程', '服務資源'];
const chart = (no) => [{ text: `病歷號 ${no}`, color: 'grey' }];
const CUSTOMERS = [{ id: 'c-wang', name: '王小明', marks: chart('1234'), flags: ['體內金屬'] }];
const pool = (id, durationMin) => ({
  id, type: 'pool', label: `復能-三選一(${durationMin})`, optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin, totalQty: 10,
});
const ctx = (ents = [pool('w-60', 60)]) => ({
  customers: CUSTOMERS,
  entitlementsBy: { 'c-wang': ents },
  visitsBy: {},
  master: { courses: SEED.courses, equipment: SEED.equipment, rooms: SEED.rooms, staff: [...SEED.staff, { id: 's-fang', name: '小芳', role: '物理治療師' }], ivProducts: SEED.ivProducts },
  today: '2026-08-01',
});
const r = (time, course, merged, who = '陳小芳') => ['確認前往', '2026-08-27', time, '王小明', '00001234', course, merged, who];
const read = (rows, c = ctx(), columns = COLS) => readAbovee([{ columns, rows }], c).items;

describe('讀字', () => {
  test('結束時間、合併扣課那一格', () => {
    assert.equal(aboveeEnd('10:30 - 11:00'), '11:00');
    assert.equal(aboveeEnd('9:30~10:45'), '10:45');
    assert.equal(aboveeEnd('10:30'), null);
    assert.equal(mergedMark('是'), true);
    assert.equal(mergedMark('✓'), true);
    assert.equal(mergedMark(''), false);
    assert.equal(mergedMark('否'), false);
  });
});

describe('照片上有那一欄：兩列都勾了 → 一段', () => {
  const items = read([r('10:30 - 11:00', 'IN 30', '是'), r('11:00 - 11:30', 'SIS 30', '是')]);

  test('確認層只剩一列、記一句與那一行寫出兩台與實際分鐘', () => {
    assert.equal(items.length, 1);
    const [m] = items;
    assert.equal(m.merged.note, '合併扣課：IN 30＋SIS 30');
    assert.equal(mergedLine(m), 'IN 30＋SIS 30 → 記成一段 60 分、扣一次');
    assert.equal(m.checked, true);
    assert.equal(summarizeAbovee(items).new, 1);
  });

  test('記下去：10:30–11:30 一段、器材照第一列、扣一次、記一句', () => {
    const { groups, problems } = planAbovee(items, ctx());
    assert.deepEqual(problems, {});
    const [s] = groups[0].visit.slots;
    assert.equal(groups[0].visit.slots.length, 1);
    assert.deepEqual([s.startsAt, s.endsAt, s.equipmentId, s.entitlementId, s.note],
      ['10:30', '11:30', 'eq-indiba', 'w-60', '合併扣課：IN 30＋SIS 30']);
  });

  test('客戶同時有 (30) 與 (60)：用合起來的 60 分重挑 → 扣 (60) 那一筆', () => {
    const both = ctx([pool('w-30', 30), pool('w-60', 60)]);
    const [m] = read([r('10:30 - 11:00', 'IN 30', '是'), r('11:00 - 11:30', 'SIS 30', '是')], both);
    assert.equal(m.entitlementId, 'w-60');
  });

  test('Abovee 寫成 IN 30＋SIS 60、SIS 那一列起訖只有 30 分 → 記一句寫實際的 30', () => {
    const [m] = read([r('15:45 - 16:15', 'IN 30', '是'), r('16:15 - 16:45', 'SIS 60', '是')]);
    assert.equal(m.merged.note, '合併扣課：IN 30＋SIS 30');
  });

  test('第二台的提醒不消失：SIS 對體內金屬那一句接在那一列的提醒裡', () => {
    const [m] = items;
    assert.deepEqual(mergedNotices(m, CUSTOMERS[0], SEED.equipment), ['合併扣課的另一台 SIS 對「體內金屬」要注意']);
  });

  test('試算表那一格旁邊印得出那一句（ADR-0096：記一句印在那一筆額度、那一天）', () => {
    const { groups } = planAbovee(items, ctx());
    const visit = { ...groups[0].visit, id: 'v1' };
    assert.deepEqual(slotNoteCells(pool('w-60', 60), [visit], ['2026-08-27']), [{ dateIndex: 0, text: '合併扣課：IN 30＋SIS 30' }]);
  });

  test('存檔前那一道多問一句', () => {
    const { groups } = planAbovee(items, ctx());
    const { lines } = aboveeConsequences({ groups, coursesById: Object.fromEntries(SEED.courses.map((c) => [c.id, c])), today: '2026-08-01' });
    assert.ok(lines.includes('其中 1 組合併扣課，各記成一段 60 分、扣一次'), lines.join('\n'));
  });
});

describe('不合的', () => {
  test('只有一列勾了、找不到另一半 → 那一列不合、不打勾、排進要你看、講一句', () => {
    const items = read([r('10:30 - 11:00', 'IN 30', '是'), r('14:00 - 14:30', 'SIS 30', '')]);
    assert.equal(items.length, 2);
    const orphan = items.find((i) => i.course.equipmentId === 'eq-indiba');
    assert.deepEqual([orphan.mergeOrphan, orphan.checked, needsAttention(orphan)], [true, false, true]);
    assert.match(newRowSay(orphan), /找不到另一半/);
    assert.equal(items.find((i) => i.course.equipmentId === 'eq-sis').mergeOrphan, undefined);
  });

  test('兩列都勾了但接不上（中間空了一段）→ 不合，兩列都是找不到另一半', () => {
    const items = read([r('10:30 - 11:00', 'IN 30', '是'), r('11:30 - 12:00', 'SIS 30', '是')]);
    assert.deepEqual(items.map((i) => Boolean(i.mergeOrphan)), [true, true]);
  });

  test('課程不一樣（IN＋ILIB）→ 不合成一段「IN 60」', () => {
    const items = read([r('10:30 - 11:00', 'IN 30', '是'), r('11:00 - 11:30', 'ILIB 30', '是')]);
    assert.equal(items.some((i) => i.merged), false);
  });
});

describe('照片上沒有那一欄（只拍了一半）', () => {
  const half = (rows, c) => read(rows.map((row) => row.filter((_, j) => j !== 6)), c, NO_COL);

  test('同一位治療師、接得上、兩台都是擇一池、對到同一筆 60 分的 → 照樣合成一列', () => {
    const items = half([r('10:30 - 11:00', 'IN 30', ''), r('11:00 - 11:30', 'SIS 30', '')]);
    assert.equal(items.length, 1);
    assert.equal(items[0].merged.note, '合併扣課：IN 30＋SIS 30');
  });

  test('治療師不一樣 → 不合', () => {
    const items = half([r('10:30 - 11:00', 'IN 30', '', '陳小芳'), r('11:00 - 11:30', 'SIS 30', '', '陳美玲')]);
    assert.equal(items.length, 2);
  });

  test('各扣各的 30 分那一筆（那一筆不是 60）→ 不合', () => {
    const items = half([r('10:30 - 11:00', 'IN 30', ''), r('11:00 - 11:30', 'SIS 30', '')], ctx([pool('w-30', 30)]));
    assert.equal(items.length, 2);
    assert.equal(items.some((i) => i.mergeOrphan), false, '沒有那一欄就沒有「勾了卻找不到另一半」這回事');
  });
});
