// Abovee 的六種預約狀態 → app 的狀態，加上「這個時間點合不合理」（abovee-status-follows-photo-2026-10-15/01）。
//
// 她 10/15：「預約狀態有 待確認／聯繫中／確認前往／已取消／客戶失約／課程完成 這六種，為什麼認不出來 ?」
// 以前 `aboveeState()` 只認「取消」「完成」兩個字，客戶失約被當成還排著；空的、抄壞的也被當成還排著，沒有人講。
//
// **這一支只加認得的字**：不改任何一列的種類、預設勾、寫進去的東西（那是 03、04）。
//
// 例子一律假名。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  photoStatusSay, photoTimeSays, readAbovee, statusColumnSay, statusFromAbovee,
} from '../public/js/domain/aboveeImport.js';
import { SEED } from '../public/js/domain/seed.js';

describe('六種字各自翻成 app 的哪一種', () => {
  const cases = [
    ['課程完成', 'done'],
    ['待確認', 'pending_confirm'],
    ['聯繫中', 'pending_confirm'],
    ['確認前往', 'pending_confirm'],
    ['已取消', 'cancelled'],
    ['客戶失約', 'no_show'],
  ];
  for (const [text, status] of cases) {
    test(`${text} → ${status}，讀得出來`, () => {
      assert.deepEqual(statusFromAbovee(text), { status, unread: false });
    });
  }

  test('前後空白、全形空白、中間夾空白也一樣', () => {
    assert.deepEqual(statusFromAbovee(' 課程完成 '), { status: 'done', unread: false });
    assert.deepEqual(statusFromAbovee('　客戶失約　'), { status: 'no_show', unread: false });
    assert.deepEqual(statusFromAbovee('確認 前往'), { status: 'pending_confirm', unread: false });
  });

  test('「待確認」「確認前往」都含「確認」兩個字 —— 不會被判成別的', () => {
    assert.equal(statusFromAbovee('待確認').status, 'pending_confirm');
    assert.equal(statusFromAbovee('確認前往').status, 'pending_confirm');
  });

  test('客戶失約不再是還排著，也不是取消', () => {
    const said = statusFromAbovee('客戶失約');
    assert.equal(said.status, 'no_show');
    assert.notEqual(said.status, 'cancelled');
  });

  test('空的、抄壞的、近似的字 → 待確認＋讀不出來（不猜成完成或取消）', () => {
    for (const text of ['', '   ', null, undefined, '確認前往X', '聯絡中', '已確認', '???']) {
      assert.deepEqual(statusFromAbovee(text), { status: 'pending_confirm', unread: true }, String(text));
    }
  });
});

describe('時間合不合理（照拍照那一天）', () => {
  const TODAY = '2026-09-09';

  test('還沒到的完成、還沒到的失約、過了的待確認各講一句', () => {
    assert.equal(photoTimeSays('done', '2026-09-10', TODAY), '還沒到就寫完成了');
    assert.equal(photoTimeSays('no_show', '2026-09-10', TODAY), '還沒到就寫失約了');
    assert.equal(photoTimeSays('pending_confirm', '2026-09-08', TODAY), '日子過了還沒結案');
  });

  test('今天的三種都不講', () => {
    for (const status of ['done', 'no_show', 'pending_confirm']) assert.equal(photoTimeSays(status, TODAY, TODAY), '', status);
  });

  test('過去的完成／失約、未來的待確認：合理，不講', () => {
    assert.equal(photoTimeSays('done', '2026-09-08', TODAY), '');
    assert.equal(photoTimeSays('no_show', '2026-09-08', TODAY), '');
    assert.equal(photoTimeSays('pending_confirm', '2026-09-10', TODAY), '');
  });

  test('已取消不看日期', () => {
    for (const date of ['2026-09-08', TODAY, '2026-09-10']) assert.equal(photoTimeSays('cancelled', date, TODAY), '', date);
  });

  test('日期讀不出來、沒給今天：不講', () => {
    assert.equal(photoTimeSays('done', null, TODAY), '');
    assert.equal(photoTimeSays('done', '2026-09-10', null), '');
  });
});

// ---------- 讀照片 ----------

const COLUMNS = ['預約狀態', '預約日期', '預約時段', '姓名', '病歷號', '課程'];
const chart = (no) => [{ text: `病歷號 ${no}`, color: 'grey' }];
const CUSTOMERS = [
  { id: 'c-a', name: '客戶A', marks: chart('1111') },
  { id: 'c-b', name: '客戶B', marks: chart('2222') },
];
const pool3 = (id) => ({ id, type: 'pool', label: '復能-三選一(60)', optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60, totalQty: 12 });
const ctx = (over = {}) => ({
  customers: CUSTOMERS,
  entitlementsBy: { 'c-a': [pool3('a-pool')], 'c-b': [pool3('b-pool')] },
  visitsBy: {},
  master: { courses: SEED.courses, equipment: SEED.equipment, rooms: SEED.rooms, staff: SEED.staff, ivProducts: SEED.ivProducts },
  today: '2026-09-09',
  ...over,
});

