// 拍照元件（`ui/components/camera.js`，issue 06，ADR-0101）。
//
// 這個元件本身沒有入口（07 起才有），所以這裡直接從 app 裡 import 它打開。
// 盯的是只有瀏覽器量得到的那幾件：
//   1. 相簿選一張大照片 → 送出去的是長邊 2000 的 JPEG、**轉正了、沒有 EXIF**
//   2. 相機權限拿不到 → 看得到系統相機與相簿兩顆，不是一片黑
//   3. 返回鍵收得起來，再開一次推得出新的一層，**上一次拍的照片不在了**
//   4. 離線按送出 → 講的是「要連網路」，假模型沒被叫
//   5. 暫停中 → 講的是「AI 暫停中」不是「辨識失敗」
//   6. 張數上限講得出來
//   7. 手機解不開整張的 1 億像素照片 → 解碼時就縮，照樣轉正送出（after-golive 01）
//   8. 手機橫放時取景框撐滿、快門在右邊那一欄（after-golive 02）

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

import { test, expect } from '../fixtures/app.js';
import { fakeAiCalls, queueAi } from '../fixtures/ai/index.js';
import { dayKey } from '../../functions/lib/guard.js';
import { BIG_PIXELS, jpegInfo } from '../../public/js/ui/components/photo.js';

// Function 記帳用真的時鐘；暫停那一條要讀同一個月的設定，所以瀏覽器也用真的今天
test.use({ today: dayKey(new Date()) });

const DIR = mkdtempSync(join(tmpdir(), 'cam-e2e-'));

/** 一張「手機橫著存、EXIF 說要轉 90 度」的照片，上面帶 GPS。有花紋（全白的會被當成空白）。 */
async function phonePhoto(name, { width = 3200, height = 2400 } = {}) {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      raw[i] = (x * 255) / width;
      raw[i + 1] = (y * 255) / height;
      raw[i + 2] = ((x ^ y) & 32) ? 220 : 90;
    }
  }
  const file = join(DIR, name);
  const buf = await sharp(raw, { raw: { width, height, channels: 3 } })
    // Orientation 要走 withMetadata（withExif 不寫它）
    .withExif({ IFD0: { Make: 'TestPhone' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '25/1 2/1 0/1' } })
    .withMetadata({ orientation: 6 })
    .jpeg({ quality: 90 })
    .toBuffer();
  writeFileSync(file, buf);
  return file;
}

/**
 * 送出去那一張的四個角（紅、綠兩個值）。`phonePhoto()` 存的是 x → 紅、y → 綠，EXIF 說要轉 90 度（6）：
 * 轉正之後左上是存著的左下（紅 0、綠 255）、右上是存著的左上（0、0），以此類推。
 * **只比寬高的話沒轉正、被拉成 1500×2000 照樣綠**（after-golive 01）。
 */
async function expectUpright(bytes) {
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  const at = (x, y) => {
    const i = (y * info.width + x) * info.channels;
    return [data[i], data[i + 1]];
  };
  const m = 8;
  const right = info.width - 1 - m;
  const bottom = info.height - 1 - m;
  const seen = { tl: at(m, m), tr: at(right, m), bl: at(m, bottom), br: at(right, bottom) };
  const want = { tl: [0, 255], tr: [0, 0], bl: [255, 255], br: [255, 0] };
  for (const corner of Object.keys(want)) {
    const off = Math.max(...want[corner].map((v, k) => Math.abs(v - seen[corner][k])));
    expect(off, `${corner} 那個角的顏色不對（看到 ${seen[corner]}，要 ${want[corner]}）—— 沒轉正或轉反了`).toBeLessThan(40);
  }
}

/** 攔下送 AI 的那一張，回它的位元組。 */
async function sentPhoto(page) {
  const request = page.waitForRequest((r) => r.url().includes('/asia-east1/extract'));
  await page.locator('[data-cam-send]').click();
  const body = JSON.parse((await request).postData());
  return Buffer.from(body.data.image, 'base64');
}

/**
 * 手機的解碼上限（after-golive 01）。桌機的 Chromium 沒有，所以 1 億像素的照片桌機照樣縮得過 —— 她手機上時好時壞。
 * 這裡模擬那個上限：`createImageBitmap()` 與 `<img>` 遇到超過 `limit` 像素的圖就失敗（兩條都要先整張解開），
 * `ImageDecoder` 解出來的那一格超過也失敗（帶了尺寸提示、解成小的就不會超過）。
 */
