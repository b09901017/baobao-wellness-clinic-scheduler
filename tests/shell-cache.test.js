// Service worker 的預快取清單必須跟實際檔案一致。
//
// 新增一個 js 檔卻忘了加進 SHELL，症狀是「平常都好好的，離線時才壞」——
// 那種 bug 很難在開發時發現，所以讓測試來記。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PUBLIC = new URL('../public/', import.meta.url).pathname;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function shellList() {
  const src = readFileSync(join(PUBLIC, 'sw.js'), 'utf8');
  const block = src.match(/const SHELL = \[([\s\S]*?)\];/);
  assert.ok(block, 'sw.js 裡找不到 SHELL 陣列');
  return [...block[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => m[1] ?? m[2]);
}

const CACHEABLE = /\.(js|css|html|webmanifest)$/;

test('SHELL 列的檔案都真的存在', () => {
  const missing = shellList()
    .filter((p) => p !== '/')
    .filter((p) => !existsSync(join(PUBLIC, p)));
  assert.deepEqual(missing, [], `SHELL 指向不存在的檔案：${missing.join(', ')}`);
});

test('每個 app 殼檔案都被列進 SHELL', () => {
  const listed = new Set(shellList());
  const onDisk = walk(PUBLIC)
    .map((p) => p.slice(PUBLIC.length - 1))
    .filter((p) => CACHEABLE.test(p) && p !== '/sw.js');

  const notListed = onDisk.filter((p) => !listed.has(p));
  assert.deepEqual(
    notListed,
    [],
    `這些檔案沒被預先快取，離線冷啟動會失敗：${notListed.join(', ')}`,
  );
});

test('改了殼就要動 VERSION（提醒用，只檢查格式）', () => {
  const src = readFileSync(join(PUBLIC, 'sw.js'), 'utf8');
  assert.match(src, /const VERSION = 'v\d+'/, 'VERSION 要維持 v<數字> 的格式');
});
