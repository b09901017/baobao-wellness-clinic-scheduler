import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  tasksForCategory, dueDateFor, tasksForVisit, bookingSystemFor, bookingSystemsForVisit,
} from '../public/js/domain/taskRules.js';
import {
  isBlocked,
  blockingFlags,
  annotateOptions,
  equipmentLimitLabel,
  validateSlots,
} from '../public/js/domain/contraindications.js';
import {
  counts, isOverused, reconcile, expandPlan, slotOutcome,
} from '../public/js/domain/entitlements.js';
import { endOf, nextStart, layOutSlots, overlaps, timeLabel } from '../public/js/domain/visitTime.js';

describe('任務規則', () => {
  test('確認之後只有門診那一類還要登記', () => {
    assert.deepEqual(tasksForCategory('A'), ['Examine', '耀聖']);
    assert.deepEqual(tasksForCategory('B'), []);
    assert.deepEqual(tasksForCategory('C'), []);
  });

  test('壓表就是登記，所以 Abovee 與打電話都不是任務', () => {
    for (const category of ['A', 'B', 'C', null, undefined]) {
      const kinds = tasksForCategory(category);
      assert.ok(!kinds.includes('Abovee'), `${category} 不該有 Abovee`);
      assert.ok(!kinds.includes('打電話'), `${category} 不該有打電話`);
    }
  });

  test('壓表登記在哪個系統：健檢是 Examine，其餘都是 Abovee', () => {
    assert.equal(bookingSystemFor('B'), 'Examine');
    for (const category of ['A', 'C', null, undefined, 'Z']) {
      assert.equal(bookingSystemFor(category), 'Abovee', `${category} 該壓在 Abovee`);
    }
  });

  test('未知類別回空陣列，不亂猜', () => {
    assert.deepEqual(tasksForCategory('Z'), []);
    assert.deepEqual(tasksForCategory(undefined), []);
  });

  test('死線是來訪日的前一天，跨月跨年都要對', () => {
    assert.equal(dueDateFor('2026-09-10'), '2026-09-09');
    assert.equal(dueDateFor('2026-09-01'), '2026-08-31');
    assert.equal(dueDateFor('2026-01-01'), '2025-12-31');
    assert.equal(dueDateFor('2028-03-01'), '2028-02-29'); // 閏年
  });

  test('同一次來訪的同名任務只產生一次', () => {
    const visit = {
      id: 'v1',
      customerId: 'c1',
      customerName: '客戶甲',
      date: '2026-09-10',
      slots: [{ courseId: 'rehab' }, { courseId: 'cardio' }],
    };
    const courses = { rehab: { category: 'A' }, cardio: { category: 'A' } };
    const tasks = tasksForVisit(visit, courses);
    assert.equal(tasks.length, 2);
    assert.equal(new Set(tasks.map((t) => t.kind)).size, 2);
    assert.ok(tasks.every((t) => t.dueDate === '2026-09-09'));
  });

  test('混合類別時取聯集', () => {
    const visit = {
      id: 'v1',
      customerId: 'c1',
      customerName: '客戶甲',
      date: '2026-09-10',
      slots: [{ courseId: 'recovery' }, { courseId: 'checkup' }],
    };
    const courses = { recovery: { category: 'C' }, checkup: { category: 'B' }, rehab: { category: 'A' } };
    const kinds = tasksForVisit(visit, courses).map((t) => t.kind).sort();
    assert.deepEqual(kinds, [], '復能與健檢確認後都沒有後續登記');

    const withClinic = { ...visit, slots: [...visit.slots, { courseId: 'rehab' }] };
    assert.deepEqual(
      tasksForVisit(withClinic, courses).map((t) => t.kind).sort(),
      ['Examine', '耀聖'],
    );
  });

  test('一筆來訪動到了哪幾個系統的壓表登記', () => {
    const courses = { recovery: { category: 'C' }, checkup: { category: 'B' } };
    const at = (slots) => bookingSystemsForVisit({ slots }, courses).sort();

    assert.deepEqual(at([{ courseId: 'recovery' }]), ['Abovee']);
    assert.deepEqual(at([{ courseId: 'checkup' }]), ['Examine']);
    assert.deepEqual(at([{ courseId: 'recovery' }, { courseId: 'checkup' }]),
      ['Abovee', 'Examine'], '同一天兩種，兩個系統上真的各有一筆');
    assert.deepEqual(at([{ courseId: 'ghost' }]), [],
      '認不得的課程不猜 —— 連壓過沒有都不知道');
  });

  test('找不到課程時略過，不會炸掉', () => {
    const visit = { id: 'v1', customerId: 'c1', customerName: 'x', date: '2026-09-10', slots: [{ courseId: 'ghost' }] };
    assert.deepEqual(tasksForVisit(visit, {}), []);
  });
});

