// 把一張照片縮成送 AI 的那一張：長邊約 2000px、JPEG 0.85（issue 06，ADR-0101）。
//
// **重新編碼本身就把 EXIF 與 GPS 丟掉了** —— canvas 輸出的 JPEG 沒有 APP1 段，
// 不用另外寫一段去剝。E2E 攔下請求檢查開頭沒有 `Exif`。
//
// 兩個坑：
//
// 1. **她相簿裡的原始照片是 9000×12000（1 億像素）**，iOS Safari 的 canvas 上限約 1677 萬像素。
//    整張畫進 canvas 會**安靜地畫出一張空白**。所以 canvas 只開目標尺寸，
//    解碼時就縮（`createImageBitmap` 的 resize 選項）；Safari 不支援 resize 的話
//    退回 `<img>` 解碼，一樣只畫進目標尺寸的 canvas
// 2. **手機拍的照片是橫著存、EXIF 說要轉**。縮之前要先知道轉完之後哪一邊比較長，
//    不然直式的訂購單會被縮成 2000×1500 而不是 1500×2000。讀檔頭就知道，不用整張解碼
//
// 上半段是純函式（`tests/photo.test.js`），下半段才碰瀏覽器。

export const LONG_EDGE = 2000;
export const QUALITY = 0.85;

/** 長邊縮到 `max`，不放大。 */
export function fitLongEdge(width, height, max = LONG_EDGE) {
  const w = Math.max(1, Math.round(Number(width) || 0));
  const h = Math.max(1, Math.round(Number(height) || 0));
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/**
 * 讀 JPEG 檔頭：寬高與 EXIF 的方向。**只讀前面幾十 KB**，不解碼。
 * 認不得（不是 JPEG、檔頭壞了）回 null。
 *
 * @param {Uint8Array} bytes
 * @returns {{width: number, height: number, orientation: number}|null}
 */
export function jpegInfo(bytes) {
  if (!bytes || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let orientation = 1;
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker === 0xe1 && readAscii(bytes, i + 4, 4) === 'Exif') {
      orientation = exifOrientation(bytes, i + 10) ?? orientation;
    }
    // SOF0～SOF15（C4 DHT、C8、CC DAC 不是）
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      const height = (bytes[i + 5] << 8) | bytes[i + 6];
      const width = (bytes[i + 7] << 8) | bytes[i + 8];
      return { width, height, orientation };
    }
    i += 2 + len;
  }
  return null;
}

const readAscii = (b, at, n) => String.fromCharCode(...b.subarray(at, at + n));

function exifOrientation(b, tiff) {
  const little = b[tiff] === 0x49;
  const u16 = (o) => (little ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
  const u32 = (o) => (little
    ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
    : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > b.length) return null;
  const count = u16(ifd);
  for (let k = 0; k < count; k += 1) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > b.length) return null;
    if (u16(e) === 0x0112) return u16(e + 8);
  }
  return null;
}

/** EXIF 方向 5～8 是轉了 90 度：寬高對調。 */
export function orientedSize({ width, height, orientation = 1 }) {
  return orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height };
}

// ---------- 瀏覽器 ----------

async function headInfo(blob) {
  try {
    return jpegInfo(new Uint8Array(await blob.slice(0, 256 * 1024).arrayBuffer()));
  } catch {
    return null;
  }
}

function canvasToJpeg(canvas, quality = QUALITY) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', quality);
  });
}

function loadImg(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });
}

/** 畫出來是不是整張一個顏色（Safari 超過 canvas 上限時的樣子）。 */
function looksBlank(ctx, w, h) {
  const probe = ctx.getImageData(0, 0, w, h).data;
  const step = Math.max(4, Math.floor(probe.length / 400 / 4) * 4);
  const [r, g, b] = [probe[0], probe[1], probe[2]];
  for (let i = 0; i < probe.length; i += step) {
    if (Math.abs(probe[i] - r) > 3 || Math.abs(probe[i + 1] - g) > 3 || Math.abs(probe[i + 2] - b) > 3) return false;
  }
  return true;
}

/**
 * 一張相簿或系統相機給的照片 → 送 AI 的那一張 JPEG。
 *
 * `longEdge`／`quality` 只有療程單要存的那一張會改（ADR-0105）：送 AI 的那一張大於
 * `storage.rules` 的上限時，再縮一次才傳得上去。
 *
 * @param {Blob} file
 * @param {{longEdge?: number, quality?: number}} [o]
 * @returns {Promise<{blob: Blob, width: number, height: number}>}
 */
export async function shrinkPhoto(file, { longEdge = LONG_EDGE, quality = QUALITY } = {}) {
  const info = await headInfo(file);
  const natural = info ? orientedSize(info) : null;

  // 第一條路：解碼時就縮（Chrome、Android）。量得到原始大小才走 —— 不知道比例就不知道要縮成多少
  if (natural && typeof createImageBitmap === 'function') {
    const target = fitLongEdge(natural.width, natural.height, longEdge);
    try {
      const bmp = await createImageBitmap(file, {
        resizeWidth: target.width, resizeHeight: target.height, resizeQuality: 'high', imageOrientation: 'from-image',
      });
      // 不支援 resize 的瀏覽器會安靜地給原尺寸 —— 那一張不可以直接畫
      if (bmp.width === target.width && bmp.height === target.height) {
        const out = drawTo(bmp, target, quality);
        bmp.close?.();
        return out;
      }
      bmp.close?.();
    } catch {
      /* 退回 <img> */
    }
  }

  // 第二條路：<img> 解碼（瀏覽器自己會照 EXIF 轉），只畫進目標尺寸的 canvas
  const { img, url } = await loadImg(file);
  try {
    const target = fitLongEdge(img.naturalWidth, img.naturalHeight, longEdge);
    return await drawTo(img, target, quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 取景畫面的一格 → 送 AI 的那一張。影像串流最多 4K（830 萬像素），不會碰到 canvas 上限。 */
export async function shrinkFrame(video) {
  return drawTo(video, fitLongEdge(video.videoWidth, video.videoHeight));
}

async function drawTo(source, { width, height }, quality = QUALITY) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  if (looksBlank(ctx, Math.min(width, 64), Math.min(height, 64)) && looksBlank(ctx, width, height)) {
    throw new Error('blank');
  }
  const blob = await canvasToJpeg(canvas, quality);
  canvas.width = 0; // 讓 iOS 早點還記憶體
  return { blob, width, height };
}
