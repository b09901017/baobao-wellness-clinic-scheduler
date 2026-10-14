// 拍 Abovee 讀「預約來源」：寫「體驗」的那一列自動標體驗、不用額度（2026-10-14，gift-and-trial 06）。
//
// 她的原話：
//
// > 然後abovee拍照也可以辨識出來就不用還要先去新增額度才能辨識或是新增 (因為目前是不是要先有一筆額度可以扣。沒有的話那一段存不下去，要先加一筆送的 ? )
//
// Abovee 把「體驗」寫在預約來源那一欄（其他值是正式課、顧客會、合作機構名），課程那一格寫的是 `IN 30`、`復健門診`。
// 抄字照抄那一格（ADR-0099：不長「是不是體驗」的欄），翻譯只有 `isTrialRow()` 一支。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  ABOVEE_KEYS, isTrialRow, mergeAboveePhotos, mergeRows, planAbovee, readAbovee, resolveItem, warningsByRow,
} from '../public/js/domain/aboveeImport.js';
import { ABOVEE_COLUMNS } from '../public/js/domain/transcripts.js';
import { ABOVEE_COLUMNS as FN_COLUMNS } from '../functions/transcripts/aboveeList.js';
import { SEED } from '../public/js/domain/seed.js';
import { counts } from '../public/js/domain/entitlements.js';

const chart = (no) => [{ text: `病歷號 ${no}`, color: 'grey' }];
const CUSTOMERS = [
  { id: 'c-wang', name: '王小明', marks: chart('1234') },
  { id: 'c-a', name: '客戶A', marks: chart('5678') },
];
const POOL30 = {
  id: 'w-pool', type: 'pool', label: '復能-三選一(30)', optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'],
  durationMin: 30, totalQty: 5,
};
const CARDIO = { id: 'w-cardio', type: 'single', label: '心臟科評估', courseId: 'course-cardio', totalQty: 1 };
const EXAM = { id: 'w-exam', type: 'single', label: '健檢', courseId: 'course-checkup', totalQty: 2 };
const MASTER = { courses: SEED.courses, equipment: SEED.equipment, rooms: SEED.rooms, staff: SEED.staff, ivProducts: SEED.ivProducts };
const ctx = (entitlementsBy = { 'c-wang': [POOL30], 'c-a': [] }, over = {}) => ({
  customers: CUSTOMERS, entitlementsBy, visitsBy: {}, master: MASTER, today: '2026-10-01', ...over,
});
const COLS = ['預約狀態', '預約日期', '預約時段', '姓名', '病歷號', '課程', '預約來源'];
const row = (course, source, { name = '王小明', chartNo = '00001234', time = '10:00 - 11:15' } = {}) =>
  ['確認前往', '2026-10-10', time, name, chartNo, course, source];
const read = (course, source, c = ctx(), who) => readAbovee([{ columns: COLS, rows: [row(course, source, who)] }], c).items[0];

describe('抄字多一欄「預約來源」（兩份一樣、不長翻譯欄）', () => {
  test('兩份 ABOVEE_COLUMNS 都有預約來源，列上叫 source', () => {
    assert.ok(ABOVEE_COLUMNS.includes('預約來源'));
    assert.deepEqual([...FN_COLUMNS], [...ABOVEE_COLUMNS]);
    assert.equal(ABOVEE_KEYS.預約來源, 'source');
  });

  test('isTrialRow：那一格去空白後含「體驗」才是', () => {
    assert.equal(isTrialRow({ source: '體驗' }), true);
    assert.equal(isTrialRow({ source: ' 體 驗 ' }), true);
    assert.equal(isTrialRow({ source: '正式課' }), false);
    assert.equal(isTrialRow({ source: '顧客會' }), false);
    assert.equal(isTrialRow({ source: '' }), false);
    assert.equal(isTrialRow({}), false);
    assert.equal(isTrialRow(null), false);
  });
});

describe('寫體驗的那一列 → 體驗、不扣', () => {
  test('IN 30＋體驗、身上有 復能-三選一(30) 剩 5 → 預選體驗的復能、INDIBA 30 分、不扣', () => {
    const item = { ...read('IN 30', '體驗'), therapistId: 'staff-tw' };
    assert.equal(item.kind, 'new');
    assert.equal(item.entitlementId, null, '就算身上有那門課的額度也不扣（她選的第一題）');
    assert.equal(item.giftCourseId, 'course-recovery');
    assert.equal(item.giftKind, 'trial');
    assert.equal(item.equipmentId, 'eq-indiba');
    const { groups, problems } = planAbovee([{ ...item, checked: true }], ctx());
    assert.deepEqual(problems, {});
    const slot = groups[0].visit.slots[0];
    assert.equal(slot.equipmentId, 'eq-indiba');
    assert.equal(slot.entitlementId, null);
    assert.equal(slot.giftKind, 'trial');
    assert.equal(slot.endsAt, '10:30');
    assert.equal(counts(POOL30, [groups[0].visit]).remaining, 5, '剩 5 不變');
  });

  test('復健門診＋體驗、沒有任何額度 → 體驗的復健門診（以前存不下去）', () => {
    const item = read('復健門診', '體驗', ctx(), { name: '客戶A', chartNo: '00005678' });
    assert.equal(item.giftCourseId, 'course-rehab');
    assert.equal(item.giftKind, 'trial');
  });

  test('換一位：體驗照樣成立（那是照片上的字，不是認人的結果）', () => {
    const item = read('IN 30', '體驗');
    const again = resolveItem(item, 'c-a', ctx());
    assert.equal(again.giftCourseId, 'course-recovery');
    assert.equal(again.giftKind, 'trial');
  });
});

