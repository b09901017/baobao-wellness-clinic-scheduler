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

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

import { test, expect } from '../fixtures/app.js';
import { fakeAiCalls, queueAi } from '../fixtures/ai/index.js';
import { dayKey } from '../../functions/lib/guard.js';
import { jpegInfo } from '../../public/js/ui/components/photo.js';

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

  const request = page.waitForRequest((r) => r.url().includes('/asia-east1/extract'));
  await page.locator('[data-cam-send]').click();
  const body = JSON.parse((await request).postData());
  const bytes = Buffer.from(body.data.image, 'base64');

  expect(bytes[0]).toBe(0xff);
  expect(bytes[1]).toBe(0xd8);
  expect(bytes.subarray(0, 4096).includes(Buffer.from('Exif')), '送出去的 JPEG 還帶著 EXIF').toBe(false);
  expect(bytes.includes(Buffer.from('TestPhone'))).toBe(false);
  const info = jpegInfo(new Uint8Array(bytes));
  expect({ width: info.width, height: info.height }, '要照 EXIF 轉正、長邊 2000').toEqual({ width: 1500, height: 2000 });

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
  await expect.poll(async () => (await measureView(page)).h > (await measureView(page)).w, '轉一次變直的').toBe(true);
  const upright = await measureView(page);
  expect(upright.inside, '整張都在畫面裡').toBe(true);
  expect(upright.scrolls, '不多出一塊可以捲的空白').toBe(false);
  expect(upright.h, '直的時候比橫著看大（她要的就是這個）').toBeGreaterThan(flat.w * 0.99);

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
