// 拍 Abovee：確認層「要改的」那一塊（abovee-status-follows-photo-2026-10-15/07）。
//
// 她 10/15：「如果是修改的，可以區分開來，像是狀態不同，醫師診間時間那些等等，不會動到次數的，就是寫的簡短，
// 誰的什麼時候的甚麼改了，打勾就只是改狀態那些等等，不要多記或少記次數! 次數不能弄錯這很重要 ! !」
//
// 句子與次數那一個括號都在 domain（`changeLines()`），括號讀計畫（`photoDayPlan()` 的 `rows`），畫面只畫。例子一律假名。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  changeLines, needsAttention, offersChange, pastStillOpen, photoDayPlan, readAbovee, recordBar, recordBarSay, summarizeAbovee, wantsWrite,
} from '../public/js/domain/aboveeImport.js';
import { aboveeConsequences } from '../public/js/domain/consequences.js';
import { visitStatusFrom } from '../public/js/domain/visits.js';
import { SEED } from '../public/js/domain/seed.js';

const TODAY = '2026-09-12';
const COLS = ['預約狀態', '預約日期', '預約時段', '姓名', '病歷號', '課程', '診間', '服務資源'];
const POOL = { id: 'w-pool', type: 'pool', label: '復能-三選一(60)', optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60, totalQty: 10 };
const PEOPLE = [{ id: 'c-wang', name: '王小明', marks: [{ text: '病歷號 1234', color: 'grey' }] }];
const coursesById = Object.fromEntries(SEED.courses.map((c) => [c.id, c]));

const sis = (startsAt, endsAt, status, over = {}) => ({
  entitlementId: 'w-pool', courseId: 'course-recovery', equipmentId: 'eq-sis', startsAt, endsAt, status, attended: null,
  therapistId: null, ...over,
});
const visit = (id, date, slots) => ({ id, customerId: 'c-wang', customerName: '王小明', date,
  status: visitStatusFrom({ status: 'pending_confirm', slots }), slots });
const ctx = (visits) => ({
  customers: PEOPLE, entitlementsBy: { 'c-wang': [POOL] }, visitsBy: { 'c-wang': visits },
  master: { courses: SEED.courses, equipment: SEED.equipment, rooms: SEED.rooms, staff: SEED.staff, ivProducts: SEED.ivProducts },
  today: TODAY,
});
const row = (status, date, time, course, resource = '') => [status, date, time, '王小明', '00001234', course, '', resource];
const read = (rows, c) => readAbovee([{ columns: COLS, rows, pageText: `${rows.length}筆第1/1頁` }], c).items;

