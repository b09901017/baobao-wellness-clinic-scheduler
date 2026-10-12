// 從 `scripts/icon-source.jpg` 產生 PWA 圖示：node scripts/make-icons.mjs
//
// 要換圖就換那一張（正方形、至少 1024px）再跑一次，然後把 `public/sw.js` 的 VERSION 加一。
//
// 來源圖本身是一顆圓角的圖示，四個角是白的。照原樣縮的話：
//   - iOS 主畫面會自己再裁一次圓角，裁的弧度跟圖上那一個不一樣，角落會露出一小塊白
//   - Android 把 maskable 圖示裁成圓形或圓角，圖案靠邊的東西（兩隻手、錢）會被切掉
// 所以這裡做兩件事：把四個白角補成旁邊那一圈深藍（整張變成滿版的正方形），
// maskable 那一張再把圖縮到中央八成、外面一圈同樣的深藍。

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'scripts', 'icon-source.jpg');
const OUT = path.join(ROOT, 'public', 'icons');

/** 圖示外框那一圈深藍。補角時朝中心走不到外框的那幾格退回它。 */
const NAVY = [20, 38, 82];

/** 角落的白：比外框亮就算（外框最亮的地方三個加起來大約 240，白是 765）。 */
const LIGHT = 300;

/** 補角時往圖的中心多走幾格再取色 —— 跳過白與深藍之間那一圈半透明的邊。 */
const SKIP = 8;

/**
 * 把四個白角補成旁邊的深藍，回一張滿版的 RGB。
 * 從四個角往裡淹，只淹比外框亮的；外框那一圈深藍擋著，淹不進圖案裡。
 */
async function squared() {
  const { data, info } = await sharp(SOURCE).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = info;
  if (w !== h) throw new Error(`來源圖要是正方形，現在是 ${w}×${h}`);

  const at = (x, y) => (y * w + x) * c;
  const light = (x, y) => { const i = at(x, y); return data[i] + data[i + 1] + data[i + 2] > LIGHT; };

  const outside = new Uint8Array(w * h);
  // 只准在角落那四塊裡淹：圖案裡也有白（中間那一隻），外框萬一有一格破洞也淹不過去
  const reach = Math.round(w * 0.25);
  const inCorner = (x, y) => (x < reach || x >= w - reach) && (y < reach || y >= h - reach);
  const stack = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    if (outside[y * w + x] || !inCorner(x, y) || !light(x, y)) continue;
    outside[y * w + x] = 1;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }

  const out = Buffer.from(data);
  const mid = (w - 1) / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!outside[y * w + x]) continue;
      // 朝中心走到外框上，再多走幾格，拿那裡的顏色 —— 外框有一點漸層，照抄旁邊的才接得起來
      const dx = mid - x;
      const dy = mid - y;
      const len = Math.hypot(dx, dy);
      let t = 0;
      let sx = x;
      let sy = y;
      while (t < len) {
        t += 1;
        sx = Math.round(x + (dx / len) * t);
        sy = Math.round(y + (dy / len) * t);
        if (!outside[sy * w + sx] && !light(sx, sy)) break;
      }
      sx = Math.round(x + (dx / len) * Math.min(t + SKIP, len));
      sy = Math.round(y + (dy / len) * Math.min(t + SKIP, len));
      const from = light(sx, sy) ? null : at(sx, sy);
      const to = at(x, y);
      for (let k = 0; k < 3; k++) out[to + k] = from === null ? NAVY[k] : data[from + k];
    }
  }
  // 補上去的那幾塊是一格一格抄的，稍微抹一下才不會有放射狀的條紋
  const filled = await sharp(out, { raw: { width: w, height: h, channels: c } }).blur(6).raw().toBuffer();
  for (let p = 0; p < w * h; p++) {
    if (!outside[p]) continue;
    for (let k = 0; k < 3; k++) out[p * c + k] = filled[p * c + k];
  }
  return sharp(out, { raw: { width: w, height: h, channels: c } });
}

const png = (img) => img.png({ compressionLevel: 9 });

const full = await squared().then((img) => img.png().toBuffer());

/** 滿版：瀏覽器分頁、Android 的一般圖示、iOS 主畫面（它自己裁圓角）。 */
async function plain(size, name) {
  await png(sharp(full).resize(size, size, { kernel: 'lanczos3' })).toFile(path.join(OUT, name));
  console.log(name);
}

/**
 * maskable：圖縮到中央八成，外面一圈把邊緣那一排顏色往外延伸 —— Android 怎麼裁都裁不到圖案。
 * 不用一個固定的深藍去填：外框有一點漸層，填單一個顏色會看得到一個正方形的接縫。
 */
async function maskable(size, name) {
  const inner = Math.round(size * 0.8);
  const pad = Math.round((size - inner) / 2);
  const art = await sharp(full).resize(inner, inner, { kernel: 'lanczos3' }).toBuffer();
  await png(
    sharp(art).extend({ top: pad, bottom: size - inner - pad, left: pad, right: size - inner - pad, extendWith: 'copy' }),
  ).toFile(path.join(OUT, name));
  console.log(name);
}

await plain(192, 'icon-192.png');
await plain(512, 'icon-512.png');
await plain(180, 'apple-touch-icon.png');
await maskable(512, 'icon-maskable-512.png');
