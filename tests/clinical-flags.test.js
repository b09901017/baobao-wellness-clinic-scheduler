// 警示要畫成什麼樣（ADR-0074）。
//
// 這一支盯的是**認不得的值不可以讓畫面壞掉**：一顆沒有顏色的丸子跟一顆
// 正常的丸子在她眼裡差不多，而那正是她分不出來的那種錯。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  ALERT_COLORS, ALERT_FILLS, DEFAULT_ALERT_COLOR, DEFAULT_ALERT_FILL,
  colorTokens, lookOf, lookup, styleFor,
} from '../public/js/domain/clinicalFlags.js';
import { MARK_COLORS } from '../public/js/domain/customerMarks.js';
import { validate } from '../public/js/domain/masterData.js';

describe('顏色名單', () => {
  test('跟客戶備註共用同一份六色 —— 不開新的色相（ADR-0039）', () => {
    assert.deepEqual(ALERT_COLORS, MARK_COLORS);
    assert.equal(ALERT_COLORS.length, 6);
  });

  test('值用 --evcolor-* 不用 --mark-*', () => {
    // --mark-* 是給小圓點用的，當 11px 的字擺在色塊上對比度不夠（ADR-0040）
    assert.deepEqual(colorTokens('red'), { fg: '--evcolor-red', bg: '--evcolor-red-bg' });
  });

  test('認不得的顏色回預設那一對，不要回一個不存在的變數名', () => {
    assert.deepEqual(colorTokens('螢光橘'), colorTokens(DEFAULT_ALERT_COLOR));
    assert.deepEqual(colorTokens(undefined), colorTokens(DEFAULT_ALERT_COLOR));
  });

  test('填法只有兩種', () => {
    assert.deepEqual(ALERT_FILLS.map((x) => x.id), ['solid', 'outline']);
  });
});

describe('一筆警示長什麼樣', () => {
  test('設定過就照她挑的', () => {
    const look = lookOf({ color: 'red', fill: 'solid' });
    assert.equal(look.color, 'red');
    assert.equal(look.fill, 'solid');
  });

  test('沒設定過就是茶色空心 —— 也就是這一層合併之前的樣子', () => {
    // 正式資料庫裡那兩筆身上沒有這兩個欄位，畫出來要跟以前一模一樣
    assert.equal(lookOf(null).color, DEFAULT_ALERT_COLOR);
    assert.equal(lookOf({}).fill, DEFAULT_ALERT_FILL);
    assert.equal(DEFAULT_ALERT_COLOR, 'tea');
    assert.equal(DEFAULT_ALERT_FILL, 'outline');
  });

  test('認不得的值退回預設，不會生出一顆沒有顏色的丸子', () => {
    const look = lookOf({ color: '螢光橘', fill: '漸層' });
    assert.equal(look.color, DEFAULT_ALERT_COLOR);
    assert.equal(look.fill, DEFAULT_ALERT_FILL);
  });

  test('行內樣式帶兩個變數 —— 實心要把底色與字對調', () => {
    const css = styleFor(lookOf({ color: 'blue' }));
    assert.match(css, /--flag-fg: var\(--evcolor-blue\)/);
    assert.match(css, /--flag-bg: var\(--evcolor-blue-bg\)/);
  });

  test('沒有 look 也吐得出一段合法的樣式', () => {
    assert.match(styleFor(null), /--flag-fg: var\(--evcolor-tea\)/);
  });
});

describe('用名字查樣式', () => {
  const rows = [
    { id: 'a', name: '體內金屬', color: 'red', fill: 'solid' },
    { id: 'b', name: '血管難打', color: 'tea', fill: 'outline' },
    { id: 'c', name: '停用的', color: 'blue', fill: 'solid', active: false },
    { id: 'd', name: '刪掉的', color: 'green', fill: 'solid', deletedAt: 'x' },
  ];

  test('查得到就照主檔', () => {
    const look = lookup(rows);
    assert.equal(look('體內金屬').color, 'red');
    assert.equal(look('體內金屬').fill, 'solid');
  });

  test('主檔上沒有那個字就回預設 —— 那是資料健檢要列的一種，不是崩潰', () => {
    assert.equal(lookup(rows)('怕痛').color, DEFAULT_ALERT_COLOR);
    assert.equal(lookup([])('體內金屬').color, DEFAULT_ALERT_COLOR);
  });

  test('停用與刪掉的不參與查表', () => {
    const look = lookup(rows);
    assert.equal(look('停用的').color, DEFAULT_ALERT_COLOR);
    assert.equal(look('刪掉的').color, DEFAULT_ALERT_COLOR);
  });

  test('前後空白不影響 —— 客戶身上存的是字串，可能帶著空白', () => {
    assert.equal(lookup(rows)('  體內金屬 ').color, 'red');
  });
});

describe('存檔前的驗證', () => {
  const ok = (r) => validate('clinicalFlags', r, { existing: [] });

  test('顏色與填法是選填的', () => {
    assert.deepEqual(ok({ name: '怕痛' }), []);
  });

  test('填了就要是名單上的 —— 存下去看起來沒變才是她分不出來的錯', () => {
    assert.ok(ok({ name: '怕痛', color: '螢光橘' }).some((e) => e.includes('顏色')));
    assert.ok(ok({ name: '怕痛', fill: '漸層' }).some((e) => e.includes('填法')));
  });

  test('名單上的照樣過', () => {
    assert.deepEqual(ok({ name: '怕痛', color: 'violet', fill: 'solid' }), []);
  });

  test('名字仍然擋空白與過長', () => {
    assert.ok(ok({ name: '  ' }).some((e) => e.includes('不可空白')));
    assert.ok(ok({ name: '一二三四五六七八九十一二三' }).some((e) => e.includes('12 字')));
  });
});
