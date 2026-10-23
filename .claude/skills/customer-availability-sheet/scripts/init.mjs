#!/usr/bin/env node
// 開一個月份的資料夾：.local/references/客戶時間/<YYYY-MM>/{截圖,過程}＋她的說明（沒有才放）。
//
//   node init.mjs 2026-12
//
// 每一個建出來的路徑都真的跑一次 git check-ignore —— 擋沒擋住從畫面上看不出來（CLAUDE.md）。
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, existsSync, copyFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
const ROOT = join(REPO, '.local', 'references', '客戶時間');
const month = process.argv[2];
if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month ?? '')) {
  console.error('用法：node init.mjs YYYY-MM（例：2026-12）');
  process.exit(2);
}

const dirs = [ROOT, join(ROOT, month), join(ROOT, month, '截圖'), join(ROOT, month, '過程')];
for (const d of dirs) mkdirSync(d, { recursive: true });
if (!existsSync(join(ROOT, 'README.md'))) copyFileSync(join(HERE, '..', 'references', 'her-readme.md'), join(ROOT, 'README.md'));
if (!existsSync(join(ROOT, '客戶記憶.json'))) writeFileSync(join(ROOT, '客戶記憶.json'), '{}\n');
const text = join(ROOT, month, '文字.txt');
if (!existsSync(text)) writeFileSync(text, '');

for (const p of [...dirs, text, join(ROOT, '客戶記憶.json')]) {
  try {
    execFileSync('git', ['check-ignore', '-q', p], { cwd: REPO });
  } catch {
    console.error(`沒有被 .gitignore 擋住：${p} —— 停下來，不要往裡面放任何東西`);
    process.exit(1);
  }
}
console.log(`好了：客戶時間/${month}/（截圖/、文字.txt、過程/），都被 .gitignore 擋著`);
