// 拍 Abovee：會改變寫入結果的提醒，不點開那一列也看得到（prelaunch-fixes-2026-10-08/12，ADR-0138）。
//
// 每一列預設打勾、預設收著。提醒以前只畫在**點開**的那一列裡，存檔前那一道也不講 ——
// 體內金屬的客人排了 SIS、或這一段排完會超過總次數，她沒點開就一路看不到（ADR-0104 的理由是
// 「提醒本來就攤開了」，而畫面上其實沒攤開）。
//
// **這一支有沒有任何一句是另外寫的？** —— 沒有：句子就是 `validateVisit()` 那幾句，分類照它從哪一圈來
//（`warningDetails()` 的 `source`），不比字眼。例子一律假名、1234。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { briefWarnings, planAbovee, readAbovee, warningsByRow } from '../public/js/domain/aboveeImport.js';
import { aboveeConsequences } from '../public/js/domain/consequences.js';
import { mustSee, validateVisit, warningDetails, slotSay } from '../public/js/domain/visits.js';
import { SEED } from '../public/js/domain/seed.js';

const master = { courses: SEED.courses, equipment: SEED.equipment, rooms: SEED.rooms, staff: SEED.staff, ivProducts: SEED.ivProducts };
const coursesById = Object.fromEntries(SEED.courses.map((c) => [c.id, c]));
const TODAY = '2026-10-08';
const chart = (no) => [{ text: `病歷號 ${no}`, color: 'grey' }];
const WANG = { id: 'c-wang', name: '王小明', marks: chart('1234'), flags: ['體內金屬'] };
const LEE = { id: 'c-lee', name: '李小華', marks: chart('5678'), flags: [] };
const pool = (id, totalQty) => ({ id, type: 'pool', label: '復能-三選一(60)', optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60, totalQty });
const COLS = ['預約狀態', '預約日期', '預約時段', '姓名', '病歷號', '課程', '診間'];
const photo = (...rows) => ({ readable: true, columns: COLS, rows });

/** 確認層的 `plan()` 做的那幾件事：組來訪 → 同一支 `validateVisit()` → 歸到各列。 */
function planned(ctx, items) {
  const { groups } = planAbovee(items, ctx);
  const byRow = {};
  for (const g of groups) {
    const check = {
      slotLabel: (i) => slotSay(g.visit.slots[i], master),
      customer: { flags: ctx.customers.find((c) => c.id === g.customerId)?.flags ?? [] },
      entitlements: ctx.entitlementsBy[g.customerId] ?? [],
      courses: master.courses, equipment: master.equipment, rooms: master.rooms, staff: master.staff, ivProducts: master.ivProducts,
      customerVisits: ctx.visitsBy[g.customerId] ?? [],
      sameDayVisits: Object.values(ctx.visitsBy).flat().filter((v) => v.date === g.date),
    };
    Object.assign(byRow, warningsByRow(g, warningDetails(g.visit, check)));
  }
  const flagged = groups.flatMap((g) => g.items
    .filter((i) => byRow[i.key]?.mustSee.length)
    .map((i) => ({ customerName: g.customerName, date: g.date, texts: byRow[i.key].mustSee })));
  return { groups, byRow, flagged };
}

// ---------- 句子只有一份，分類照來源 ----------

