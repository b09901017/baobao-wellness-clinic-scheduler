// 記一筆時打名字就跳出客戶（notes-widget 03）：`domain/customers.js` 的 `nameSuggestions()`。
//
// 底下的 `CASES` 是情境表：Android 小工具的輸入卡（08）照抄同一套比法，06 建共用的情境檔時從這裡搬。
// 名字一律假名（王小明、客戶B…），真名不進 repo。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { nameSuggestions } from '../public/js/domain/customers.js';

const PEOPLE = [
  { id: 'wxm', name: '王小明' },
  { id: 'wdt', name: '王大同' },
  { id: 'wx', name: '王小' },
  { id: 'lin', name: '林' },
  { id: 'lulu', name: 'ＬｕＬｕ' },
  { id: 'space', name: '陳 美玲' },
  { id: 'gone', name: '王小華', deletedAt: '2026-11-01T00:00:00Z' },
  { id: 'guest', name: '客戶B', oneTime: true },
];

/** [說明, 框裡的字, 游標（null＝最後）, 選項, 期望 { from, to, ids }] */
const CASES = [
  ['打一個姓：名字開頭是王的都列，刪掉的不列', '王', null, {}, { from: 0, to: 1, ids: ['wdt', 'wx', 'wxm'] }],
  ['只比開頭、不比包含：打「明」不跳', '明', null, {}, { from: 1, to: 1, ids: [] }],
  ['前面接著別的字：「請王小」用「王小」', '請王小', null, {}, { from: 1, to: 3, ids: ['wx', 'wxm'] }],
  ['全名完全一樣的排第一', '王小', null, {}, { from: 0, to: 2, ids: ['wx', 'wxm'] }],
  ['到空白或標點為止：「回電，王」只看「王」', '回電，王', null, {}, { from: 3, to: 4, ids: ['wdt', 'wx', 'wxm'] }],
  ['游標在中間：只看游標前面', '王小明回電', 3, {}, { from: 0, to: 3, ids: ['wxm'] }],
  ['已經是現在掛的那一位的全名：不跳', '王小明', null, { currentId: 'wxm' }, { from: 3, to: 3, ids: [] }],
  ['全名是別人、不是現在掛的那一位：照跳', '王小明', null, { currentId: 'wdt' }, { from: 0, to: 3, ids: ['wxm'] }],
  ['一個字的名字', '找林', null, {}, { from: 1, to: 2, ids: ['lin'] }],
  ['全形半形、大小寫不算不一樣', 'call lu', null, {}, { from: 5, to: 7, ids: ['lulu'] }],
  ['名字中間有空白的那一位：打「陳美」找得到', '陳美', null, {}, { from: 0, to: 2, ids: ['space'] }],
  ['一次性客人也列（列誰照呼叫端給的名單）', '客戶', null, {}, { from: 0, to: 2, ids: ['guest'] }],
  ['空的框', '', null, {}, { from: 0, to: 0, ids: [] }],
  ['最後一個字是空白：不跳', '王小明 ', null, {}, { from: 4, to: 4, ids: [] }],
];

for (const [name, text, caret, opts, want] of CASES) {
  test(`nameSuggestions：${name}`, () => {
    const got = nameSuggestions(text, caret ?? text.length, PEOPLE, opts);
    assert.deepEqual(
      { from: got.from, to: got.to, ids: got.matches.map((c) => c.id) },
      want,
    );
  });
}

test('nameSuggestions：最多 6 位', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ id: `w${i}`, name: `王${i}` }));
  assert.equal(nameSuggestions('王', 1, many).matches.length, 6);
});

test('nameSuggestions：換字的範圍換成全名之後就是她要的那一行', () => {
  const text = '請王小回電';
  const { from, to, matches } = nameSuggestions(text, 3, PEOPLE);
  const pick = matches.find((c) => c.id === 'wxm');
  assert.equal(`${text.slice(0, from)}${pick.name}${text.slice(to)}`, '請王小明回電');
});
