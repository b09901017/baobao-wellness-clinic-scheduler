// 鍵盤蓋住輸入框（notes-widget 01，ADR-0181）。
//
// 真的鍵盤只有手機上有（HTC 實機量過：全螢幕的那一顆，鍵盤跳出來時版面不縮、只縮 visual viewport；
// 加了 `interactive-widget=resizes-content` 之後版面 800 → 404，抽屜落在鍵盤上面）。這裡釘住那一行，
// 與「打字時把底部導覽列收起來」的判斷。版面縮了導覽列收不收，E2E `100-keyboard-layout` 量。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { keyboardOpen, typesText, KEYBOARD_MIN_PX } from '../public/js/ui/keyboard.js';
import { fromRoot } from './helpers/paths.js';

const read = (p) => readFileSync(fromRoot(p), 'utf8').replace(/\r\n/g, '\n');

test('index.html 的 viewport：鍵盤跳出來時版面跟著縮（全螢幕的那一顆靠它）', () => {
  const meta = read('public/index.html').match(/<meta name="viewport" content="([^"]+)"/)?.[1] ?? '';
  assert.match(meta, /interactive-widget=resizes-content/);
  assert.match(meta, /viewport-fit=cover/, 'ADR-0147 的那一格不能掉');
});

/** 假的元素：只有 typesText() 讀的那幾格。 */
const el = (tagName, type = null, extra = {}) => ({
  tagName, getAttribute: (k) => (k === 'type' ? type : null), disabled: false, readOnly: false, isContentEditable: false, ...extra,
});

test('typesText：會叫出鍵盤的欄位才算', () => {
  for (const t of [null, 'text', 'search', 'tel', 'number', 'email', 'url', 'password']) assert.equal(typesText(el('INPUT', t)), true, String(t));
  assert.equal(typesText(el('TEXTAREA')), true);
  assert.equal(typesText(el('DIV', null, { isContentEditable: true })), true);
  for (const t of ['date', 'time', 'checkbox', 'radio', 'button', 'submit', 'range', 'file', 'color']) assert.equal(typesText(el('INPUT', t)), false, t);
  assert.equal(typesText(el('BUTTON')), false);
  assert.equal(typesText(el('INPUT', 'text', { readOnly: true })), false);
  assert.equal(typesText(el('INPUT', 'text', { disabled: true })), false);
  assert.equal(typesText(null), false);
});

test('keyboardOpen：焦點在打字的格子裡、而且版面矮了一截才算', () => {
  const input = el('INPUT', 'text');
  assert.equal(keyboardOpen({ tallest: 800, height: 404, focused: input }), true, 'HTC 量到的');
  assert.equal(keyboardOpen({ tallest: 800, height: 800, focused: input }), false, 'Safari、桌機：版面不縮');
  assert.equal(keyboardOpen({ tallest: 800, height: 800 - KEYBOARD_MIN_PX + 1, focused: input }), false, '網址列那種小跳動');
  assert.equal(keyboardOpen({ tallest: 800, height: 404, focused: el('BUTTON') }), false, '鍵盤收了、版面還沒長回來');
  assert.equal(keyboardOpen({ tallest: 800, height: 404, focused: null }), false);
});

test('接線：app.js 一開機就盯（只掛一次）；手機上 html[data-keyboard] 收起底部導覽列', () => {
  assert.match(read('public/js/app.js'), /watchKeyboard\(\)/);
  const css = read('public/css/app.css');
  const rule = css.match(/@media \(max-width: 899px\) \{\s*html\[data-keyboard\] \.app__nav \{\s*display: none;/);
  assert.ok(rule, 'html[data-keyboard] .app__nav 收起來，只在手機寬度');
});
