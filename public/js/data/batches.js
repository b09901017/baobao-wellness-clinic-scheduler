// 壓表批次的存取。
//
// 這是「跨裝置續作」的實作（SPEC 第 1、5.3 節）：她可能 iPad 壓到一半換手機，
// 所以進度必須存雲端，不能只放本機。佇列順序在建立當下凍結，
// 換裝置回來不會發現順序跳掉 —— 那正是現在白紙的問題。

import { where } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

import * as repo from './repo.js';

const PATH = 'batches';

export const get = (id) => repo.getOne(PATH, id);

/** 還在進行中的批次。她通常只有一個，但不強制。 */
export async function listActive() {
  const rows = await repo.list(PATH, { wheres: [where('status', '==', 'active')] });
  return rows.sort((a, b) => String(b.targetMonth ?? '').localeCompare(String(a.targetMonth ?? '')));
}

export const create = (data) => repo.create(PATH, data);
export const update = (id, changes) => repo.update(PATH, id, changes);
export const remove = (id, reason) => repo.softDelete(PATH, id, reason);

/**
 * 記下她處理到哪 —— 每一位的狀態與最後停留的位置。
 * cursor 只用來「換裝置回來時捲到這裡」，完成度一律由 queue 的 state 推導。
 */
export const saveProgress = (id, queue, cursor) =>
  repo.update(PATH, id, { queue, cursor, lastDeviceHint: deviceHint() });

export const finish = (id) => repo.update(PATH, id, { status: 'finished' });
export const abandon = (id) => repo.update(PATH, id, { status: 'abandoned' });

/** 純粹給她看「上次是在哪台裝置壓的」，不拿來做任何判斷。 */
function deviceHint() {
  const w = globalThis.innerWidth ?? 0;
  if (!w) return null;
  return w < 600 ? '手機' : w < 900 ? '平板直式' : '平板橫式';
}
