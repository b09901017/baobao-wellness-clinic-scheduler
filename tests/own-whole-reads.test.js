// 刪客戶、改名之前讀這位客戶的全部（before-golive-2026-10-19 issue 13、14；中途發現第 1、6 條，ADR-0158 同一個形狀）。
//
// 判準：
// - 13：這一行會不會讓快取裡少一筆待確認來訪的那一位，被當成「沒有掛著東西」刪掉？
// - 14：這一行會不會讓改名之後，快取裡漏掉的那幾筆待辦／來訪留著舊名字？
// data 那一層要連 Firestore，這裡掃原始碼：讀的是哪一支、擋在寫之前。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fromRoot } from './helpers/paths.js';

const read = (rel) => readFileSync(fromRoot(rel), 'utf8').replace(/\r\n/g, '\n');
const body = (src, start, end = '\n}\n') => {
  const at = src.indexOf(start);
  assert.ok(at >= 0, `找不到 ${start}`);
  return src.slice(at, src.indexOf(end, at));
};

test('data/customers.js 的 ownWhole()：來訪走 listWhole()、待辦與隨手記看 cacheReads()、讀不完整丟 IncompleteReadError', () => {
  const src = read('public/js/data/customers.js');
  const fn = body(src, 'export async function ownWhole(');
  assert.match(fn, /listWhole\(/);
  assert.match(fn, /cacheReads\(\)/);
  assert.match(fn, /IncompleteReadError/);
});

test('13 刪客戶：按下去那一刻讀 ownWhole()，拿它問 deleteBlockers()（不拿打開時那一份）', () => {
  const src = read('public/js/ui/views/customerDetail.js');
  const handler = body(src, "querySelector('[data-delete]')", '\n  });\n');
  assert.match(handler, /ownWhole\(/);
  assert.doesNotMatch(handler, /deleteBlockers\(\{ visits: ctx\.visits/);
  assert.ok(handler.indexOf('ownWhole(') < handler.indexOf('rules.deleteBlockers('));
  assert.match(handler, /readFailed/);
});
