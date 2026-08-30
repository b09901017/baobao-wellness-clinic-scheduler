// Service worker 的預快取清單必須跟實際檔案一致。
//
// 新增一個 js 檔卻忘了加進 SHELL，症狀是「平常都好好的，離線時才壞」——
// 那種 bug 很難在開發時發現，所以讓測試來記。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { fromRoot, toPosix } from './helpers/paths.js';

const PUBLIC = fromRoot('public/');

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

// 客戶填時間的那一頁不是 app 的一部分（ADR-0031）：客戶在 LINE 裡點一個連結
// 就開了，那一頁自己不註冊 service worker，而她的裝置永遠不會離線打開它。
// 預先快取它只是白白佔位子。
//
// **這份清單要留得很短。** 它是「離線會壞掉」那道守衛唯一的後門，
// 每多一條就少擋一個檔案 —— 要加之前先問這個檔案是不是真的不屬於 app。
const NOT_APP_SHELL = [
  '/form.html',
  '/css/form.css',
  '/js/form/page.js',
  '/js/data/publicForm.js',
];

test('排除清單裡的檔案都真的存在，而且沒有被列進 SHELL', () => {
  // 排除清單打錯字的話它就什麼都沒排除，而那個錯誤是安靜的。
  const missing = NOT_APP_SHELL.filter((p) => !existsSync(join(PUBLIC, p)));
  assert.deepEqual(missing, [], `排除清單指向不存在的檔案：${missing.join(', ')}`);

  const listed = new Set(shellList());
  const both = NOT_APP_SHELL.filter((p) => listed.has(p));
  assert.deepEqual(both, [], `這些檔案同時被排除又被列進 SHELL：${both.join(', ')}`);
});

test('SHELL 列的檔案都真的存在', () => {
  const missing = shellList()
    .filter((p) => p !== '/')
    .filter((p) => !existsSync(join(PUBLIC, p)));
  assert.deepEqual(missing, [], `SHELL 指向不存在的檔案：${missing.join(', ')}`);
});

test('每個 app 殼檔案都被列進 SHELL', () => {
  const listed = new Set(shellList());
  const onDisk = walk(PUBLIC)
    // SHELL 裡寫的是網址（`/js/app.js`），所以切出來的相對路徑要換成 `/`。
    .map((p) => toPosix(p.slice(PUBLIC.length - 1)))
    .filter((p) => CACHEABLE.test(p) && p !== '/sw.js' && !NOT_APP_SHELL.includes(p));

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
