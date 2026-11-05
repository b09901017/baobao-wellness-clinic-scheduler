// 隨手記「挑日期」按一下就選好（2026-11-05 第一輪小修 05）。
//
// 她用手機按「挑日期」→ 選了一天 → 沒記上；點底下那個原生的框才記得上。壞的是程式叫 `showPicker()` 那一條路，
// 所以「挑日期」那一顆本身就是日期框（label 包著一個透明的 `<input type="date">`），不再叫 `showPicker()`。
// 點不點得到、選了記不記得上在 E2E `91`；這裡釘形狀與「不准再叫 showPicker()」。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { field } from '../public/js/ui/components/note.js';
import { todayISO } from '../public/js/domain/dates.js';

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const full = join(dir, name);
  return statSync(full).isDirectory() ? walk(full) : (name.endsWith('.js') ? [full] : []);
});

// 比的是「.showPicker」（呼叫），註解裡講到 `showPicker()` 這個名字不算
test('public/js 底下沒有任何一處叫 showPicker()', () => {
  const hits = walk('public/js').filter((f) => /\.showPicker/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(hits, []);
});

test('「挑日期」是一個 label，日期框就在它裡面、沒有藏起來', () => {
  const html = field();
  const pick = html.match(/<label[^>]*data-nd-pick[^>]*>([\s\S]*?)<\/label>/);
  assert.ok(pick, '「挑日期」那一顆是 <label>（<button> 裡不能放 <input>）');
  const input = pick[1].match(/<input[^>]*data-nd-input[^>]*>/);
  assert.ok(input, '日期框在「挑日期」裡面');
  assert.match(input[0], /type="date"/);
  assert.doesNotMatch(input[0], /\shidden\b/, '日期框不可以是 hidden 的');
  assert.equal((html.match(/data-nd-input/g) ?? []).length, 1, '只有一個日期框（底下那個長框不要了）');
});

test('選了今天：「今天」亮、「挑日期」不亮；選了別天反過來', () => {
  const today = field({ value: todayISO() });
  assert.match(today, /data-nd-today[^>]*aria-pressed="true"/);
  assert.match(today, /data-nd-pick[^>]*data-on="false"/);

  const other = field({ value: '2026-12-31' });
  assert.match(other, /data-nd-today[^>]*aria-pressed="false"/);
  assert.match(other, /data-nd-pick[^>]*data-on="true"/);
  assert.match(other, /data-nd-input[^>]*value="2026-12-31"/);
});