describe('warningDetails()：同一份句子，多帶「哪一圈來的、講的是哪幾段」', () => {
  // 一筆什麼都有的來訪：SIS（體內金屬）、兩段重疊、額度超用、沒選治療師、品項不一樣、撞診間
  const ents = [pool('P', 1), { id: 'IV', type: 'single', label: '營養點滴-腸道修復', courseId: 'course-iv-drip', ivProductId: 'iv-gut', totalQty: 5 }];
  const visit = { id: 'v-new', customerId: 'c-wang', customerName: '王小明', date: '2026-10-21', status: 'pending_confirm', slots: [
    { entitlementId: 'P', courseId: 'course-recovery', equipmentId: 'eq-sis', startsAt: '09:00', endsAt: '10:00', status: 'pending_confirm' },
    { entitlementId: 'P', courseId: 'course-recovery', equipmentId: 'eq-indiba', therapistId: 'staff-zn', startsAt: '09:30', endsAt: '10:30', status: 'pending_confirm' },
    { entitlementId: 'IV', courseId: 'course-iv-drip', ivProductId: 'iv-liver', roomId: 'room-iv5', startsAt: '14:00', endsAt: '15:30', status: 'pending_confirm' },
  ] };
  const other = { id: 'v-lee', customerId: 'c-lee', customerName: '李小華', date: '2026-10-21', status: 'confirmed', slots: [
    { courseId: 'course-iv-drip', roomId: 'room-iv5', startsAt: '14:30', endsAt: '16:00', status: 'confirmed' }] };
  const check = { customer: WANG, entitlements: ents, ...master, customerVisits: [], sameDayVisits: [other] };
  const details = warningDetails(visit, check);
  const of = (source) => details.filter((w) => w.source === source);

  test('句子與順序跟 validateVisit().warnings 一模一樣', () => {
    assert.deepEqual(details.map((w) => w.text), validateVisit(visit, check).warnings);
    assert.ok(details.length >= 6);
  });

  test('每一句知道自己是哪一圈來的、講的是哪幾段', () => {
    assert.deepEqual(of('notice').map((w) => [w.slots, /體內金屬/.test(w.text)]), [[[0], true]]);
    assert.deepEqual(of('overlap').map((w) => w.slots), [[0, 1]]);
    assert.deepEqual(of('entitlement').map((w) => [w.slots, /超過總次數/.test(w.text)]), [[[0, 1], true]]);
    assert.deepEqual(of('ivMismatch').map((w) => [w.slots, /品項跟買的不一樣/.test(w.text)]), [[[2], true]]);
    assert.deepEqual(of('conflict').map((w) => [w.slots, /已經排了 李小華/.test(w.text)]), [[[2], true]]);
    assert.ok(of('assign').some((w) => w.slots[0] === 0 && /還沒選治療師/.test(w.text)));
    assert.ok(!of('assign').some((w) => /品項/.test(w.text)), '品項不一樣不跟「還沒選治療師」混在同一種');
  });

  test('哪幾種算「不點開也要看得到」只寫在 mustSee()：器材對警示、重疊、超用與到期、品項不一樣、撞到別人', () => {
    assert.deepEqual([...new Set(details.filter(mustSee).map((w) => w.source))].sort(),
      ['conflict', 'entitlement', 'ivMismatch', 'notice', 'overlap']);
    assert.equal(mustSee({ source: 'assign' }), false, '「還沒選治療師」那一類幾乎每一列都有，照舊點開才看');
    assert.equal(mustSee({ source: 'nth' }), false);
    assert.equal(mustSee({ source: 'frequency' }), false);
  });

  test('取消掉的段照舊不講（濾在每一圈自己身上）', () => {
    const gone = { ...visit, slots: visit.slots.map((s, i) => (i === 0 ? { ...s, status: 'cancelled' } : s)) };
    assert.ok(!warningDetails(gone, check).some((w) => w.slots.includes(0)));
  });
});

// ---------- 拍 Abovee：歸到各列、確認框 ----------

