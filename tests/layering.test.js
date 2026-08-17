// 分層守衛。
//
// SPEC 第 10 節要求：只有 /data 能碰 firestore SDK，/domain 是純函式不碰 IO，
// 規則絕不寫在 UI 事件處理器裡。這個測試讓那些要求變成會紅的東西，
// 而不是只寫在文件裡的期望。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const JS_ROOT = new URL('../public/js/', import.meta.url).pathname;

function filesUnder(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

const FIREBASE_IMPORT = /from\s+['"]https:\/\/www\.gstatic\.com\/firebasejs\//;

test('只有 /data 可以 import firebase SDK', () => {
  const offenders = [];
  for (const file of filesUnder(JS_ROOT)) {
    const rel = file.slice(JS_ROOT.length);
    if (rel.startsWith('data/')) continue;
    if (FIREBASE_IMPORT.test(readFileSync(file, 'utf8'))) offenders.push(rel);
  }
  assert.deepEqual(
    offenders,
    [],
    `這些檔案不在 /data 卻直接 import 了 firebase SDK：${offenders.join(', ')}`,
  );
});

test('/domain 不可以 import /data 或 /ui', () => {
  const domainDir = join(JS_ROOT, 'domain');
  const offenders = [];
  for (const file of filesUnder(domainDir)) {
    const src = readFileSync(file, 'utf8');
    if (/from\s+['"][^'"]*\/(data|ui)\//.test(src)) {
      offenders.push(file.slice(JS_ROOT.length));
    }
  }
  assert.deepEqual(offenders, [], `/domain 必須是純函式，不能往上依賴：${offenders.join(', ')}`);
});

test('/domain 不可以碰瀏覽器 API', () => {
  const domainDir = join(JS_ROOT, 'domain');
  const offenders = [];
  for (const file of filesUnder(domainDir)) {
    const src = readFileSync(file, 'utf8');
    // 註解不算，只看實際程式碼
    const code = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    if (/\b(document|window|localStorage|fetch)\b/.test(code)) {
      offenders.push(file.slice(JS_ROOT.length));
    }
  }
  assert.deepEqual(offenders, [], `/domain 不能碰 IO 或 DOM：${offenders.join(', ')}`);
});