describe('醫療禁忌（硬性阻擋）', () => {
  const 體內金屬客戶 = { flags: ['體內金屬'] };
  const 一般客戶 = { flags: [] };
  const sis = { id: 'sis', name: '超磁場', contraindications: ['體內金屬'] };
  const laser = { id: 'laser', name: '高能量雷射', contraindications: ['體內金屬'] };
  const indiba = { id: 'indiba', name: 'INDIBA', contraindications: [] };

  test('體內金屬擋掉超磁場與高能量雷射，只剩 INDIBA', () => {
    assert.ok(isBlocked(體內金屬客戶, sis));
    assert.ok(isBlocked(體內金屬客戶, laser));
    assert.ok(!isBlocked(體內金屬客戶, indiba));
  });

  test('沒有標記的客戶三種都能用', () => {
    for (const eq of [sis, laser, indiba]) assert.ok(!isBlocked(一般客戶, eq));
  });

  test('要說得出被擋的原因，不能只說不能選', () => {
    assert.deepEqual(blockingFlags(體內金屬客戶, sis), ['體內金屬']);
  });

  test('被擋的選項留在原位，不從清單消失', () => {
    const annotated = annotateOptions(體內金屬客戶, [laser, sis, indiba]);
    assert.deepEqual(annotated.map((o) => o.id), ['laser', 'sis', 'indiba']);
    assert.deepEqual(annotated.map((o) => o.blocked), [true, true, false]);
  });

  test('缺欄位時不當成有禁忌', () => {
    assert.ok(!isBlocked({}, {}));
    assert.ok(!isBlocked(undefined, undefined));
  });

  // 壓表卡片牆上那顆丸子（ADR-0046）。它是算出來的，不是打字打的 ——
  // 器材主檔上的禁忌一改，這句話跟著改。
  test('只剩一台就講「只能 ⋯⋯」', () => {
    assert.deepEqual(
      equipmentLimitLabel(體內金屬客戶, [laser, sis, indiba]),
      { text: '只能 INDIBA', blocked: 2, left: 1 },
    );
  });

  test('還剩兩台以上就講「不能用 ⋯⋯」', () => {
    const 孕婦 = { flags: ['孕婦'] };
    const eq = [{ ...sis, contraindications: ['孕婦'] }, laser, indiba];
    assert.equal(equipmentLimitLabel(孕婦, eq).text, '不能用 超磁場');
  });

  test('一台都不剩要講得出來 —— 那時候她壓不下去', () => {
    const 全擋 = { flags: ['體內金屬'] };
    const eq = [sis, laser, { ...indiba, contraindications: ['體內金屬'] }];
    assert.deepEqual(equipmentLimitLabel(全擋, eq), { text: '3 台都不能用', blocked: 3, left: 0 });
  });

  test('沒有東西被擋就回 null —— 不然它會變成每一張卡都有的裝飾', () => {
    assert.equal(equipmentLimitLabel(一般客戶, [sis, laser, indiba]), null);
  });

  test('沒有擇一池就回 null，不要無中生有一句話', () => {
    assert.equal(equipmentLimitLabel(體內金屬客戶, []), null);
    assert.equal(equipmentLimitLabel(體內金屬客戶), null);
  });

  test('送出前驗證會指出是第幾個時段出問題', () => {
    const errors = validateSlots(
      體內金屬客戶,
      [{ equipmentId: 'indiba' }, { equipmentId: 'sis' }],
      { indiba, sis },
    );
    assert.equal(errors.length, 1);
    assert.equal(errors[0].slotIndex, 1);
    assert.match(errors[0].message, /超磁場/);
  });
});

