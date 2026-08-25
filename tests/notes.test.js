// 隨手記。它要能在三秒內記完，所以這裡驗的多半是「不要多擋」。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_LENGTH,
  datedIn,
  groupByCustomer,
  isOpen,
  normalize,
  normalizePatch,
  openCount,
  openFor,
  sortNotes,
  validateNote,
} from '../public/js/domain/notes.js';

const note = (over = {}) => ({
  id: 'n1',
  text: '指定 LuLu，不要排騰崴',
  customerId: 'c1',
  customerName: '王小姐',
  done: false,
  createdAt: '2026-08-19T02:00:00Z',
  deletedAt: null,
  ...over,
});

test('一行字就存得下去，客戶是選填的', () => {
  assert.equal(validateNote(note()).errors.length, 0);
  assert.equal(
    validateNote(note({ customerId: null, customerName: null })).errors.length,
    0,
    '沒掛客戶也要記得下去 —— 那些通常是最容易忘的雜事',
  );
});

test('空的存不下去', () => {
  assert.ok(validateNote(note({ text: '   ' })).errors.some((e) => e.includes('寫點東西')));
});

test('太長的擋下來，並說該寫去哪裡', () => {
  const { errors } = validateNote(note({ text: 'あ'.repeat(MAX_LENGTH + 1) }));
  assert.ok(errors.some((e) => e.includes('客戶備註')));
});

test('掛了客戶卻沒帶名字會被擋 —— 清單頁不會為了一行字再讀一次客戶', () => {
  const { errors } = validateNote(note({ customerName: '' }));
  assert.ok(errors.some((e) => e.includes('沒有名字')));
});

test('沒勾的在上面，新的先；勾掉的沉到最下面', () => {
  const rows = [
    note({ id: 'old', createdAt: '2026-08-01T00:00:00Z' }),
    note({ id: 'done', done: true, createdAt: '2026-08-19T09:00:00Z' }),
    note({ id: 'new', createdAt: '2026-08-19T05:00:00Z' }),
  ];
  assert.deepEqual(sortNotes(rows).map((n) => n.id), ['new', 'old', 'done']);
});

test('勾掉的不會消失 —— 她會勾錯，看得到才點得回來', () => {
  const rows = [note({ id: 'a', done: true })];
  assert.equal(sortNotes(rows).length, 1);
  assert.equal(openCount(rows), 0);
});

test('已刪除的不算數', () => {
  const rows = [note({ id: 'a', deletedAt: '2026-08-19T00:00:00Z' })];
  assert.deepEqual(sortNotes(rows), []);
  assert.equal(isOpen(rows[0]), false);
});

test('依客戶分組，沒掛客戶的收在最後一組', () => {
  const rows = [
    note({ id: 'a', customerId: 'c2', customerName: '陳先生' }),
    note({ id: 'b', customerId: null, customerName: null }),
    note({ id: 'c', customerId: 'c1', customerName: '王小姐' }),
  ];
  const groups = groupByCustomer(rows);
  assert.deepEqual(groups.map((g) => g.customerId), ['c1', 'c2', null]);
  assert.equal(groups[2].customerName, '沒掛客戶');
});

test('某位客戶身上還沒處理掉的', () => {
  const rows = [
    note({ id: 'a', customerId: 'c1' }),
    note({ id: 'b', customerId: 'c1', done: true }),
    note({ id: 'c', customerId: 'c2' }),
  ];
  assert.deepEqual(openFor(rows, 'c1').map((n) => n.id), ['a']);
});

test('沒掛客戶時兩個欄位一起清成 null', () => {
  const out = normalize({ text: '  記一下  ', customerId: '   ', customerName: '王小姐' });
  assert.deepEqual(out,
    { text: '記一下', customerId: null, customerName: null, date: null, done: false });
});

test('掛了客戶就兩個都留著', () => {
  const out = normalize({ text: 'x', customerId: 'c1', customerName: ' 王小姐 ', done: true });
  assert.deepEqual(out,
    { text: 'x', customerId: 'c1', customerName: '王小姐', date: null, done: true });
});

// ---------- 日期（選填）----------

