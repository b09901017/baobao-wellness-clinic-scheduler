// 主檔存取。所有讀寫都走 repo.js，所以自動有稽核紀錄與軟刪除。
//
// Firestore 路徑：config/app/{type}/{id}
//   config    集合
//   app       文件（同時放設定值本身）
//   {type}    子集合，例如 rooms、courses
//
// SPEC 第 5.1 節寫成 config/courses/{id}，但那個路徑在 Firestore 是不合法的
// （集合與文件必須交替出現）。這裡是最接近原意的合法寫法，
// firestore.rules 的 match /config/{docId=**} 已經涵蓋。

import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

import { getDb } from './firebase.js';
import * as repo from './repo.js';
import { MASTER_TYPES } from '../domain/masterData.js';
import { SEED, DEFAULT_SETTINGS } from '../domain/seed.js';
import { toStored } from '../domain/messageTemplates.js';

const pathFor = (type) => `config/app/${type}`;

export function listAll(type, { includeDeleted = false } = {}) {
  return includeDeleted ? repo.listWithDeleted(pathFor(type)) : repo.list(pathFor(type));
}

export const get = (type, id) => repo.getOne(pathFor(type), id);
export const create = (type, data, id = null) => repo.create(pathFor(type), data, id);
export const update = (type, id, changes) => repo.update(pathFor(type), id, changes);
export const remove = (type, id, reason) => repo.softDelete(pathFor(type), id, reason);
export const restore = (type, id) => repo.restore(pathFor(type), id);

/** 一次把所有主檔讀出來。設定頁與之後的排班畫面都需要全部。 */
export async function loadAll() {
  const entries = await Promise.all(
    MASTER_TYPES.map(async (type) => [type, await listAll(type)]),
  );
  return Object.fromEntries(entries);
}

// ---------- 設定值 ----------

export async function getSettings() {
  const snap = await getDoc(doc(getDb(), 'config', 'app'));
  return { ...DEFAULT_SETTINGS, ...(snap.exists() ? snap.data() : {}) };
}

/**
 * 設定值也走 repo，才會有稽核與復原 —— 排序權重被改掉而不知道是什麼時候改的，
 * 跟資料被改掉一樣難查。
 */
export async function saveSettings(changes) {
  const exists = (await getDoc(doc(getDb(), 'config', 'app'))).exists();
  await repo.commit([
    exists
      ? { op: 'update', path: 'config', id: 'app', changes }
      : { op: 'create', path: 'config', id: 'app', data: changes },
  ]);
}

// ---------- LINE 回覆模板 ----------
//
// 存在 `config/app` 這份文件的 `messageTemplates` 欄位底下 —— 跟
// `sortWeights`、`sheetSync` 同一份，所以**自動有稽核紀錄、自動進備份、
// 自動被還原腳本搬回來**，`firestore.rules` 的 `match /config/{docId=**}`
// 也已經涵蓋，一行都不用改。
//
// 只存她**改過**的那幾則（`toStored()`）：之後改預設值時她沒動過的會跟著更新。

/**
 * 這一次開著 app 的期間讀過的那一份。`null` 代表還沒讀過。
 *
 * 快取的理由跟 `data/playbooks.js` 一樣：模板是**很少改、要在五個地方被讀到**
 * 的參考資料，每次都重讀等於在她的行動網路上多打幾輪往返（SPEC 第 6.9 節）。
 */
let templateCache = null;

/** 任何一次寫入之後都要丟掉 —— 她改完立刻要看到改完的樣子。 */
export function forgetTemplates() {
  templateCache = null;
}

/**
 * 她改過的那幾則。**讀不到就回空物件**，那時候每一則都用預設值 ——
 * 「看到出廠設定的那一句」比「看到空白」好得多。
 *
 * @param {{fresh?: boolean}} [o]
 */
export async function getTemplates({ fresh = false } = {}) {
  if (!fresh && templateCache) return templateCache;
  try {
    templateCache = (await getSettings()).messageTemplates ?? {};
  } catch {
    return {};
  }
  return templateCache;
}

/** 存整份。走 `saveSettings()`，所以跟排序權重一樣有稽核與復原。 */
export async function saveTemplates(next) {
  await saveSettings({ messageTemplates: toStored(next) });
  forgetTemplates();
}

// ---------- 種子資料 ----------

/**
 * 載入種子資料。已經存在的一律跳過，不覆蓋 —— 她可能已經改過了。
 * 用固定 ID 所以重跑不會長出第二份。
 *
 * @returns {Promise<{created: number, skipped: number, byType: object}>}
 */
export async function loadSeed() {
  const byType = {};
  let created = 0;
  let skipped = 0;

  for (const type of MASTER_TYPES) {
    const rows = SEED[type] ?? [];
    const existing = await repo.listWithDeleted(pathFor(type));
    const existingIds = new Set(existing.map((r) => r.id));

    let madeHere = 0;
    for (const row of rows) {
      if (existingIds.has(row.id)) {
        skipped += 1;
        continue;
      }
      const { id, ...data } = row;
      await repo.create(pathFor(type), { ...data, active: true }, id);
      created += 1;
      madeHere += 1;
    }
    byType[type] = madeHere;
  }

  return { created, skipped, byType };
}

// 匯出備份在 data/backup.js —— 它要的不只是主檔，而是全部集合（SPEC 第 6.8 節）。
