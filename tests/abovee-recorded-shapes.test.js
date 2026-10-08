// 拍 Abovee：「app 上已經有了」認得三種形狀（prelaunch-fixes-2026-10-08/11）。
//
// 以前只認「同一天、同一個開始時間」。另外兩種再拍一次會被當成新的，照畫面勾下去就扣兩次：
// - **合併扣課的後一半**：app 上是一段（10:30–11:30），照片上是兩列 —— 第二列找不到伴，還叫她「確定是單獨一段再勾」
// - **沒有開始時間的舊段**：合併檔匯進來的來訪有的沒寫時間，比不到
//
// **這一支有沒有任何一條路，讓 app 上只記了前一半時，後一半被吞掉？** —— 沒有：要 app 那一段的時間蓋得住它。
// **有沒有任何一條路，讓一段舊的蓋掉兩列？** —— 沒有：一段只認領一列，取消的列不認領。
// 例子一律假名、1234。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  mismatchSay, needsAttention, newRowSay, planAbovee, readAbovee, recordedSay, summarizeAbovee,
} from '../public/js/domain/aboveeImport.js';
import { aboveeConsequences, closedDayLine, settledDayLine } from '../public/js/domain/consequences.js';
import { SEED } from '../public/js/domain/seed.js';

const master = { courses: SEED.courses, equipment: SEED.equipment, rooms: SEED.rooms, staff: SEED.staff, ivProducts: SEED.ivProducts };
const coursesById = Object.fromEntries(SEED.courses.map((c) => [c.id, c]));
const CUSTOMERS = [{ id: 'c1', name: '王小明', marks: [{ text: '病歷號 1234', color: 'grey' }] }];
const POOL = { id: 'P', type: 'pool', label: '復能-三選一(60)', optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60, totalQty: 12 };
const POOL30 = { id: 'P30', type: 'pool', label: '復能-三選一(30)', optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 30, totalQty: 12 };
const ILIB = { id: 'I', type: 'single', label: 'ILIB(60)', courseId: 'course-iv-laser', durationMin: 60, totalQty: 20 };
const TODAY = '2026-10-08';
const ctx = (visits = [], ents = [POOL]) => ({
  customers: CUSTOMERS, entitlementsBy: { c1: ents }, visitsBy: { c1: visits }, master, today: TODAY,
});
const LEFT = ['預約狀態', '預約日期', '預約時段', '姓名', '病歷號', '課程'];
const row = (status, date, time, course, ...more) => [status, date, time, '王小明', '00001234', course, ...more];
const brief = (items) => items.map((i) => `${i.startsAt} ${i.kind}${i.mergeOrphan ? '(orphan)' : ''}`);

// ---------- 一、合併扣課的後一半 ----------

