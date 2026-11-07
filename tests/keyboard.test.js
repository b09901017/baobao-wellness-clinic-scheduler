// 鍵盤蓋住輸入框（notes-widget 01，ADR-0181）。
//
// 真的鍵盤只有手機上有（HTC 實機量過：全螢幕的那一顆，鍵盤跳出來時版面不縮、只縮 visual viewport；
// 加了 `interactive-widget=resizes-content` 之後版面 800 → 404，抽屜落在鍵盤上面）。這裡釘住那一行，
// 與「打字時把底部導覽列收起來」的判斷。版面縮了導覽列收不收，E2E `100-keyboard-layout` 量。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { keyboardOpen, typesText, nextKeyboard, KEYBOARD_MIN_PX } from '../public/js/ui/keyboard.js';
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

test('接線：app.js 一開機就盯（只掛一次）；手機上 html[data-keyboard] 收起底部導覽列與右下角那一顆（R1）', () => {
  assert.match(read('public/js/app.js'), /watchKeyboard\(\)/);
  const css = read('public/css/app.css');
  const rule = css.match(/@media \(max-width: 899px\) \{\s*html\[data-keyboard\] \.app__nav,\s*html\[data-keyboard\] \.fab \{\s*display: none;/);
  assert.ok(rule, 'html[data-keyboard] .app__nav 與 .fab 收起來，只在手機寬度');
});

// 上 main 前最後健檢 C（2026-11-07）：打字時轉方向（鍵盤還開著）→ 以前把「量過最高的」換成轉過去那一刻的高度
// （扣掉鍵盤的那一截），判成鍵盤沒開，底部導覽列站回鍵盤上面，要收一次鍵盤才好。
// 三星直的 384 寬、橫的 832 寬（都小於 900，走手機的版面）；數字照 `.scratch/final-check-2026-11-07/3-notes-web.md` 量的
describe('nextKeyboard：照寬度各記一份量過最高的、轉方向時鍵盤還開著', () => {
  const input = el('INPUT', 'text');
  const start = (width, height) => ({ width, tallestBy: new Map([[width, height]]), lowest: null, open: false });
  const walk = (s, steps) => steps.map(([width, height, focused]) => {
    s = nextKeyboard(s, { width, height, focused });
    return s.open;
  });

  test('直的打字 → 轉成橫的（鍵盤還開著）→ 收起來 → 再打開：每一步都對', () => {
    assert.deepEqual(walk(start(384, 832), [
      [384, 832, input], // 聚焦、鍵盤還沒出來
      [384, 452, input], // 鍵盤開著
      [832, 180, input], // 轉成橫的、鍵盤還開著 —— 以前這裡是 false
      [832, 384, input], // 鍵盤收起來（長回來一截）
      [832, 180, input], // 再打開一次
    ]), [false, true, true, false, true]);
  });

  test('轉回直的（鍵盤還開著）沿用直的時候量過的最高', () => {
    assert.deepEqual(walk(start(384, 832), [
      [384, 452, input], [832, 180, input], [384, 452, input],
    ]), [true, true, true]);
  });

  test('轉方向時沒在打字（或鍵盤沒開）：照一般的量，不會一直以為鍵盤開著', () => {
    assert.deepEqual(walk(start(384, 832), [
      [832, 384, null], [832, 384, input], [832, 180, input],
    ]), [false, false, true]);
    assert.deepEqual(walk(start(384, 832), [
      [384, 832, input], [832, 384, input],
    ]), [false, false], '聚焦了但鍵盤還沒出來就轉：沒有開著的鍵盤可以留');
  });

  test('轉過去之後不打字了：照一般的量；鍵盤收起來那一下長回來的高度記成最高', () => {
    assert.deepEqual(walk(start(384, 832), [
      [384, 452, input], [832, 180, input], [832, 180, null], [832, 384, null], [832, 180, input],
    ]), [true, true, false, false, true]);
  });

  test('桌機縮放視窗（寬度變了、沒有螢幕鍵盤）：跟以前一樣不成立', () => {
    assert.deepEqual(walk(start(1280, 800), [
      [700, 800, input], [700, 760, input], [1280, 800, input],
    ]), [false, false, false]);
  });
});
