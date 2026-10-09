// 拍 Abovee → 一次新增很多來訪（issue 13）。`domain/aboveeImport.js`。
//
// **這一支有沒有任何一行，讓 Abovee 上的「確認前往」變成 app 的「已確認」？** —— 沒有：
// 預約狀態只照原字印，新段一律 INITIAL_STATUS（ADR-0027、0099）。
// **有沒有任何一條路，讓「對不上」的那一列在這一層被改掉？** —— 沒有：那一列勾不了（ADR-0056）。
//
// 例子一律假名、1234。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  aboveeDate, aboveeDatesIn, aboveeStart, mergeAboveePhotos, mismatchSay, needsAttention, newRowSay, picksOf, planAbovee, queueMarksAfter, readAbovee, resolveItem, summarizeAbovee,
} from '../public/js/domain/aboveeImport.js';
import { INITIAL_STATUS } from '../public/js/domain/visits.js';
import { SEED } from '../public/js/domain/seed.js';

const LEFT_COLUMNS = ['預約狀態', '預約日期', '預約時段', '姓名', '病歷號', '課程'];
const RIGHT_COLUMNS = ['診間', '服務資源', '取消原因'];

const LINES = [
  // 左半 ................................................................ 右半
  [['確認前往', '2026-09-10', '09:00 - 10:15', '王小明', '00001234', 'SIS 60'], ['', '陳小芳', '']],
  [['確認前往', '2026-09-10', '10:30 - 11:45', '王小明', '00001234', 'ILIB 60'], ['點滴室10', 'I1點10', '']],
  [['已取消', '2026-09-11', '09:00 - 10:15', '李小華', '00005678', 'EECP60'], ['治療室5', 'EECP1', '客人有事']],
  [['確認前往', '2026-09-11', '14:00 - 15:15', '李小華', '00005678', 'EECP60'], ['治療室8', 'EECP1', '']],
  [['課程完成', '2026-09-12', '09:00 - 10:15', '客戶A', '', 'SIS 60'], ['', '黃欣穎', '']],
  [['確認前往', '2026-09-12', '11:00 - 12:15', '陳大文', '00009999', 'ILIB 60'], ['點滴室2', 'I2點2', '']],
  [['確認前往', '2026-09-15', '09:00 - 10:15', '陳大文', '00009999', 'ILIB 60'], ['點滴室2', 'I2點2', '']],
  [['已取消', '2026-09-16', '09:00 - 10:15', '客戶A', '', 'SIS 60'], ['', '黃欣穎', '取消']],
  [['確認前往', '2026-09-17', '09:00 - 10:15', '客戶A', '', 'INDIBA 60'], ['', '小芳', '']],
  [['確認前往', '2026-09-18', '10:00 - 11:15', '李小華', '00005678', 'EECP60'], ['治療室5', 'EECP1', '']],
];

const left = { readable: true, columns: LEFT_COLUMNS, rows: LINES.map(([l]) => l) };
const right = { readable: true, columns: RIGHT_COLUMNS, rows: LINES.map(([, r]) => r) };

const chart = (no) => [{ text: `病歷號 ${no}`, color: 'grey' }];
const CUSTOMERS = [
  { id: 'c-wang', name: '王小明', marks: chart('1234') },
  { id: 'c-lee', name: '李小華', marks: chart('5678') },
  { id: 'c-a', name: '客戶A', marks: [] },
  { id: 'c-chen', name: '陳大文', marks: chart('9999') },
];

const pool3 = (id) => ({ id, type: 'pool', label: '復能-三選一(60)', optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60, totalQty: 12 });
const ilib = (id) => ({ id, type: 'single', label: 'ILIB(60)', courseId: 'course-iv-laser', durationMin: 60, totalQty: 20 });
const ENTS = {
  'c-wang': [pool3('w-pool'), ilib('w-ilib')],
  'c-lee': [{ id: 'l-eecp', type: 'single', label: 'EECP', courseId: 'course-eecp', totalQty: 40 }],
  'c-a': [pool3('a-pool')],
  'c-chen': [ilib('ch-ilib')],
};

