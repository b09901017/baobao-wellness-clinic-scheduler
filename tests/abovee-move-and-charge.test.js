// 拍 Abovee：Abovee 上同一段改了時間、也改了扣法（staging-polish 16，中途發現「段四 1」）。
//
// 她 10/19：「做，照你的建議」—— 認出改期之後也比一次扣法（ADR-0154），有差就在「要改的」多一行。
// 以前改期那一條路不經過 `chargeChangeOf()`：Abovee 上把 EECP 60 改到 11:00 又改成 EECP20，app 照「改期」整段抄舊的
// （扣額度、60 分），新的那一段不會順便變成體驗、也不講。
//
// 判準：**次數照 `counts()`**（確認框的括號加起來＝前後的差）、新的那一段的時長照扣法套過之後的那一段。例子一律假名。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { readAbovee, photoDayPlan, changeLines, recordedSay } from '../public/js/domain/aboveeImport.js';
import { counts } from '../public/js/domain/entitlements.js';
import { SEED } from '../public/js/domain/seed.js';

const COURSES = SEED.courses.map((c) => ({ ...c, active: true }));
const MASTER = { courses: COURSES, equipment: SEED.equipment, rooms: SEED.rooms, staff: SEED.staff, ivProducts: SEED.ivProducts };
const EECP_ENT = { id: 'w-eecp', customerId: 'c-wang', type: 'single', label: 'EECP', courseId: 'course-eecp', totalQty: 10, durationMin: 60 };

const TODAY = '2026-10-18';
const DAY = '2026-10-20';
const COLS = ['預約狀態', '預約日期', '預約時段', '姓名', '病歷號', '課程'];
const PEOPLE = [{ id: 'c-wang', name: '王小明', marks: [{ text: '病歷號 1234', color: 'grey' }] }];
const ctx = (visits = [], { today = TODAY, ents = [EECP_ENT] } = {}) => ({
  customers: PEOPLE, entitlementsBy: { 'c-wang': ents }, visitsBy: { 'c-wang': visits }, master: MASTER, today,
});
const prow = (time, course, status = '確認前往') => [status, DAY, time, '王小明', '00001234', course];
const read = (rows, c) => readAbovee([{ columns: COLS, rows, pageText: `${rows.length}筆第1/1頁` }], c).items;
const eecp = (over = {}) => ({
  entitlementId: 'w-eecp', courseId: 'course-eecp', courseName: 'EECP', roomId: 'room-t5', bed: null,
  startsAt: '10:00', endsAt: '11:00', minutes: 60, giftKind: null, status: 'confirmed', attended: null, ...over,
});
const visitOf = (slots) => ({ id: 'v1', customerId: 'c-wang', customerName: '王小明', date: DAY, status: 'confirmed', slots });
const booked = (visits) => counts(EECP_ENT, visits, 'w-eecp').booked;
/** 「要改的」那幾行括號加起來（扣 +1、還 −1） */
const said = (lines) => lines.reduce((sum, l) => {
  for (const m of l.text.matchAll(/（(扣|還) (\d+) 次）/g)) sum += (m[1] === '扣' ? 1 : -1) * Number(m[2]);
  return sum;
}, 0);

