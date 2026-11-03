// 拍 Abovee「發現問題 N」那一頁列哪幾件、N 怎麼數（abovee-confirm-glance 04，ADR-0170）。
//
// 她 11/3：「就是那健檢出來，"要你看"，不一樣等等怪怪的地方，能不能切換之後才看到」；
// 「能不能不要上面那段話，像是"對過 … 都在這次的照片上。"」。
//
// 盯四件事：
//   1. N ＝ 那一頁列出來的件數：照片層級一種一件、要改的照列數、要你看／過了還沒結案／還差一步一列一件、app 有照片沒有照段數
//   2. 同一列在兩塊只算一件；記好了的不算（呼叫端只傳還沒記的）
//   3. 「都在這次的照片上」那一句不畫；「還沒認出是誰」「沒有對」照講、算一件
//   4. 正常配上的左右兩半那一句不畫
// 例子一律假名。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { absentSay, absentShown, problemsPage } from '../public/js/domain/aboveeImport.js';

const CUSTOMERS = [{ id: 'c-wang', name: '王小明' }];
const range = { lo: { date: '2026-10-02', time: '09:00' }, hi: { date: '2026-10-16', time: '10:00' } };
const slot = (n) => ({ key: `v${n}:0`, customerId: 'c-wang', customerName: '王小明', date: `2026-10-0${n}`, startsAt: '10:00', name: 'IN(60)', status: 'confirmed' });
const absent = ({ slots = [], unknown = [], ids = ['c-wang'], why = null } = {}) => (why
  ? { checked: null, why, slots: [] }
  : { checked: { customerIds: ids, unknown, ranges: [range] }, why: null, slots });

describe('absentShown()：「app 有、這次照片上沒有」那一塊在「發現問題」上講什麼、算幾件', () => {
  test('都在照片上 → 不畫、0 件（「都在這次的照片上」那一句她劃掉了）', () => {
    assert.deepEqual(absentShown(absent(), CUSTOMERS), { say: '', count: 0 });
    assert.match(absentSay(absent(), CUSTOMERS), /都在這次的照片上/, 'absentSay() 本身沒變（別的地方照舊讀它）');
  });

  test('有沒拍到的段 → 照段數；那一句照 absentSay()', () => {
    const gone = absent({ slots: [slot(3), slot(4)] });
    assert.deepEqual(absentShown(gone, CUSTOMERS), { say: absentSay(gone, CUSTOMERS), count: 2 });
  });

  test('還沒認出是誰（ADR-0153）算一件；跟沒拍到的段一起時加一', () => {
    const only = absentShown(absent({ unknown: ['某某某'] }), CUSTOMERS);
    assert.equal(only.count, 1);
    assert.equal(only.say, '照片上的 某某某 還沒認出是誰，先沒對。');
    assert.doesNotMatch(only.say, /都在這次的照片上/);
    assert.equal(absentShown(absent({ slots: [slot(3)], unknown: ['某某某'] }), CUSTOMERS).count, 2);
  });

  test('照片上的人一個都沒認出 → 沒有對，算一件', () => {
    const shown = absentShown(absent({ ids: [], unknown: ['某某某'] }), CUSTOMERS);
    assert.equal(shown.count, 1);
    assert.match(shown.say, /沒有對/);
  });

  test('沒有對（不是照時間排、讀不到日期）→ 照講、算一件：那時候 0 件不等於沒事', () => {
    for (const why of ['unsorted', 'noDates']) {
      const gone = absent({ why });
      assert.deepEqual(absentShown(gone, CUSTOMERS), { say: absentSay(gone, CUSTOMERS), count: 1 }, why);
    }
  });

  test('照片上一列都沒有 → 不畫', () => {
    assert.deepEqual(absentShown({ checked: null, why: null, slots: [] }, CUSTOMERS), { say: '', count: 0 });
  });
});

