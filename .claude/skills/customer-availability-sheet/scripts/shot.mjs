// preview.py 叫的：把幾個 HTML 截成同名的 .png。一次只開一個 Chromium（不要把她的機器跑滿）。
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const { chromium } = createRequire(resolve(REPO, 'package.json'))('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 760, height: 900 } });
for (const file of process.argv.slice(2)) {
  await page.goto(pathToFileURL(file).href);
  await page.screenshot({ path: file.replace(/\.html$/, '.png'), fullPage: true });
}
await browser.close();