describe('不是體驗的照舊', () => {
  test('心臟門診＋顧客會、沒有心臟科評估額度 → 體驗（05 之後那門課不算次數）', () => {
    const item = read('心臟門診', '顧客會');
    assert.equal(item.giftCourseId, 'course-cardio');
    assert.equal(item.giftKind, 'trial');
  });

  test('心臟門診＋顧客會、有一筆心臟科評估剩 1 → 預選那一筆、扣（ADR-0121 不變）', () => {
    const item = read('心臟門診', '顧客會', ctx({ 'c-wang': [POOL30, CARDIO] }));
    assert.equal(item.entitlementId, 'w-cardio');
    assert.equal(item.giftKind, null);
  });

  test('SIS 60＋正式課 → 照舊扣額度', () => {
    const item = read('SIS 30', '正式課');
    assert.equal(item.entitlementId, 'w-pool');
    assert.equal(item.giftKind, null);
  });

  test('舊 Function（抄字沒有預約來源那一欄）→ 每一列的預選跟改之前一模一樣', () => {
    const old = readAbovee([{ columns: COLS.slice(0, 6), rows: [row('IN 30', '體驗').slice(0, 6)] }], ctx()).items[0];
    assert.equal(old.entitlementId, 'w-pool');
    assert.equal(old.giftKind, null);
    assert.equal(old.giftCourseId, null);
  });
});

describe('健檢與二返沒有體驗：照扣、那一句收著也看得到', () => {
  test('健檢＋體驗 → 照扣健檢那一筆、warningsByRow 的 mustSee 有那一句', () => {
    const c = ctx({ 'c-wang': [EXAM] });
    const item = { ...read('健檢', '體驗', c), checked: true };
    assert.equal(item.entitlementId, 'w-exam');
    assert.equal(item.giftKind, null);
    const { groups } = planAbovee([item], c);
    const byRow = warningsByRow(groups[0], [], { courses: SEED.courses });
    assert.ok(byRow[item.key].mustSee.some((w) => w.includes('健檢、二返沒有體驗')), JSON.stringify(byRow));
    assert.deepEqual(byRow[item.key].all, byRow[item.key].mustSee);
  });

  test('寫體驗的 IN 30、她自己改按扣額度 → 也講一句（照扣一次）', () => {
    const item = { ...read('IN 30', '體驗'), entitlementId: 'w-pool', giftCourseId: null, giftKind: null, therapistId: 'staff-tw', checked: true };
    const { groups } = planAbovee([item], ctx());
    const [say] = warningsByRow(groups[0], [], { courses: SEED.courses })[item.key].mustSee;
    assert.match(say, /這裡選了扣額度/);
  });

  test('課程那一格認不出來、寫體驗、她自己按了一筆額度 → 講「這裡選了扣額度」，不講健檢', () => {
    const item = { ...read('XYZ 30', '體驗'), entitlementId: 'w-pool', equipmentId: 'eq-indiba', therapistId: 'staff-tw', checked: true };
    assert.equal(item.course, null);
    const { groups } = planAbovee([item], ctx());
    const [say] = warningsByRow(groups[0], [], { courses: SEED.courses })[item.key].mustSee;
    assert.match(say, /這裡選了扣額度/);
  });

  test('寫正式課的健檢：沒有那一句', () => {
    const c = ctx({ 'c-wang': [EXAM] });
    const item = { ...read('健檢', '正式課', c), checked: true };
    const { groups } = planAbovee([item], c);
    assert.deepEqual(warningsByRow(groups[0], [], { courses: SEED.courses })[item.key].mustSee, []);
  });
});

describe('左右兩半：預約來源在交界', () => {
  const LEFT = ['預約狀態', '預約日期', '預約時段', '姓名', '病歷號', '課程'];
  test('左半被切成「體」、右半完整「體驗」→ 接起來是「體驗」', () => {
    const { rows } = mergeAboveePhotos([
      { columns: [...LEFT, '預約來源'], rows: [row('IN 30', '體')] },
      { columns: ['預約來源', '診間'], rows: [['體驗', '治療室5']] },
    ]);
    assert.equal(rows[0].source, '體驗');
  });

  test('左半沒有那一欄、右半有 → 補得進來', () => {
    const { rows } = mergeAboveePhotos([
      { columns: LEFT, rows: [row('IN 30', '').slice(0, 6)] },
      { columns: ['預約來源', '診間'], rows: [['體驗', '治療室5']] },
    ]);
    assert.equal(rows[0].source, '體驗');
  });
});

describe('合併扣課：體驗的列不參與', () => {
  test('兩列 IN 30＋體驗、合併扣課都寫「是」→ 不合成一列、也不標成找不到另一半', () => {
    const cols = [...COLS, '合併扣課'];
    const { items } = readAbovee([{ columns: cols, rows: [
      [...row('IN 30', '體驗', { time: '10:00 - 10:30' }), '是'],
      [...row('IN 30', '體驗', { time: '10:30 - 11:00' }), '是'],
    ] }], ctx());
    assert.equal(items.length, 2);
    assert.ok(items.every((i) => !i.merged && !i.mergeOrphan), JSON.stringify(items.map((i) => [i.mergeOrphan, i.merged])));
  });

  test('mergeRows 直接叫：giftKind 有值、勾了合併扣課 → 照原樣', () => {
    const item = { key: 'a0', kind: 'new', customerId: 'c-wang', giftCourseId: 'course-recovery', giftKind: 'trial', row: { merged: '是' } };
    assert.deepEqual(mergeRows([item], ctx(), { hasColumn: true }), [item]);
  });
});
