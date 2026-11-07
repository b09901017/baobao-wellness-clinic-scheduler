// 第 3 組（隨手記網頁那一半）重現用：打字時（鍵盤開著）轉方向，`html[data-keyboard]` 會不會掉。
//
// 不起模擬器：用 Playwright 的 route 把 public/ 底下的檔案當成網站，頁面只有一格輸入框＋真的 `ui/keyboard.js`。
// `setViewportSize()` 模擬 `interactive-widget=resizes-content` 之後鍵盤把版面縮短（同 E2E `100` 的做法）。
//
// 跑法（repo 根目錄）：node .scratch/final-check-2026-11-07/keyboard-rotate.mjs
// 會印每一步 `data-keyboard` 在不在；最後一行 PASS／REPRODUCED。

import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ORIGIN = 'http://keyboard.test';

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, interactive-widget=resizes-content"></head>
<body><input id="t" type="text" />
<script type="module">
  import { watchKeyboard } from '/js/ui/keyboard.js';
  watchKeyboard();
  window.__ready = true;
</script></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 384, height: 832 } }); // 三星那一型：直的 384×832
await page.route(`${ORIGIN}/**`, async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: PAGE });
  const file = path.join(ROOT, 'public', url.pathname);
  return route.fulfill({ contentType: 'text/javascript', body: await readFile(file, 'utf8') });
});
await page.goto(`${ORIGIN}/`);
await page.waitForFunction(() => window.__ready);

// resize 事件在 setViewportSize() 回來之後才到：等兩個畫格再讀（E2E `100` 用 expect 輪詢，同一件事）
const has = () => page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(
  () => setTimeout(() => ok(document.documentElement.hasAttribute('data-keyboard')), 50),
))));
const step = async (label) => console.log(`${label.padEnd(40)} data-keyboard=${await has()}`);

await page.focus('#t');
await step('直的、聚焦（鍵盤還沒出來）');
await page.setViewportSize({ width: 384, height: 452 });
await step('直的、鍵盤開著（版面 832 → 452）');
// 轉成橫的、鍵盤還開著：寬換了、高是橫的扣掉鍵盤
await page.setViewportSize({ width: 832, height: 180 });
const rotated = await has();
await step('轉成橫的、鍵盤還開著（832×180）');
// 鍵盤收起來（焦點還在）
await page.setViewportSize({ width: 832, height: 384 });
await step('橫的、鍵盤收起來（832×384）');
await page.setViewportSize({ width: 832, height: 180 });
await step('橫的、鍵盤再打開一次（832×180）');

await browser.close();
console.log(rotated ? 'PASS（轉方向之後還認得鍵盤開著）' : 'REPRODUCED（轉方向之後 data-keyboard 掉了：手機寬度底部導覽列會站回鍵盤上面，直到鍵盤收起來一次）');
