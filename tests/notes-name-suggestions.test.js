// 記一筆時打名字就跳出客戶（notes-widget 03）：`domain/customers.js` 的 `nameSuggestions()`。
//
// 情境表（以前在這裡的 `CASES`）搬進共用情境檔 `tests/fixtures/notes-parity.json` 的 `nameSuggestions` 那一段（06）：
// Android 小工具的輸入卡照抄同一套比法，兩邊讀同一份（`tests/notes-parity.test.js`、`android/core` 的 `ParityTest`）。
// 名字一律假名（王小明、客戶B…），真名不進 repo。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { nameSuggestions } from '../public/js/domain/customers.js';

const PEOPLE = [
  { id: 'wxm', name: '王小明' },
  { id: 'wx', name: '王小' },
];

test('nameSuggestions：換字的範圍換成全名之後就是她要的那一行', () => {
  const text = '請王小回電';
  const { from, to, matches } = nameSuggestions(text, 3, PEOPLE);
  const pick = matches.find((c) => c.id === 'wxm');
  assert.equal(`${text.slice(0, from)}${pick.name}${text.slice(to)}`, '請王小明回電');
});
