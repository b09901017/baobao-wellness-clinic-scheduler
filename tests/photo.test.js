// 送 AI 那一張照片的縮法（`ui/components/photo.js`，issue 06）。
//
// 瀏覽器那一半（canvas、createImageBitmap）在 `tests-e2e/specs/37-camera.spec.js`；
// 這裡盯的是縮之前那兩個決定：**轉正之後哪一邊比較長**、**縮成多少**。
// 直式的訂購單被當成橫的縮，送出去的是一張 2000×1500 的扁紙。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

import { fitLongEdge, jpegInfo, orientedSize } from '../public/js/ui/components/photo.js';

async function jpeg({ width, height, orientation }) {
  let img = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 180, b: 150 } } });
  if (orientation) img = img.withMetadata({ orientation });
  return new Uint8Array(await img.jpeg().toBuffer());
}

describe('讀檔頭', () => {
  test('寬高與 EXIF 方向（手機橫著存、說要轉 90 度）', async () => {
    const info = jpegInfo(await jpeg({ width: 400, height: 300, orientation: 6 }));
    assert.deepEqual(info, { width: 400, height: 300, orientation: 6 });
    assert.deepEqual(orientedSize(info), { width: 300, height: 400 });
  });

  test('沒有 EXIF 就是 1', async () => {
    assert.equal(jpegInfo(await jpeg({ width: 50, height: 80 })).orientation, 1);
  });

  test('不是 JPEG 回 null', () => {
    assert.equal(jpegInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), null);
    assert.equal(jpegInfo(null), null);
  });
});

describe('縮成多少', () => {
  test('她相簿裡那種 9000×12000 → 1500×2000', () => {
    assert.deepEqual(fitLongEdge(9000, 12000), { width: 1500, height: 2000 });
  });

  test('比 2000 小的不放大', () => {
    assert.deepEqual(fitLongEdge(1080, 1920), { width: 1080, height: 1920 });
  });

  test('4K 取景畫面 → 2000×1125', () => {
    assert.deepEqual(fitLongEdge(3840, 2160), { width: 2000, height: 1125 });
  });

  test('壞掉的輸入不會變成 0 或 NaN', () => {
    assert.deepEqual(fitLongEdge(0, undefined), { width: 1, height: 1 });
  });
});
