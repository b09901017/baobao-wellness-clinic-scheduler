// import 路徑檢查。
//
// 沒有 build pipeline 就沒有打包器幫忙檢查路徑，寫錯了要到瀏覽器打開才發現，
// 而且整頁空白不會有任何提示。這裡把它變成會紅的測試。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

import { fromRoot, toPosix } from './helpers/paths.js';

const JS_ROOT = fromRoot('public/js/');

function filesUnder(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

// 匹配 import ... from '...' 與 export ... from '...'
const SPEC_RE = /(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g;

test('每個相對 import 都指向實際存在的檔案', () => {
  const broken = [];

  for (const file of filesUnder(JS_ROOT)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(SPEC_RE)) {
      const spec = m[1];
      if (!spec.startsWith('.')) continue; // CDN 或裸模組不檢查
      const target = resolve(dirname(file), spec);
      if (!existsSync(target)) {
        broken.push(`${toPosix(file.slice(JS_ROOT.length))} → ${spec}`);
      }
    }
  }

  assert.deepEqual(broken, [], `這些 import 指向不存在的檔案：\n${broken.join('\n')}`);
});

test('相對 import 一律帶 .js 副檔名', () => {
  // 瀏覽器的 ES modules 不會自動補副檔名，少了就是 404
  const bad = [];
  for (const file of filesUnder(JS_ROOT)) {
    for (const m of readFileSync(file, 'utf8').matchAll(SPEC_RE)) {
      const spec = m[1];
      if (spec.startsWith('.') && !spec.endsWith('.js')) {
        bad.push(`${toPosix(file.slice(JS_ROOT.length))} → ${spec}`);
      }
    }
  }
  assert.deepEqual(bad, [], `這些 import 少了 .js：\n${bad.join('\n')}`);
});

test('firebase SDK 版本在所有檔案裡一致', () => {
  const versions = new Set();
  for (const file of filesUnder(JS_ROOT)) {
    for (const m of readFileSync(file, 'utf8').matchAll(/firebasejs\/([\d.]+)\//g)) {
      versions.add(m[1]);
    }
  }
  assert.equal(versions.size <= 1, true, `firebase SDK 版本不一致：${[...versions].join(', ')}`);
});

test('壓表與來訪編輯器共用同一個「這一次記一句」的長度上限', () => {
  // 兩邊寫的是同一個欄位（visits 的 note）。各自寫死一個數字的下場是
  // 「在壓表打得下，回來改就被截掉」—— 而她不會知道字是在哪一步不見的。
  const offenders = [];
  for (const name of ['schedule.js', 'visitEditor.js']) {
    const src = readFileSync(join(JS_ROOT, 'ui/views', name), 'utf8');
    if (!/NOTE_MAX/.test(src)) offenders.push(`${name} 沒有用 NOTE_MAX`);
    // data-note / name="note" 附近不可以出現寫死的 maxlength 數字
    if (/maxlength="\d/.test(src)) offenders.push(`${name} 有寫死的 maxlength`);
  }
  assert.deepEqual(offenders, [], offenders.join('；'));
});
