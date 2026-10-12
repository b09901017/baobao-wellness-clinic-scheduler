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
  // 資料健檢那一頁的字幾乎都從這一支來（每一項的名字、說明、每一列的那一句；issue 18）
  'domain/health.js',
];

/** 不上她的畫面的，與還沒輪到的。 */
const EXEMPT = new Map([
  // 呼叫端少傳參數時丟的錯，只在開發時看得到
  ['ui/components/dialog.js', 'confirmAction() 的參數錯誤'],
]);

const DEV_WORDS = /SPEC|ADR-?\d|寫死|程式碼|程式裡|#\/todo\/inbox|#\/todo\/backfill/g;

test('畫面上的字串裡沒有 SPEC、ADR、程式碼、舊網址', () => {
  const left = FILES.filter((f) => !EXEMPT.has(f))
    .flatMap((f) => [...code(f).matchAll(DEV_WORDS)].map((m) => `${f}：${m[0]}`));
  assert.deepEqual(left, []);
});

// 資料健檢那一頁（issue 18）：字是組出來的，沒有任何地方把 `**` 轉成粗體、把反引號拿掉 ——
// 寫進去就原樣印在她的畫面上。對她一律寫「你」（以前好幾句用「她」講她自己）。
test('資料健檢的字：沒有 **、反引號、「她」「妳」', () => {
  const left = ['domain/health.js', 'ui/views/health.js'].flatMap((f) => code(f).split('\n')
    // 去掉註解之後，程式碼裡不會有中文與 `**` —— 有就是字串裡的（樣板字串也算）
    .filter((line) => /\*\*|她|妳/.test(line)
      // 單引號字串裡的反引號：寫成 `復能-SIS(60)` 想讓它變成程式碼字體，畫面上只會多兩個反引號
      || [...line.matchAll(/'(?:[^'\\]|\\.)*'/g)].some((m) => m[0].includes('`')))
    .map((line) => `${f}：${line.trim()}`));
  assert.deepEqual(left, []);
});