describe('app 10:00 EECP 60 扣額度、照片 11:00 EECP20：改期＋改成體驗', () => {
  const v1 = visitOf([eecp()]);
  const c = ctx([v1]);
  const [item] = read([prow('11:00 - 11:20', 'EECP20')], c);

  test('那一列是改期，也帶著扣法不一樣，兩件都預設勾', () => {
    assert.equal(item.kind, 'recorded');
    assert.equal(item.move?.slot.startsAt, '11:00');
    assert.equal(item.adoptMove, true);
    assert.deepEqual(item.chargeChange, { to: 'trial', entitlementId: null, minutes: 20 });
    assert.equal(item.adoptCharge, true);
    assert.equal(item.existing.entitlementId, 'w-eecp', '寫之前比的那一格：她看到的時候扣著哪一筆');
    assert.match(recordedSay(item), /11:00/);
    assert.match(recordedSay(item), /體驗/);
  });

  test('「要改的」兩行：改期一行、扣法一行；括號加起來是還 1 次', () => {
    const p = photoDayPlan([item], c);
    const { lines } = changeLines([item], p, c);
    assert.deepEqual(lines.map((l) => l.field).sort(), ['adoptCharge', 'adoptMove']);
    assert.match(lines.find((l) => l.field === 'adoptCharge').text, /改成體驗 20 分，不扣/);
    assert.equal(said(lines), -1, lines.map((l) => l.text).join('\n'));
  });

  test('套上去：10:00 取消、11:00 是體驗 20 分（11:20 結束）；那一筆 EECP 已排少 1，跟計畫的 rows 一樣', () => {
    const p = photoDayPlan([item], c);
    assert.deepEqual(p.missed, []);
    const [w] = p.writes;
    const [old, fresh] = w.visit.slots;
    assert.deepEqual([old.startsAt, old.status], ['10:00', 'cancelled']);
    assert.deepEqual([fresh.startsAt, fresh.endsAt, fresh.entitlementId, fresh.giftKind, fresh.minutes, fresh.roomId],
      ['11:00', '11:20', null, 'trial', 20, 'room-t5']);
    assert.equal(booked([v1]) - booked([w.visit]), 1);
    assert.equal(p.rows.reduce((s, r) => s + r.charge, 0), -1);
  });

  test('只拿掉扣法那一個勾：照舊改期、扣額度、60 分', () => {
    const off = { ...item, adoptCharge: false };
    const [w] = photoDayPlan([off], c).writes;
    const fresh = w.visit.slots[1];
    assert.deepEqual([fresh.startsAt, fresh.endsAt, fresh.entitlementId, fresh.giftKind ?? null], ['11:00', '12:00', 'w-eecp', null]);
    assert.equal(booked([v1]) - booked([w.visit]), 0);
  });
});

test('反過來：app 10:00 體驗 20、照片 11:00 EECP60 → 改期＋改成扣那一筆 EECP、60 分（扣 1 次）', () => {
  const v1 = visitOf([eecp({ entitlementId: null, giftKind: 'trial', minutes: 20, endsAt: '10:20' })]);
  const c = ctx([v1]);
  const [item] = read([prow('11:00 - 12:00', 'EECP60')], c);
  assert.equal(item.adoptMove, true);
  assert.deepEqual(item.chargeChange, { to: 'counted', entitlementId: 'w-eecp', minutes: 60 });
  assert.equal(item.adoptCharge, true);
  const p = photoDayPlan([item], c);
  const fresh = p.writes[0].visit.slots[1];
  assert.deepEqual([fresh.startsAt, fresh.endsAt, fresh.entitlementId, fresh.giftKind ?? null, fresh.minutes], ['11:00', '12:00', 'w-eecp', null, 60]);
  assert.equal(booked([p.writes[0].visit]) - booked([v1]), 1);
  assert.equal(said(changeLines([item], p, c).lines), 1);
});

test('改期沒先勾（日子過了照片還寫確認前往）→ 扣法也不先勾', () => {
  const v1 = visitOf([eecp()]);
  const c = ctx([v1], { today: '2026-10-25' });
  const [item] = read([prow('11:00 - 11:20', 'EECP20')], c);
  assert.equal(item.move?.slot.startsAt, '11:00');
  assert.equal(item.adoptMove, false);
  assert.ok(item.chargeChange, '照樣講出來');
  assert.equal(item.adoptCharge, false);
});

test('扣法一樣的改期：沒有扣法那一行，跟以前一模一樣', () => {
  const v1 = visitOf([eecp()]);
  const c = ctx([v1]);
  const [item] = read([prow('11:00 - 12:00', 'EECP60')], c);
  assert.equal(item.adoptMove, true);
  assert.equal(item.chargeChange, null);
  assert.equal(item.adoptCharge, false);
  assert.deepEqual(changeLines([item], photoDayPlan([item], c), c).lines.map((l) => l.field), ['adoptMove']);
});