const slot = (over) => ({ startsAt: '09:00', endsAt: '10:00', status: 'confirmed', ...over });
const VISITS = {
  'c-a': [{ id: 'v-a12', customerId: 'c-a', date: '2026-09-12', status: 'done',
    slots: [slot({ entitlementId: 'a-pool', courseId: 'course-recovery', equipmentId: 'eq-sis', status: 'done' })] }],
  'c-chen': [
    { id: 'v-ch12', customerId: 'c-chen', date: '2026-09-12', status: 'confirmed',
      slots: [slot({ entitlementId: 'ch-ilib', courseId: 'course-iv-laser', startsAt: '11:00', endsAt: '12:00' })] },
    { id: 'v-ch15', customerId: 'c-chen', date: '2026-09-15', status: 'pending_confirm',
      slots: [slot({ entitlementId: 'ch-ilib', courseId: 'course-iv-laser', status: 'pending_confirm' })] },
  ],
};

const STAFF = [...SEED.staff, { id: 's-fang', name: '小芳', role: '物理治療師' }];

const ctx = (over = {}) => ({
  customers: CUSTOMERS,
  entitlementsBy: ENTS,
  visitsBy: VISITS,
  master: {
    courses: SEED.courses, equipment: SEED.equipment, rooms: SEED.rooms, staff: STAFF, ivProducts: SEED.ivProducts,
  },
  today: '2026-09-09',
  ...over,
});

describe('讀字', () => {
  test('日期與開始時間', () => {
    assert.equal(aboveeDate('2026-09-10'), '2026-09-10');
    assert.equal(aboveeDate('2026/9/3'), '2026-09-03');
    assert.equal(aboveeDate('115/09/10'), '2026-09-10');
    assert.equal(aboveeDate('九月十日'), null);
    assert.equal(aboveeStart('09:00 - 10:15'), '09:00');
    assert.equal(aboveeStart('9:30~10:45'), '09:30');
    assert.equal(aboveeStart(''), null);
  });
});

describe('兩張怎麼對', () => {
  test('左半＋右半、列數一樣 → 照第幾列對上', () => {
    const { rows, pairing } = mergeAboveePhotos([left, right]);
    assert.equal(pairing, 'halves');
    assert.equal(rows.length, 10);
    assert.equal(rows[1].room, '點滴室10');
    assert.equal(rows[1].resource, 'I1點10');
    assert.deepEqual(rows[1].photos, [0, 1]);
  });

  test('右半邊只有 9 列 → 不配對，右半那幾格空著', () => {
    const { rows, pairing, counts } = mergeAboveePhotos([left, { ...right, rows: right.rows.slice(0, 9) }]);
    assert.equal(pairing, 'mismatch');
    assert.deepEqual(counts, { left: 10, right: 9 });
    assert.equal(rows.length, 10);
    assert.equal(rows[1].room, undefined);
  });

  test('先拍右半再拍左半也一樣', () => {
    assert.equal(mergeAboveePhotos([right, left]).rows[1].room, '點滴室10');
  });

  test('兩張都有姓名（兩頁）→ 接起來，同一位同一天同一個開始時間的去重', () => {
    const page2 = { readable: true, columns: LEFT_COLUMNS, rows: [LINES[9][0], ['確認前往', '2026-09-19', '09:00', '王小明', '1234', 'SIS 60']] };
    const { rows, pairing } = mergeAboveePhotos([left, page2]);
    assert.equal(pairing, 'pages');
    assert.equal(rows.length, 11);
  });

  test('一張、兩張都沒有姓名 → 講出來，一列都不讀', () => {
    assert.equal(mergeAboveePhotos([left]).pairing, 'single');
    assert.deepEqual(mergeAboveePhotos([right]), { rows: [], pairing: 'noNames', counts: null });
  });
});

