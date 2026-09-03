// 備忘錄／SOP 的存取。
//
// 它是**參考資料**：很少改，但要在三個地方被讀到（備忘錄那一頁、日曆上點一筆
// 來訪、待辦的「跟客人確認時間」）。所以這一層多一個**行程內快取** ——
// 每次都重讀等於為了一段幾乎不變的文字，在她的行動網路上多打幾輪往返
// （SPEC 第 6.9 節）。
//
// 快取只活在這一次開著 app 的期間，任何一次寫入就整個丟掉。她在另一台裝置上
// 改了這一台不會馬上知道 —— 那被接受：備忘錄不是會對不起來的資料，
// 而重新整理就是最新的。
//
// 規則一條都不在這裡，全部在 domain/playbook.js。

import * as repo from './repo.js';
import { normalize } from '../domain/playbook.js';

const PATH = 'playbooks';

/** 這一次開著 app 的期間讀過的那一份。`null` 代表還沒讀過。 */
let cache = null;

/** 任何一次寫入之後都要丟掉 —— 她改完立刻要看到改完的樣子。 */
export function forget() {
  cache = null;
}

/**
 * 全部，順序由畫面決定（`deckOrder()`）。
 *
 * **不下 `order`**：`repo.list()` 本來就帶 `where('deletedAt','==',null)`，
 * 純等值查詢不需要複合索引，而排序在 client 做便宜得多
 *（她的備忘錄不會有一百份）。
 *
 * @param {{fresh?: boolean}} [o] fresh：跳過快取重讀一次
 */
export async function list({ fresh = false } = {}) {
  if (!fresh && cache) return cache;
  cache = await repo.list(PATH);
  return cache;
}

/**
 * 一份。**先從快取找**，找不到才去讀 —— 從清單點進去那一下不該再打一次網路。
 *
 * 快取裡沒有不代表不存在（她可能是直接打網址進來的），所以退回去讀一次。
 */
export async function get(id) {
  const hit = cache?.find((p) => p.id === id);
  if (hit) return hit;
  return repo.getOne(PATH, id);
}

export async function listDeleted() {
  return (await repo.listWithDeleted(PATH)).filter((p) => p.deletedAt);
}

export async function create(data) {
  const id = await repo.create(PATH, normalize(data));
  forget();
  return id;
}

/**
 * 改一份。
 *
 * **收的是整份不是變了的那幾欄** —— `normalize()` 只回三個欄位，
 * 逐欄 patch 會讓舊形狀留下來的 `sections`／`tag`／`pinned` 永遠留在文件上。
 * 整份寫進去，稽核紀錄上的 before/after 也才看得出改了什麼。
 */
export async function update(id, data) {
  await repo.update(PATH, id, normalize(data));
  forget();
}

export async function remove(id, reason) {
  await repo.softDelete(PATH, id, reason);
  forget();
}

export async function restore(id) {
  await repo.restore(PATH, id);
  forget();
}