test('日期空字串一律清成 null —— 日曆是用 date >= from 撈的', () => {
  // 空字串會被 `where('date', '>=', '2026-08-01')` 撈進來嗎？不會，
  // 但它會排在所有日期前面而且看起來像有值。null 才是「沒掛日期」。
  for (const date of ['', '   ', undefined, null]) {
    assert.equal(normalize({ text: 'x', date }).date, null, JSON.stringify(date));
  }
  assert.equal(normalize({ text: 'x', date: ' 2026-08-25 ' }).date, '2026-08-25');
});

test('日期是選填的，但填了就要是真的日期', () => {
  assert.deepEqual(validateNote({ text: 'x' }).errors, []);
  assert.deepEqual(validateNote({ text: 'x', date: '2026-08-25' }).errors, []);
  assert.ok(validateNote({ text: 'x', date: '八月二十五' }).errors.length);
  assert.ok(validateNote({ text: 'x', date: '2026-13-40' }).errors.length);
});

test('過去的日期不擋 —— 她會補記昨天那一件', () => {
  assert.deepEqual(validateNote({ text: 'x', date: '2020-01-01' }).errors, []);
});

test('datedIn：沒有日期的不上日曆，勾掉的照樣上', () => {
  const rows = [
    note({ id: 'a', date: '2026-08-25' }),
    note({ id: 'b', date: null }),
    note({ id: 'c', date: '2026-08-25', done: true }),
    note({ id: 'd', date: '2026-09-01' }),
    note({ id: 'e', date: '2026-08-20', deletedAt: 'x' }),
  ];
  assert.deepEqual(
    datedIn(rows, '2026-08-01', '2026-08-31').map((n) => n.id),
    ['a', 'c'],
    '勾掉的要留著 —— 日曆上畫成刪除線，不是消失',
  );
});

test('datedIn：頭尾兩天都算在範圍裡', () => {
  const rows = [note({ id: 'a', date: '2026-08-01' }), note({ id: 'b', date: '2026-08-31' })];
  assert.deepEqual(datedIn(rows, '2026-08-01', '2026-08-31').map((n) => n.id), ['a', 'b']);
});

// ---------- 改一筆（normalizePatch） ----------
//
// `normalize()` 吃的是一份完整的隨手記，`update(id, changes)` 收的是
// 「只有變了的那幾欄」。兩件事用同一支函式的代價是實際發生過的：
// 日曆上的待辦編輯器只問「記什麼」與「哪一天」，於是改一件**已經勾掉**的
// 待辦會把它變回沒做，而 `doneAt` 還留著上次的時間。

test('沒帶到的欄位一個都不動 —— 改一件勾掉的待辦不會把它變回沒做', () => {
  const patch = normalizePatch({ text: '訂九月的衛教單（改過）', date: '2026-09-03' });
  assert.deepEqual(patch, { text: '訂九月的衛教單（改過）', date: '2026-09-03' });
  assert.ok(!('done' in patch), 'done 沒帶到就不可以出現在要寫進去的東西裡');
  assert.ok(!('customerId' in patch));
});

test('帶到的欄位照 normalize 的規矩整理', () => {
  assert.deepEqual(normalizePatch({ text: '  兩邊留白  ' }), { text: '兩邊留白' });
  // 空字串一律收成 null —— 日曆是 where('date','>=',…) 撈的（ADR-0044）
  assert.deepEqual(normalizePatch({ date: '' }), { date: null });
  assert.deepEqual(normalizePatch({ done: 1 }), { done: true });
});

test('客戶那兩個欄位是一組的，只帶一個過來也要一起算出來', () => {
  assert.deepEqual(
    normalizePatch({ customerId: 'c1', customerName: ' 王小明 ' }),
    { customerId: 'c1', customerName: '王小明' },
  );
  // 拿掉客戶時名字要跟著清掉，不能留著上一版的
  assert.deepEqual(normalizePatch({ customerId: '' }), { customerId: null, customerName: null });
  assert.deepEqual(
    normalizePatch({ customerName: '王小明' }),
    { customerId: null, customerName: null },
  );
});

test('什麼都沒帶就什麼都不寫', () => {
  assert.deepEqual(normalizePatch(), {});
  assert.deepEqual(normalizePatch({}), {});
});
