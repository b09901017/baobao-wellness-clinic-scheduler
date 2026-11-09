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
  aboveeEnd, mergedLine, mergedMark, mergedNotices, needsAttention, newRowSay, photoDayPlan, planAbovee, readAbovee, recordedSay,
  resolveItem, rowTag, summarizeAbovee,
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

// ---------- 照額度的分鐘（family-merge-round 05，ADR-0185）----------
//
// 她 11/9：「abovee 這個，主要是給櫃檯看的，所以有時候我可能會忘記勾，或是多勾…但是拍到 app 裡，真的要記錄扣額度時就不能出錯，所以要提醒」
// → 有那一欄也不只看勾：額度的分鐘＝兩列加起來就合成一段、跟勾不一樣就講一句。
//
// 回歸表是 5～10 月重對的真實形狀（只留課程字、起訖、勾、額度分鐘；日期與人都拿掉）。
// **一列幾分鐘取「課程寫的分鐘」與「起訖」較小的那個**：Abovee 常多排 15 分空檔（16:00–16:45 的「高能量 30」），
// 也有課程字寫 60、起訖只有 30 的（「SIS 60」排 16:15–16:45）。

describe('照額度的分鐘：跟勾不一樣就講一句', () => {
  const plan = (items, c = ctx()) => photoDayPlan(items.map((i) => ({ ...i, checked: true })), c);
  const tagOf = (items, c = ctx()) => {
    const p = plan(items, c);
    return items.map((i) => rowTag({ ...i, checked: true }, p)?.all ?? []);
  };

  // [說明, 兩列（起訖、課程字、勾）, 額度, 合不合, 要不要講]
  const SHAPES = [
    ['沒勾、30＋30（第二列多排 15 分）、額度 60 分一次 → 合、講（忘了勾的那一種）',
      [['15:30 - 16:00', 'IN 30', ''], ['16:00 - 16:45', '高能量 30', '']], [pool('w-60', 60)], true, true],
    ['勾了、30＋30（第二列多排 15 分）、額度 60 → 合、不講', [['13:00 - 13:30', '高能量 30', '是'], ['13:30 - 14:15', 'IN 30', '是']], [pool('w-60', 60)], true, false],
    ['勾了、IN 30＋SIS 60（起訖各 30）、額度 60 → 合、不講', [['15:45 - 16:15', 'IN 30', '是'], ['16:15 - 16:45', 'SIS 60', '是']], [pool('w-60', 60)], true, false],
    ['勾了、30＋30、額度 60 → 合、不講', [['10:30 - 11:00', 'IN 30', '是'], ['11:00 - 11:30', 'SIS 30', '是']], [pool('w-60', 60)], true, false],
    ['沒勾、60＋60、額度 60 → 不合、不講', [['09:30 - 10:30', '高能量 60', ''], ['10:30 - 11:30', 'SIS 60', '']], [pool('w-60', 60)], false, false],
    ['沒勾、60＋60 多排 15 分、額度 60 → 不合、不講', [['13:00 - 14:15', 'IN 60', ''], ['14:15 - 15:30', 'SIS 60', '']], [pool('w-60', 60)], false, false],
    ['沒勾、30＋30、額度 30 分一次 → 不合、不講', [['10:00 - 10:30', 'SIS 30', ''], ['10:30 - 11:00', 'IN 30', '']], [pool('w-30', 30)], false, false],
    ['沒勾、30＋30 多排 15 分、額度 30 → 不合、不講', [['10:00 - 10:30', 'SIS 30', ''], ['10:30 - 11:15', 'SIS 30', '']], [pool('w-30', 30)], false, false],
    ['勾了、30＋30、額度 30 分一次 → 不合（各扣一次）、講', [['10:30 - 11:00', 'IN 30', '是'], ['11:00 - 11:30', 'SIS 30', '是']], [pool('w-30', 30)], false, true],
  ];
  for (const [label, rows, ents, merges, says] of SHAPES) {
    test(label, () => {
      const items = read(rows.map(([time, course, mark]) => r(time, course, mark)), ctx(ents));
      assert.equal(items.length, merges ? 1 : 2, '合成幾列');
      const tags = tagOf(items, ctx(ents));
      assert.deepEqual(tags.map((t) => t.includes('合併')), items.map(() => says), `短標記：${JSON.stringify(tags)}`);
    });
  }

  test('沒勾、額度 60 分一次：記成一段 15:30–16:30、扣一次、記一句自動寫、講「Abovee 沒勾」', () => {
    const items = read([r('15:30 - 16:00', 'IN 30', ''), r('16:00 - 16:45', '高能量 30', '')]);
    const [m] = items;
    assert.equal(m.merged.note, '合併扣課：IN 30＋高能量雷射 30');
    assert.equal(mergedLine(m), 'IN 30＋高能量雷射 30 → 記成一段 60 分、扣一次');
    assert.equal(m.checked, true);
    const p = plan(items);
    const [s] = p.groups[0].visit.slots;
    assert.equal(p.groups[0].visit.slots.length, 1);
    assert.deepEqual([s.startsAt, s.endsAt, s.entitlementId, s.note], ['15:30', '16:30', 'w-60', '合併扣課：IN 30＋高能量雷射 30']);
    assert.ok(p.mustSeeBy[m.key].some((t) => /Abovee 沒勾合併扣課.*60 分一次.*先當成一段/.test(t)), p.mustSeeBy[m.key].join('\n'));
    assert.equal(p.rows.reduce((n, x) => n + x.charge, 0), 1, '扣一次');
  });

  test('按「拆開成兩段」（換回 merged.parts）→ 兩段各扣一次、不再講', () => {
    const [m] = read([r('15:30 - 16:00', 'IN 30', ''), r('16:00 - 16:45', '高能量 30', '')]);
    const p = plan(m.merged.parts);
    assert.equal(p.groups[0].visit.slots.length, 2);
    assert.equal(p.rows.reduce((n, x) => n + x.charge, 0), 2);
    assert.ok(Object.values(p.mustSeeBy).flat().every((t) => !/合併扣課/.test(t)));
  });

  test('只勾了一列、旁邊那一列沒勾、額度 60 分一次 → 照分鐘合、講「只勾了一列」', () => {
    const items = read([r('15:30 - 16:00', 'IN 30', '是'), r('16:00 - 16:30', 'SIS 30', '')]);
    assert.equal(items.length, 1);
    assert.equal(items[0].mergeOrphan, undefined);
    const p = plan(items);
    assert.ok(p.mustSeeBy[items[0].key].some((t) => /只勾了一列/.test(t)), p.mustSeeBy[items[0].key].join('\n'));
  });

  test('兩列都勾、額度 30 分一次：兩段各扣 (30) 那一筆、兩列都講「勾了合併扣課…30 分一次」', () => {
    const c = ctx([pool('w-30', 30)]);
    const items = read([r('10:30 - 11:00', 'IN 30', '是'), r('11:00 - 11:30', 'SIS 30', '是')], c);
    assert.deepEqual(items.map((i) => [i.entitlementId, i.checked, Boolean(i.merged), Boolean(i.mergeOrphan)]),
      [['w-30', true, false, false], ['w-30', true, false, false]]);
    const p = plan(items, c);
    assert.equal(p.rows.reduce((n, x) => n + x.charge, 0), 2);
    for (const i of items) assert.ok(p.mustSeeBy[i.key].some((t) => /勾了合併扣課.*30 分一次.*兩段/.test(t)), p.mustSeeBy[i.key].join('\n'));
  });

  test('身上沒有挑得到的額度：照勾（兩列都勾 → 合）', () => {
    const items = read([r('10:30 - 11:00', 'IN 30', '是'), r('11:00 - 11:30', 'SIS 30', '是')], ctx([]));
    assert.equal(items.length, 1);
  });

  test('換一位：上一位的「照分鐘合／拆」那一句不留著', () => {
    const c = ctx([pool('w-30', 30)]);
    const [a] = read([r('10:30 - 11:00', 'IN 30', '是'), r('11:00 - 11:30', 'SIS 30', '是')], c);
    assert.ok(a.mergeSplit);
    assert.equal(resolveItem(a, 'c-wang', c).mergeSplit, false);
    const [m] = read([r('15:30 - 16:00', 'IN 30', ''), r('16:00 - 16:45', '高能量 30', '')]);
    assert.ok(m.mergeGuess);
    assert.equal(resolveItem(m, 'c-wang', ctx()).mergeGuess, null);
  });
});

