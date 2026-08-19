// 備註（掛在客戶身上的彩色標記）。ADR-0019。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  MARK_COLORS, DEFAULT_MARK_COLOR, MAX_MARK_LENGTH, MAX_MARKS,
  readMarks, marksToText, normalizeMark, validateMarks, colorToken, toCustomerFields,
} from '../public/js/domain/customerMarks.js';

describe('顏色', () => {
  test('顏色只有六個，而且都指到 tokens.css 的變數', () => {
    assert.equal(MARK_COLORS.length, 6);
    for (const c of MARK_COLORS) {
      assert.match(c.token, /^--mark-[a-z]+$/);
    }
  });

  test('認不得的顏色一律退回灰色 —— 畫面上不可以出現沒有顏色的圓點', () => {
    assert.equal(colorToken('nope'), '--mark-grey');
    assert.equal(colorToken(undefined), '--mark-grey');
    assert.equal(normalizeMark({ text: 'x', color: '#ff0000' }).color, DEFAULT_MARK_COLOR);
    assert.equal(normalizeMark({ text: 'x', color: 'violet' }).color, 'violet');
  });
});

describe('讀出備註', () => {
  test('有 marks 就用 marks', () => {
    const marks = readMarks({
      marks: [{ text: '喜歡下午', color: 'green' }, { text: '指定騰崴', color: 'blue' }],
      notes: '這一段應該被忽略',
    });
    assert.deepEqual(marks, [
      { text: '喜歡下午', color: 'green' },
      { text: '指定騰崴', color: 'blue' },
    ]);
  });

  test('舊客戶只有 notes，逐行拆成灰色備註 —— 不需要先搬移過才看得到東西', () => {
    const marks = readMarks({ notes: '營養品(12000)：夜態美+速膳淨\n7/17 二返(夏)' });
    assert.deepEqual(marks, [
      { text: '營養品(12000)：夜態美+速膳淨', color: 'grey' },
      { text: '7/17 二返(夏)', color: 'grey' },
    ]);
  });

  test('空白行不會變成看不見的空丸子', () => {
    assert.deepEqual(readMarks({ notes: 'a\n\n  \nb' }), [
      { text: 'a', color: 'grey' },
      { text: 'b', color: 'grey' },
    ]);
    assert.deepEqual(readMarks({ notes: '   ' }), []);
    assert.deepEqual(readMarks({}), []);
    assert.deepEqual(readMarks(null), []);
  });

  test('marks 是空陣列就是真的沒有備註，不會退回去讀 notes', () => {
    assert.deepEqual(readMarks({ marks: [], notes: '舊的' }), []);
  });
});

describe('寫回去', () => {
  test('marks 與 notes 一起寫，notes 是換行接起來的鏡像', () => {
    const fields = toCustomerFields([
      { text: '喜歡下午', color: 'green' },
      { text: '指定騰崴', color: 'blue' },
    ]);
    assert.deepEqual(fields.marks, [
      { text: '喜歡下午', color: 'green' },
      { text: '指定騰崴', color: 'blue' },
    ]);
    assert.equal(fields.notes, '喜歡下午\n指定騰崴');
  });

  test('沒有備註時 notes 是 null 不是空字串', () => {
    assert.equal(marksToText([]), null);
    assert.equal(marksToText(null), null);
    assert.equal(toCustomerFields([]).notes, null);
  });

  test('空白的那幾則在寫回去之前就被丟掉', () => {
    const fields = toCustomerFields([{ text: '  ', color: 'red' }, { text: 'ok', color: 'red' }]);
    assert.deepEqual(fields.marks, [{ text: 'ok', color: 'red' }]);
    assert.equal(fields.notes, 'ok');
  });

  test('寫出去再讀回來是同一份', () => {
    const marks = [{ text: '體況不穩', color: 'red' }, { text: '喜歡早上', color: 'tea' }];
    assert.deepEqual(readMarks(toCustomerFields(marks)), marks);
  });
});

describe('驗證', () => {
  const ok = [{ text: '喜歡下午', color: 'green' }];

  test('正常的過', () => {
    assert.deepEqual(validateMarks(ok), []);
    assert.deepEqual(validateMarks([]), []);
    assert.deepEqual(validateMarks(null), []);
  });

  test('不是陣列就直接擋下來', () => {
    assert.deepEqual(validateMarks('喜歡下午'), ['備註格式錯誤']);
  });

  test('空白的擋下來', () => {
    assert.deepEqual(validateMarks([{ text: '   ', color: 'grey' }]), ['備註不可以是空白的']);
  });

  test('太長的擋下來，並說該怎麼辦', () => {
    const errors = validateMarks([{ text: 'あ'.repeat(MAX_MARK_LENGTH + 1), color: 'grey' }]);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /拆成兩三則/);
  });

  test(`最多 ${MAX_MARKS} 則`, () => {
    const many = Array.from({ length: MAX_MARKS + 1 }, (_, i) => ({ text: `第${i}則`, color: 'grey' }));
    assert.match(validateMarks(many)[0], new RegExp(`最多 ${MAX_MARKS} 則`));
  });

  test('重複的擋下來 —— 同一句話出現兩次只會讓她以為自己看錯', () => {
    const errors = validateMarks([
      { text: '喜歡下午', color: 'green' },
      { text: '喜歡下午', color: 'red' },
    ]);
    assert.deepEqual(errors, ['「喜歡下午」重複了']);
  });
});