describe('每一列分成四種', () => {
  const { items } = readAbovee([left, right], ctx());
  const byLine = (i) => items[i];

  test('新的 5 段、已經記了 3 段、已取消的 2 列淡掉沒勾', () => {
    assert.deepEqual(summarizeAbovee(items), { total: 10, new: 5, recorded: 3, attention: 0, cancelled: 2, checked: 5 });
    assert.deepEqual([2, 7].map((i) => [byLine(i).cancelled, byLine(i).checked]), [[true, false], [true, false]]);
    assert.deepEqual([4, 5, 6].map((i) => byLine(i).kind), ['recorded', 'recorded', 'recorded']);
  });

  test('認得人、額度只有一筆就預選、器材診間治療師照翻譯', () => {
    const sis = byLine(0);
    assert.equal(sis.customerId, 'c-wang');
    assert.equal(sis.entitlementId, 'w-pool');
    assert.equal(sis.equipmentId, 'eq-sis');
    assert.equal(sis.therapistId, 's-fang');
    assert.equal(byLine(1).entitlementId, 'w-ilib');
    assert.equal(byLine(1).roomId, 'room-iv10');
    assert.equal(byLine(3).roomId, 'room-t8');
  });

  test('預約狀態只照原字留著，不是 app 的狀態', () => {
    assert.equal(byLine(0).statusText, '確認前往');
    assert.equal('status' in byLine(0), false);
  });

  test('同一位同一天同一個開始時間、器材不一樣 → 對不上，勾不了', () => {
    const photo = { ...left, rows: [['確認前往', '2026-09-12', '09:00 - 10:15', '客戶A', '', 'INDIBA 60']] };
    const [only] = readAbovee([photo], ctx()).items;
    assert.equal(only.kind, 'mismatch');
    assert.equal(only.checked, false);
    assert.equal(only.existing.visitId, 'v-a12');
  });

  test('認不得人 → 不勾、不挑；她選了人之後重算', () => {
    const photo = { ...left, rows: [['確認前往', '2026-09-20', '09:00', '王曉名', '00001234', 'SIS 60']] };
    const [only] = readAbovee([photo], ctx()).items;
    assert.equal(only.kind, 'unknown');
    assert.equal(only.who.how, 'numberOnly');
    assert.equal(only.customerId, null);
    assert.equal(only.checked, false);

    const picked = resolveItem(only, 'c-wang', ctx());
    assert.equal(picked.kind, 'new');
    assert.equal(picked.entitlementId, 'w-pool');
    assert.equal(picked.checked, false, '選了人才能勾，勾是她自己勾');
  });

  test('已經過了的新段 → 不勾（ADR-0030 的做法）', () => {
    const [only] = readAbovee([left], ctx({ today: '2026-09-11' })).items;
    assert.equal(only.kind, 'new');
    assert.equal(only.checked, false);
  });
});

describe('組成來訪', () => {
  test('同一位同一天兩段 → 一天兩段；每一段都是 INITIAL_STATUS', () => {
    const { items } = readAbovee([left, right], ctx());
    const { groups, problems } = planAbovee(items, ctx());
    assert.deepEqual(problems, {});
    assert.equal(groups.length, 4);
    const wang = groups.find((g) => g.customerId === 'c-wang');
    assert.equal(wang.visit.slots.length, 2);
    assert.deepEqual(wang.visit.slots.map((s) => s.status), [INITIAL_STATUS, INITIAL_STATUS]);
    assert.equal(wang.visit.status, INITIAL_STATUS);
    assert.deepEqual(wang.visit.slots.map((s) => s.courseId), ['course-recovery', 'course-iv-laser']);
    for (const g of groups) {
      for (const s of g.visit.slots) assert.equal(s.status, INITIAL_STATUS, 'Abovee 上的「確認前往」不是 app 的已確認');
    }
  });

  test('併進同一天已確認的來訪：新段待確認、那一天退回待確認', () => {
    const photo = { ...left, rows: [['確認前往', '2026-09-12', '14:00', '陳大文', '9999', 'ILIB 60']] };
    const items = readAbovee([photo], ctx()).items.map((i) => ({ ...i, checked: true }));
    const [g] = planAbovee(items, ctx()).groups;
    assert.equal(g.visit.id, 'v-ch12');
    assert.equal(g.reopened, true);
    assert.deepEqual(g.visit.slots.map((s) => s.status), ['confirmed', INITIAL_STATUS]);
  });

  test('勾了卻缺東西 → 列在 problems，不組進來訪', () => {
    const { items } = readAbovee([left, right], ctx());
    const broken = items.map((i) => (i.key === items[0].key ? { ...i, entitlementId: null } : i));
    const { groups, problems } = planAbovee(broken, ctx());
    assert.deepEqual(problems[items[0].key], ['先選要做什麼']);
    assert.equal(groups.find((g) => g.customerId === 'c-wang').visit.slots.length, 1);
  });
});