function phoneDecodeLimit(page, limit) {
  return page.addInitScript((LIMIT) => {
    const size = (b) => {
      if (b[0] !== 0xff || b[1] !== 0xd8) return null;
      for (let i = 2; i + 9 < b.length;) {
        const marker = b[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return ((b[i + 5] << 8) | b[i + 6]) * ((b[i + 7] << 8) | b[i + 8]);
        }
        i += 2 + ((b[i + 2] << 8) | b[i + 3]);
      }
      return null;
    };
    const tooBig = async (blob) => (size(new Uint8Array(await blob.slice(0, 256 * 1024).arrayBuffer())) ?? 0) > LIMIT;

    const realBitmap = window.createImageBitmap;
    window.createImageBitmap = async function createImageBitmap(src, ...rest) {
      if (src instanceof Blob && await tooBig(src)) throw new DOMException('decode', 'InvalidStateError');
      return realBitmap.call(this, src, ...rest);
    };

    const RealImage = window.Image;
    window.Image = function Image(...a) {
      const img = new RealImage(...a);
      let onload = null;
      Object.defineProperty(img, 'onload', { configurable: true, get: () => onload, set: (fn) => { onload = fn; } });
      img.addEventListener('load', (e) => {
        if (img.naturalWidth * img.naturalHeight > LIMIT) img.onerror?.(new Event('error'));
        else onload?.call(img, e);
      });
      return img;
    };

    if (window.ImageDecoder) {
      const realDecode = window.ImageDecoder.prototype.decode;
      window.ImageDecoder.prototype.decode = async function decode(...a) {
        const out = await realDecode.apply(this, a);
        if (out.image.codedWidth * out.image.codedHeight > LIMIT) {
          out.image.close();
          throw new DOMException('decode', 'EncodingError');
        }
        return out;
      };
    }
  }, limit);
}

async function openCam(page, { kind = 'planFlyer', max = 10 } = {}) {
  await page.evaluate(async ({ k, m }) => {
    const { openCamera } = await import('/js/ui/components/camera.js');
    window.__camDone = null;
    openCamera({ kind: k, max: m, onDone: (photos) => { window.__camDone = photos.map((p) => p.transcript); } });
  }, { k: kind, m: max });
  await expect(page.locator('.cam')).toBeVisible();
}

test('C1 相機權限拿不到 → 取景框換成一句話＋系統相機、相簿兩顆', async ({ app, page }) => {
  await app.signIn('/');
  await openCam(page);
  // 無頭 Chromium 沒有相機也沒有授權：getUserMedia 會被拒
  await expect(page.locator('[data-cam-fallback]')).toBeVisible();
  await expect(page.locator('[data-cam-fallback] [data-cam-system]')).toBeVisible();
  await expect(page.locator('[data-cam-fallback] [data-cam-album]')).toBeVisible();
  // 觸控區
  const box = await page.locator('[data-cam-close]').boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(44);
});

test('C2 相簿選一張 3200×2400 帶 EXIF 的照片 → 送出去的是轉正的 1500×2000、沒有 EXIF；辨識完這一層收起來交出抄字', async ({ app, page }) => {
  await queueAi([]);
  const file = await phonePhoto('rotated.jpg');
  await app.signIn('/');
  await openCam(page);

  await page.locator('[data-cam-album-input]').setInputFiles(file);
  await expect(page.locator('.cam__thumb')).toHaveCount(1);
  await expect(page.locator('[data-cam-send]')).toHaveText('送出 1 張');

  const bytes = await sentPhoto(page);

  expect(bytes[0]).toBe(0xff);
  expect(bytes[1]).toBe(0xd8);
  expect(bytes.subarray(0, 4096).includes(Buffer.from('Exif')), '送出去的 JPEG 還帶著 EXIF').toBe(false);
  expect(bytes.includes(Buffer.from('TestPhone'))).toBe(false);
  const info = jpegInfo(new Uint8Array(bytes));
  expect({ width: info.width, height: info.height }, '要照 EXIF 轉正、長邊 2000').toEqual({ width: 1500, height: 2000 });
  await expectUpright(bytes);

  await expect(page.locator('.cam')).toHaveCount(0);
  const done = await page.evaluate(() => window.__camDone);
  expect(done).toHaveLength(1);
  expect(done[0].readable).toBe(true);
  expect(await fakeAiCalls()).toBe(1);
});

test('C3 返回鍵收得起來、停在原本那一頁；再開一次推得出新的一層，上一次的照片不在了', async ({ app, page }) => {
  const file = await phonePhoto('back.jpg', { width: 1200, height: 900 });
  await app.signIn('/customers');
  await openCam(page);
  await page.locator('[data-cam-album-input]').setInputFiles(file);
  await expect(page.locator('.cam__thumb')).toHaveCount(1);

  await page.goBack();
  await expect(page.locator('.cam')).toHaveCount(0);
  expect(page.url()).toContain('#/customers');

  await openCam(page);
  await expect(page.locator('.cam__thumb'), '不存草稿：收起來再打開，上一次拍的不在').toHaveCount(0);
  await page.goBack();
  await expect(page.locator('.cam')).toHaveCount(0);
  expect(page.url()).toContain('#/customers');
});

