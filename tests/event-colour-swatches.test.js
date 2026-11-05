// 新增行事備註那張表的顏色（2026-11-05 第一輪小修 07，ADR-0171 推翻 ADR-0040 空心那一點）。
//
// 她：「為什麼第一個都很奇怪，會是一個空心圈圈？」「就直接拿掉，讓第一顆就是紫色的實心」。
// 第一顆＝那一類本來的顏色、實心、選它存 null；六色裡跟它重複的那一色不列 —— 除非這一筆現在存的就是那一色。
// 畫面上的樣子（實心、休假每顆斜線）在 E2E `92`。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATEGORIES, EVENT_COLORS, colourChoices } from '../public/js/domain/events.js';

const ids = (list) => list.map((c) => c.id);

test('每一類都說了六色裡哪一色跟它本來的顏色重複', () => {
  const by = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.sameAs]));
  assert.deepEqual(by, { personal: 'violet', leave: 'blue' });
  for (const c of CATEGORIES) assert.ok(EVENT_COLORS.includes(c.sameAs), c.id);
});

test('行事備註不列紫、休假不列藍；其餘照六色的順序', () => {
  assert.deepEqual(ids(colourChoices('personal')), ['grey', 'green', 'tea', 'red', 'blue']);
  assert.deepEqual(ids(colourChoices('leave')), ['grey', 'green', 'tea', 'red', 'violet']);
});

test('這一筆現在存的就是被拿掉的那一色：照樣列出來（原本的位置）', () => {
  assert.deepEqual(ids(colourChoices('personal', 'violet')), EVENT_COLORS);
  assert.deepEqual(ids(colourChoices('leave', 'blue')), EVENT_COLORS);
  // 別的顏色不影響
  assert.deepEqual(ids(colourChoices('personal', 'red')), ['grey', 'green', 'tea', 'red', 'blue']);
});

test('不認得的類別照行事備註（同 kindClass() 的退路）', () => {
  assert.deepEqual(ids(colourChoices('mystery')), ids(colourChoices('personal')));
});

test('編輯器的第一顆不再是空心的「跟著類別」', () => {
  const src = readFileSync('public/js/ui/views/eventEditor.js', 'utf8');
  assert.doesNotMatch(src, /swatch--auto/, '空心那一顆拿掉了（masterList 警示的「空心」填法是另一件事）');
  assert.match(src, /colourChoices\(/, '六色從 domain 拿，不在畫面裡寫死拿掉哪一色');
});
