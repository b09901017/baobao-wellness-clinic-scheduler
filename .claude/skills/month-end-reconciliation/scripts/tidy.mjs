#!/usr/bin/env node
// 逐像素驗證之前整理每張截圖（2026-10-16 與 2026-11-04 那兩批是 90% 縮放截的，欄跟欄、字跟按鈕都比 100% 擠）：
//
//   node tidy.mjs <截圖資料夾> <輸出資料夾> [--skip <檔名>,<檔名>]
//
// 1. 底部的橫向捲軸＋分頁那一條（「共 N 筆，第 N / M 頁」連下拉選單）裁掉：切列時會被當成一列資料。
// 2. 左邊每一列的鉛筆按鈕裁掉（有才裁 —— 100% 那一批沒截到它）：校正會把它當成狀態徽章、拿徽章當日期比。
// 3. 名字後面那顆藍色方塊按鈕塗成底色：90% 時它跟名字只隔 1～2px，切塊會把兩個切成同一塊。
//    認法：兩條等高（≥ 15px）、相距 18～26px 的純藍直邊（約 (0,100,255)）＝一顆按鈕，只塗那個框，字一個像素都不動。
//    塗的是按鈕右邊那一格的底色（灰底的列塗成純白，本身就變成一塊「墨」）。
// 輸出檔名跟原檔一樣；只印尺寸與數字。
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const sharp = createRequire(join(REPO, 'package.json'))('sharp');

const argv = process.argv.slice(2);
const [src, out] = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--skip');
const skip = new Set((argv[argv.indexOf('--skip') + 1] ?? '').split(',').filter(Boolean));
if (!src || !out) {
  console.error('用法：node tidy.mjs <截圖資料夾> <輸出資料夾> [--skip a.png,b.png]');
  process.exit(2);
}
mkdirSync(out, { recursive: true });

/** 按鈕的直邊：純藍 */
const blue = (d, i) => d[i] < 40 && d[i + 1] > 80 && d[i + 1] < 140 && d[i + 2] > 225;

let buttons = 0;
let pencils = 0;
for (const f of readdirSync(src).filter((x) => x.toLowerCase().endsWith('.png') && !skip.has(x)).sort()) {
  const { data, info } = await sharp(join(src, f)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const at = (x, y) => (y * width + x) * 3;

  // 捲軸：一整列有六成以上是中灰色（每個通道 60～200、三個通道差不多）
  let cut = height;
  for (let y = 0; y < height && cut === height; y += 1) {
    let gray = 0;
    for (let x = 0; x < width; x += 1) {
      const i = at(x, y);
      if (data[i] > 60 && data[i] < 200 && Math.abs(data[i] - data[i + 1]) < 8 && Math.abs(data[i] - data[i + 2]) < 8) gray += 1;
    }
    if (gray > 0.6 * width) cut = y;
  }

  // 藍色直邊（≥ 15px 高的一段）
  const runs = [];
  for (let x = 0; x < width; x += 1) {
    let y0 = null;
    for (let y = 0; y <= cut; y += 1) {
      const on = y < cut && blue(data, at(x, y));
      if (on && y0 === null) y0 = y;
      if (!on && y0 !== null) { if (y - y0 >= 15) runs.push({ x, y0, y1: y - 1 }); y0 = null; }
    }
  }
  const pairs = [];
  for (const a of runs) {
    const b = runs.find((r) => r.x - a.x >= 18 && r.x - a.x <= 26 && Math.abs(r.y0 - a.y0) <= 1 && Math.abs(r.y1 - a.y1) <= 1);
    if (b) pairs.push([a, b]);
  }
  // 鉛筆：最左邊那一欄（x < 60）的按鈕 —— 裁到它右邊再空 5px
  const lefts = pairs.filter(([a]) => a.x < 60);
  const left = lefts.length >= 2 ? Math.max(...lefts.map(([, b]) => b.x)) + 5 : 0;
  if (left) pencils += 1;
  for (const [a, b] of pairs) {
    if (a.x < left) continue;
    for (let y = Math.min(a.y0, b.y0) - 3; y <= Math.max(a.y1, b.y1) + 3; y += 1) {
      if (y < 0 || y >= cut) continue;
      const bg = at(Math.min(width - 1, b.x + 4), y);
      for (let x = a.x; x <= b.x; x += 1) { const i = at(x, y); data[i] = data[bg]; data[i + 1] = data[bg + 1]; data[i + 2] = data[bg + 2]; }
    }
    buttons += 1;
  }
  await sharp(data, { raw: { width, height, channels: 3 } })
    .extract({ left, top: 0, width: width - left, height: cut }).png().toFile(join(out, f));
}
console.log(`整理好了：鉛筆裁掉 ${pencils} 張、名字後面的按鈕塗掉 ${buttons} 顆`);