describe('合併扣課記好之後，同一頁再拍一次', () => {
  const HALVES = [['10:30 - 11:00', 'IN 30'], ['11:00 - 11:30', 'SIS 30']];
  const withColumn = { readable: true, columns: [...LEFT, '合併扣課'],
    rows: HALVES.map(([time, course]) => row('確認前往', '2026-10-21', time, course, '是')) };
  // 沒有那一欄：兩列服務資源同一位治療師、合起來剛好是那一筆的 60 分（`looksMerged()`）
  const noColumn = { readable: true, columns: [...LEFT, '服務資源'],
    rows: HALVES.map(([time, course]) => row('確認前往', '2026-10-21', time, course, '芝寧')) };

  for (const [label, photo] of [['照片上有「合併扣課」那一欄', withColumn], ['照片上沒有那一欄', noColumn]]) {
    test(`${label}：第二次「新的」是 0 段，兩列都是已經記了`, () => {
      const first = readAbovee([photo], ctx());
      assert.equal(first.items.length, 1, '第一次合成一段');
      const saved = { ...planAbovee(first.items, ctx()).groups[0].visit, id: 'v1' };
      assert.deepEqual(saved.slots.map((s) => `${s.startsAt}-${s.endsAt}`), ['10:30-11:30']);

      const again = readAbovee([photo], ctx([saved])).items;
      assert.deepEqual(brief(again), ['10:30 recorded', '11:00 recorded']);
      assert.deepEqual(again.map((i) => [i.checked, needsAttention(i), newRowSay(i)]), [[false, false, ''], [false, false, '']]);
      assert.equal(summarizeAbovee(again).new, 0);
      assert.match(recordedSay(again[1]), /合併扣課的後一半.*10:30/);
      assert.equal(planAbovee(again.map((i) => ({ ...i, checked: true })), ctx([saved])).groups.length, 0, '勾不進去');
    });
  }

  test('app 上真的只記了前一半（30 分的一段）：後一半不被吞掉', () => {
    const half = { id: 'v1', customerId: 'c1', date: '2026-10-21', status: 'pending_confirm',
      slots: [{ entitlementId: 'P30', courseId: 'course-recovery', equipmentId: 'eq-indiba', startsAt: '10:30', endsAt: '11:00', status: 'pending_confirm' }] };
    const again = readAbovee([withColumn], ctx([half], [POOL30])).items;
    assert.deepEqual(brief(again), ['10:30 recorded', '11:00 new(orphan)']);
    const plain = readAbovee([noColumn], ctx([half], [POOL30])).items;
    assert.deepEqual(brief(plain), ['10:30 recorded', '11:00 new']);
  });

  test('有那一欄、後一列沒勾：不當成後一半（那是另外一段）', () => {
    const photo = { ...withColumn, rows: [withColumn.rows[0], row('確認前往', '2026-10-21', '11:00 - 11:30', 'SIS 30', '')] };
    const saved = { id: 'v1', customerId: 'c1', date: '2026-10-21', status: 'pending_confirm',
      slots: [{ entitlementId: 'P', courseId: 'course-recovery', equipmentId: 'eq-indiba', startsAt: '10:30', endsAt: '11:30', status: 'pending_confirm' }] };
    assert.deepEqual(brief(readAbovee([photo], ctx([saved])).items), ['10:30 recorded', '11:00 new']);
  });

  test('後一列是別的課（IN 30 之後接 ILIB）：不當成後一半', () => {
    const photo = { readable: true, columns: LEFT, rows: [
      row('確認前往', '2026-10-21', '10:30 - 11:00', 'IN 30'), row('確認前往', '2026-10-21', '11:00 - 11:30', 'ILIB 30')] };
    const saved = { id: 'v1', customerId: 'c1', date: '2026-10-21', status: 'pending_confirm',
      slots: [{ entitlementId: 'P', courseId: 'course-recovery', equipmentId: 'eq-indiba', startsAt: '10:30', endsAt: '11:30', status: 'pending_confirm' }] };
    const items = readAbovee([photo], ctx([saved], [POOL, ILIB])).items;
    assert.deepEqual(brief(items), ['10:30 recorded', '11:00 new']);
  });

  test('前一列是「還沒簽療程單」的對不上：後一半照樣不是新的（那一句前一列已經講了）', () => {
    const photo = { ...withColumn, rows: HALVES.map(([time, course]) => row('課程完成', '2026-10-01', time, course, '是')) };
    const saved = { id: 'v1', customerId: 'c1', date: '2026-10-01', status: 'confirmed',
      slots: [{ entitlementId: 'P', courseId: 'course-recovery', equipmentId: 'eq-indiba', startsAt: '10:30', endsAt: '11:30', status: 'confirmed' }] };
    const items = readAbovee([photo], ctx([saved])).items;
    assert.deepEqual(items.map((i) => [i.kind, i.reason ?? null]), [['mismatch', 'notClosed'], ['recorded', null]]);
  });

  test('後一半那一列不給「改成 Abovee 的」（那一段的治療師由前一列比）', () => {
    const saved = { id: 'v1', customerId: 'c1', date: '2026-10-21', status: 'pending_confirm',
      slots: [{ entitlementId: 'P', courseId: 'course-recovery', equipmentId: 'eq-indiba', therapistId: 'staff-tw',
        startsAt: '10:30', endsAt: '11:30', status: 'pending_confirm' }] };
    const [a, b] = readAbovee([noColumn], ctx([saved])).items;
    assert.equal(a.diffs?.[0]?.field, 'therapistId');
    assert.equal(b.kind, 'recorded');
    assert.ok(!b.diffs?.length);
  });
});

// ---------- 二、沒有開始時間的舊段 ----------