describe('一張照片：取消一段、過去的完成一段、改期一段、兩段補上治療師', () => {
  const visits = [
    visit('v08', '2026-09-08', [sis('09:00', '10:00', 'done', { therapistId: 'staff-zn', attended: true })]),
    visit('v10', '2026-09-10', [sis('10:00', '11:00', 'pending_confirm', { therapistId: 'staff-zn' })]),
    visit('v14', '2026-09-14', [sis('14:00', '15:00', 'confirmed', { therapistId: 'staff-zn' })]),
    visit('v16', '2026-09-16', [sis('10:00', '11:00', 'confirmed', { therapistId: 'staff-zn' })]),
    visit('v18', '2026-09-18', [sis('10:00', '11:00', 'confirmed')]),
    visit('v19', '2026-09-19', [sis('10:00', '11:00', 'confirmed')]),
    visit('v20', '2026-09-20', [sis('10:00', '11:00', 'confirmed', { therapistId: 'staff-zn' })]),
  ];
  const c = ctx(visits);
  const items = read([
    row('課程完成', '2026-09-08', '09:00 - 10:00', 'SIS 60', '芝寧'),
    row('課程完成', '2026-09-10', '10:00 - 11:00', 'SIS 60', '芝寧'),
    row('確認前往', '2026-09-14', '15:00 - 16:00', 'SIS 60', '芝寧'),
    row('已取消', '2026-09-16', '10:00 - 11:00', 'SIS 60', '芝寧'),
    row('確認前往', '2026-09-18', '10:00 - 11:00', 'SIS 60', '芝寧'),
    row('確認前往', '2026-09-19', '10:00 - 11:00', 'SIS 60', '芝寧'),
    row('確認前往', '2026-09-20', '10:00 - 11:00', 'SIS 60', '芝寧'),
  ], c);
  const keyOn = (date) => items.find((i) => i.date === date).key;

  test('三行＋一行補上、全部預設勾；抬頭「要改 5 段」；一列都不在「要你看」', () => {
    const { lines, fill } = changeLines(items, photoDayPlan(items, c), c);
    assert.equal(lines.length, 3, lines.map((l) => l.text).join('\n'));
    assert.ok(lines.every((l) => l.on));
    assert.deepEqual(fill.keys, [keyOn('2026-09-18'), keyOn('2026-09-19')]);
    assert.equal(fill.on, true);
    assert.equal(fill.text, '另外 2 段補上治療師');
    assert.equal(summarizeAbovee(items).changes, 5);
    assert.equal(items.filter(offersChange).filter(needsAttention).length, 0);
    assert.equal(items.filter(wantsWrite).length, 5);
  });

  test('一行一件事、誰的什麼時候的什麼；括號是計畫算的次數', () => {
    const { lines, fill } = changeLines(items, photoDayPlan(items, c), c);
    const text = Object.fromEntries(lines.map((l) => [l.key, l.text]));
    assert.equal(text[keyOn('2026-09-10')], '王小明 9/10(四) 10:00 SIS(60)：待確認 → 已完成（次數不變）');
    assert.equal(text[keyOn('2026-09-14')], '王小明 9/14(一) 14:00 SIS(60)：14:00 → 15:00（次數不變）');
    assert.equal(text[keyOn('2026-09-16')], '王小明 9/16(三) 10:00 SIS(60)：已確認 → 已取消（還 1 次）');
    assert.equal(fill.details[0], '王小明 9/18(五) 10:00 SIS(60)：治療師 芝寧');
  });

  test('拿掉一個勾：那一件不改、寫「不改」，其餘照改；拿掉「補上」那一行少 2', () => {
    const off = items.map((i) => (i.key === keyOn('2026-09-14') ? { ...i, adoptMove: false } : i));
    const p = photoDayPlan(off, c);
    const { lines } = changeLines(off, p, c);
    assert.equal(lines.find((l) => l.key === keyOn('2026-09-14')).text, '王小明 9/14(一) 14:00 SIS(60)：14:00 → 15:00（不改）');
    assert.equal(p.rows.some((r) => r.kind === 'move'), false);
    assert.deepEqual(p.writes.find((w) => w.id === 'v14'), undefined);
    assert.equal(off.filter(wantsWrite).length, 4);
    const noFill = items.map((i) => (changeLines(items, null, c).fill.keys.includes(i.key) ? { ...i, adopt: false } : i));
    assert.equal(noFill.filter(wantsWrite).length, 3);
    assert.equal(changeLines(noFill, photoDayPlan(noFill, c), c).fill.text, '另外 2 段補上治療師（不補）');
  });

  test('確認框：改這 5 段、補上那幾段分開講', () => {
    const { title, lines } = aboveeConsequences({ plan: photoDayPlan(items, c), coursesById, today: TODAY });
    assert.equal(title, '改這 5 段？');
    assert.ok(lines.includes('補上 2 段的治療師（app 上原本空著）'), lines.join('\n'));
  });
});

test('不扣額度的那一段（功醫門診，體驗）改成已取消 → 「本來就不扣次數」', () => {
  const fm = { entitlementId: null, courseId: 'course-fm', startsAt: '10:00', endsAt: '10:30', status: 'confirmed', attended: null, giftKind: 'trial' };
  const c = ctx([visit('v16', '2026-09-16', [fm])]);
  const items = read([row('已取消', '2026-09-16', '10:00 - 10:30', '功醫門診')], c);
  const { lines } = changeLines(items, photoDayPlan(items, c), c);
  assert.match(lines[0].text, /：已確認 → 已取消（本來就不扣次數）$/);
});

test('沒有要改的 → 沒有一行（畫面上那一塊一個像素都不佔）', () => {
  const c = ctx([visit('v16', '2026-09-16', [sis('10:00', '11:00', 'confirmed', { therapistId: 'staff-zn' })])]);
  const items = read([row('確認前往', '2026-09-16', '10:00 - 11:00', 'SIS 60', '芝寧')], c);
  assert.deepEqual(changeLines(items, photoDayPlan(items, c), c), { lines: [], fill: null });
});

