// 客戶、會籍與額度的規則。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  isValidDate, lastDayOf, addDays, addMonths, daysBetween,
} from '../public/js/domain/dates.js';
import {
  validate, warnings, membershipExpiry, membershipState, splitFlags,
  MAX_PRIORITY, EXPIRING_SOON_DAYS,
} from '../public/js/domain/customers.js';
import {
  expandPlan, summarize, lowRemaining, validateEntitlement, LOW_REMAINING,
} from '../public/js/domain/entitlements.js';

describe('日期算術', () => {
  test('不存在的日期不算合法', () => {
    assert.ok(isValidDate('2026-02-28'));
    assert.ok(!isValidDate('2026-02-30'));
    assert.ok(!isValidDate('2026-13-01'));
    assert.ok(!isValidDate('2026/02/01'));
    assert.ok(!isValidDate(''));
    assert.ok(!isValidDate(null));
  });

  test('閏年的二月有 29 天', () => {
    assert.equal(lastDayOf(2028, 2), 29);
    assert.equal(lastDayOf(2026, 2), 28);
  });

  test('加天數要跨得過月底與年底', () => {
    assert.equal(addDays('2026-08-31', 1), '2026-09-01');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  });

  test('加月份時月底夾到當月最後一天，不會溢出到下個月', () => {
    assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
    assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
    assert.equal(addMonths('2026-08-18', 12), '2027-08-18');
    assert.equal(addMonths('2026-03-31', -1), '2026-02-28');
  });

  test('相差天數，早的在後面就是負的', () => {
    assert.equal(daysBetween('2026-08-18', '2026-08-20'), 2);
    assert.equal(daysBetween('2026-08-20', '2026-08-18'), -2);
    assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1);
  });
});

describe('會籍', () => {
  test('會籍是日曆上的一年，不是 365 天', () => {
    assert.equal(membershipExpiry('2026-02-29', 12), null, '不存在的購買日算不出到期日');
    assert.equal(membershipExpiry('2028-02-29', 12), '2029-02-28');
    assert.equal(membershipExpiry('2026-08-18', 12), '2027-08-18');
  });

  test('沒有購買日或月數就沒有到期日，不亂猜', () => {
    assert.equal(membershipExpiry(null, 12), null);
    assert.equal(membershipExpiry('2026-08-18', null), null);
    assert.equal(membershipExpiry('2026-08-18', 0), null);
  });

  test('快到期的門檻是 30 天，過期的天數是負的', () => {
    assert.deepEqual(membershipState(null, '2026-08-18'), { state: 'none', days: null });
    assert.equal(membershipState('2026-08-17', '2026-08-18').state, 'expired');
    assert.equal(membershipState('2026-08-17', '2026-08-18').days, -1);
    assert.equal(membershipState('2026-09-17', '2026-08-18').state, 'soon');
    assert.equal(membershipState('2026-09-30', '2026-08-18').state, 'ok');
    assert.equal(EXPIRING_SOON_DAYS, 30);
  });

  test('到期當天還算有效', () => {
    assert.equal(membershipState('2026-08-18', '2026-08-18').state, 'soon');
    assert.equal(membershipState('2026-08-18', '2026-08-18').days, 0);
  });
});

describe('客戶驗證', () => {
  const ok = { name: '客戶甲', priority: 3, flags: ['體內金屬'] };

  test('姓名不可空白', () => {
    assert.ok(validate({ ...ok, name: '  ' }).length);
    assert.deepEqual(validate(ok), []);
  });

  test('喜好程度要在 0 到上限之間的整數 —— 排序公式要拿它當分母', () => {
    assert.ok(validate({ ...ok, priority: -1 }).length);
    assert.ok(validate({ ...ok, priority: MAX_PRIORITY + 1 }).length);
    assert.ok(validate({ ...ok, priority: 2.5 }).length);
    assert.deepEqual(validate({ ...ok, priority: 0 }), []);
  });

  test('日期填了就要合法，沒填不算錯', () => {
    assert.deepEqual(validate({ ...ok, purchasedAt: null, membershipExpiresAt: '' }), []);
    assert.ok(validate({ ...ok, purchasedAt: '2026-02-30' }).length);
  });

  test('會籍到期日不可以早於購買日', () => {
    const errors = validate({ ...ok, purchasedAt: '2026-08-18', membershipExpiresAt: '2026-08-17' });
    assert.ok(errors.some((e) => e.includes('早於購買日')));
  });

  test('永久限制不可空白也不可重複', () => {
    assert.ok(validate({ ...ok, flags: ['體內金屬', '體內金屬'] }).length);
    assert.ok(validate({ ...ok, flags: [''] }).length);
  });
});

describe('客戶提示（只提示不阻擋）', () => {
  const existing = [{ id: 'a', name: '王小姐' }, { id: 'b', name: '王小姐' }];

  test('同名客戶只提示，validate 不擋 —— 真的可能有兩位王小姐', () => {
    const candidate = { id: 'c', name: '王小姐', phone: '0900' };
    assert.deepEqual(validate(candidate), []);
    assert.ok(warnings(candidate, existing)[0].includes('2 位'));
  });

  test('改自己的時候不會說自己跟自己同名', () => {
    assert.deepEqual(warnings({ id: 'a', name: '王小姐', phone: '0900' }, [existing[0]]), []);
  });

  test('清單裡真的有兩位同名時，改其中一位仍然會提醒另一位', () => {
    assert.ok(warnings({ id: 'a', name: '王小姐', phone: '0900' }, existing)[0].includes('1 位'));
  });

  test('沒有電話也沒有 LINE 會提醒，因為之後問時間會找不到人', () => {
    const list = warnings({ id: 'z', name: '新客戶' }, []);
    assert.ok(list.some((w) => w.includes('LINE')));
  });
});

