// 本輪可用性的解析與查詢。SPEC 第 4.3、5.3 節。
//
// 解析器一定會有讀不懂的句子，那不是 bug —— 重點是它讀不懂的時候要說出來，
// 而不是安靜地少一條規則。這一支測試盯的就是這件事。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseAvailability, dayStatus, availableDates, describeRule,
  collectionState, currentCollection, validateCollection, summarize,
  manualRule, mergeRules, validateRule,
} from '../public/js/domain/availability.js';

const parse = (text) => parseAvailability(text, { year: 2026 });

describe('解析原文', () => {
  test('SPEC 第 8.2 節那句原話', () => {
    const { rules, unparsed } = parse('9月禮拜一不行，9/17、9/18、9/22–24 不行');

    assert.deepEqual(rules, [
      { kind: 'exclude_weekday', weekday: 1 },
      { kind: 'exclude_date', date: '2026-09-17' },
      { kind: 'exclude_date', date: '2026-09-18' },
      { kind: 'exclude_range', from: '2026-09-22', to: '2026-09-24' },
    ]);
    assert.deepEqual(unparsed, []);
  });

  test('出國八天算成從那天起的八天', () => {
    const { rules } = parse('8/18 出國八天');
    assert.deepEqual(rules, [{ kind: 'exclude_range', from: '2026-08-18', to: '2026-08-25' }]);
  });

  test('「那星期」涵蓋整週，從禮拜一到禮拜日', () => {
    // 2026-09-06 是星期日，所以那一週是 8/31（一）到 9/6（日）
    const { rules } = parse('9/6 那星期不行');
    assert.deepEqual(rules, [{ kind: 'exclude_range', from: '2026-08-31', to: '2026-09-06' }]);
  });

  test('一三下午方便 —— 沒有「禮拜」前綴，但有時段就敢認', () => {
    const { rules, unparsed } = parse('一三下午方便');
    assert.deepEqual(rules, [
      { kind: 'prefer', weekday: 1, partOfDay: 'pm' },
      { kind: 'prefer', weekday: 3, partOfDay: 'pm' },
    ]);
    assert.deepEqual(unparsed, []);
  });

  test('沒有時段線索的裸數字不當成星期 —— 那會把日期讀成星期', () => {
    const { rules } = parse('12/1 不行');
    assert.deepEqual(rules, [{ kind: 'exclude_date', date: '2026-12-01' }]);
  });

  test('範圍先吃掉，裡面的日期不再重複記一次', () => {
    const { rules } = parse('9/22-9/24 不行');
    assert.deepEqual(rules, [{ kind: 'exclude_range', from: '2026-09-22', to: '2026-09-24' }]);
  });

  test('半天的限制記下來，不當成整天也不丟掉', () => {
    const { rules } = parse('禮拜五下午不行');
    assert.deepEqual(rules, [{ kind: 'exclude_weekday', weekday: 5, partOfDay: 'pm' }]);
  });

  test('看不懂的句子要列出來，不可以安靜丟掉', () => {
    const { rules, unparsed } = parse('禮拜一不行，禮拜一再確認一次，看情況');

    // 「禮拜一再確認一次」也沒有語氣詞，但它不是光禿禿的星期，所以不借語氣 ——
    // 借了會憑空多一條「禮拜一不行」，那比看不懂還糟
    assert.deepEqual(rules, [{ kind: 'exclude_weekday', weekday: 1 }]);
    assert.deepEqual(unparsed, ['禮拜一再確認一次', '看情況']);
  });

  test('不合法的日期不會被組出來', () => {
    const { rules, unparsed } = parse('2/30 不行');
    assert.deepEqual(rules, []);
    assert.deepEqual(unparsed, ['2/30 不行']);
  });

  test('空白原文不會爆掉', () => {
    for (const empty of ['', '   ', null, undefined]) {
      assert.deepEqual(parse(empty), { rules: [], unparsed: [] });
    }
  });

  test('同一件事講兩次只留一條', () => {
    const { rules } = parse('禮拜一不行，星期一不行');
    assert.equal(rules.length, 1);
  });
});

describe('某一天能不能排', () => {
  const rules = [
    { kind: 'exclude_weekday', weekday: 1 },
    { kind: 'exclude_date', date: '2026-09-17' },
    { kind: 'exclude_range', from: '2026-09-22', to: '2026-09-24' },
    { kind: 'prefer', weekday: 3, partOfDay: 'pm' },
  ];

  test('星期一整天不行', () => {
    assert.equal(dayStatus(rules, '2026-09-07').available, false); // 星期一
    assert.equal(dayStatus(rules, '2026-09-08').available, true);
  });

  test('單日與範圍都擋得住', () => {
    assert.equal(dayStatus(rules, '2026-09-17').available, false);
    assert.equal(dayStatus(rules, '2026-09-23').available, false, '範圍內不可用');
    assert.equal(dayStatus(rules, '2026-09-25').available, true);
  });

  test('擋整天時要說得出理由', () => {
    const { reasons } = dayStatus(rules, '2026-09-17');
    assert.deepEqual(reasons, ['9/17(四)不行']);
  });

  test('只擋半天的日子仍然排得進去，但要標出是哪半天', () => {
    const half = [{ kind: 'exclude_weekday', weekday: 5, partOfDay: 'pm' }];
    const friday = dayStatus(half, '2026-09-04');

    assert.equal(friday.available, true, '下午不行不代表整天不行');
    assert.equal(friday.blockedPart, 'pm');
  });

  test('上午與下午分別被擋，加起來就是整天不行', () => {
    const both = [
      { kind: 'exclude_weekday', weekday: 5, partOfDay: 'pm' },
      { kind: 'exclude_date', date: '2026-09-04', partOfDay: 'am' },
    ];
    assert.equal(dayStatus(both, '2026-09-04').available, false);
  });

  test('偏好標得出來，但不影響可不可以排', () => {
    const wed = dayStatus(rules, '2026-09-02'); // 星期三
    assert.equal(wed.preferred, true);
    assert.equal(wed.available, true);
  });
});

