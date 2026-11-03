// 拍 Abovee 收著的列：紅字短標記（abovee-confirm-glance 03，ADR-0170）。
//
// 她 11/3：「簡短的，像是⚠ 撞期 ⚠ 次數不夠⚠ 禁忌 +1⚠ 過期⚠ 品項⚠ 重疊⚠ 健檢等等，一列有好幾個提醒時，
// 只寫最要緊的那一個，後面接「+1」」。先後：禁忌 → 次數不夠 → 撞期 → 重疊 → 過期 → 品項 → 健檢。
//
// 盯四件事：
//   1. 短字與先後只在 `warningTag()`：一列同時撞期與禁忌寫的是「禁忌 +1」；+N 算種不算句
//   2. 超用與到期分得出兩個字（`entitlementWarnings()` 帶 `kind`，`from()` 不丟掉它）
//   3. 對照表沒有的 mustSee 照樣有一個標記（「提醒」）；不是 mustSee 的一個都不畫
//   4. `photoDayPlan()` 的 `tagBy` 跟 `mustSeeBy` 一對一（同一列、同樣多、同一個順序）
// 例子一律假名、1234。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { photoDayPlan, readAbovee, rowTag, warningTag, warningsByRow } from '../public/js/domain/aboveeImport.js';
import { warningDetails } from '../public/js/domain/visits.js';
import { SEED } from '../public/js/domain/seed.js';

const master = { courses: SEED.courses, equipment: SEED.equipment, rooms: SEED.rooms, staff: SEED.staff, ivProducts: SEED.ivProducts };
const TODAY = '2026-10-08';
const chart = (no) => [{ text: `病歷號 ${no}`, color: 'grey' }];
const WANG = { id: 'c-wang', name: '王小明', marks: chart('1234'), flags: ['體內金屬'] };
const LEE = { id: 'c-lee', name: '李小華', marks: chart('5678'), flags: [] };
const pool = (id, totalQty, more = {}) => ({
  id, type: 'pool', label: '復能-三選一(60)', optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60, totalQty, ...more,
});
const COLS = ['預約狀態', '預約日期', '預約時段', '姓名', '病歷號', '課程', '診間'];
const photo = (...rows) => ({ readable: true, columns: COLS, rows });
const tag = (list, o) => {
  const t = warningTag(list, o);
  return t && `${t.text}${t.more ? ` +${t.more}` : ''}`;
};

describe('warningTag()：最要緊的那一個＋「+N」', () => {
  test('一列同時撞期與禁忌 → 禁忌 +1', () => {
    assert.equal(tag([{ source: 'conflict' }, { source: 'notice' }]), '禁忌 +1');
  });

  test('先後：禁忌 → 次數不夠 → 撞期 → 重疊 → 過期 → 品項 → 健檢 → 體驗 → 狀態 → 提醒 → 還差一步', () => {
    const all = [
      { source: 'photoStatus', kind: 'time' }, { source: 'trial' }, { source: 'mystery' },
      { source: 'examNotMine' }, { source: 'ivMismatch' }, { source: 'entitlement', kind: 'expired' },
      { source: 'overlap' }, { source: 'conflict' }, { source: 'entitlement', kind: 'over' }, { source: 'notice' },
    ];
    const t = warningTag(all, { stuck: true });
    assert.deepEqual(t.all, ['禁忌', '次數不夠', '撞期', '重疊', '過期', '品項', '健檢', '體驗', '狀態', '提醒', '還差一步']);
    assert.deepEqual([t.text, t.more], ['禁忌', 10]);
  });

  test('超用與到期是兩個字', () => {
    assert.equal(tag([{ source: 'entitlement', kind: 'over' }]), '次數不夠');
    assert.equal(tag([{ source: 'entitlement', kind: 'expired' }]), '過期');
    assert.equal(tag([{ source: 'entitlement', kind: 'expired' }, { source: 'entitlement', kind: 'over' }]), '次數不夠 +1');
  });

  test('+N 算種不算句：兩句撞期是一種；禁忌的兩個來源算一種；健檢的兩個來源算一種', () => {
    assert.equal(tag([{ source: 'conflict' }, { source: 'conflict' }]), '撞期');
    assert.equal(tag([{ source: 'mergedNotice' }, { source: 'notice' }]), '禁忌');
    assert.equal(tag([{ source: 'photoStatus', kind: 'closeBlock' }, { source: 'examNotMine' }]), '健檢');
  });

  test('拍 Abovee 自己的三種：合併扣課另一台 → 禁忌、體驗照扣 → 體驗、照片的狀態 → 狀態（二返簽不成是健檢）', () => {
    assert.equal(tag([{ source: 'mergedNotice' }]), '禁忌');
    assert.equal(tag([{ source: 'trial' }]), '體驗');
    for (const kind of ['photosDiffer', 'unread', 'halvesDiffer', 'pastOpen', 'time']) {
      assert.equal(tag([{ source: 'photoStatus', kind }]), '狀態', kind);
    }
    assert.equal(tag([{ source: 'photoStatus', kind: 'closeBlock' }]), '健檢');
  });

  test('對照表沒有的不是不畫：「提醒」', () => {
    assert.equal(tag([{ source: 'somethingNew' }]), '提醒');
    assert.equal(tag([{ source: 'entitlement', kind: 'somethingNew' }]), '提醒');
  });

  test('還差一步排在所有紅字後面、也算一種', () => {
    assert.equal(tag([], { stuck: true }), '還差一步');
    assert.equal(tag([{ source: 'conflict' }], { stuck: true }), '撞期 +1');
  });

  test('什麼都沒有 → null（一個像素都不佔）', () => {
    assert.equal(warningTag([]), null);
    assert.equal(warningTag(undefined), null);
  });
});