test('C4 離線按送出 → 講要連網路，假模型沒被叫', async ({ app, page, context }) => {
  test.info().annotations.push({ type: 'allow-console-errors', description: '這一支刻意斷線（字體載不到）' });
  await queueAi([]);
  const file = await phonePhoto('offline.jpg', { width: 1200, height: 900 });
  await app.signIn('/');
  await openCam(page);
  await page.locator('[data-cam-album-input]').setInputFiles(file);
  await expect(page.locator('.cam__thumb')).toHaveCount(1);

  await context.setOffline(true);
  await page.locator('[data-cam-send]').click();
  await expect(page.locator('[data-cam-say]')).toContainText('辨識要連網路');
  await context.setOffline(false);
  expect(await fakeAiCalls()).toBe(0);
  await expect(page.locator('.cam')).toBeVisible();
});

test('C5 AI 暫停中 → 講的是暫停與去哪裡打開，不是辨識失敗', async ({ app, page }) => {
  await app.seed([{ path: 'config', id: 'ai', data: { paused: true } }]);
  await queueAi([]);
  const file = await phonePhoto('paused.jpg', { width: 1200, height: 900 });
  await app.signIn('/');
  await openCam(page);
  await page.locator('[data-cam-album-input]').setInputFiles(file);
  await page.locator('[data-cam-send]').click();
  const say = page.locator('[data-cam-say]');
  await expect(say).toContainText('AI 暫停中');
  await expect(say).toContainText('設定 → AI 用量');
  await expect(say).not.toContainText('辨識失敗');
  expect(await fakeAiCalls()).toBe(0);
});

test('C6 Abovee 最多兩張：選三張只收兩張並講出來，快門變灰', async ({ app, page }) => {
  const files = await Promise.all(['a.jpg', 'b.jpg', 'c.jpg'].map((n) => phonePhoto(n, { width: 900, height: 600 })));
  await app.signIn('/');
  await openCam(page, { kind: 'aboveeList', max: 2 });
  await expect(page.locator('.cam__frame--wide')).toHaveCount(1);
  await page.locator('[data-cam-album-input]').setInputFiles(files);
  await expect(page.locator('.cam__thumb')).toHaveCount(2);
  await expect(page.locator('[data-cam-say]')).toContainText('最多 2 張');
  await expect(page.locator('[data-cam-shutter]')).toBeDisabled();

  // 拿掉一張 → 快門回來
  await page.locator('[data-cam-remove]').first().click();
  await expect(page.locator('.cam__thumb')).toHaveCount(1);
});

// ---------------------------------------------------------------------------
// 1 億像素的照片（`.scratch/after-golive-2026-10-20/issues/01`）
// ---------------------------------------------------------------------------
//
// 她 2026-10-20：「會寫說有一張照片讀不出來，換一張試試，但我換了還是讀不出來?」
// 手機原檔 12000×9000，整張解開約 430MB，Android 的 Chrome 解不開（時好時壞）。
// 桌機沒有那個上限，所以這裡把上限設成 1600 萬像素、照片 2000 萬像素來模擬。

test('P1 手機解不開整張的大照片 → 照樣送出轉正的 1500×2000（解碼時就縮）', async ({ app, page }) => {
  await queueAi([]);
  const file = await phonePhoto('huge.jpg', { width: 5200, height: 3900 });
  await phoneDecodeLimit(page, 16_000_000);
  await app.signIn('/');
  await openCam(page);

  await page.locator('[data-cam-album-input]').setInputFiles(file);
  await expect(page.locator('.cam__thumb'), '手機上這一張會講「讀不出來」').toHaveCount(1);
  await expect(page.locator('[data-cam-say]')).toHaveText('');

  const bytes = await sentPhoto(page);
  const info = jpegInfo(new Uint8Array(bytes));
  expect({ width: info.width, height: info.height }).toEqual({ width: 1500, height: 2000 });
  expect(bytes.subarray(0, 4096).includes(Buffer.from('Exif')), '送出去的 JPEG 還帶著 EXIF').toBe(false);
  await expectUpright(bytes);
});

test('P2 沒有 ImageDecoder 的瀏覽器（Safari）照舊走原本那兩條：轉正、長邊 2000', async ({ app, page }) => {
  await queueAi([]);
  const file = await phonePhoto('nodecoder.jpg');
  await page.addInitScript(() => { delete window.ImageDecoder; });
  await app.signIn('/');
  await openCam(page);
  expect(await page.evaluate(() => typeof window.ImageDecoder)).toBe('undefined');

  await page.locator('[data-cam-album-input]').setInputFiles(file);
  await expect(page.locator('.cam__thumb')).toHaveCount(1);
  const bytes = await sentPhoto(page);
  const info = jpegInfo(new Uint8Array(bytes));
  expect({ width: info.width, height: info.height }).toEqual({ width: 1500, height: 2000 });
  await expectUpright(bytes);
});

