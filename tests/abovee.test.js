// Abovee 上的寫法 → app 主檔（issue 12）。
//
// Abovee 右半邊跟 app 主檔講的是同一批東西，寫法不一樣：服務資源是治療師的**全名**、
// 醫師的全名，診間是「治療室5」，課程是「SIS 60」。
//
// **這一支有沒有任何一條路，讓一個 Abovee 上的名字被認成兩位裡面的某一位、而她沒選？** —— 沒有：
// 符合的零位或好幾位一律 null。例子一律假名。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { aliasWrites, courseFrom, roomFrom, staffFrom } from '../public/js/domain/abovee.js';
import { SEED } from '../public/js/domain/seed.js';

const STAFF = [
  { id: 's-fang', name: '小芳', role: '物理治療師' },
  { id: 's-lulu', name: 'LuLu', role: '物理治療師', aboveeNames: ['陳露露'] },
  { id: 's-xia', name: '夏', role: '醫師' },
  { id: 's-xia-pt', name: '夏', role: '物理治療師', deletedAt: '2026-01-01' },
];

describe('服務資源 → 治療師／醫師', () => {
  test('治療師名字是全名的結尾：陳小芳 → 小芳', () => {
    assert.equal(staffFrom('陳小芳', STAFF)?.id, 's-fang');
  });

  test('另一位的名字也是結尾（芳）→ 兩位都符合，null', () => {
    assert.equal(staffFrom('陳小芳', [...STAFF, { id: 's-f', name: '芳', role: '物理治療師' }]), null);
  });

  test('記住的寫法完全相同 → 直接對上，不管結尾規則', () => {
    assert.equal(staffFrom('陳露露', STAFF)?.id, 's-lulu');
    assert.equal(staffFrom(' 陳露露 ', STAFF)?.id, 's-lulu');
    // 記住的寫法贏過結尾規則：另一位叫「露露」也不會搶走
    assert.equal(staffFrom('陳露露', [...STAFF, { id: 's-ll', name: '露露', role: '物理治療師' }])?.id, 's-lulu');
  });

  test('醫師的姓是全名的開頭：夏OO → 夏（醫師）；治療師的「夏」不算開頭', () => {
    assert.equal(staffFrom('夏大同', STAFF)?.id, 's-xia');
    assert.equal(staffFrom('夏大同', [{ id: 'pt', name: '夏', role: '物理治療師' }]), null);
  });

  test('認不出來、空白、已刪除的 → null', () => {
    assert.equal(staffFrom('王大明', STAFF), null);
    assert.equal(staffFrom('', STAFF), null);
    assert.equal(staffFrom('林夏', [{ id: 'gone', name: '夏', role: '物理治療師', deletedAt: 'x' }]), null);
  });
});

describe('診間／服務資源 → 診間', () => {
  const rooms = SEED.rooms;
  test('治療室5 → 治5；點滴室10 → 點滴10；VIP室3 → VIP3', () => {
    assert.equal(roomFrom('治療室5', '', rooms)?.id, 'room-t5');
    assert.equal(roomFrom('點滴室10', '', rooms)?.id, 'room-iv10');
    assert.equal(roomFrom('VIP室3', '', rooms)?.id, 'room-vip3');
  });

  test('診間那一格空著 → 看服務資源的房間部分：I1點10 → 點滴10、I2治2 → 治2', () => {
    assert.equal(roomFrom('', 'I1點10', rooms)?.id, 'room-iv10');
    assert.equal(roomFrom('', 'I2治2', rooms)?.id, 'room-t2');
  });

  test('認不出來 → null（EECP1 是機器不是房間）', () => {
    assert.equal(roomFrom('', 'EECP1', rooms), null);
    assert.equal(roomFrom('會議室', '', rooms), null);
  });
});

describe('課程那一格 → 課程、器材、分鐘', () => {
  const master = { courses: SEED.courses, equipment: SEED.equipment };

  test('SIS 60 → 復能、SIS、60', () => {
    assert.deepEqual(courseFrom('SIS 60', master), { courseId: 'course-recovery', equipmentId: 'eq-sis', durationMin: 60 });
  });

  test('ILIB 60 → ILIB 課程（也帶著那一台，四選一要它）', () => {
    assert.deepEqual(courseFrom('ILIB 60', master), { courseId: 'course-iv-laser', equipmentId: 'eq-ilib', durationMin: 60 });
  });

  test('EECP60、二返60 → 課程、分鐘；INDIBA 30 → 復能', () => {
    assert.deepEqual(courseFrom('EECP60', master), { courseId: 'course-eecp', equipmentId: null, durationMin: 60 });
    assert.deepEqual(courseFrom('二返60', master), { courseId: 'course-followup', equipmentId: null, durationMin: 60 });
    assert.equal(courseFrom('INDIBA 30', master)?.equipmentId, 'eq-indiba');
  });

  test('XYZ 30、空白 → null', () => {
    assert.equal(courseFrom('XYZ 30', master), null);
    assert.equal(courseFrom('', master), null);
  });
});

describe('她替認不出來的寫法選了人 → 記住', () => {
  test('每一位一筆，接在原本的後面；已經認得的、已經記著的不再寫', () => {
    const writes = aliasWrites([
      { text: '陳小芳', staffId: 's-fang' }, // 結尾規則本來就認得 → 不寫
      { text: '林芳芳', staffId: 's-fang' },
      { text: '陳露', staffId: 's-lulu' },
      { text: '陳露露', staffId: 's-lulu' }, // 已經記著
      { text: '林芳芳', staffId: 's-fang' }, // 同一個選了兩次
    ], STAFF);
    assert.deepEqual(writes, [
      { id: 's-fang', name: '小芳', changes: { aboveeNames: ['林芳芳'] } },
      { id: 's-lulu', name: 'LuLu', changes: { aboveeNames: ['陳露露', '陳露'] } },
    ]);
  });

  test('那個寫法已經是別人的 → 不寫（兩位不可以同一個寫法）', () => {
    assert.deepEqual(aliasWrites([{ text: '陳露露', staffId: 's-fang' }], STAFF), []);
  });
});