describe('超用與到期：warningDetails() 每一句帶 kind', () => {
  const visit = { id: 'v-new', customerId: 'c-lee', date: '2026-10-21', status: 'pending_confirm', slots: [
    { entitlementId: 'P', courseId: 'course-recovery', equipmentId: 'eq-indiba', therapistId: 'staff-zn',
      startsAt: '09:00', endsAt: '10:00', status: 'pending_confirm' },
  ] };
  const used = { id: 'v-old', customerId: 'c-lee', date: '2026-09-01', status: 'done', slots: [
    { entitlementId: 'P', courseId: 'course-recovery', equipmentId: 'eq-indiba', startsAt: '09:00', endsAt: '10:00', status: 'done' }] };
  const check = { customer: LEE, entitlements: [pool('P', 1, { expiresAt: '2026-10-01' })], ...master, customerVisits: [used], sameDayVisits: [] };
  const mine = warningDetails(visit, check).filter((w) => w.source === 'entitlement');

  test('超用 → over、到期 → expired', () => {
    assert.deepEqual(mine.map((w) => [w.kind, /超過總次數/.test(w.text) || /到期/.test(w.text)]), [['over', true], ['expired', true]]);
    assert.match(mine[0].text, /超過總次數/);
    assert.match(mine[1].text, /到期之後/);
  });

  test('別的來源不多帶一格', () => {
    assert.ok(warningDetails(visit, check).filter((w) => w.source !== 'entitlement').every((w) => !('kind' in w)));
  });
});

describe('photoDayPlan() 的 tagBy：跟 mustSeeBy 一對一', () => {
  // 體內金屬排 SIS、只買 1 次已經用掉 1 次：禁忌＋次數不夠，「還沒選治療師」不是 mustSee
  const used = { id: 'v-old', customerId: 'c-wang', date: '2026-01-06', status: 'done',
    slots: [{ entitlementId: 'P', courseId: 'course-recovery', equipmentId: 'eq-indiba', startsAt: '09:00', endsAt: '10:00', status: 'done' }] };
  const ctx = { customers: [WANG, LEE], entitlementsBy: { 'c-wang': [pool('P', 1)], 'c-lee': [pool('L', 12)] },
    visitsBy: { 'c-wang': [used] }, master, today: TODAY };
  const { items } = readAbovee([photo(
    ['確認前往', '2026-10-21', '09:00 - 10:15', '王小明', '00001234', 'SIS 60', ''],
    ['確認前往', '2026-10-21', '11:00 - 12:15', '李小華', '00005678', 'IN 60', ''],
  )], ctx);
  const p = photoDayPlan(items, ctx);
  const [wang, lee] = items;

  test('同一列、同樣多、同一個順序', () => {
    assert.deepEqual(Object.keys(p.tagBy).sort(), Object.keys(p.mustSeeBy).sort());
    for (const key of Object.keys(p.mustSeeBy)) assert.equal(p.tagBy[key].length, p.mustSeeBy[key].length, key);
  });

  test('王小明那一列：禁忌 +1；李小華那一列一個標記都沒有（「還沒選治療師」不是 mustSee）', () => {
    assert.equal(p.mustSeeBy[wang.key].length, 2);
    assert.equal(tag(p.tagBy[wang.key]), '禁忌 +1');
    assert.ok((p.warningsBy[lee.key] ?? []).some((t) => /還沒選治療師/.test(t)), '點開之後照舊看得到');
    assert.equal(rowTag(lee, p), null);
  });

  test('rowTag()：會寫進去的列才有；拿掉勾就沒有', () => {
    assert.deepEqual([rowTag(wang, p).text, rowTag(wang, p).more], ['禁忌', 1]);
    const off = items.map((i) => (i.key === wang.key ? { ...i, checked: false } : i));
    assert.equal(rowTag(off[0], photoDayPlan(off, ctx)), null);
  });

  test('rowTag()：勾著、存不下去 → 還差一步', () => {
    // 那一筆額度不在了：組不出時段，存不下去
    const lost = items.map((i) => (i.key === lee.key ? { ...i, entitlementId: 'gone' } : i));
    const q = photoDayPlan(lost, ctx);
    assert.ok((q.problems[lee.key] ?? []).length, JSON.stringify(q.problems));
    assert.deepEqual(rowTag(lost[1], q).all, ['還差一步']);
  });
});

describe('warningsByRow()：拍 Abovee 自己那三種也帶來源', () => {
  test('體驗照扣 → trial；照片的狀態 → photoStatus＋那一種', () => {
    const group = { at: { a: 0, b: 1 }, items: [
      { key: 'a', kind: 'new', entitlementId: 'P', row: { course: 'IN 60', source: '體驗' }, course: { courseId: 'course-recovery' } },
      { key: 'b', kind: 'new', photoStatus: 'done', photoTime: '還沒到就寫課程完成', date: '2026-12-01', row: {} },
    ] };
    const out = warningsByRow(group, [], { courses: SEED.courses });
    assert.equal(out.a.tags.length, out.a.mustSee.length);
    assert.deepEqual(out.a.tags, [{ source: 'trial' }]);
    assert.deepEqual(out.b.tags, [{ source: 'photoStatus', kind: 'time' }]);
  });
});
