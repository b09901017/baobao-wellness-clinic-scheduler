// 隨手記。它要能在三秒內記完，所以這裡驗的多半是「不要多擋」。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_LENGTH,
  groupByCustomer,
  isOpen,
  normalize,
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
  assert.deepEqual(out, { text: '記一下', customerId: null, customerName: null, done: false });
});

test('掛了客戶就兩個都留著', () => {
  const out = normalize({ text: 'x', customerId: 'c1', customerName: ' 王小姐 ', done: true });
  assert.deepEqual(out, { text: 'x', customerId: 'c1', customerName: '王小姐', done: true });
});