describe('app 上已經有一段 60 分，照片兩列（後一半認領也照分鐘）', () => {
  const saved = (startsAt, endsAt, entitlementId = 'w-60', equipmentId = 'eq-indiba') => ({ id: 'v1', customerId: 'c-wang', date: '2026-08-27', status: 'pending_confirm',
    slots: [{ entitlementId, courseId: 'course-recovery', equipmentId, startsAt, endsAt, status: 'pending_confirm' }] });
  const withVisit = (visit, ents = [pool('w-60', 60)]) => ({ ...ctx(ents), visitsBy: { 'c-wang': [visit] } });
  const brief = (items) => items.map((i) => `${i.startsAt} ${i.kind}${i.mergeOrphan ? '(orphan)' : ''}${i.halfOf ? '(half)' : ''}`);

  test('沒勾、app 15:30–16:30 一段 60 分（TimeTree 排的）、第二列 16:00–16:45 → 認領成後一半、講一句，不多記一段', () => {
    const items = read([r('15:30 - 16:00', 'IN 30', ''), r('16:00 - 16:45', '高能量 30', '')], withVisit(saved('15:30', '16:30')));
    assert.deepEqual(brief(items), ['15:30 recorded', '16:00 recorded(half)']);
    assert.match(recordedSay(items[1]), /Abovee 沒勾合併扣課/);
    assert.equal(summarizeAbovee(items).new, 0);
  });

  test('勾了、app 13:00–14:00、第二列 13:30–14:15（多排 15 分）→ 照樣認領（以前變成找不到另一半）', () => {
    const items = read([r('13:00 - 13:30', '高能量 30', '是'), r('13:30 - 14:15', 'IN 30', '是')], withVisit(saved('13:00', '14:00', 'w-60', 'eq-laser')));
    assert.deepEqual(brief(items), ['13:00 recorded', '13:30 recorded(half)']);
    assert.doesNotMatch(recordedSay(items[1]), /沒勾/);
  });

  test('沒勾、app 那一段只有 30 分（額度 30 分一次）→ 第二列是新的一段', () => {
    const items = read([r('10:00 - 10:30', 'IN 30', ''), r('10:30 - 11:00', 'SIS 30', '')],
      withVisit(saved('10:00', '10:30', 'w-30'), [pool('w-30', 30)]));
    assert.deepEqual(brief(items), ['10:00 recorded', '10:30 new']);
  });

  test('沒勾、app 那一段蓋得住、可是那一筆額度是 90 分 → 分鐘對不起來，不認領', () => {
    const items = read([r('15:30 - 16:00', 'IN 30', ''), r('16:00 - 16:30', 'SIS 30', '')],
      withVisit(saved('15:30', '17:00', 'w-90'), [pool('w-90', 90)]));
    assert.deepEqual(brief(items), ['15:30 recorded', '16:00 new']);
  });
});