describe('直接標成壓完（她 9/17）', () => {
  test('那個月有清單、這位在清單裡 → done；不在清單裡的不加進去', () => {
    const batches = [
      { id: 'b-sep', targetMonth: '2026-09', cursor: 'c-wang', queue: [
        { customerId: 'c-wang', state: 'pending' }, { customerId: 'c-chen', state: 'done' },
      ] },
      { id: 'b-oct', targetMonth: '2026-10', queue: [{ customerId: 'c-wang', state: 'pending' }] },
    ];
    const marks = queueMarksAfter([
      { customerId: 'c-wang', date: '2026-09-10' },
      { customerId: 'c-lee', date: '2026-09-11' },
      { customerId: 'c-chen', date: '2026-09-15' },
    ], batches);
    assert.deepEqual(marks, [{
      batchId: 'b-sep',
      cursor: 'c-wang',
      customerIds: ['c-wang'],
      queue: [{ customerId: 'c-wang', state: 'done', skippedReason: null }, { customerId: 'c-chen', state: 'done' }],
    }]);
  });
});

// 確認層以前自己寫了一份：「要你看 N 段」算已取消的對不上，底下「要你看」那一組卻不排它 ——
// 抬頭說 2 段、底下只有 1 列。兩邊一律問同一支
describe('要你看的是哪幾列：抬頭的數字與底下那一組問同一支', () => {
  const item = (o) => ({ kind: 'new', cancelled: false, who: { how: 'both' }, ...o });

  test('對不上、認不得（除了 app 裡沒有的）要看；Abovee 上已取消的：認不得人的不用、對不上的要看', () => {
    assert.equal(needsAttention(item({ kind: 'mismatch' })), true);
    assert.equal(needsAttention(item({ kind: 'unknown', who: { how: 'conflict' } })), true);
    assert.equal(needsAttention(item({ kind: 'unknown', who: { how: 'none' } })), false);
    // 2026-09-24 晚（ADR-0116）：以前已取消的一律不用 —— Abovee 上取消了、app 上還活著的那一段她就看不到
    assert.equal(needsAttention(item({ kind: 'mismatch', cancelled: true })), true);
    assert.equal(needsAttention(item({ kind: 'unknown', cancelled: true, who: { how: 'conflict' } })), false);
    assert.equal(needsAttention(item({ kind: 'new' })), false);
  });

  test('summarizeAbovee 的 attention 就是 needsAttention 數出來的', () => {
    const items = [item({ kind: 'mismatch' }), item({ kind: 'mismatch', cancelled: true }), item({ kind: 'unknown', who: { how: 'ambiguous' } })];
    assert.equal(summarizeAbovee(items).attention, items.filter(needsAttention).length);
    assert.equal(summarizeAbovee(items).attention, 3);
  });
});

// 確認層補讀「照片上那幾天」的來訪，以前用自己的正規表示式只認四位數的年 —— 民國年那幾天沒補讀，
// 跨到下個月的「已經記了」會被當成新的
test('照片上讀得到的日期：跟 aboveeDate() 同一種讀法（民國年也認），排好不重複', () => {
  const t = (rows) => ({ columns: ['預約日期', '姓名'], rows });
  assert.deepEqual(
    aboveeDatesIn([t([['115/10/02', '王小明'], ['2026-09-30', '客戶A']]), t([['2026-09-30', '李小華'], ['', '09:00 - 10:15']])]),
    ['2026-09-30', '2026-10-02'],
  );
  assert.deepEqual(aboveeDatesIn([]), []);
});

