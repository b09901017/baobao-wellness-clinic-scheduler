// 試算表：送的／體驗的段那一列寫「（體驗）」「（送的）」，來訪紀錄那一行也寫（2026-10-14，gift-and-trial 03）。
//
// 她的原話：
//
// > 但是來訪以及試算表還是要標註(送的)、(體驗)
// > 但我希望這個送的體驗可以額外寫或是標記起來讓以後的我知道，在試算表也是如此
//
// 01 之後**任何課**都可能是體驗：一段 INDIBA 30 分體驗以前會落在 `復能（不算次數）`，看不出是哪一台、也看不出是體驗。
// 判準：**這幾列不是額度** —— 應有、剩餘一槓、不進合計，扣額度的那幾列一格都不動。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { syncBundle, customerReport, extraRows } from '../public/js/domain/sheetReport.js';
import { SEED } from '../public/js/domain/seed.js';

const TODAY = '2026-10-14';
const MASTER = {
  courses: SEED.courses, equipment: SEED.equipment, staff: SEED.staff, rooms: SEED.rooms, ivProducts: SEED.ivProducts,
};
const BY_ID = Object.fromEntries(SEED.courses.map((c) => [c.id, c]));

const POOL = {
  id: 'e-pool', customerId: 'c1', type: 'pool', label: '復能-三選一(60)',
  optionEquipmentIds: ['eq-indiba', 'eq-sis', 'eq-laser'], totalQty: 10, durationMin: 60,
};
const ILIB = { id: 'e-ilib', customerId: 'c1', type: 'single', label: 'ILIB(60)', courseId: 'course-iv-laser', totalQty: 5 };

const s = (over) => ({ entitlementId: null, startsAt: '10:00', endsAt: '10:30', status: 'done', attended: true, ...over });
const day = (date, slots, status = 'done') => ({ id: `v-${date}`, customerId: 'c1', customerName: '客戶A', date, status, slots });

const sheetOf = (visits, ents = [POOL, ILIB]) => syncBundle({
  customers: [{ id: 'c1', name: '客戶A' }],
  entitlementsBy: { c1: ents },
  visitsBy: { c1: visits },
  today: TODAY,
  master: MASTER,
}).sheets[0];

const extras = (sheet) => sheet.rows.filter((r) => r.extra).map((r) => [r.label, r.total, r.done, r.booked, r.remaining, r.marks]);

