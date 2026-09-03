// 客戶、會籍與額度的規則。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  isValidDate, lastDayOf, addDays, addMonths, daysBetween,
} from '../public/js/domain/dates.js';
import {
  validate, warnings, membershipExpiry, membershipState, splitFlags,
  splitFlagsForEdit, mergeFlags, MAX_PRIORITY, EXPIRING_SOON_DAYS,
} from '../public/js/domain/customers.js';
import { contraindicationTerms } from '../public/js/domain/contraindications.js';
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

// ADR-0064：永久限制有三層。第二層什麼都不擋，但壓表那一刻要一眼看得到。
describe('臨床提醒是永久限制的第二層', () => {
  const equipment = [{ id: 'eq-sis', name: '超磁場', contraindications: ['體內金屬'] }];
  const clinical = [
    { id: 'cf-veins', name: '血管難打' },
    { id: 'cf-first', name: '第一針', active: false },
    { id: 'cf-gone', name: '已刪的', deletedAt: 'x' },
  ];

  test('三層各自分開 —— 禁忌會擋、臨床提醒不擋但要看得到、其餘不畫在卡片牆上', () => {
    const split = splitFlags(
      { flags: ['體內金屬', '血管難打', '固定禮拜五不行'] }, equipment, clinical,
    );
    assert.deepEqual(split.contraindications, ['體內金屬']);
    assert.deepEqual(split.clinical, ['血管難打']);
    assert.deepEqual(split.others, ['固定禮拜五不行']);
  });

  test('停用或刪掉的臨床提醒不再算第二層，掉回其餘', () => {
    const split = splitFlags({ flags: ['第一針', '已刪的'] }, equipment, clinical);
    assert.deepEqual(split.clinical, []);
    assert.deepEqual(split.others, ['第一針', '已刪的']);
  });

  test('兩份名單撞名時禁忌贏 —— 畫成比較輕的一顆等於把硬性阻擋降級', () => {
    const split = splitFlags(
      { flags: ['體內金屬'] }, equipment, [{ name: '體內金屬' }],
    );
    assert.deepEqual(split.contraindications, ['體內金屬']);
    assert.deepEqual(split.clinical, []);
  });

  test('沒有臨床提醒主檔時，行為跟這一支上線之前一模一樣', () => {
    const split = splitFlags({ flags: ['體內金屬', '血管難打'] }, equipment);
    assert.deepEqual(split.contraindications, ['體內金屬']);
    assert.deepEqual(split.clinical, []);
    assert.deepEqual(split.others, ['血管難打']);
  });
});

describe('永久限制的編輯（丸子 + 自由輸入）', () => {
  const equipment = [
    { id: 'eq-sis', name: '超磁場', contraindications: ['體內金屬'] },
    { id: 'eq-laser', name: '高能量雷射', contraindications: ['體內金屬'] },
    { id: 'eq-indiba', name: 'INDIBA', contraindications: [] },
    { id: 'eq-old', name: '舊機', contraindications: ['心律調節器'], deletedAt: 'x' },
  ];

  test('可以點的字就是器材上登記的那幾個，去重且不含已刪除的器材', () => {
    assert.deepEqual(contraindicationTerms(equipment), ['體內金屬']);
  });

  test('沒有器材就沒有丸子 —— 不要憑空生一個擋不住東西的字', () => {
    assert.deepEqual(contraindicationTerms([]), []);
    assert.deepEqual(contraindicationTerms(), []);
  });

  test('打開表單時，會擋東西的字落在丸子，其餘落在自由輸入', () => {
    const split = splitFlagsForEdit(
      ['固定禮拜五不行', '體內金屬'], contraindicationTerms(equipment),
    );
    assert.deepEqual(split.picked, ['體內金屬']);
    assert.deepEqual(split.others, ['固定禮拜五不行']);
  });

  test('存檔時合回一份，丸子排前面', () => {
    assert.deepEqual(mergeFlags(['體內金屬'], ['固定禮拜五不行']), ['體內金屬', '固定禮拜五不行']);
  });

  test('自由輸入又打了一次同一個字不會變成重複 —— 那會讓整張表單存不下去', () => {
    const flags = mergeFlags(['體內金屬'], ['體內金屬', '固定禮拜五不行']);
    assert.deepEqual(flags, ['體內金屬', '固定禮拜五不行']);
    assert.deepEqual(validate({ name: '王小姐', flags }), []);
  });

  test('空白項目會被丟掉，不會存成一個看不見的限制', () => {
    assert.deepEqual(mergeFlags([], ['  ', '體內金屬', '']), ['體內金屬']);
  });

  test('拆開再合回去是同一份', () => {
    const terms = contraindicationTerms(equipment);
    const before = ['體內金屬', '固定禮拜五不行'];
    const { picked, others } = splitFlagsForEdit(before, terms);
    assert.deepEqual(mergeFlags(picked, others), before);
  });

  // ADR-0064：編輯畫面上多一排丸子，而自由輸入那一欄要同時排掉兩份名單。
  describe('多了臨床提醒那一排之後', () => {
    const clinicalNames = ['血管難打'];

    test('三份各自落位', () => {
      const split = splitFlagsForEdit(
        ['固定禮拜五不行', '體內金屬', '血管難打'],
        contraindicationTerms(equipment),
        clinicalNames,
      );
      assert.deepEqual(split.picked, ['體內金屬']);
      assert.deepEqual(split.clinicalPicked, ['血管難打']);
      assert.deepEqual(split.others, ['固定禮拜五不行']);
    });

    test('臨床提醒不可以同時掉進自由輸入 —— 那會讓整張表單因為重複而存不下去', () => {
      const before = ['體內金屬', '血管難打', '固定禮拜五不行'];
      const s2 = splitFlagsForEdit(before, contraindicationTerms(equipment), clinicalNames);
      const after = mergeFlags(s2.picked, s2.clinicalPicked, s2.others);
      assert.deepEqual(after, before);
      assert.deepEqual(validate({ name: '王小姐', flags: after }), []);
    });

    test('只傳兩份的舊呼叫端行為一個字都沒有變', () => {
      assert.deepEqual(mergeFlags(['體內金屬'], ['固定禮拜五不行']), ['體內金屬', '固定禮拜五不行']);
      const split = splitFlagsForEdit(['體內金屬', '血管難打'], ['體內金屬']);
      assert.deepEqual(split.picked, ['體內金屬']);
      assert.deepEqual(split.clinicalPicked, []);
      assert.deepEqual(split.others, ['血管難打']);
    });
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