describe('段四她回的（中途發現 5、14、15）', () => {
  // 今天 9/12：9/8 照片寫確認前往、app 上沒有；9/9 照片寫聯繫中、app 上已確認（兩邊都還沒結案）；9/20 聯繫中（新的、勾著）
  const visits = [visit('v09', '2026-09-09', [sis('10:00', '11:00', 'confirmed', { therapistId: 'staff-zn' })])];
  const c = ctx(visits);
  const items = read([
    row('確認前往', '2026-09-08', '09:00 - 10:00', 'SIS 60', '芝寧'),
    row('聯繫中', '2026-09-09', '10:00 - 11:00', 'SIS 60', '芝寧'),
    row('聯繫中', '2026-09-20', '10:00 - 11:00', 'SIS 60', '芝寧'),
  ], c);

  test('5：日子過了、Abovee 上還沒結案的兩種（新的、兩邊都開著）收起來，不算進「要你看」', () => {
    assert.deepEqual(items.map((i) => [i.kind, i.reason ?? null, pastStillOpen(i)]),
      [['new', null, true], ['mismatch', 'bothOpen', true], ['new', null, false]]);
    const s = summarizeAbovee(items);
    assert.deepEqual([s.attention, s.pastOpen], [0, 2]);
  });

  test('15：確認框講照片上寫的那幾個字，不把聯繫中說成確認前往', () => {
    const { lines } = aboveeConsequences({ plan: photoDayPlan(items, c), coursesById, today: TODAY });
    assert.ok(lines.includes('每一段都記成「待確認」—— Abovee 上寫的「聯繫中」不等於問過客人'), lines.join('\n'));
  });

  test('14：照 Abovee 改狀態、次數不變的也寫括號', () => {
    const v10 = [visit('v10', '2026-09-10', [sis('10:00', '11:00', 'pending_confirm', { therapistId: 'staff-zn' })])];
    const cc = ctx(v10);
    const done = read([row('課程完成', '2026-09-10', '10:00 - 11:00', 'SIS 60', '芝寧')], cc);
    const { lines } = aboveeConsequences({ plan: photoDayPlan(done, cc), coursesById, today: TODAY });
    assert.ok(lines.includes('照 Abovee 改成「已完成」1 段（次數不變）'), lines.join('\n'));
  });
});

describe('底下那一顆數的是真的會寫的（10/16 審查）', () => {
  // 要改的每一件這一次都改不成時（她看到的那一段剛在別的地方改過、二返簽不成…），以前那一顆照樣寫「改這 1 段」、按得下去，
  // 按了什麼都沒發生（`save()` 看到一筆都不寫就安靜地回去）
  const v16 = visit('v16', '2026-09-16', [sis('10:00', '11:00', 'confirmed')]);
  const c = ctx([v16]);
  const [item] = read([row('已取消', '2026-09-16', '10:00 - 11:00', 'SIS 60')], c);

  test('改得成：改 1 段、沒有要講的', () => {
    assert.deepEqual(recordBar([item], photoDayPlan([item], c)), { fresh: 0, changed: 1, stuck: 0, cannot: 0 });
  });

  test('她看到的那一段剛在別的地方改過：0 段、1 段改不成', () => {
    const stale = { ...item, existing: { ...item.existing, status: 'pending_confirm' } };
    const p = photoDayPlan([stale], c);
    assert.equal(p.writes.length, 0);
    assert.deepEqual(recordBar([stale], p), { fresh: 0, changed: 0, stuck: 0, cannot: 1 });
    assert.match(recordBarSay(recordBar([stale], p)), /1 段這一次改不成/);
  });
});

describe('同一列一件改成了、一件沒改成（10/16 審查）', () => {
  // 9/10 那一段：照片寫課程完成、治療師也不一樣。治療師那一格她看到之後在別的地方又改過（stale），狀態照改。
  // 沒改成的那一件要記著是哪一格 —— 以前存完整列的勾都拿掉、那一列變回沒記，狀態那一行寫「不改」，其實已經改了
  const v10 = visit('v10', '2026-09-10', [sis('10:00', '11:00', 'pending_confirm', { therapistId: 'staff-zn' })]);
  const c = ctx([v10]);
  const [item] = read([row('課程完成', '2026-09-10', '10:00 - 11:00', 'SIS 60', '騰崴')], c);

  test('那一列兩件都要改、都預設勾', () => {
    assert.deepEqual([item.statusChange?.to, item.adoptStatus, item.diffs?.[0]?.field, item.adopt], ['done', true, 'therapistId', true]);
  });

  test('治療師沒改成：missed 記著是 adopt 那一格；狀態照改', () => {
    const seen = { ...item, diffs: item.diffs.map((d) => ({ ...d, app: 'staff-tw' })) };
    const p = photoDayPlan([seen], c);
    assert.deepEqual(p.missed.map((m) => [m.key, m.missedWhy, m.missedField]), [[item.key, 'stale', 'adopt']]);
    assert.deepEqual(p.rows.map((r) => r.kind), ['status']);
    const { lines } = changeLines([seen], p, c);
    assert.match(lines.find((l) => l.field === 'adoptStatus').text, /（次數不變）/);
    assert.match(lines.find((l) => l.field === 'adopt').text, /這一次改不成 —— 那一段剛在別的地方改過/);
  });
});
