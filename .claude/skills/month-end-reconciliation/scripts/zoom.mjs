#!/usr/bin/env node
// 把一張 Abovee 截圖切成幾塊、放大兩倍，給「用看的抄」的人讀（`references/transcribe.md`）。
//
//   node zoom.mjs <截圖.png> <輸出資料夾> [倍數=2] [x 從-到]
//
// 左右切兩半（中間重疊 60 像素，交界那一欄兩邊都看得到），太高的再上下切（每塊最多 500 像素高、重疊 30）。
// 給了 `240-340` 這種 x 範圍就只切那一欄（看不清楚的名字放大四倍時用）。
// 放大用 nearest：字的邊緣照原樣變大，不會被插值「修」成另一個字。
// 輸出檔名：<stem>-r<列塊>-L.png / -R.png（只切一欄是 -x240.png），印出每一塊的檔名與它在原圖上的範圍。
import { createRequire } from 'node:module';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const [src, outDir, scaleArg, xArg] = process.argv.slice(2);
if (!src || !outDir) {
  console.error('用法：node zoom.mjs <截圖.png> <輸出資料夾> [倍數=2] [x 從-到]');
  process.exit(2);
}
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const require = createRequire(join(REPO, 'package.json'));
const sharp = require('sharp');

const scale = Number(scaleArg ?? 2);
const stem = basename(src, extname(src));
mkdirSync(outDir, { recursive: true });

const { width, height } = await sharp(src).metadata();
const OVERLAP_X = 60;
const MAX_H = 500;
const OVERLAP_Y = 30;

const half = Math.ceil(width / 2);
const only = String(xArg ?? '').match(/^(\d+)-(\d+)$/);
const cols = only
  ? [{ tag: `x${only[1]}`, left: Math.min(width - 1, Number(only[1])), width: Math.max(1, Math.min(width, Number(only[2])) - Math.min(width - 1, Number(only[1]))) }]
  : [
    { tag: 'L', left: 0, width: Math.min(width, half + OVERLAP_X / 2) },
    { tag: 'R', left: Math.max(0, half - OVERLAP_X / 2), width: width - Math.max(0, half - OVERLAP_X / 2) },
  ];
const rows = [];
for (let top = 0; top < height; top += MAX_H - OVERLAP_Y) {
  rows.push({ top, height: Math.min(MAX_H, height - top) });
  if (top + MAX_H >= height) break;
}

for (const [ri, r] of rows.entries()) {
  for (const c of cols) {
    const file = resolve(outDir, `${stem}-r${ri + 1}-${c.tag}.png`);
    await sharp(src)
      .extract({ left: c.left, top: r.top, width: c.width, height: r.height })
      .resize({ width: c.width * scale, height: r.height * scale, kernel: 'nearest' })
      .toFile(file);
    console.log(`${file}  原圖 x ${c.left}–${c.left + c.width}、y ${r.top}–${r.top + r.height}`);
  }
}
