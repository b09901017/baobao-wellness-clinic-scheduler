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
 * 一次原子寫入多筆資料，每一筆各自附一則稽核。
 *
 * 這是這一層唯一真正在寫入的地方，底下的 create / update / softDelete 都是它的包裝。
 * 之所以要有「多筆一次寫」，是因為有些事天生就是一組：建客戶連同展開的七筆額度、
 * 存一筆來訪連同它動到的額度計數。出現「客戶建好了但額度只寫進去三筆」
 * 比整個失敗還糟，因為沒有人會發現。
 *
 * @param {{op:'create'|'update'|'softDelete', path:string, id?:string,
 *          data?:object, changes?:object, reason?:string}[]} ops
 * @returns {Promise<string[]>} 依序回傳每一筆的 id
 */
export async function commit(ops) {
  // Firestore 一個 batch 上限 500 個操作，每筆資料佔兩個（本體 + 稽核）。
  if (ops.length * 2 > 500) throw new Error('一次寫太多筆了，請分批');

  const refs = ops.map((o) =>
    o.id ? doc(getDb(), o.path, o.id) : doc(collection(getDb(), o.path)),
  );

  // 稽核的 before 要有東西，所以更新前先把舊值讀出來。
  const befores = await Promise.all(
    ops.map((o, i) => (o.op === 'create' ? null : getDoc(refs[i]))),
  );

  const batch = writeBatch(getDb());
  const actor = actorId();

  ops.forEach((o, i) => {
    const ref = refs[i];
    const before = befores[i];
    if (o.op !== 'create' && !before.exists()) {
      throw new Error(`${o.path}/${o.id} 不存在`);
    }

    let after;
    if (o.op === 'create') {
      batch.set(ref, {
        ...o.data,
        deletedAt: null,
        createdBy: actor,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      after = o.data;
    } else if (o.op === 'update') {
      batch.update(ref, { ...o.changes, updatedAt: serverTimestamp() });
      after = o.changes;
    } else {
      batch.update(ref, { deletedAt: serverTimestamp(), updatedAt: serverTimestamp() });
      after = { deletedAt: 'server', reason: o.reason ?? null };
    }

    batch.set(newAuditRef(), {
      at: serverTimestamp(),
      actor,
      action: `${o.path}.${o.op}`,
      targetPath: ref.path,
      before: o.op === 'create' ? null : before.data(),
      after,
    });
  });

  await batch.commit();
  return refs.map((r) => r.id);
}

/** 建立一筆資料，同時寫一筆稽核。 */
export async function create(path, data, id = null) {
  const [newId] = await commit([{ op: 'create', path, id, data }]);
  return newId;
}

/** 建立多筆，全有或全無。 */
export function createMany(entries) {
  return commit(entries.map((e) => ({ op: 'create', ...e })));
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
 * 更新一筆資料。稽核的 before 是更新前的完整內容，
 * 這樣 undo 就只是把 before 寫回去。
 */
export async function update(path, id, changes) {
  await commit([{ op: 'update', path, id, changes }]);
}

/**
 * 軟刪除。Security Rules 直接禁止 delete，所以這是唯一的刪除方式。
 * 資料還在，只是查詢時被 list() 濾掉。
 */
export async function softDelete(path, id, reason = null) {
  await commit([{ op: 'softDelete', path, id, reason }]);
}

/** 還原軟刪除的資料。設定頁的「已刪除項目」用得到。 */
export async function restore(path, id) {
  return update(path, id, { deletedAt: null });
}