describe('額度計算', () => {
  const ent = { totalQty: 20 };
  const visits = [
    { status: 'done', slots: [{ entitlementId: 'e1' }] },
    { status: 'done', slots: [{ entitlementId: 'e1' }] },
    { status: 'confirmed', slots: [{ entitlementId: 'e1' }] },
    { status: 'pending_confirm', slots: [{ entitlementId: 'e1' }] },
    { status: 'no_show', slots: [{ entitlementId: 'e1' }] },
    { status: 'cancelled', slots: [{ entitlementId: 'e1' }] },
    { status: 'done', slots: [{ entitlementId: 'other' }] },
  ];

  test('未到不扣次數，但要獨立算得出來', () => {
    const c = counts(ent, visits, 'e1');
    assert.equal(c.done, 2);
    assert.equal(c.booked, 2);
    assert.equal(c.noShow, 1);
    assert.equal(c.remaining, 16);
  });

  test('取消完全不算，時段已經還回去了', () => {
    const c = counts({ totalQty: 5 }, [{ status: 'cancelled', slots: [{ entitlementId: 'e1' }] }], 'e1');
    assert.equal(c.done, 0);
    assert.equal(c.booked, 0);
    assert.equal(c.remaining, 5);
  });

  test('已軟刪除的來訪不列入計算', () => {
    const c = counts({ totalQty: 5 }, [
      { status: 'done', deletedAt: 'x', slots: [{ entitlementId: 'e1' }] },
    ], 'e1');
    assert.equal(c.done, 0);
  });

  test('一次來訪用掉同一個額度兩次要算兩次', () => {
    const c = counts({ totalQty: 5 }, [
      { status: 'done', slots: [{ entitlementId: 'e1' }, { entitlementId: 'e1' }] },
    ], 'e1');
    assert.equal(c.done, 2);
  });

  test('額度超用只是算得出來，不是丟錯', () => {
    assert.ok(isOverused({ total: 2, done: 2, booked: 1 }));
    assert.ok(!isOverused({ total: 2, done: 1, booked: 1 }));
  });

  test('對帳能抓出計數欄位與實際不符', () => {
    const bad = reconcile({ totalQty: 20, doneCount: 99, bookedCount: 2 }, visits, 'e1');
    assert.equal(bad.ok, false);
    assert.equal(bad.stored.done, 99);
    assert.equal(bad.actual.done, 2);

    const good = reconcile({ totalQty: 20, doneCount: 2, bookedCount: 2 }, visits, 'e1');
    assert.equal(good.ok, true);
  });
});

describe('逐段的結果（客人只做一半就走）', () => {
  // 2026-08-20 使用者確認：不常發生，但是會發生。
  // 次數只扣真的做了的那幾段 —— 這是這個專案最不能算錯的東西。

  const ent = { totalQty: 10 };
  const half = {
    status: 'done',
    slots: [
      { entitlementId: 'e1', attended: true },
      { entitlementId: 'e1', attended: false },
    ],
  };

  test('已完成的來訪裡，沒做的那一段不扣次數', () => {
    const c = counts(ent, [half], 'e1');
    assert.equal(c.done, 1);
    assert.equal(c.noShow, 1);
    assert.equal(c.remaining, 9, '沒做的那一段要還回去');
  });

  test('attended 沒寫過的舊資料一律當成有做', () => {
    // 把它們當成沒做，會讓所有人的次數一夜之間全部退回去
    const legacy = { status: 'done', slots: [{ entitlementId: 'e1' }] };
    const nulled = { status: 'done', slots: [{ entitlementId: 'e1', attended: null }] };
    assert.equal(counts(ent, [legacy], 'e1').done, 1);
    assert.equal(counts(ent, [nulled], 'e1').done, 1);
  });

  test('還沒發生的來訪不看 attended', () => {
    // 匯入器會在 confirmed 的來訪上寫 attended: false（domain/mergeImport.js），
    // 那句話的意思是「還沒發生」，不是「沒做」。看它就會把未來的來訪算成未到。
    const future = { status: 'confirmed', slots: [{ entitlementId: 'e1', attended: false }] };
    const c = counts(ent, [future], 'e1');
    assert.equal(c.booked, 1);
    assert.equal(c.noShow, 0);
    assert.equal(c.done, 0);
  });

  test('整筆未到時，每一段都算未到，不管 attended 寫了什麼', () => {
    const missed = {
      status: 'no_show',
      slots: [{ entitlementId: 'e1', attended: true }, { entitlementId: 'e1' }],
    };
    const c = counts(ent, [missed], 'e1');
    assert.equal(c.noShow, 2);
    assert.equal(c.done, 0);
    assert.equal(c.remaining, 10);
  });

  test('slotOutcome 認得五種狀態，取消與已刪除都不算', () => {
    const on = { entitlementId: 'e1' };
    assert.equal(slotOutcome({ status: 'done' }, on), 'done');
    assert.equal(slotOutcome({ status: 'done' }, { ...on, attended: false }), 'no_show');
    assert.equal(slotOutcome({ status: 'no_show' }, on), 'no_show');
    assert.equal(slotOutcome({ status: 'confirmed' }, on), 'booked');
    assert.equal(slotOutcome({ status: 'pending_confirm' }, on), 'booked');
    assert.equal(slotOutcome({ status: 'cancelled' }, on), null);
    assert.equal(slotOutcome({ status: 'done', deletedAt: 'x' }, on), null);
    assert.equal(slotOutcome(null, on), null);
  });

  test('對帳跟著逐段算，不會因為改法而永遠對不起來', () => {
    // reconcile 與 counts 只能有一份實作（ADR-0004）
    const r = reconcile({ totalQty: 10, doneCount: 2, bookedCount: 0 }, [half], 'e1');
    assert.equal(r.actual.done, 1);
    assert.equal(r.ok, false, '快取說 2、實際 1，要看得出來');
  });
});

