// 所有 Firestore 讀寫都經過這裡。
//
// 這一層存在的理由只有一個：讓「留稽核」和「不硬刪除」變成做不到的例外，
// 而不是每次寫 code 都要記得的規矩。想繞過它就要自己 import firestore SDK，
// 而那件事會被 tests/layering.test.js 抓到。

import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit as fsLimit,
  serverTimestamp,
  writeBatch,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

import { getDb, getAuthInstance } from './firebase.js';

function actorId() {
  return getAuthInstance().currentUser?.uid ?? 'unknown';
}

function newAuditRef() {
  return doc(collection(getDb(), 'audit'));
}

/** 清單查詢一律排除已刪除的資料。呼叫端不需要自己記得加。 */
export async function list(path, { wheres = [], order = null, limit = null } = {}) {
  const clauses = [where('deletedAt', '==', null), ...wheres];
  if (order) clauses.push(orderBy(order[0], order[1] ?? 'asc'));
  if (limit) clauses.push(fsLimit(limit));

  const snap = await getDocs(query(collection(getDb(), path), ...clauses));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * 含已刪除的全部資料。只有「已刪除項目還原」與匯出備份該用這個，
 * 一般清單一律用 list()。
 */
export async function listWithDeleted(path) {
  const snap = await getDocs(collection(getDb(), path));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getOne(path, id) {
  const snap = await getDoc(doc(getDb(), path, id));
  if (!snap.exists()) return null;
  const data = { id: snap.id, ...snap.data() };
  return data.deletedAt ? null : data;
}

/**
 * 建立一筆資料，同時寫一筆稽核。兩者在同一個 batch 裡，
 * 不會出現「資料寫進去了但沒有紀錄」。
 */
export async function create(path, data, id = null) {
  const ref = id ? doc(getDb(), path, id) : doc(collection(getDb(), path));
  const payload = {
    ...data,
    deletedAt: null,
    createdBy: actorId(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const batch = writeBatch(getDb());
  batch.set(ref, payload);
  batch.set(newAuditRef(), {
    at: serverTimestamp(),
    actor: actorId(),
    action: `${path}.create`,
    targetPath: ref.path,
    before: null,
    after: data,
  });
  await batch.commit();
  return ref.id;
}

/**
 * 先拿一個還沒被使用的 id。
 * 用途是「客戶」與它底下的「額度」要能在同一個 batch 裡建立 ——
 * 子集合的路徑需要父文件的 id，所以 id 必須先於寫入存在。
 */
export function newId(path) {
  return doc(collection(getDb(), path)).id;
}

/**
 * 一次建立多筆資料（各自附稽核），全部在同一個 writeBatch 裡。
 *
 * 建客戶 + 展開方案的七筆額度必須全有或全無：出現「客戶建好了但額度只寫進去三筆」
 * 比整個失敗還糟，因為沒有人會發現。
 *
 * @param {{path:string, data:object, id?:string}[]} entries
 * @returns {Promise<string[]>} 依序回傳每一筆的 id
 */
export async function createMany(entries) {
  // Firestore 一個 batch 上限 500 個操作，每筆資料佔兩個（本體 + 稽核）。
  if (entries.length * 2 > 500) throw new Error('一次寫太多筆了，請分批');

  const batch = writeBatch(getDb());
  const ids = [];

  for (const { path, data, id = null } of entries) {
    const ref = id ? doc(getDb(), path, id) : doc(collection(getDb(), path));
    batch.set(ref, {
      ...data,
      deletedAt: null,
      createdBy: actorId(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(newAuditRef(), {
      at: serverTimestamp(),
      actor: actorId(),
      action: `${path}.create`,
      targetPath: ref.path,
      before: null,
      after: data,
    });
    ids.push(ref.id);
  }

  await batch.commit();
  return ids;
}

/**
 * 跨所有父文件查同名子集合。客戶總覽要一次拿到全部客戶的額度，
 * 否則就是二十幾次往返。
 *
 * 刻意不加 where(deletedAt == null)：collection group 查詢帶條件要另外開索引，
 * 而這裡的量（二十幾位客戶 × 各七筆額度）在 client 濾掉便宜得多。
 *
 * @returns {Promise<object[]>} 每筆多一個 parentId 欄位
 */
export async function listGroup(collectionId, { includeDeleted = false } = {}) {
  const snap = await getDocs(collectionGroup(getDb(), collectionId));
  return snap.docs
    .map((d) => ({ id: d.id, parentId: d.ref.parent.parent?.id ?? null, ...d.data() }))
    .filter((r) => includeDeleted || !r.deletedAt);
}

/**
 * 更新一筆資料。會先讀出舊值寫進稽核的 before，
 * 這樣 undo 就只是把 before 寫回去。
 */
export async function update(path, id, changes) {
  const ref = doc(getDb(), path, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error(`${path}/${id} 不存在`);

  const batch = writeBatch(getDb());
  batch.update(ref, { ...changes, updatedAt: serverTimestamp() });
  batch.set(newAuditRef(), {
    at: serverTimestamp(),
    actor: actorId(),
    action: `${path}.update`,
    targetPath: ref.path,
    before: snap.data(),
    after: changes,
  });
  await batch.commit();
}

/**
 * 軟刪除。Security Rules 直接禁止 delete，所以這是唯一的刪除方式。
 * 資料還在，只是查詢時被 list() 濾掉。
 */
export async function softDelete(path, id, reason = null) {
  const ref = doc(getDb(), path, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error(`${path}/${id} 不存在`);

  const batch = writeBatch(getDb());
  batch.update(ref, { deletedAt: serverTimestamp(), updatedAt: serverTimestamp() });
  batch.set(newAuditRef(), {
    at: serverTimestamp(),
    actor: actorId(),
    action: `${path}.softDelete`,
    targetPath: ref.path,
    before: snap.data(),
    after: { deletedAt: 'server', reason },
  });
  await batch.commit();
}

/** 還原軟刪除的資料。設定頁的「已刪除項目」用得到。 */
export async function restore(path, id) {
  return update(path, id, { deletedAt: null });
}