test('P3 真的解不開時講原因與怎麼辦，不叫她「換一張試試」', async ({ app, page }) => {
  expect(5200 * 3900, '這一張要大到講「太大」').toBeGreaterThan(BIG_PIXELS);
  const file = await phonePhoto('toobig.jpg', { width: 5200, height: 3900 });
  // 連 ImageDecoder 都沒有、又超過上限：三條路都走不通
  await page.addInitScript(() => { delete window.ImageDecoder; });
  await phoneDecodeLimit(page, 16_000_000);
  await app.signIn('/');
  await openCam(page);

  await page.locator('[data-cam-album-input]').setInputFiles(file);
  const say = page.locator('[data-cam-say]');
  await expect(say).toContainText('太大');
  await expect(say).toContainText('快門');
  await expect(say).not.toContainText('換一張');
  await expect(page.locator('.cam__thumb')).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// 看照片可以轉 90°（`.scratch/asks-2026-09-18/issues/05`）
// ---------------------------------------------------------------------------
//
// 她 2026-09-18：「有時候我的照片是橫的，我想要直得看比較方便」。
// 五個入口共用 `openPhoto()`，所以直接從 app 裡 import 它打開一張橫的。
// **CSS 轉，照片本身不動**；不記住（她同意），收起再打開是原本的方向。

/** 橫的一張（800×400），畫在 canvas 上變成 blob 網址 —— 跟 app 裡的照片同一種東西。 */
function openLandscape(page) {
  return page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 800;
    c.height = 400;
    const g = c.getContext('2d');
    g.fillStyle = '#c33';
    g.fillRect(0, 0, 800, 400);
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg'));
    const url = URL.createObjectURL(blob);
    const { openPhoto } = await import('/js/ui/components/seen.js');
    openPhoto(url, '');
    return url;
  });
}

/** 照片畫出來的框（算上旋轉）與捲動區。 */
const measureView = (page) => page.evaluate(() => {
  const img = document.querySelector('.seenview__img').getBoundingClientRect();
  const s = document.querySelector('.seenview__scroll');
  const box = s.getBoundingClientRect();
  return {
    w: img.width, h: img.height,
    inside: img.left >= box.left - 1 && img.right <= box.right + 1 && img.top >= box.top - 1 && img.bottom <= box.bottom + 1,
    scrolls: s.scrollWidth > s.clientWidth + 1 || s.scrollHeight > s.clientHeight + 1,
  };
});

test('C7 看照片：轉 90° 之後橫的變直的、整張在畫面裡；轉四次回原樣；收起再打開是原本的方向', async ({ app, page }) => {
  await app.signIn('/');
  const url = await openLandscape(page);
  await expect(page.locator('.seenview img')).toBeVisible();

  const flat = await measureView(page);
  expect(flat.w, '一開始是橫的').toBeGreaterThan(flat.h);

  const turn = page.locator('[data-seenview-turn]');
  await turn.click();
  await expect.poll(async () => {
    const m = await measureView(page);
    return m.h > m.w;
  }, '轉一次變直的').toBe(true);
  const upright = await measureView(page);
  expect(upright.inside, '整張都在畫面裡').toBe(true);
  expect(upright.scrolls, '不多出一塊可以捲的空白').toBe(false);
  expect(upright.h, '直的時候比橫著看大（她要的就是這個）').toBeGreaterThan(flat.w * 0.99);

  // 轉過之後點兩下不理 —— 跳回橫的會讓她以為轉壞了（放大交給兩指）
  await page.locator('.seenview__img').dblclick();
  const still = await measureView(page);
  expect(Math.abs(still.w - upright.w) < 2 && Math.abs(still.h - upright.h) < 2, '點兩下之後還是直的、大小不變')
    .toBe(true);

  await turn.click();
  await turn.click();
  await turn.click();
  await expect.poll(async () => {
    const m = await measureView(page);
    return Math.abs(m.w - flat.w) < 2 && Math.abs(m.h - flat.h) < 2;
  }, '轉四次回原樣').toBe(true);

  await turn.click();
  await page.locator('[data-seenview-close]').click();
  await expect(page.locator('.seenview')).toHaveCount(0);
  await page.evaluate(async (u) => (await import('/js/ui/components/seen.js')).openPhoto(u, ''), url);
  await expect(page.locator('.seenview img')).toBeVisible();
  const again = await measureView(page);
  expect(again.w, '不記住：再打開是原本橫的').toBeGreaterThan(again.h);
});