describe('可用天數', () => {
  test('壓表排序要用的就是這個數字', () => {
    const rules = [{ kind: 'exclude_weekday', weekday: 1 }];
    const days = availableDates(rules, '2026-09-01', '2026-09-30');

    assert.equal(days.length, 26); // 九月有四個星期一
    assert.ok(!days.includes('2026-09-07'));
    assert.ok(days.includes('2026-09-08'));
  });

  test('沒有規則就是整段都可用', () => {
    assert.equal(availableDates([], '2026-09-01', '2026-09-30').length, 30);
  });

  test('日期不合法或顛倒就回空陣列，不要無限迴圈', () => {
    assert.deepEqual(availableDates([], '2026-09-30', '2026-09-01'), []);
    assert.deepEqual(availableDates([], 'x', '2026-09-01'), []);
  });
});

describe('規則的人話', () => {
  test('每一種都說得出來', () => {
    assert.equal(describeRule({ kind: 'exclude_weekday', weekday: 1 }), '每個禮拜一不行');
    assert.equal(
      describeRule({ kind: 'exclude_weekday', weekday: 5, partOfDay: 'pm' }),
      '每個禮拜五下午不行',
    );
    assert.equal(describeRule({ kind: 'exclude_date', date: '2026-09-17' }), '9/17(四)不行');
    assert.equal(
      describeRule({ kind: 'exclude_range', from: '2026-09-22', to: '2026-09-24' }),
      '9/22(二) 到 9/24(四) 不行',
    );
    assert.equal(describeRule({ kind: 'prefer', weekday: 3, partOfDay: 'pm' }), '禮拜三下午方便');
  });
});

describe('有效期', () => {
  const record = { validFrom: '2026-09-01', validTo: '2026-09-30', collectedAt: '2026-08-28' };

  test('過期要看得出來，不是安靜地繼續用', () => {
    assert.equal(collectionState(record, '2026-10-05').state, 'expired');
    assert.equal(collectionState(record, '2026-10-05').days, -5);
  });

  test('快過期與還有效分得出來', () => {
    assert.equal(collectionState(record, '2026-09-10').state, 'valid');
    assert.equal(collectionState(record, '2026-09-29').state, 'expiring');
  });

  test('還沒開始的是 upcoming，不是過期', () => {
    assert.equal(collectionState(record, '2026-08-29').state, 'upcoming');
  });

  test('沒有有效期就是沒有，不要猜', () => {
    assert.equal(collectionState({}, '2026-09-10').state, 'none');
  });

  test('同時有效時用收集日期最新的那份', () => {
    const older = { ...record, id: 'a', collectedAt: '2026-08-20' };
    const newer = { ...record, id: 'b', collectedAt: '2026-08-28' };
    const expired = { id: 'c', validFrom: '2026-07-01', validTo: '2026-07-31', collectedAt: '2026-09-01' };

    assert.equal(currentCollection([older, newer, expired], '2026-09-10').id, 'b');
  });

  test('全部過期就回 null，讓畫面提示該重問了', () => {
    const expired = { id: 'c', validFrom: '2026-07-01', validTo: '2026-07-31' };
    assert.equal(currentCollection([expired], '2026-09-10'), null);
  });

  test('軟刪除的不算', () => {
    assert.equal(currentCollection([{ ...record, id: 'a', deletedAt: 'x' }], '2026-09-10'), null);
  });
});

describe('驗證', () => {
  const good = {
    rawText: '禮拜一不行',
    collectedAt: '2026-08-28',
    validFrom: '2026-09-01',
    validTo: '2026-09-30',
    rules: [{ kind: 'exclude_weekday', weekday: 1 }],
  };

  test('填好的一筆沒有錯誤', () => {
    assert.deepEqual(validateCollection(good), []);
  });

  test('原文不可空白 —— 原文才是最終依據', () => {
    assert.ok(validateCollection({ ...good, rawText: '  ' }).some((e) => e.includes('原文')));
  });

  test('有效期顛倒要擋', () => {
    assert.ok(
      validateCollection({ ...good, validTo: '2026-08-01' }).some((e) => e.includes('迄日')),
    );
  });

  test('壞規則要指得出是第幾條', () => {
    const errors = validateCollection({
      ...good,
      rules: [good.rules[0], { kind: 'exclude_date', date: '亂寫' }],
    });
    assert.ok(errors.some((e) => e.startsWith('第 2 條規則')), errors.join(' / '));
  });

  test('摘要說得出可用幾天', () => {
    assert.match(summarize(good, '2026-09-01'), /可用 26 天/);
    assert.match(summarize({ ...good, rules: [] }, '2026-09-01'), /看原文/);
  });
});