describe('problemsPage()：那一頁列哪幾件、N 是多少', () => {
  const none = { problems: {} };
  const page = (items, o = {}, plan = none) => problemsPage(items, plan, { absent: absent(), customers: CUSTOMERS, ...o });

  test('什麼都沒有 → 0 件', () => {
    const p = page([{ key: 'a0', kind: 'new', customerId: 'c-wang', checked: true }]);
    assert.deepEqual([p.count, p.notes, p.changes, p.look, p.later, p.flagged], [0, [], [], [], [], []]);
  });

  test('照片層級：沒拍到預約狀態那一欄、左右列數不一樣、沒有姓名 —— 一種一件；正常配上的那一句不畫', () => {
    assert.deepEqual(page([], { pairing: 'mismatch', noStatusColumn: 'some' }).notes, ['statusColumn', 'mismatch']);
    assert.equal(page([], { pairing: 'mismatch', noStatusColumn: 'some' }).count, 2);
    assert.deepEqual(page([], { pairing: 'noNames' }).notes, ['noNames']);
    assert.deepEqual(page([], { pairing: 'halves' }).notes, []);
    assert.equal(page([], { pairing: 'halves' }).count, 0);
  });

  test('要改的照列數：一列改狀態又改期是一件', () => {
    const both = { key: 'a1', kind: 'recorded', customerId: 'c-wang', statusChange: { from: 'confirmed', to: 'done' }, adoptStatus: true,
      move: { slot: { startsAt: '11:00' } }, adoptMove: true };
    const fill = { key: 'a2', kind: 'recorded', customerId: 'c-wang', diffs: [{ field: 'therapistId', app: null, abovee: 's1' }], adopt: true };
    const p = page([both, fill]);
    assert.deepEqual([p.changes, p.count], [['a1', 'a2'], 2]);
  });

  test('同一列在「要改的」與「要你看」只算一件', () => {
    const odd = { key: 'a3', kind: 'mismatch', customerId: 'c-wang', diffs: [{ field: 'roomId', app: 'r1', abovee: 'r2' }], adopt: true };
    const p = page([odd], { attention: new Set(['a3']) });
    assert.deepEqual([p.changes, p.look, p.count], [['a3'], ['a3'], 1]);
  });

  test('要你看、日子過了還沒結案（收著的那一組）都列、都算', () => {
    const items = ['a4', 'a5', 'a6'].map((key) => ({ key, kind: 'new', customerId: 'c-wang' }));
    const p = page(items, { attention: new Set(['a4', 'a5']), later: new Set(['a5']) });
    assert.deepEqual([p.look, p.later, p.count], [['a4'], ['a5'], 2]);
  });

  test('有紅字短標記的列（連還差一步）：不在要你看裡的另外一塊「有提醒的」；在要你看裡的不再列一次', () => {
    const items = [
      { key: 'a7', kind: 'new', customerId: 'c-wang', checked: true },
      { key: 'a8', kind: 'new', customerId: 'c-wang', checked: true },
      { key: 'a9', kind: 'new', customerId: 'c-wang', checked: false },
      { key: 'a10', kind: 'new', customerId: 'c-wang', checked: true },
      { key: 'a11', kind: 'new', customerId: 'c-wang', checked: true },
    ];
    const plan = {
      problems: { a7: ['要選一個額度'], a8: ['要選一個額度'], a9: ['要選一個額度'] },
      tagBy: { a10: [{ source: 'conflict' }], a11: [] },
    };
    const p = page(items, { attention: new Set(['a8']) }, plan);
    assert.deepEqual([p.flagged, p.look, p.count], [['a7', 'a10'], ['a8'], 3], '沒勾的那一列不會寫進去，不算；沒有標記的不列');
  });

  test('「有提醒的」跟辨識結果上的紅字一對一：每一列都問 rowTag()', () => {
    const items = [{ key: 'c0', kind: 'new', customerId: 'c-wang', checked: true }];
    const plan = { problems: {}, tagBy: { c0: [{ source: 'notice' }] } };
    assert.deepEqual(page(items, {}, plan).flagged, ['c0']);
    assert.deepEqual(page([{ ...items[0], checked: false }], {}, plan).flagged, [], '沒勾的那一列沒有標記，也不列');
  });

  // 段二（續）中途發現：只有一句「為什麼沒先勾」或「差一個字」、不在要你看、也沒有紅字的列 —— 那一句以前收著也畫（ADR-0116、0128）。
  // 不收進這一頁的話，那一句只剩點開才看得到，而「發現問題 0」灰掉講的是「沒事」
  test('列底下有一句的（讀不到全部來訪、看起來是同一段、差一個字、同一格取消過）也在「有提醒的」；取消的那一列沒有一句、不列', () => {
    const items = [
      { key: 'd0', kind: 'new', customerId: 'c-wang', checked: false, partialHistory: true },
      { key: 'd1', kind: 'new', customerId: 'c-wang', checked: false, repeatOf: 'd9', date: '2026-10-03', startsAt: '10:00' },
      { key: 'd2', kind: 'new', customerId: 'c-wang', checked: true, course: { courseId: 'x', near: { seen: 'SlS', as: 'SIS' } } },
      { key: 'd3', kind: 'new', customerId: 'c-wang', checked: false, appCancelledHere: true },
      { key: 'd4', kind: 'new', customerId: 'c-wang', checked: false, cancelled: true },
      { key: 'd5', kind: 'recorded', customerId: 'c-wang' },
    ];
    const p = page(items);
    assert.deepEqual([p.flagged, p.count], [['d0', 'd1', 'd2', 'd3'], 4]);
  });

  test('app 有照片沒有：照段數，加進 N', () => {
    const p = page([], { absent: absent({ slots: [slot(3), slot(4)], unknown: ['某某某'] }) });
    assert.deepEqual([p.absent.count, p.count], [3, 3]);
  });

  test('N 就是每一塊加起來（不重複的列＋段＋照片層級）', () => {
    const items = [
      { key: 'b0', kind: 'recorded', customerId: 'c-wang', statusChange: { from: 'confirmed', to: 'done' }, adoptStatus: true },
      { key: 'b1', kind: 'mismatch', customerId: 'c-wang' },
      { key: 'b2', kind: 'new', customerId: 'c-wang', checked: true },
    ];
    const p = page(items, { attention: new Set(['b1']), pairing: 'mismatch', absent: absent({ slots: [slot(5)] }) },
      { problems: { b2: ['還沒選器材'] } });
    assert.equal(p.count, 1 + 1 + 1 + 1 + 1);
  });
});
