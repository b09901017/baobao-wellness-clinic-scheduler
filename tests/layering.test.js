// 分層守衛。
//
// SPEC 第 10 節要求：只有 /data 能碰 firestore SDK，/domain 是純函式不碰 IO，
// 規則絕不寫在 UI 事件處理器裡。這個測試讓那些要求變成會紅的東西，
// 而不是只寫在文件裡的期望。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

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

test('每個具名 import 都對得上真的匯出', () => {
  // 這一類錯誤（改了函式名字但漏改一個 import）測試抓不到、語法檢查也抓不到，
  // 只有在真的裝置上打開那一頁時整支 module 才會不執行，畫面停在載入中。
  // 跟 shell-cache 與 rules 那兩支守衛同一個道理：讓它變成會紅的東西。
  const files = filesUnder(JS_ROOT);

  const exported = new Map();
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const names = new Set();
    for (const m of src.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm)) names.add(m[1]);
    for (const m of src.matchAll(/^export\s+(?:const|let|var|class)\s+([A-Za-z0-9_$]+)/gm)) names.add(m[1]);
    for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop().trim();
        if (name) names.add(name);
      }
    }
    exported.set(file, names);
  }

  const missing = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"](\.[^'"]+)['"]/g)) {
      const target = resolve(dirname(file), m[2]);
      const have = exported.get(target);
      // 指不到的檔案由下面那一支測試負責報，這裡只看有檔案的
      if (!have) continue;
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (name && !have.has(name)) {
          missing.push(`${file.slice(JS_ROOT.length)} 想要 ${name}，但 ${m[2]} 沒有匯出`);
        }
      }
    }
  }

  assert.deepEqual(missing, [], `這些 import 在瀏覽器裡會讓整支檔案不執行：\n${missing.join('\n')}`);
});

test('相對 import 都指得到真的檔案', () => {
  const missing = [];
  for (const file of filesUnder(JS_ROOT)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      const target = resolve(dirname(file), m[1]);
      if (!existsSync(target)) missing.push(`${file.slice(JS_ROOT.length)} → ${m[1]}`);
    }
  }
  assert.deepEqual(missing, [], `這些路徑指不到檔案：\n${missing.join('\n')}`);
});
