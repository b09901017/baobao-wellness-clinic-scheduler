// 一次寫入的反向操作。純函式。
//
// 為什麼這件事在 /domain 而不是躲在 /data 裡：反向操作要遵守業務規則，
// 不是把資料倒帶就好 —— 復原一次「新增」是標記刪除，不是硬刪除
// （SPEC 第 6.1 節：永不硬刪除，Rules 也擋著）。
//
// SPEC 第 6.3 節：有了稽核紀錄，undo 就是把 before 寫回去，並再記一筆稽核。
// 這裡只負責算出「寫回去」是哪些操作，真正寫入在 data/repo.js。

/** 復原寫回去時標在稽核上的記號，之後回頭看才知道這筆是復原造成的。 */
export const UNDO_NOTE = '復原';

/**
 * 算出一批寫入的反向操作。
 *
 * @param {{op:'create'|'update'|'softDelete', path:string, id:string,
 *          data?:object, changes?:object}[]} ops 已經配好 id 的那批操作
 * @param {(object|null)[]} befores 每一筆寫入前的完整內容，順序與 ops 相同；
 *                                  新增的那幾筆是 null
 * @returns {object[]|null} 反向操作；只要有一筆算不出來就整批回 null ——
 *                          半套的復原比沒有復原危險
 */
export function inverseOps(ops, befores) {
  if (!Array.isArray(ops) || !ops.length) return null;
  if (!Array.isArray(befores) || befores.length !== ops.length) return null;

  const out = [];
  for (const [i, op] of ops.entries()) {
    const inverse = inverseOf(op, befores[i]);
    if (!inverse) return null;
    out.push({ ...inverse, note: UNDO_NOTE });
  }
  return out;
}

function inverseOf(op, before) {
  if (!op?.path || !op?.id) return null;

  // 復原新增 = 標記刪除。資料留著，設定頁的「已刪除項目」看得到。
  if (op.op === 'create') {
    return { op: 'softDelete', path: op.path, id: op.id, reason: UNDO_NOTE };
  }

  if (!before) return null;

  if (op.op === 'softDelete') {
    return { op: 'update', path: op.path, id: op.id, changes: { deletedAt: before.deletedAt ?? null } };
  }

  if (op.op === 'update') {
    return { op: 'update', path: op.path, id: op.id, changes: previousValues(op.changes, before) };
  }

  return null;
}

/**
 * 只把這次動到的欄位還原，沒動到的不要碰。
 * 本來不存在的欄位還原成 null —— Firestore 寫不進 undefined，
 * 而這個專案的慣例是「沒有值」就是 null（deletedAt 也是這樣）。
 */
function previousValues(changes, before) {
  const out = {};
  for (const key of Object.keys(changes ?? {})) {
    out[key] = key in before ? before[key] : null;
  }
  return out;
}
