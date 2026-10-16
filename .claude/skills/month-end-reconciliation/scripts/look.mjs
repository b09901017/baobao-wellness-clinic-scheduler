#!/usr/bin/env node
// 交給她之前自己看一眼那一頁：一個無頭 Chromium（reducedMotion）截桌機與手機兩張，順便量有沒有橫向捲動、有沒有 console 錯誤。
//
//   node look.mjs <對帳結果.html> <輸出資料夾>
//
// 截圖有真名 —— 輸出資料夾要在 .local/ 底下（run.mjs 給的是 <月>/過程/看一眼/）。
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const { chromium } = await import(pathToFileURL(join(REPO, 'node_modules/playwright/index.mjs')).href);

const [file, outDir] = process.argv.slice(2);
if (!file || !outDir) {
  console.error('用法：node look.mjs <對帳結果.html> <輸出資料夾>');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
try {
  for (const [w, h, tag] of [[820, 1100, '桌機'], [390, 844, '手機']]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(pathToFileURL(resolve(file)).href);
    const out = join(outDir, `${tag}.png`);
    await page.screenshot({ path: out, fullPage: false });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    console.log(`${tag}：${resolve(out)}　橫向捲動 ${overflow ? '有（要修）' : '沒有'}　錯誤 ${errors.length}`);
    for (const e of errors) console.log(`  ! ${e}`);
    await page.close();
  }
} finally {
  await browser.close();
}