describe('合併檔匯進來、沒有開始時間的舊段', () => {
  const imported = (over = {}, slot = {}) => ({
    id: 'v1', customerId: 'c1', customerName: '王小明', date: '2026-08-20', status: 'done', importedFrom: { source: 'merge-file' }, ...over,
    slots: [{ entitlementId: 'P', courseId: 'course-recovery', equipmentId: 'eq-sis', startsAt: null, endsAt: null, status: 'done', ...slot }],
  });
  const photo = (...rows) => ({ readable: true, columns: LEFT, rows });
  const SIS = row('課程完成', '2026-08-20', '09:00 - 10:15', 'SIS 60');

  test('照片上同一天同一門課那一列：已經記了，抬頭不寫「新的 1 段」', () => {
    const { items } = readAbovee([photo(SIS)], ctx([imported()]));
    assert.equal(items[0].kind, 'recorded');
    assert.equal(items[0].checked, false);
    assert.match(recordedSay(items[0]), /匯入的舊資料，沒有時間/);
    assert.deepEqual([summarizeAbovee(items).new, summarizeAbovee(items).recorded], [0, 1]);
  });

  test('舊段上沒記器材（匯入的常常沒有）：照樣認領；記的是別台就不是同一段', () => {
    assert.equal(readAbovee([photo(SIS)], ctx([imported({}, { equipmentId: null })])).items[0].kind, 'recorded');
    assert.equal(readAbovee([photo(SIS)], ctx([imported({}, { equipmentId: 'eq-indiba' })])).items[0].kind, 'new');
  });

  test('一段舊的只蓋一列：同一天同一門課兩列，第二列照舊是新的', () => {
    const { items } = readAbovee([photo(SIS, row('課程完成', '2026-08-20', '14:00 - 15:15', 'SIS 60'))], ctx([imported()]));
    assert.deepEqual(brief(items), ['09:00 recorded', '14:00 new']);
  });

  test('Abovee 上已取消的列不認領：真的那一列才是已經記了，也沒有假的「Abovee 上取消了」', () => {
    const gone = row('已取消', '2026-08-20', '09:00 - 10:15', 'SIS 60');
    const real = row('課程完成', '2026-08-20', '14:00 - 15:15', 'SIS 60');
    const { items } = readAbovee([photo(gone, real)], ctx([imported()]));
    assert.deepEqual(items.map((i) => [i.startsAt, i.kind, i.cancelled, i.reason ?? null]),
      [['09:00', 'new', true, null], ['14:00', 'recorded', false, null]]);
    assert.equal(items.filter(needsAttention).length, 0);
  });

  test('同一個時間找得到的那一段優先；沒有時間的那一段留給別列', () => {
    const timed = { id: 'v2', customerId: 'c1', date: '2026-08-20', status: 'done',
      slots: [{ entitlementId: 'P', courseId: 'course-recovery', equipmentId: 'eq-sis', startsAt: '09:00', endsAt: '10:00', status: 'done' }] };
    const two = { ...imported(), slots: [...timed.slots, ...imported().slots] };
    const { items } = readAbovee([photo(SIS, row('課程完成', '2026-08-20', '14:00 - 15:15', 'SIS 60'), row('課程完成', '2026-08-20', '16:00 - 17:15', 'SIS 60'))], ctx([two]));
    assert.deepEqual(brief(items), ['09:00 recorded', '14:00 recorded', '16:00 new']);
    assert.equal(Boolean(items[0].timeless), false);
    assert.equal(items[1].timeless, true);
  });

  test('預約狀態照樣對一次：Abovee 寫完成、app 那一段還沒結案 → 對不上（還沒簽療程單）', () => {
    const open = imported({ status: 'confirmed' }, { status: 'confirmed' });
    const [item] = readAbovee([photo(SIS)], ctx([open])).items;
    assert.deepEqual([item.kind, item.reason], ['mismatch', 'notClosed']);
    assert.match(mismatchSay(item), /還沒簽療程單/);
  });

  test('還沒到的那一天也一樣：那一列不再是新的、不預設打勾（以前勾下去那一天就存不了）', () => {
    const future = imported({ date: '2026-10-20', status: 'confirmed' }, { status: 'confirmed', equipmentId: null });
    const [item] = readAbovee([photo(row('確認前往', '2026-10-20', '09:00 - 10:15', 'SIS 60'))], ctx([future])).items;
    assert.deepEqual([item.kind, item.checked], ['recorded', false]);
  });

  test('沒有時間的舊段不給「改成 Abovee 的」', () => {
    const p = { readable: true, columns: [...LEFT, '服務資源'], rows: [[...SIS, '芝寧']] };
    const [item] = readAbovee([p], ctx([imported({}, { therapistId: 'staff-tw' })])).items;
    assert.equal(item.kind, 'recorded');
    assert.ok(!item.diffs?.length);
  });

  test('合併扣課的兩列對到一段沒有時間的舊段：一起算已經記了', () => {
    const p = { readable: true, columns: [...LEFT, '合併扣課'], rows: [
      row('課程完成', '2026-08-20', '10:30 - 11:00', 'IN 30', '是'), row('課程完成', '2026-08-20', '11:00 - 11:30', 'SIS 30', '是')] };
    const { items } = readAbovee([p], ctx([imported({}, { equipmentId: null })]));
    assert.deepEqual(items.map((i) => i.kind), ['recorded']);
    assert.equal(summarizeAbovee(items).new, 0);
  });
});

