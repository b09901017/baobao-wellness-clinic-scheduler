// AI 用量的讀寫（ADR-0100）。
//
// - `aiUsage/{月}`、`aiUsage/{月}/calls`：**只讀**。只有 Function 寫得進去（Rules 寫 false）
// - `config/ai`：她的每月上限與暫停開關。走 repo，才有稽核（「暫停 AI」那一句）
//
// `calls` 身上沒有 `deletedAt`（它不是她的資料，是 Function 的帳本），所以不走
// `repo.list()` —— 那一支會 `where('deletedAt','==',null)`，一筆都撈不到。

import {
  collection, doc, getDoc, getDocs, limit, orderBy, query,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

import { getDb } from './firebase.js';
import * as repo from './repo.js';

export const CONFIG_ID = 'ai';

export async function readConfig() {
  const snap = await getDoc(doc(getDb(), 'config', CONFIG_ID));
  return snap.exists() ? snap.data() : {};
}

/** 只存她改的那幾格。第一次存的時候那一份還不存在，就建一份。 */
export async function saveConfig(changes) {
  const exists = (await getDoc(doc(getDb(), 'config', CONFIG_ID))).exists();
  await repo.commit([
    exists
      ? { op: 'update', path: 'config', id: CONFIG_ID, changes }
      : { op: 'create', path: 'config', id: CONFIG_ID, data: changes },
  ]);
}

export async function readMonth(month) {
  const snap = await getDoc(doc(getDb(), 'aiUsage', month));
  return snap.exists() ? snap.data() : null;
}

/** 這個月最近 n 次，新的在前。 */
export async function recentCalls(month, n = 20) {
  const snap = await getDocs(query(
    collection(getDb(), 'aiUsage', month, 'calls'),
    orderBy('at', 'desc'),
    limit(n),
  ));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