describe('矩陣：送的／體驗的段自己一列', () => {
  const visits = [
    day('2026-10-01', [s({ courseId: 'course-recovery', courseName: '復能', equipmentId: 'eq-indiba', giftKind: 'trial' })]),
    day('2026-10-02', [s({ courseId: 'course-cardio', courseName: '心臟科評估', giftKind: 'trial' })]),
    day('2026-10-20', [s({ courseId: 'course-cardio', courseName: '心臟科評估', giftKind: 'trial', status: 'pending_confirm', attended: null })], 'pending_confirm'),
    day('2026-10-03', [s({ entitlementId: 'e-pool', courseId: 'course-recovery', courseName: '復能', equipmentId: 'eq-sis', endsAt: '11:00', giftKind: null })]),
  ];

  test('INDIBA（體驗）一格、心臟科評估（體驗）兩格；應有、剩餘一槓（同一種照名字，zh-TW 排序中文在前）', () => {
    const sheet = sheetOf(visits);
    assert.deepEqual(extras(sheet), [
      ['心臟科評估（體驗）', '—', 1, 1, '—', ['', '✓', '', '○']],
      ['INDIBA（體驗）', '—', 1, 0, '—', ['✓', '', '', '']],
    ]);
  });

  test('擇一池那門課照器材的全名（不是別稱 IN）；同一台 30 與 60 分是同一列', () => {
    const sheet = sheetOf([
      day('2026-10-01', [s({ courseId: 'course-recovery', equipmentId: 'eq-indiba', giftKind: 'trial' })]),
      day('2026-10-02', [s({ courseId: 'course-recovery', equipmentId: 'eq-indiba', giftKind: 'trial', endsAt: '11:00' })]),
    ]);
    assert.deepEqual(extras(sheet).map((r) => [r[0], r[2]]), [['INDIBA（體驗）', 2]]);
  });

  test('扣額度的那幾列一格都不動、合計不變', () => {
    const before = sheetOf([visits[3]]);
    const after = sheetOf(visits);
    const nums = (sheet) => sheet.rows.filter((r) => !r.extra).map((r) => [r.label, r.total, r.done, r.booked, r.remaining]);
    assert.deepEqual(nums(after), nums(before));
    assert.deepEqual(after.totals, before.totals);
  });

  test('同一門課一段送的、一段體驗 → 兩列；先體驗再送的', () => {
    const sheet = sheetOf([
      day('2026-10-01', [s({ courseId: 'course-cardio', giftKind: 'gift' })]),
      day('2026-10-02', [s({ courseId: 'course-cardio', giftKind: 'trial' })]),
    ]);
    assert.deepEqual(extras(sheet).map((r) => r[0]), ['心臟科評估（體驗）', '心臟科評估（送的）']);
  });

  test('先後：n返 → 體驗 → 送的 → 額度被刪的；三返那一列一個字都沒變', () => {
    const sheet = sheetOf([
      day('2026-10-01', [s({ courseId: 'course-cardio', giftKind: 'gift' })]),
      day('2026-10-02', [s({ courseId: 'course-iv-laser', entitlementId: 'e-gone' })]),
      day('2026-10-03', [s({ courseId: 'course-fm', giftKind: 'trial' })]),
      day('2026-10-04', [s({ courseId: 'course-followup', courseName: '三返', followupNth: 3, followupForVisitId: 'vx' })]),
    ]);
    assert.deepEqual(extras(sheet).map((r) => r[0]), ['三返（不算次數）', '功醫門診（體驗）', '心臟科評估（送的）', 'ILIB（額度已刪除）']);
  });

  test('舊資料（沒有 giftKind 的功醫門診）那一列寫「功醫門診（體驗）」', () => {
    const sheet = sheetOf([day('2026-10-01', [s({ courseId: 'course-fm', courseName: '功醫門診' })])]);
    assert.deepEqual(extras(sheet).map((r) => r[0]), ['功醫門診（體驗）']);
  });

  test('每一個日期欄至少一格有符號（sheet-rows-without-entitlement 的不變量）', () => {
    const sheet = sheetOf(visits);
    sheet.dates.forEach((_, i) => {
      assert.ok(sheet.rows.some((r) => r.marks[i]), `第 ${i + 1} 欄`);
    });
  });

  test('extraRows() 沒帶器材主檔也畫得出來（退回課程名）', () => {
    const rows = extraRows({
      scheduled: [], dates: ['2026-10-01'], coursesById: BY_ID,
      visits: [day('2026-10-01', [s({ courseId: 'course-recovery', equipmentId: 'eq-indiba', giftKind: 'trial' })])],
    });
    assert.deepEqual(rows.map((r) => r.label), ['復能（體驗）']);
  });
});

describe('來訪紀錄那一行', () => {
  test('送的／體驗的段課程那一格接 (體驗)／(送的)；扣額度的段一個字都沒變', () => {
    const sheet = sheetOf([
      day('2026-10-02', [
        s({ courseId: 'course-cardio', courseName: '心臟科評估', giftKind: 'trial' }),
        s({ courseId: 'course-fm', courseName: '功醫門診', giftKind: 'gift', startsAt: '11:00', endsAt: '11:30' }),
        s({ entitlementId: 'e-pool', courseId: 'course-recovery', courseName: '復能', equipmentId: 'eq-sis', startsAt: '12:00', endsAt: '13:00', giftKind: null }),
      ]),
    ]);
    assert.deepEqual(sheet.log[0].items.map((i) => i.course), ['心臟科評估(體驗)', '功醫門診(送的)', '復能']);
  });
});

describe('手動貼上那一條路也一樣', () => {
  test('customerReport() 的矩陣有「INDIBA（體驗）」那一列', () => {
    const { rows } = customerReport({
      customer: { id: 'c1', name: '客戶A' }, entitlements: [POOL],
      visits: [day('2026-10-01', [s({ courseId: 'course-recovery', equipmentId: 'eq-indiba', giftKind: 'trial' })])],
      courses: SEED.courses, staff: SEED.staff, equipment: SEED.equipment, ivProducts: SEED.ivProducts, today: TODAY,
    });
    assert.ok(rows.some((r) => r[0] === 'INDIBA（體驗）'), rows.map((r) => r[0]).join('／'));
  });
});