describe('永久限制與醫療禁忌', () => {
  const equipment = [
    { id: 'eq-sis', name: '超磁場', contraindications: ['體內金屬'] },
    { id: 'eq-old', name: '舊機', contraindications: ['心律調節器'], deletedAt: 'x' },
  ];

  test('會擋掉器材的那些限制要跟其他限制分開 —— 一個是硬性阻擋，一個只是提醒', () => {
    const split = splitFlags({ flags: ['體內金屬', '固定禮拜五不行'] }, equipment);
    assert.deepEqual(split.contraindications, ['體內金屬']);
    assert.deepEqual(split.others, ['固定禮拜五不行']);
  });

  test('已刪除器材上的禁忌不再算禁忌', () => {
    const split = splitFlags({ flags: ['心律調節器'] }, equipment);
    assert.deepEqual(split.contraindications, []);
    assert.deepEqual(split.others, ['心律調節器']);
  });
});

describe('額度驗證', () => {
  const courses = [{ id: 'course-rehab', name: '復健科醫師門診' }];
  const equipment = [{ id: 'eq-a', name: 'A' }, { id: 'eq-b', name: 'B' }];
  const ctx = { courses, equipment };

  test('single 一定要選一個存在的課程', () => {
    assert.deepEqual(
      validateEntitlement({ type: 'single', label: '門診', totalQty: 6, courseId: 'course-rehab' }, ctx),
      [],
    );
    assert.ok(
      validateEntitlement({ type: 'single', label: '門診', totalQty: 6, courseId: 'nope' }, ctx).length,
    );
    assert.ok(validateEntitlement({ type: 'single', label: '門診', totalQty: 6 }, ctx).length);
  });

  test('擇一池至少要有兩種器材，只有一種就不叫擇一', () => {
    assert.ok(
      validateEntitlement(
        { type: 'pool', label: '復能', totalQty: 12, optionEquipmentIds: ['eq-a'] }, ctx,
      ).length,
    );
    assert.deepEqual(
      validateEntitlement(
        { type: 'pool', label: '復能', totalQty: 12, optionEquipmentIds: ['eq-a', 'eq-b'] }, ctx,
      ),
      [],
    );
  });

  test('總次數必須是大於 0 的整數', () => {
    const base = { type: 'single', label: '門診', courseId: 'course-rehab' };
    assert.ok(validateEntitlement({ ...base, totalQty: 0 }, ctx).length);
    assert.ok(validateEntitlement({ ...base, totalQty: 1.5 }, ctx).length);
  });

  test('型態只能是 single 或 pool', () => {
    assert.ok(validateEntitlement({ type: 'bundle', label: 'x', totalQty: 1 }, ctx).length);
  });
});

describe('展開方案時帶上購買日與到期日', () => {
  const plan = {
    name: '筋骨強身',
    membershipMonths: 12,
    items: [{ type: 'single', courseId: 'c1', label: '靜脈', qty: 20, durationMin: 60 }],
  };

  test('額度自己記住什麼時候到期，不用回頭問範本', () => {
    const [e] = expandPlan(plan, 1, { purchasedAt: '2026-08-18', expiresAt: '2027-08-18' });
    assert.equal(e.purchasedAt, '2026-08-18');
    assert.equal(e.expiresAt, '2027-08-18');
  });

  test('沒給日期就是 null，不會變成 undefined 寫進 Firestore', () => {
    const [e] = expandPlan(plan);
    assert.equal(e.purchasedAt, null);
    assert.equal(e.expiresAt, null);
  });
});

describe('客戶總覽的額度合計', () => {
  const ents = [
    { id: 'a', totalQty: 20, doneCount: 3, bookedCount: 2 },
    { id: 'b', totalQty: 12, doneCount: 0, bookedCount: 0 },
  ];

  test('合計走計數欄位，因為總覽一次要畫二十幾位客戶', () => {
    const sum = summarize(ents);
    assert.deepEqual(sum, {
      pools: 2, total: 32, done: 3, booked: 2, remaining: 27, overused: false,
    });
  });

  test('任何一池超用就整位客戶標記超用', () => {
    assert.ok(summarize([{ id: 'a', totalQty: 2, doneCount: 2, bookedCount: 1 }]).overused);
  });

  test('沒有額度時合計是零，不是 NaN', () => {
    assert.equal(summarize([]).remaining, 0);
    assert.equal(summarize(undefined).pools, 0);
  });

  test('剩幾次以內算快用完', () => {
    assert.ok(lowRemaining([{ totalQty: 10, doneCount: 8, bookedCount: 0 }]));
    assert.ok(!lowRemaining([{ totalQty: 10, doneCount: 7, bookedCount: 0 }]));
    assert.equal(LOW_REMAINING, 2);
  });
});
