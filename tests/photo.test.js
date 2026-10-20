// 送 AI 那一張照片的縮法（`ui/components/photo.js`，issue 06）。
//
// 瀏覽器那一半（canvas、createImageBitmap）在 `tests-e2e/specs/37-camera.spec.js`；
// 這裡盯的是縮之前那兩個決定：**轉正之後哪一邊比較長**、**縮成多少**。
// 直式的訂購單被當成橫的縮，送出去的是一張 2000×1500 的扁紙。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

import { decodeHint, fitLongEdge, frameUpright, jpegInfo, orientedSize } from '../public/js/ui/components/photo.js';

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

// after-golive 01：手機解不開整張 1 億像素的照片，改用 ImageDecoder 解碼時就縮。
// 瀏覽器那一半（真的解、畫進 canvas、四個角的顏色）在 E2E `37` 的 P1～P3。
describe('ImageDecoder 要解成多大', () => {
  test('她手機那種 12000×9000 → 帶目標的兩倍（4000×3000），Chromium 才解得比目標大', () => {
    assert.deepEqual(decodeHint({ width: 12000, height: 9000, orientation: 1 }), { desiredWidth: 4000, desiredHeight: 3000 });
  });

  test('方向 6（橫著存、要轉）照檔案裡存的方向算，不先轉', () => {
    assert.deepEqual(decodeHint({ width: 12000, height: 9000, orientation: 6 }), { desiredWidth: 4000, desiredHeight: 3000 });
    assert.deepEqual(decodeHint({ width: 9000, height: 12000, orientation: 6 }), { desiredWidth: 3000, desiredHeight: 4000 });
  });

  test('兩倍已經比原圖大的不帶提示（不放大、照原尺寸解）', () => {
    assert.equal(decodeHint({ width: 3200, height: 2400, orientation: 6 }), null);
    assert.equal(decodeHint({ width: 1080, height: 1920, orientation: 1 }), null);
  });

  test('療程單要存的那一張帶自己的長邊', () => {
    assert.deepEqual(decodeHint({ width: 12000, height: 9000 }, 1600), { desiredWidth: 3200, desiredHeight: 2400 });
  });

  test('讀不到檔頭的不帶', () => {
    assert.equal(decodeHint(null), null);
  });
});

describe('ImageDecoder 吐出來的那一格畫出來是不是正的', () => {
  const info6 = { width: 3200, height: 2400, orientation: 6 };

  test('帶著跟 EXIF 一樣的轉法、長寬比對 → 放行（Chrome 151 量到的樣子）', () => {
    assert.equal(frameUpright({ rotation: 90, flip: false, displayWidth: 1200, displayHeight: 1600 }, info6), true);
    assert.equal(frameUpright({ rotation: 0, flip: false, displayWidth: 3000, displayHeight: 2250 },
      { width: 12000, height: 9000, orientation: 1 }), true);
  });

  test('舊的瀏覽器沒有 rotation：本來就不用轉的放行，要轉的交給舊的兩條路', () => {
    assert.equal(frameUpright({ displayWidth: 3000, displayHeight: 2250 }, { width: 12000, height: 9000, orientation: 1 }), true);
    assert.equal(frameUpright({ displayWidth: 1600, displayHeight: 1200 }, info6), false);
  });

  test('轉法不一樣、鏡像、或長寬比對不上 → 不放行', () => {
    assert.equal(frameUpright({ rotation: 0, flip: false, displayWidth: 1600, displayHeight: 1200 }, info6), false);
    assert.equal(frameUpright({ rotation: 90, flip: true, displayWidth: 1200, displayHeight: 1600 }, info6), false);
    assert.equal(frameUpright({ rotation: 90, flip: false, displayWidth: 1600, displayHeight: 1200 }, info6), false);
  });

  test('鏡像的那四種方向（相機不會拍出來）一律不走這條', () => {
    for (const orientation of [2, 4, 5, 7]) {
      assert.equal(frameUpright({ rotation: 0, flip: true, displayWidth: 100, displayHeight: 100 },
        { width: 100, height: 100, orientation }), false);
    }
  });
});
