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
  assert.match(data, /const chainSaid = \(chain\) => \(chain \? \{ plan: chain\.plan, tasks: chain\.tasks \} : null\);/);
  const start = data.indexOf('export async function updateEntitlement(');
  assert.match(data.slice(start, data.indexOf('\n}\n', start)), /return chainSaid\(chain\);/);
  assert.match(read('public/js/ui/toast.js'), /typeof success === 'function' \? success\(result\) : success/);
  assert.match(read('public/js/ui/views/customerDetail.js'), /success: \(chain\) => `已儲存\$\{chainSavedSay\(chain\)\}`/);
});

// issue 19（中途發現 15，她 10/19 深夜：「講，在 toast 後面接，不加確認框」）：改額度的其他幾條路也重算那一條鏈（ADR-0159），
// 一樣沒有講到鏈的確認框 —— 加購一筆、加購一整個方案、拍訂購單加購、改購買日、從已刪除項目還原、「把計數欄位改成重算值」。
// 判準：這一行會不會讓她加購一筆二返之後，待辦上安靜地多一張「約二返」、而 toast 只講「已加購」？
test('接線：其他改額度的路也把那一份 plan 回給畫面', () => {
  const data = read('public/js/data/customers.js');
  for (const name of ['createEntitlement', 'addEntitlements', 'updateEntitlements', 'restoreEntitlement']) {
    const start = data.search(new RegExp(`export async function ${name}\\(`));
    const body = data.slice(start, data.indexOf('\n}\n', start));
    assert.match(body, /return chainSaid\(chain\);/, `${name}() 要回 chainSaid(chain)`);
  }
});

test('接線：那幾條路存完的 toast 都接 chainSavedSay()', () => {
  const detail = read('public/js/ui/views/customerDetail.js');
  assert.match(detail, /success: \(chain\) => `已加購\$\{chainSavedSay\(chain\)\}`/, '加購一筆');
  assert.match(detail, /success: \(chain\) => `已加購 \$\{rows\.length\} 筆\$\{chainSavedSay\(chain\)\}`/, '加購一整個方案');
  assert.match(detail, /success: \(chain\) => `已修正\$\{chainSavedSay\(chain\)\}`/, '把計數欄位改成重算值');
  assert.match(read('public/js/ui/views/bought.js'), /success: \(chain\) => `購買日期改好了\$\{chainSavedSay\(chain\)\}`/, '改購買日');
  assert.match(read('public/js/ui/views/trash.js'), /success: \(result\) => `已還原\$\{chainSavedSay\(result\)\}`/, '從已刪除項目還原');
  assert.match(read('public/js/ui/components/orderConfirm.js'), /已加購到 \$\{target\.name\}\$\{chainSavedSay\(chain\)\}/, '拍訂購單加購');
});
