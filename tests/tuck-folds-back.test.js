// 「換一款」「其他醫師」收得回去（2026-10-18，staging-polish 段一；她回中途發現：「好，一起修掉」）。
//
// 那一顆以前只會展開（`data-tuck` 設成 open、那一顆藏起來）。現在展開、收回都走 `form.js` 的 `toggleTuck()`：
// 來訪編輯器經 `wireChips()`、壓表自己畫的那兩排（品項、醫師）在 `onDeckClick()` 叫同一支。
// 真的收得回去、選著的那一款收起來也看得到由 E2E `01` 的 J-E10 量。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../public/${rel}`, import.meta.url), 'utf8');

test('只有 toggleTuck() 一支在動 data-tuck（不會有一個入口又變回只展開不收回）', () => {
  for (const rel of ['js/ui/views/schedule.js', 'js/ui/views/visitEditor.js', 'js/ui/components/aboveeConfirm.js']) {
    assert.doesNotMatch(read(rel), /setAttribute\('data-tuck'/, rel);
  }
  assert.match(read('js/ui/views/schedule.js'), /f\.toggleTuck\(e\)/);
  assert.match(read('js/ui/components/form.js'), /if \(toggleTuck\(e\)\) return;/);
});

test('展開之後那一顆不藏起來；收回時選著的那一顆照樣看得到', () => {
  const css = read('css/app.css');
  assert.doesNotMatch(css, /\[data-tuck='open'\] \.chip--more \{ display: none; \}/);
  assert.match(css, /\.chip--tucked\[aria-pressed='true'\] \{ display: inline-flex; \}/);
});
