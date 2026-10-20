// 拍 Abovee：點開沒勾的那一列，看得到「勾起來的話」會有的提醒（before-golive-2026-10-19/09）。
//
// 她：「沒勾的列，點開看不到提醒。(好，修)」。提醒是拿勾著的那幾列組出來的來訪算的，沒勾的那一列不在任何一組裡。
// 作法：把那一列當成勾起來，整張重跑同一支 `photoDayPlan()`（跨天的超用要靠別組、同一天撞診間要靠別人那一天），
// 只讀那一列 —— **不寫回她的勾**，所以確認框的「其中 N 段有提醒」一個都不多。例子一律假名、1234。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { photoDayPlan, readAbovee, whatIfChecked } from '../public/js/domain/aboveeImport.js';
import { SEED } from '../public/js/domain/seed.js';

const master = { courses: SEED.courses, equipment: SEED.equipment, rooms: SEED.rooms, staff: SEED.staff, ivProducts: SEED.ivProducts };
const TODAY = '2026-10-08';
const LEE = { id: 'c-lee', name: '李小華', chartNo: '5678', marks: [], flags: [] };
const WANG = { id: 'c-wang', name: '王小明', chartNo: '1234', marks: [], flags: ['體內金屬'] };
const pool = (id, totalQty) => ({ id, type: 'pool', label: '復能-三選一(60)', optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60, totalQty });
const COLS = ['預約狀態', '預約日期', '預約時段', '姓名', '病歷號', '課程', '診間'];
const photo = (...rows) => ({ readable: true, columns: COLS, rows });

describe('whatIfChecked()：沒勾的那一列，照「勾起來的話」算一次', () => {
  const ctx = { customers: [LEE, WANG], entitlementsBy: { 'c-lee': [pool('L', 1)], 'c-wang': [pool('W', 5)] }, visitsBy: {}, master, today: TODAY };
  const rows = [
    ['確認前往', '2026-10-21', '09:00 - 10:15', '李小華', '00005678', 'IN 60', ''],
    ['確認前往', '2026-10-22', '09:00 - 10:15', '李小華', '00005678', 'IN 60', ''],
    ['確認前往', '2026-10-23', '09:00 - 10:15', '李小華', '00005678', 'IN 60', ''],
  ];
  const read = readAbovee([photo(...rows)], ctx).items;
  // 判準的例子：只買 1 次 ILIB…（這裡是復能 1 次）、照片上三天各一段、只勾前兩列
  const items = read.map((i, n) => (n === 2 ? { ...i, checked: false } : i));
  const third = items[2];

  test('點開第三列：「勾起來的話」看得到超過總次數；勾起來之後跟真的計畫那一行一樣', () => {
    assert.equal(third.kind, 'new');
    const now = photoDayPlan(items, ctx);
    assert.deepEqual(now.warningsBy[third.key] ?? [], [], '沒勾的那一列，平常的計畫裡什麼都沒有（以前就這樣）');

    const what = whatIfChecked(items, third.key, ctx);
    assert.ok(what.warnings.some((t) => /排完這次會超過總次數（共 1 次，已排 3 次）/.test(t)), what.warnings.join('｜'));

    const checked = photoDayPlan(items.map((i) => (i.key === third.key ? { ...i, checked: true } : i)), ctx);
    assert.deepEqual(what.warnings, checked.warningsBy[third.key]);
    assert.deepEqual(what.problems, checked.problems[third.key] ?? []);
  });

  test('不寫回她的勾：算完之後 items 一個字都沒變、平常那一份計畫的 mustSee 不多一列', () => {
    const before = JSON.stringify(items);
    whatIfChecked(items, third.key, ctx);
    assert.equal(JSON.stringify(items), before);
    const now = photoDayPlan(items, ctx);
    assert.ok(!Object.keys(now.mustSeeBy).includes(third.key) || !now.mustSeeBy[third.key].length);
  });

  test('照當下勾著的算：她再把第一列也拿掉 → 第三列勾起來的話只排 2 次，還是超過；三列都拿掉 → 不超過', () => {
    const two = items.map((i, n) => (n === 0 ? { ...i, checked: false } : i));
    assert.ok(whatIfChecked(two, third.key, ctx).warnings.some((t) => /已排 2 次/.test(t)));
    const alone = items.map((i) => ({ ...i, checked: false }));
    assert.ok(!whatIfChecked(alone, third.key, ctx).warnings.some((t) => /超過總次數/.test(t)));
  });

  test('已經記了、對不上、認不得人的列：沒有「勾起來的話」（回 null）', () => {
    assert.equal(whatIfChecked(items, 'nope', ctx), null);
    for (const kind of ['recorded', 'mismatch', 'unknown']) {
      const odd = items.map((i) => (i.key === third.key ? { ...i, kind } : i));
      assert.equal(whatIfChecked(odd, third.key, ctx), null, kind);
    }
    const nobody = items.map((i) => (i.key === third.key ? { ...i, customerId: null } : i));
    assert.equal(whatIfChecked(nobody, third.key, ctx), null);
    // 勾著的那一列本來就在計畫裡，不用另外算
    assert.equal(whatIfChecked(items, items[0].key, ctx), null);
  });

  test('會擋的那種也講：器材沒選 → 勾起來的話存不下去的理由進 problems', () => {
    const noEq = items.map((i) => (i.key === third.key ? { ...i, equipmentId: null } : i));
    const what = whatIfChecked(noEq, third.key, ctx);
    assert.ok(what.problems.length, JSON.stringify(what));
    assert.deepEqual(photoDayPlan(noEq, ctx).problems[third.key] ?? [], [], '平常那一份照舊不擋沒勾的那一列');
  });
});