// ---------- 自己加一條規則 ----------
//
// 解析器一定會漏，而它的正確目標本來就是「常見的認得，其餘老實說看不懂」。
// 漏掉的時候原本唯一的辦法是把原文改寫成它認得的講法 —— 而 SPEC 第 4.3 節
// 要求原文照抄、永遠保留。見 .scratch/availability/issues/01。

describe('手動加的規則', () => {
  test('四種規則都建得出來，而且都標得出是自己加的', () => {
    assert.deepEqual(
      manualRule({ kind: 'exclude_weekday', weekday: '5' }),
      { kind: 'exclude_weekday', weekday: 5, manual: true },
    );
    assert.deepEqual(
      manualRule({ kind: 'exclude_date', date: '2026-09-17', partOfDay: 'am' }),
      { kind: 'exclude_date', date: '2026-09-17', partOfDay: 'am', manual: true },
    );
    assert.deepEqual(
      manualRule({ kind: 'exclude_range', from: '2026-09-22', to: '2026-09-24' }),
      { kind: 'exclude_range', from: '2026-09-22', to: '2026-09-24', manual: true },
    );
    assert.deepEqual(
      manualRule({ kind: 'prefer', weekday: '3', partOfDay: 'pm' }),
      { kind: 'prefer', weekday: 3, partOfDay: 'pm', manual: true },
    );
  });

  test('喜好填了日期就以日期為準，不填就用星期', () => {
    assert.equal(manualRule({ kind: 'prefer', weekday: '3', date: '2026-09-17' }).date, '2026-09-17');
    assert.equal(manualRule({ kind: 'prefer', weekday: '3' }).weekday, 3);
  });

  test('不認得的種類回 null，不要編一條出來', () => {
    assert.equal(manualRule({ kind: '亂寫' }), null);
  });

  test('手動加的規則跟解析出來的一樣會被套用', () => {
    const rules = [manualRule({ kind: 'exclude_weekday', weekday: 5 })];
    assert.equal(dayStatus(rules, '2026-09-18').available, false, '2026-09-18 是禮拜五');
    assert.equal(dayStatus(rules, '2026-09-17').available, true);
  });

  test('重新解析原文時，自己加的那幾條要留著', () => {
    // 那幾條本來就不在原文的解析結果裡 —— 那正是她手動加的原因。
    // 整份取代等於每次重新解析都清掉一次，而且不會有任何訊息。
    const manual = manualRule({ kind: 'exclude_weekday', weekday: 5 });
    const before = [{ kind: 'exclude_date', date: '2026-09-01' }, manual];
    const parsed = [{ kind: 'exclude_date', date: '2026-09-02' }];

    const merged = mergeRules(before, parsed);
    assert.deepEqual(merged, [{ kind: 'exclude_date', date: '2026-09-02' }, manual]);
  });

  test('重新解析不會把解析出來的舊規則留下來', () => {
    const before = [{ kind: 'exclude_date', date: '2026-09-01' }];
    assert.deepEqual(mergeRules(before, []), []);
  });

  test('一條規則的驗證只有一份實作，收集與手動新增共用', () => {
    assert.deepEqual(validateRule({ kind: 'exclude_weekday', weekday: 3 }), []);
    assert.deepEqual(validateRule({ kind: 'exclude_weekday', weekday: 9 }), ['星期不合法']);
    assert.deepEqual(validateRule({ kind: 'exclude_date', date: '亂寫' }), ['日期不合法']);
    assert.deepEqual(
      validateRule({ kind: 'exclude_range', from: '2026-09-24', to: '2026-09-22' }),
      ['結束日不能早於開始日'],
    );
    assert.deepEqual(validateRule({ kind: '亂寫' }), ['不認得的種類']);

    // 整份收集的驗證要講得出是第幾條
    const errors = validateCollection({
      rawText: '有字', collectedAt: '2026-09-01', validFrom: '2026-09-01', validTo: '2026-09-30',
      rules: [{ kind: 'exclude_weekday', weekday: 9 }],
    });
    assert.deepEqual(errors, ['第 1 條規則：星期不合法']);
  });

  test('手動加的規則存得進去，不會被驗證擋下來', () => {
    const errors = validateCollection({
      rawText: '月底那幾天盡量不要',
      collectedAt: '2026-09-01',
      validFrom: '2026-09-01',
      validTo: '2026-09-30',
      rules: [manualRule({ kind: 'exclude_range', from: '2026-09-28', to: '2026-09-30' })],
    });
    assert.deepEqual(errors, []);
  });
});