const LINES = [
  ['確認前往', '2026-09-10', '09:00 - 10:00', '客戶A', '00001111', 'SIS 60'],
  ['課程完成', '2026-09-08', '09:00 - 10:00', '客戶A', '00001111', 'SIS 60'],
  ['客戶失約', '2026-09-11', '09:00 - 10:00', '客戶B', '00002222', 'SIS 60'],
  ['', '2026-09-12', '09:00 - 10:00', '客戶B', '00002222', 'SIS 60'],
  ['確認前往X', '2026-09-13', '09:00 - 10:00', '客戶B', '00002222', 'SIS 60'],
];
const withStatus = { readable: true, columns: COLUMNS, rows: LINES };
// 同一張、左邊切掉了「預約狀態」那一欄
const withoutStatus = { readable: true, columns: COLUMNS.slice(1), rows: LINES.map((l) => l.slice(1)) };

describe('每一列帶著照片上的狀態', () => {
  test('讀得出來的帶 app 的狀態；空的、抄壞的帶「讀不出來」', () => {
    const { items } = readAbovee([withStatus], ctx());
    assert.deepEqual(items.map((i) => [i.photoStatus, i.statusUnread]), [
      ['pending_confirm', false],
      ['done', false],
      ['no_show', false],
      ['pending_confirm', true],
      ['pending_confirm', true],
    ]);
    // 「取消了沒」照舊只看取消：失約不算取消
    assert.deepEqual(items.map((i) => i.cancelled), [false, false, false, false, false]);
  });

  test('有那一欄：整張不帶「沒拍到」', () => {
    assert.equal(readAbovee([withStatus], ctx()).noStatusColumn, null);
    assert.equal(statusColumnSay(readAbovee([withStatus], ctx())), '');
  });

  test('photoStatusSay()：讀不出來講讀不出來，其餘照時間講', () => {
    const { items } = readAbovee([withStatus], ctx());
    const TODAY = '2026-09-09';
    assert.deepEqual(items.map((i) => photoStatusSay(i, TODAY)), [
      '',
      '',
      '還沒到就寫失約了',
      '讀不出預約狀態（照片上那一格是空的）',
      '讀不出預約狀態（照片上是「確認前往X」）',
    ]);
  });
});

describe('整張照片沒拍到「預約狀態」那一欄 ≠ 讀不出來', () => {
  test('每一列都不是讀不出來，狀態是 null（看不出來，不是待確認）', () => {
    const { items } = readAbovee([withoutStatus], ctx());
    assert.deepEqual(items.map((i) => [i.photoStatus, i.statusUnread]), LINES.map(() => [null, false]));
    assert.deepEqual(items.map((i) => photoStatusSay(i, '2026-09-09')), LINES.map(() => ''));
  });

  test('預設勾照舊：跟同一張照片寫「確認前往」的時候一模一樣', () => {
    const asPending = { ...withStatus, rows: LINES.map((l) => ['確認前往', ...l.slice(1)]) };
    const same = (read) => read.items.map((i) => [i.kind, i.checked]);
    assert.deepEqual(same(readAbovee([withoutStatus], ctx())), same(readAbovee([asPending], ctx())));
  });

  test('只在抬頭講一次（整張的旗標）', () => {
    const read = readAbovee([withoutStatus], ctx());
    assert.equal(read.noStatusColumn, 'all');
    assert.match(statusColumnSay(read), /沒拍到「預約狀態」那一欄/);
  });

  test('兩頁裡有一張沒拍到：只有那一張上的列看不出來', () => {
    const page1 = { readable: true, columns: COLUMNS, rows: LINES.slice(0, 2) };
    const page2 = { readable: true, columns: COLUMNS.slice(1), rows: LINES.slice(2).map((l) => l.slice(1)) };
    const read = readAbovee([page1, page2], ctx());
    assert.equal(read.noStatusColumn, 'some');
    assert.deepEqual(read.items.map((i) => i.photoStatus), ['pending_confirm', 'done', null, null, null]);
    assert.match(statusColumnSay(read), /有一張照片沒拍到/);
  });

  test('同一列兩張都拍到、只有一張有那一欄：照有的那一張', () => {
    const page1 = { readable: true, columns: COLUMNS.slice(1), rows: [LINES[1].slice(1)] };
    const page2 = { readable: true, columns: COLUMNS, rows: [LINES[1]] };
    const read = readAbovee([page1, page2], ctx());
    assert.deepEqual(read.items.map((i) => i.photoStatus), ['done']);
    assert.equal(read.noStatusColumn, null);
  });
});

describe('客戶失約：這一支還沒拿它去改任何東西（04 才改）', () => {
  // 釘著 01 之後它被當成什麼 —— 跟 app 上已確認的同一段比：照舊「已經記了」（以前就是這樣，`aboveeState()` 回 booked）
  test('app 上同一段已確認、照片寫客戶失約 → 照舊是「已經記了」', () => {
    const visit = {
      id: 'v1', customerId: 'c-b', date: '2026-09-11', status: 'confirmed',
      slots: [{ startsAt: '09:00', endsAt: '10:00', status: 'confirmed', entitlementId: 'b-pool', courseId: 'course-recovery', equipmentId: 'eq-sis' }],
    };
    const { items } = readAbovee([{ ...withStatus, rows: [LINES[2]] }], ctx({ visitsBy: { 'c-b': [visit] } }));
    assert.deepEqual(items.map((i) => [i.kind, i.photoStatus, i.checked]), [['recorded', 'no_show', false]]);
  });

  test('app 裡沒有、照片寫客戶失約（未來）→ 新的一段、不預設勾（03 改的：還沒到就寫失約了）', () => {
    const { items } = readAbovee([{ ...withStatus, rows: [LINES[2]] }], ctx());
    assert.deepEqual(items.map((i) => [i.kind, i.cancelled, i.checked]), [['new', false, false]]);
  });
});
