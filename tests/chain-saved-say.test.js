// 改二返的次數，存完的 toast 講待辦多一張／少一張（before-golive-2026-10-19 issue 17；中途發現第 8 條）。
//
// 判準：這一行會不會讓她改了二返的次數之後，待辦上安靜地多一張「約二返」、而畫面一個字都沒講？
// 不加確認框（她常改，多一道框煩）—— 只在 toast 的「已儲存」後面接半句。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chainSavedSay } from '../public/js/domain/consequences.js';
import { fromRoot } from './helpers/paths.js';

const read = (rel) => readFileSync(fromRoot(rel), 'utf8').replace(/\r\n/g, '\n');

test('多一張約二返 → 「—— 待辦多 1 張「約二返」」；收一張 → 「1 張「約二返」收起來了」', () => {
  assert.equal(chainSavedSay({ plan: { create: [{ kind: '約二返' }], remove: [] }, tasks: [] }), ' —— 待辦多 1 張「約二返」');
  assert.equal(chainSavedSay({ plan: { create: [], remove: [{ id: 't1' }] }, tasks: [{ id: 't1', kind: '約二返' }] }),
    ' —— 1 張「約二返」收起來了');
});

test('沒動到、沒有鏈 → 空字串（toast 照舊只講「已儲存」）', () => {
  assert.equal(chainSavedSay(null), '');
  assert.equal(chainSavedSay({ plan: { create: [], remove: [] }, tasks: [] }), '');
});

test('接線：updateEntitlement() 回那一份、toast 的 success 收得到函式、改額度那一張表用它', () => {
  const data = read('public/js/data/customers.js');
  assert.match(data, /return chain \? \{ plan: chain\.plan, tasks: chain\.tasks \} : null;/);
  assert.match(read('public/js/ui/toast.js'), /typeof success === 'function' \? success\(result\) : success/);
  assert.match(read('public/js/ui/views/customerDetail.js'), /success: \(chain\) => `已儲存\$\{chainSavedSay\(chain\)\}`/);
});