// ---------- 三、那一天已經結案了 ----------

describe('確認框：那一天已經結案了，這一段會另開一次新的來訪', () => {
  test('那一句只有一份，壓表那一頁讀它（字一個都沒變）', () => {
    assert.equal(closedDayLine(), '這天已經結案了，所以這一段會另開一次新的來訪');
    const src = readFileSync(new URL('../public/js/ui/views/schedule.js', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('function addNote('), src.indexOf('function dayWarnings('));
    // eslint-disable-next-line no-template-curly-in-string
    assert.ok(body.includes('if (closed.length) return `${closedDayLine()}。`;'), 'addNote() 讀 consequences.js 那一句，後面接句號');
    assert.ok(!src.includes('這天已經結案了'), '畫面裡不留第二份');
  });

  const done = { id: 'v1', customerId: 'c1', customerName: '王小明', date: '2026-10-21', status: 'done',
    slots: [{ entitlementId: 'P', courseId: 'course-recovery', equipmentId: 'eq-sis', startsAt: '09:00', endsAt: '10:00', status: 'done' }] };
  const said = (visits, rows) => {
    const c = ctx(visits, [POOL, ILIB]);
    const { items } = readAbovee([{ readable: true, columns: LEFT, rows }], c);
    const { groups } = planAbovee(items.map((i) => (i.kind === 'new' ? { ...i, checked: true } : i)), c);
    return { groups, lines: aboveeConsequences({ groups, coursesById, today: TODAY }).lines };
  };

  test('那一天已完成，再記一段：講出來是另開一次新的來訪', () => {
    const { groups, lines } = said([done], [row('確認前往', '2026-10-21', '14:00 - 15:15', 'ILIB 60')]);
    assert.equal(groups[0].visit.id, undefined, '真的是新的一筆');
    assert.ok(lines.includes(`王小明 10/21(三)：${closedDayLine()}`), lines.join('｜'));
    assert.ok(!lines.some((l) => l.includes(settledDayLine())), '不是「原本談定的段不動」那一句');
  });

  test('同一天兩段一起記：講「這 2 段」', () => {
    const { lines } = said([done], [row('確認前往', '2026-10-21', '14:00 - 15:15', 'ILIB 60'), row('確認前往', '2026-10-21', '16:00 - 17:15', 'SIS 60')]);
    assert.ok(lines.includes('王小明 10/21(三)：這天已經結案了，所以這 2 段會另開一次新的來訪'), lines.join('｜'));
  });

  test('那一天沒有結案的：不講；併進談定那一天的照舊是另一句', () => {
    assert.ok(!said([], [row('確認前往', '2026-10-21', '14:00 - 15:15', 'ILIB 60')]).lines.some((l) => l.includes('結案')));
    const settled = { ...done, status: 'confirmed', slots: [{ ...done.slots[0], status: 'confirmed' }] };
    const { lines } = said([settled], [row('確認前往', '2026-10-21', '14:00 - 15:15', 'ILIB 60')]);
    assert.ok(lines.some((l) => l.includes(settledDayLine())));
    assert.ok(!lines.some((l) => l.includes('結案')));
  });

  test('那一天的那一筆是取消的：不算結案，不講', () => {
    const gone = { ...done, status: 'cancelled', slots: [{ ...done.slots[0], status: 'cancelled' }] };
    assert.ok(!said([gone], [row('確認前往', '2026-10-21', '14:00 - 15:15', 'ILIB 60')]).lines.some((l) => l.includes('結案')));
  });
});
