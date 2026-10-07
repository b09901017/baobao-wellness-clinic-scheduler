// 畫面上不出現寫給寫程式的人看的話（issue 15，2026-10-07）：文件章節（SPEC）、ADR 編號、
// 「寫死在程式碼裡」、舊網址。那些話她讀了只會多一個看不懂的字。
//
// 掃的是去掉註解之後的原始碼 —— 註解裡引 ADR 是應該的。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const code = (rel) => readFileSync(new URL(`../public/js/${rel}`, import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|\s)\/\/.*$/gm, '$1');

const under = (dir) => readdirSync(new URL(`../public/js/${dir}`, import.meta.url))
  .filter((f) => f.endsWith('.js')).map((f) => `${dir}/${f}`);

const FILES = [
  ...under('ui/views'), ...under('ui/components'),
  'domain/messageTemplates.js', 'domain/aiUsage.js',
];

/** 不上她的畫面的，與還沒輪到的。 */
const EXEMPT = new Map([
  // 呼叫端少傳參數時丟的錯，只在開發時看得到
  ['ui/components/dialog.js', 'confirmAction() 的參數錯誤'],
  // 資料健檢那一頁整頁重新設計（issue 18），做完拿掉
  ['ui/views/health.js', 'issue 18'],
]);

const DEV_WORDS = /SPEC|ADR-?\d|寫死|程式碼|程式裡|#\/todo\/inbox|#\/todo\/backfill/g;

test('畫面上的字串裡沒有 SPEC、ADR、程式碼、舊網址', () => {
  const left = FILES.filter((f) => !EXEMPT.has(f))
    .flatMap((f) => [...code(f).matchAll(DEV_WORDS)].map((m) => `${f}：${m[0]}`));
  assert.deepEqual(left, []);
});
