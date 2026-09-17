// 療程單的讀寫：Firestore 的文件 ＋ Cloud Storage 的照片（issue 14，ADR-0101、0105）。
//
// - 文件：`customers/{客戶}/treatmentSheets/{療程單}`，走 `repo`（有稽核、只軟刪除）
// - 照片：`treatmentSheets/{客戶}/{療程單}/{拍照時間}.jpg`，`storage.rules` 只准白名單
//
// **新版的順序只有一種**：新的照片傳上去 → 文件更新 → 才刪舊的照片檔（ADR-0101）。
// 反過來的話，中間斷線就兩張都沒了。文件更新失敗時把剛傳上去的那一張收回來（盡量），
// 舊的那一張還在、文件沒變。
//
// Storage 等到第一次要用才初始化、才接模擬器（跟 `data/ai.js` 的 App Check 同一個理由）：
// 打開 app 的時候絕大部分時間用不到療程單的照片。

import {
  connectStorageEmulator,
  deleteObject,
  getDownloadURL,
  getStorage,
  ref,
  uploadBytes,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js';

import { initFirebase } from './firebase.js';
import * as repo from './repo.js';
import { usingEmulator } from '../firebase-config.js';
import { MAX_PHOTO_BYTES, photoPathFor } from '../domain/treatmentSheets.js';

const pathOf = (customerId) => `customers/${customerId}/treatmentSheets`;

let storage = null;

function bucket() {
  if (storage) return storage;
  const { app } = initFirebase();
  storage = getStorage(app);
  if (usingEmulator()) connectStorageEmulator(storage, '127.0.0.1', 9199);
  // SDK 預設斷線時重試十分鐘。她站在櫃台等一個轉圈十分鐘等於當機 —— 一分鐘還傳不上去就講出來
  storage.maxUploadRetryTime = 60_000;
  storage.maxOperationRetryTime = 30_000;
  return storage;
}

/** Storage 的錯誤 → 講得出來的一句話。 */
export class PhotoError extends Error {
  constructor(reason, cause) {
    super({
      notAllowed: '照片傳不上去：這個帳號沒有權限',
      offline: '照片傳不上去：網路斷了，接上網路再存一次',
      tooLarge: '照片太大了，重拍一張',
      failed: '照片傳不上去，再存一次',
    }[reason] ?? '照片傳不上去，再存一次');
    this.reason = reason;
    this.cause = cause;
  }
}

function photoReason(e) {
  const code = String(e?.code ?? '');
  if (code === 'storage/unauthorized' || code === 'storage/unauthenticated') return 'notAllowed';
  if (code === 'storage/retry-limit-exceeded' || globalThis.navigator?.onLine === false) return 'offline';
  return 'failed';
}

// ---------- 讀 ----------

/** 全部客戶的療程單（還沒刪的）。每一筆帶 `customerId`（冗餘存的那一格；沒有就用路徑上的）。 */
export async function listAll() {
  const rows = await repo.listGroup('treatmentSheets');
  return rows.map(({ parentId, ...r }) => ({ ...r, customerId: r.customerId ?? parentId }));
}

export const listByCustomer = (customerId) => repo.list(pathOf(customerId));

/** 「已刪除項目」用。 */
export async function listDeleted() {
  const rows = await repo.listGroup('treatmentSheets', { includeDeleted: true });
  return rows.filter((r) => r.deletedAt).map(({ parentId, ...r }) => ({ ...r, customerId: r.customerId ?? parentId }));
}

/**
 * 那一張照片的網址。**檔案不在回 null**（還原備份之後的樣子：照片不進備份，ADR-0101）。
 * 網址只放在畫面的 `<img>` 上，**不存、不記**（它帶著下載權杖）。
 */
export async function photoUrl(photoPath) {
  if (!photoPath) return null;
  try {
    return await getDownloadURL(ref(bucket(), photoPath));
  } catch (e) {
    if (String(e?.code) === 'storage/object-not-found') return null;
    throw e;
  }
}

// ---------- 寫 ----------

async function upload(photoPath, blob) {
  if (!blob || blob.size > MAX_PHOTO_BYTES) throw new PhotoError('tooLarge');
  if (globalThis.navigator?.onLine === false) throw new PhotoError('offline');
  try {
    await uploadBytes(ref(bucket(), photoPath), blob, { contentType: 'image/jpeg' });
  } catch (e) {
    throw new PhotoError(photoReason(e), e);
  }
}

/** 刪一個照片檔。檔案本來就不在算刪掉了。回有沒有刪成。 */
async function removePhoto(photoPath) {
  try {
    await deleteObject(ref(bucket(), photoPath));
    return true;
  } catch (e) {
    return String(e?.code) === 'storage/object-not-found';
  }
}

/**
 * 新的一張：照片傳上去 → 建文件。
 *
 * @param {object} fields `domain/treatmentSheets.js` 的 `sheetFields()`
 * @param {Blob} blob 縮好的 JPEG
 * @returns {Promise<string>} 新的那一張的 id
 */
export async function create(fields, blob, { takenAt = Date.now() } = {}) {
  const id = repo.newId(pathOf(fields.customerId));
  const photoPath = photoPathFor(fields.customerId, id, takenAt);
  await upload(photoPath, blob);
  try {
    await repo.commit([{
      op: 'create', path: pathOf(fields.customerId), id,
      data: { ...fields, photoPath, photoAt: new Date(takenAt).toISOString(), stalePhotoPaths: [] },
    }]);
  } catch (e) {
    await removePhoto(photoPath);
    throw e;
  }
  return id;
}

/**
 * 同一張的新版：**新照片傳上去 → 文件更新 → 才刪舊的照片檔**（ADR-0101）。
 *
 * 舊的刪不掉（網路在最後那一下斷了）不算存失敗 —— 文件已經指到新的了。
 * 刪不掉的那幾個記在 `stalePhotoPaths`，下次打開療程單那一頁再刪一次（`sweepStale()`）。
 *
 * @returns {Promise<{oldRemoved: boolean}>}
 */
export async function replace(existing, fields, blob, { takenAt = Date.now() } = {}) {
  const path = pathOf(existing.customerId);
  const photoPath = photoPathFor(existing.customerId, existing.id, takenAt);
  await upload(photoPath, blob);
  try {
    await repo.commit([{
      op: 'update', path, id: existing.id,
      changes: { ...fields, photoPath, photoAt: new Date(takenAt).toISOString() },
    }]);
  } catch (e) {
    await removePhoto(photoPath);
    throw e;
  }

  const old = [existing.photoPath, ...(existing.stalePhotoPaths ?? [])].filter((p) => p && p !== photoPath);
  const left = [];
  for (const p of old) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await removePhoto(p))) left.push(p);
  }
  if (left.length || (existing.stalePhotoPaths ?? []).length) {
    try {
      await repo.commit([{ op: 'update', path, id: existing.id, changes: { stalePhotoPaths: left } }]);
    } catch {
      /* 記不下來就算了：照片檔已經不被任何文件指著，資料沒有錯 */
    }
  }
  return { oldRemoved: left.length === 0 };
}

/** 上一次沒刪掉的舊照片檔，再刪一次。刪乾淨才寫文件。 */
export async function sweepStale(sheet) {
  const stale = sheet?.stalePhotoPaths ?? [];
  if (!stale.length) return;
  const left = [];
  for (const p of stale) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await removePhoto(p))) left.push(p);
  }
  if (left.length === stale.length) return;
  await repo.commit([{ op: 'update', path: pathOf(sheet.customerId), id: sheet.id, changes: { stalePhotoPaths: left } }]);
}

/** 刪掉一整張療程單：**文件軟刪除，照片檔留著**（「已刪除項目」還原得回來，ADR-0101）。 */
export const remove = (sheet, reason = null) => repo.softDelete(pathOf(sheet.customerId), sheet.id, reason);

export const restore = (sheet) => repo.restore(pathOf(sheet.customerId), sheet.id);