describe('方案展開', () => {
  const plan = {
    name: '筋骨強身',
    items: [
      { type: 'single', courseId: 'iv-laser', label: '靜脈', qty: 20, durationMin: 60 },
      { type: 'pool', label: '復能', qty: 12, durationMin: 60, optionEquipmentIds: ['laser', 'sis', 'indiba'] },
    ],
  };

  test('購買數量會乘上去', () => {
    const ents = expandPlan(plan, 2);
    assert.equal(ents[0].totalQty, 40);
    assert.equal(ents[1].totalQty, 24);
  });

  test('展開後只留方案名稱的文字快照，不指回範本', () => {
    const [first] = expandPlan(plan);
    assert.equal(first.sourcePlanName, '筋骨強身');
    assert.ok(!('sourcePlanId' in first), '不可以留指向範本的連結，範本會改');
  });

  test('擇一池帶的是器材不是課程', () => {
    const pool = expandPlan(plan)[1];
    assert.deepEqual(pool.optionEquipmentIds, ['laser', 'sis', 'indiba']);
    assert.equal(pool.courseId, null);
  });

  test('展開時計數從零開始', () => {
    for (const e of expandPlan(plan)) {
      assert.equal(e.doneCount, 0);
      assert.equal(e.bookedCount, 0);
    }
  });
});

describe('來訪時間', () => {
  test('結束時間 = 起始 + 時長', () => {
    assert.equal(endOf('09:15', 60), '10:15');
    assert.equal(endOf('14:45', 30), '15:15');
  });

  test('下一段預設隔 15 分鐘', () => {
    assert.equal(nextStart('10:15'), '10:30');
    assert.equal(nextStart('10:15', 30), '10:45');
  });

  test('排出白紙上那種連續時段', () => {
    // 9:15–10:15 復能 → 10:30–11:30 靜脈
    assert.deepEqual(layOutSlots('09:15', [60, 60]), [
      { startsAt: '09:15', endsAt: '10:15' },
      { startsAt: '10:30', endsAt: '11:30' },
    ]);
  });

  test('沒有時間的時段寫成「時間不詳」，不是空白也不是 null–null', () => {
    // 匯入的舊來訪就是這樣（ADR-0011）
    assert.equal(timeLabel({ startsAt: '09:15', endsAt: '10:15' }), '09:15–10:15');
    assert.equal(timeLabel({ startsAt: null, endsAt: null }), '時間不詳');
    assert.equal(timeLabel({}), '時間不詳');
    assert.equal(timeLabel({ startsAt: '09:15', endsAt: null }), '09:15');
  });

  test('重疊判斷：相接不算重疊', () => {
    const a = { startsAt: '09:00', endsAt: '10:00' };
    assert.ok(!overlaps(a, { startsAt: '10:00', endsAt: '11:00' }));
    assert.ok(overlaps(a, { startsAt: '09:59', endsAt: '11:00' }));
    assert.ok(overlaps(a, { startsAt: '09:15', endsAt: '09:30' }));
  });
});