describe('08 預約狀態跟 app 對一次，只講不改（ADR-0116）', () => {
  // 她 2026-09-24 晚：「其實拍 Abovee上面也有標已取消等等的標記…其實也可以當作某一方面的交叉驗證?」
  // Abovee 那一欄三種字：課程完成、確認前往、已取消。**這一層一段都不改**（ADR-0056）
  const ilibSlot = (over) => ({ entitlementId: 'ch-ilib', courseId: 'course-iv-laser', startsAt: '09:00', endsAt: '10:00', ...over });
  const withChen = (...visits) => ctx({ visitsBy: { ...VISITS, 'c-chen': [...VISITS['c-chen'], ...visits] } });
  const read = (row, c = ctx()) => readAbovee([{ ...left, rows: [row] }], c).items[0];

  // 她 2026-10-09（ADR-0144，推翻 ADR-0116 表上這一格）：「要改成算新的一段，如果照片有就新增，
  // 如果這段原本是取消那預設不勾並提醒已取消過」。以前是「對不上」、勾不起來 —— 取消之後在同一格重約的那一段這一層記不了。
  // ADR-0116 當初要擋的（這一列是新的**而且預設打勾**，她取消的那一段被加回來）照舊擋著：不預設打勾
  test('app 上取消了、Abovee 上還是確認前往：算新的一段、不預設打勾、要你看、講得出取消過', () => {
    const c = withChen({ id: 'v-ch20', customerId: 'c-chen', date: '2026-09-20', status: 'cancelled',
      slots: [ilibSlot({ status: 'cancelled' })] });
    const item = read(['確認前往', '2026-09-20', '09:00 - 10:15', '陳大文', '00009999', 'ILIB 60'], c);
    assert.equal(item.kind, 'new');
    assert.equal(item.checked, false, '日期在未來也不先勾');
    assert.equal(needsAttention(item), true);
    assert.match(newRowSay(item), /app 上這一段取消過/);
    assert.match(newRowSay(item), /回 Abovee 放掉/, '沒有重約的那一種照舊講得出要去放掉');
    assert.equal(item.entitlementId, 'ch-ilib', '跟別的新的一段一樣先按好額度');
  });

  test('她勾了才寫：整天都取消的那一天另開一次新的來訪，取消的那一段不動', () => {
    const c = withChen({ id: 'v-ch20', customerId: 'c-chen', date: '2026-09-20', status: 'cancelled',
      slots: [ilibSlot({ status: 'cancelled' })] });
    const item = read(['確認前往', '2026-09-20', '09:00 - 10:15', '陳大文', '00009999', 'ILIB 60'], c);
    assert.deepEqual(planAbovee([item], c).groups, [], '沒勾：一段都不寫');
    const [group] = planAbovee([{ ...item, checked: true }], c).groups;
    assert.equal(group.visit.id, undefined, '不是把取消的那一筆救回來');
    assert.deepEqual(group.visit.slots.map((s) => [s.startsAt, s.status]), [['09:00', 'pending_confirm']]);
  });

  test('只取消了那一段（同一天別段還在）：勾了就接在那一天的尾巴，取消的那一段照舊是取消的', () => {
    const c = withChen({ id: 'v-ch21', customerId: 'c-chen', date: '2026-09-21', status: 'confirmed',
      slots: [ilibSlot({ status: 'cancelled' }), ilibSlot({ startsAt: '14:00', endsAt: '15:00', status: 'confirmed' })] });
    const item = read(['確認前往', '2026-09-21', '09:00 - 10:15', '陳大文', '00009999', 'ILIB 60'], c);
    assert.deepEqual([item.kind, item.checked], ['new', false]);
    const [group] = planAbovee([{ ...item, checked: true }], c).groups;
    assert.equal(group.visit.id, 'v-ch21');
    assert.deepEqual(group.visit.slots.map((s) => [s.startsAt, s.status]),
      [['09:00', 'cancelled'], ['14:00', 'confirmed'], ['09:00', 'pending_confirm']]);
  });

  test('照片上取消的那一列與重約的那一列都在：取消的是「兩邊都取消」，重約的是新的一段', () => {
    const c = withChen({ id: 'v-ch20', customerId: 'c-chen', date: '2026-09-20', status: 'cancelled',
      slots: [ilibSlot({ status: 'cancelled' })] });
    const { items } = readAbovee([{ ...left, rows: [
      ['已取消', '2026-09-20', '09:00 - 10:15', '陳大文', '00009999', 'ILIB 60'],
      ['確認前往', '2026-09-20', '09:00 - 10:15', '陳大文', '00009999', 'ILIB 60'],
    ] }], c);
    assert.deepEqual(items.map((i) => [i.kind, i.checked]), [['recorded', false], ['new', false]]);
    assert.match(newRowSay(items[1]), /取消過/);
  });

  test('記進去之後同一頁再拍一次：那一列是已經記了（活著的那一段優先）', () => {
    const c = withChen({ id: 'v-ch21', customerId: 'c-chen', date: '2026-09-21', status: 'confirmed',
      slots: [ilibSlot({ status: 'cancelled' }), ilibSlot({ status: 'pending_confirm' })] });
    const item = read(['確認前往', '2026-09-21', '09:00 - 10:15', '陳大文', '00009999', 'ILIB 60'], c);
    assert.equal(item.kind, 'recorded');
  });

  test('Abovee 上已取消、app 上還活著：以前整列跳過，現在要你看', () => {
    const item = read(['已取消', '2026-09-15', '09:00 - 10:15', '陳大文', '00009999', 'ILIB 60']);
    assert.equal(item.kind, 'mismatch');
    assert.equal(item.reason, 'aboveeCancelled');
    assert.equal(needsAttention(item), true);
    assert.equal(mismatchSay(item), 'Abovee 上取消了，app 上還是「待確認」。');
  });

  test('兩邊都取消：一致，不排進要你看', () => {
    const c = withChen({ id: 'v-ch20', customerId: 'c-chen', date: '2026-09-20', status: 'cancelled',
      slots: [ilibSlot({ status: 'cancelled' })] });
    const item = read(['已取消', '2026-09-20', '09:00 - 10:15', '陳大文', '00009999', 'ILIB 60'], c);
    assert.equal(item.kind, 'recorded');
    assert.equal(needsAttention(item), false);
    assert.equal(summarizeAbovee([item]).recorded, 0, '「已經記了 N 段」不算取消的');
  });

  test('Abovee 上課程完成、app 上還開著：講還沒簽療程單', () => {
    const item = read(['課程完成', '2026-09-12', '11:00 - 12:15', '陳大文', '00009999', 'ILIB 60']);
    assert.equal(item.reason, 'notClosed');
    assert.equal(mismatchSay(item), 'Abovee 上是「課程完成」，app 上還是「已確認」—— 還沒簽療程單。');
  });

  test('Abovee 上課程完成、app 上記未到', () => {
    const c = withChen({ id: 'v-ch22', customerId: 'c-chen', date: '2026-09-22', status: 'no_show',
      slots: [ilibSlot({ status: 'no_show' })] });
    const item = read(['課程完成', '2026-09-22', '09:00 - 10:15', '陳大文', '00009999', 'ILIB 60'], c);
    assert.equal(item.reason, 'appNoShow');
    assert.match(mismatchSay(item), /app 上記「未到」/);
  });

  test('確認前往不拿來比：app 上待確認是常態，已經記了', () => {
    const item = read(['確認前往', '2026-09-15', '09:00 - 10:15', '陳大文', '00009999', 'ILIB 60']);
    assert.equal(item.kind, 'recorded');
    assert.equal(needsAttention(item), false);
  });

  test('課程不一樣就不是同一段：Abovee 上 ILIB 取消了、app 上同一時間是 SIS → 不是對不上', () => {
    const item = read(['已取消', '2026-09-12', '09:00 - 10:15', '客戶A', '', 'INDIBA 60']);
    assert.notEqual(item.kind, 'mismatch');
    assert.equal(needsAttention(item), false);
    assert.equal(item.checked, false);
  });

  test('app 上取消的是另一個課程、Abovee 上這一格還掛著 → 照新的一段走，但不預設打勾、講一句為什麼', () => {
    // 審查抓到的：課程那一格抄錯的話，這一列就是她取消掉的那一段 —— 打勾就加回來了
    const c = withChen({ id: 'v-ch20', customerId: 'c-chen', date: '2026-09-20', status: 'cancelled',
      slots: [ilibSlot({ status: 'cancelled', courseId: 'course-recovery', equipmentId: 'eq-sis' })] });
    const item = read(['確認前往', '2026-09-20', '09:00 - 10:15', '陳大文', '00009999', 'ILIB 60'], c);
    assert.equal(item.kind, 'new');
    assert.equal(item.checked, false);
    assert.match(newRowSay(item), /app 上這個時間有一段取消了/);
    assert.equal(newRowSay(read(['確認前往', '2026-09-25', '09:00 - 10:15', '陳大文', '00009999', 'ILIB 60'], c)), '',
      '那個時間沒有取消掉的段就不講');
  });

  test('換一個人重算：上一位的比對結果不留著', () => {
    const c = withChen({ id: 'v-ch20', customerId: 'c-chen', date: '2026-09-20', status: 'cancelled',
      slots: [ilibSlot({ status: 'cancelled' })] });
    const item = read(['確認前往', '2026-09-20', '09:00 - 10:15', '陳大文', '00009999', 'ILIB 60'], c);
    const other = resolveItem(item, 'c-wang', c);
    assert.equal(other.kind, 'new');
    assert.equal(other.reason, null);
  });
});