describe('體內金屬排 SIS 而且超用的那一列', () => {
  const used = { id: 'v-old', customerId: 'c-wang', date: '2026-01-06', status: 'done',
    slots: [{ entitlementId: 'P', courseId: 'course-recovery', equipmentId: 'eq-indiba', startsAt: '09:00', endsAt: '10:00', status: 'done' }] };
  const ctx = { customers: [WANG, LEE], entitlementsBy: { 'c-wang': [pool('P', 1)], 'c-lee': [pool('L', 12)] }, visitsBy: { 'c-wang': [used] }, master, today: TODAY };
  const { items } = readAbovee([photo(['確認前往', '2026-10-21', '09:00 - 10:15', '王小明', '00001234', 'SIS 60', ''])], ctx);

  test('那一列預設打勾（Abovee 上已經約了）', () => {
    assert.deepEqual([items[0].kind, items[0].checked, items[0].entitlementId], ['new', true, 'P']);
  });

  test('收起來那一行要畫的：那兩句都在，「還沒選治療師」不在', () => {
    const { byRow } = planned(ctx, items);
    const { mustSee: shut, all } = byRow[items[0].key];
    assert.equal(shut.length, 2);
    assert.ok(shut.some((t) => /SIS 對「體內金屬」要注意/.test(t)));
    assert.ok(shut.some((t) => /排完這次會超過總次數/.test(t)));
    assert.ok(all.some((t) => /還沒選治療師/.test(t)), '點開之後照舊看得到');
    assert.ok(shut.every((t) => all.includes(t)), '收著畫的是點開那一份的子集，同一句');
  });

  test('存檔前那一道：講「其中 1 段有提醒」，那兩句列出來', () => {
    const { groups, flagged } = planned(ctx, items);
    const { lines } = aboveeConsequences({ groups, coursesById, today: TODAY, flagged });
    assert.ok(lines.some((l) => /其中 1 段有提醒/.test(l)), lines.join('｜'));
    assert.ok(lines.some((l) => /王小明 10\/21\(三\).*SIS 對「體內金屬」要注意/.test(l)), lines.join('｜'));
    assert.ok(lines.some((l) => /王小明 10\/21\(三\).*排完這次會超過總次數/.test(l)), lines.join('｜'));
    assert.ok(!lines.some((l) => /還沒選治療師/.test(l)));
  });

  test('沒打勾的列不會寫進去 —— 不算進那一道', () => {
    const { groups, flagged } = planned(ctx, items.map((i) => ({ ...i, checked: false })));
    assert.deepEqual([groups.length, flagged.length], [0, 0]);
  });
});

describe('只畫這一列自己的', () => {
  // 同一位同一天三列：只有 SIS 那一列有事（李小華身上沒有警示，換王小明）
  const ctx = { customers: [WANG, LEE], entitlementsBy: { 'c-wang': [pool('P', 12)] }, visitsBy: {}, master, today: TODAY };
  const rows = [
    ['確認前往', '2026-10-21', '09:00 - 10:15', '王小明', '00001234', 'IN 60', ''],
    ['確認前往', '2026-10-21', '11:00 - 12:15', '王小明', '00001234', 'SIS 60', ''],
    ['確認前往', '2026-10-21', '14:00 - 15:15', '王小明', '00001234', 'IN 60', ''],
  ];
  const { items } = readAbovee([photo(...rows)], ctx);

  test('另外兩列一個字都不多；確認框的 N 是 1、那一句只出現一次', () => {
    const { groups, byRow, flagged } = planned(ctx, items);
    assert.equal(groups.length, 1);
    assert.deepEqual(items.map((i) => byRow[i.key].mustSee.length), [0, 1, 0]);
    assert.match(byRow[items[1].key].mustSee[0], /11:00 的 SIS\(60\)：SIS 對「體內金屬」要注意/);
    const { lines } = aboveeConsequences({ groups, coursesById, today: TODAY, flagged });
    assert.ok(lines.some((l) => /其中 1 段有提醒/.test(l)));
    assert.equal(lines.filter((l) => /體內金屬/.test(l)).length, 1);
  });

  test('併進既有那一天：那一天原本那一段的提醒不掛到這一次的列上', () => {
    const there = { id: 'v1', customerId: 'c-wang', customerName: '王小明', date: '2026-10-21', status: 'pending_confirm',
      slots: [{ entitlementId: 'P', courseId: 'course-recovery', equipmentId: 'eq-sis', startsAt: '16:00', endsAt: '17:00', status: 'pending_confirm' }] };
    const c = { ...ctx, visitsBy: { 'c-wang': [there] } };
    const { items: one } = readAbovee([photo(rows[0])], c);
    const { byRow } = planned(c, one);
    assert.deepEqual(byRow[one[0].key].mustSee, [], '16:00 那一段的體內金屬不是這一列的事');
  });

  test('兩列扣同一筆、合起來才超用：那一句兩列都有，確認框只講一次、N 是 2', () => {
    const c = { ...ctx, customers: [LEE, WANG], entitlementsBy: { 'c-lee': [pool('L', 1)] } };
    const two = readAbovee([photo(
      ['確認前往', '2026-10-21', '09:00 - 10:15', '李小華', '00005678', 'IN 60', ''],
      ['確認前往', '2026-10-21', '14:00 - 15:15', '李小華', '00005678', 'IN 60', ''],
    )], c).items;
    const { groups, byRow, flagged } = planned(c, two);
    assert.deepEqual(two.map((i) => byRow[i.key].mustSee.length), [1, 1]);
    const { lines } = aboveeConsequences({ groups, coursesById, today: TODAY, flagged });
    assert.ok(lines.some((l) => /其中 2 段有提醒/.test(l)));
    assert.equal(lines.filter((l) => /超過總次數/.test(l)).length, 1);
  });
});

describe('沒有提醒的那一次，畫面一個字都不多', () => {
  const ctx = { customers: [LEE], entitlementsBy: { 'c-lee': [pool('L', 12)] }, visitsBy: {}, master, today: TODAY };
  const { items } = readAbovee([photo(['確認前往', '2026-10-21', '09:00 - 10:15', '李小華', '00005678', 'IN 60', ''])], ctx);

  test('那一列沒有要畫的；確認框跟沒有這個功能時一模一樣', () => {
    const { groups, byRow, flagged } = planned(ctx, items);
    assert.deepEqual(byRow[items[0].key].mustSee, []);
    assert.deepEqual(flagged, []);
    assert.deepEqual(aboveeConsequences({ groups, coursesById, today: TODAY, flagged }),
      aboveeConsequences({ groups, coursesById, today: TODAY }));
  });
});

describe('太多句的時候', () => {
  test('那一行：前兩句＋「還有 N 句」', () => {
    assert.deepEqual(briefWarnings(['a', 'b']), ['a', 'b']);
    assert.deepEqual(briefWarnings(['a', 'b', 'c', 'd']), ['a', 'b', '還有 2 句 —— 點開這一列看']);
    assert.deepEqual(briefWarnings([]), []);
  });

  test('確認框：列前幾句＋「還有 N 句」，每一項一句話', () => {
    const flagged = Array.from({ length: 9 }, (_, i) => ({ customerName: '王小明', date: '2026-10-21', texts: [`第 ${i} 句`] }));
    const { lines } = aboveeConsequences({ groups: [], coursesById, today: TODAY, flagged, adopts: [{ diffs: [] }] });
    assert.ok(lines.some((l) => /其中 9 段有提醒/.test(l)));
    assert.equal(lines.filter((l) => /第 \d 句/.test(l)).length, 6);
    assert.ok(lines.some((l) => /還有 3 句/.test(l)));
    assert.ok(lines.every((l) => !l.includes('\n')));
  });
});

// ---------- 畫面真的畫在不用點開的地方（掃原始碼）----------

describe('aboveeConfirm.js：收著的列與確認框', () => {
  const src = readFileSync(new URL('../public/js/ui/components/aboveeConfirm.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const rowHtml = src.slice(src.indexOf('function rowHtml('), src.indexOf('// ---------- 展開的那一列 ----------'));

  test('收著的那一行畫的是 mustSeeBy 那一份，而且不在「點開才有」的那一段裡', () => {
    const at = rowHtml.indexOf('mustSeeBy[item.key]');
    assert.ok(at > 0, 'rowHtml() 要讀 plan() 的 mustSeeBy');
    assert.ok(rowHtml.includes('briefWarnings('), '太多句時收成前幾句');
    const detailAt = rowHtml.indexOf('open ? detailHtml(');
    assert.ok(detailAt > 0);
    const hintAt = rowHtml.indexOf('abl-row__hint--warn');
    assert.ok(hintAt > 0 && hintAt < detailAt, '那一行畫在展開那一塊之前（收著也在）');
  });

  test('句子不是在畫面裡另外寫的：plan() 走 warningDetails() 與 warningsByRow()', () => {
    const plan = src.slice(src.indexOf('function plan()'), src.indexOf('const absentNow'));
    assert.ok(plan.includes('warningDetails('));
    assert.ok(plan.includes('warningsByRow('));
    assert.ok(plan.includes('mustSee'));
    assert.ok(!/startsWith\('這一段'\)/.test(plan), '歸到哪一列照段落的位置，不比字');
  });

  test('確認框拿到的是這一次真的要寫的那幾列的提醒（flagged）', () => {
    const record = src.slice(src.indexOf('async function record('), src.indexOf('const ok = await confirmAction('));
    assert.ok(record.includes('flagged'));
    assert.ok(record.includes('mustSeeBy'));
  });
});