// abovee-and-master-2026-10-05/07：n返 與不算次數的課在挑額度之前就分流、照片上的品項優先、分角色認人
describe('07 分流與品項', () => {
  const FM = { id: 'course-fm', name: '功醫門診', durationMin: 30, assigns: 'none', doctorPick: 'any', uncounted: true, aboveeNames: ['功醫門診'] };
  const exam = { id: 'w-exam', type: 'single', label: '健檢', courseId: 'course-checkup', totalQty: 1 };
  const second = { id: 'w-fu', type: 'single', label: '二返', courseId: 'course-followup', totalQty: 1, followupForEntitlementId: 'w-exam' };
  const iv = (id, ivProductId, label) => ({ id, type: 'single', label, courseId: 'course-iv-drip', ivProductId, totalQty: 5 });
  // 王小明 9/01 做完一次健檢（n返 要接在一次做完的健檢後面）
  const examVisit = { id: 'v-w-exam', customerId: 'c-wang', date: '2026-09-01', status: 'done',
    slots: [{ entitlementId: 'w-exam', courseId: 'course-checkup', startsAt: '09:00', endsAt: '11:00', status: 'done' }] };
  const c7 = (ents = {}) => ctx({
    entitlementsBy: { ...ENTS, 'c-wang': [...ENTS['c-wang'], exam, second], ...ents },
    visitsBy: { ...VISITS, 'c-wang': [examVisit] },
    master: { ...ctx().master, courses: [...SEED.courses, FM] },
  });
  const read = (row, c = c7()) => readAbovee([{ ...left, rows: [row] }], c).items[0];

  test('三返30：n返、第三返、不預選二返那一筆額度、不替她選接哪一次健檢', () => {
    const item = read(['確認前往', '2026-09-20', '09:00 - 10:15', '王小明', '00001234', '三返30']);
    assert.equal(item.kind, 'new');
    assert.equal(item.isNth, true);
    assert.equal(item.nth, 3);
    assert.equal(item.entitlementId, null, '二返那一筆有剩，也不可以扣到它（ADR-0063：n返 不是額度）');
    assert.equal(item.followupForVisitId, null);
    assert.equal(picksOf(item).isNth, true);
    assert.equal(picksOf(item).minutes, 30);
    // 勾著、還差一步：選接哪一次健檢（08 的確認層補那一排）
    assert.match(planAbovee([item], c7()).problems[item.key][0], /哪一次健檢/);
  });

  test('二返60：扣二返那一筆、這一段 60 分（約的時候選時長，ADR-0122）', () => {
    const item = read(['確認前往', '2026-09-20', '09:00 - 10:15', '王小明', '00001234', '二返60']);
    assert.equal(item.isNth, false);
    assert.equal(item.entitlementId, 'w-fu');
    const [g] = planAbovee([item], c7()).groups;
    assert.equal(g.visit.slots[0].minutes, 60);
    assert.equal(g.visit.slots[0].endsAt, '10:00');
  });

  test('功醫門診（沒有任何額度的客戶）：不扣次數那一顆、勾著、記得進去', () => {
    const item = read(['確認前往', '2026-09-20', '09:00 - 10:15', '客戶A', '', '功醫門診']);
    assert.equal(item.entitlementId, null);
    assert.equal(item.uncountedCourseId, 'course-fm');
    assert.equal(item.checked, true);
    const { groups, problems } = planAbovee([item], c7());
    assert.deepEqual(problems, {});
    assert.deepEqual([groups[0].visit.slots[0].courseId, groups[0].visit.slots[0].entitlementId], ['course-fm', null]);
  });

  test('不算次數的課、客戶身上還有那門課的額度 → 照舊扣（ADR-0121）', () => {
    const bought = { id: 'a-fm', type: 'single', label: '功醫門診', courseId: 'course-fm', totalQty: 2 };
    const item = read(['確認前往', '2026-09-20', '09:00 - 10:15', '客戶A', '', '功醫門診'], c7({ 'c-a': [...ENTS['c-a'], bought] }));
    assert.equal(item.entitlementId, 'a-fm');
    assert.equal(item.uncountedCourseId, null);
  });

  test('照片上寫哪一款就是那一款，同時買了兩款時扣對的那一筆', () => {
    const both = c7({ 'c-a': [iv('a-gut', 'iv-gut', '營養點滴・腸道修復'), iv('a-liver', 'iv-liver', '營養點滴・護肝排毒')] });
    const liver = read(['確認前往', '2026-09-20', '09:00 - 10:15', '客戶A', '', '護肝排毒'], both);
    assert.deepEqual([liver.entitlementId, liver.ivProductId], ['a-liver', 'iv-liver']);

    // 只買了護肝排毒、照片上寫腸道修復：扣那一筆、品項照照片（換一款只多一句提醒，ADR-0002）
    const one = c7({ 'c-a': [iv('a-liver', 'iv-liver', '營養點滴・護肝排毒')] });
    const gut = read(['確認前往', '2026-09-20', '09:00 - 10:15', '客戶A', '', '腸道修復'], one);
    assert.deepEqual([gut.entitlementId, gut.ivProductId], ['a-liver', 'iv-gut']);
  });

  test('分角色認人：復能那一列的全名不會被姓李的醫師搶走；二返那一列認成醫師', () => {
    // 治療師「小芳」與醫師「李」（種子）都在：「李小芳」兩條規則都符合
    const c = c7();
    const sis = readAbovee([{ ...left, rows: [['確認前往', '2026-09-20', '09:00', '王小明', '1234', 'SIS 60']] },
      { ...right, rows: [['', '李小芳', '']] }], c).items[0];
    assert.equal(sis.therapistId, 's-fang');
    assert.equal(sis.doctorId, null);
    assert.equal(sis.staffKnown, true);

    const fu = readAbovee([{ ...left, rows: [['確認前往', '2026-09-20', '09:00', '王小明', '1234', '二返30']] },
      { ...right, rows: [['', '李大同', '']] }], c).items[0];
    assert.equal(fu.doctorId, 'staff-dr-li');
    assert.equal(fu.therapistId, null);
  });
});
