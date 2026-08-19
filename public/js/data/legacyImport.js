// 舊試算表匯入的寫入端。解析與判斷全部在 domain/legacyImport.js，這裡只負責
// 「把算好的計畫寫進去」，而且照樣走 repo，所以有稽核也軟刪除得掉。

import * as repo from './repo.js';
import * as config from './config.js';
import * as customers from './customers.js';
import { recount } from '../domain/visits.js';

const CUSTOMERS = 'customers';
const VISITS = 'visits';
const entPath = (customerId) => `${CUSTOMERS}/${customerId}/entitlements`;

/**
 * dry-run 與正式匯入都要的對照資料：課程、器材、品項、方案範本，
 * 加上已經在系統裡的客戶（同名的整張跳過）。
 */
export async function loadContext() {
  const [cache, existingCustomers] = await Promise.all([config.loadAll(), customers.list()]);
  return {
    courses: cache.courses,
    equipment: cache.equipment,
    ivProducts: cache.ivProducts,
    plans: cache.plans,
    // 診間與治療師只有合併檔用得到（舊試算表沒記過那兩樣，ADR-0011），
    // 但兩條路共用同一份對照資料 —— 兩支各讀一次主檔只會多一趟往返。
    rooms: cache.rooms,
    staff: cache.staff,
    existingCustomers,
  };
}

/**
 * 寫入一位客戶的整份匯入內容：客戶、額度、來訪，**全部在同一個 commit**。
 *
 * 一位客戶就是一個原子單位。半套的匯入（客戶建好了、額度只進去三筆）比整個失敗
 * 危險得多，因為沒有人會發現 —— 這正是 repo.commit() 存在的理由。所以塞不進
 * 一個 batch 時我們選擇拒絕，不選擇分批。
 *
 * 刻意**不產生任務**：這些掛號在舊系統裡早就做完了，照常產生會長出幾百筆逾期任務
 * 把待辦中心淹掉，而那些事沒有一件真的要做。
 *
 * @param {ReturnType<import('../domain/legacyImport.js').planForSheet>} plan
 * @returns {Promise<{customerId: string, entitlements: number, visits: number}>}
 */
export async function importPlan(plan) {
  if (plan.skip || !plan.customer) throw new Error(`「${plan.sheetName}」被跳過，沒有東西可以寫`);

  const customerId = repo.newId(CUSTOMERS);

  // key → 真正的 id。子集合的路徑需要父文件的 id，所以 id 必須先於寫入存在。
  const idByKey = new Map(plan.entitlements.map((e) => [e.key, repo.newId(entPath(customerId))]));

  const visits = plan.visits.map((visit) => ({
    id: repo.newId(VISITS),
    ...visit,
    customerId,
    slots: visit.slots.map(({ entitlementKey, ...slot }) => ({
      ...slot,
      entitlementId: idByKey.get(entitlementKey) ?? null,
    })),
  }));

  const missing = visits.flatMap((v) => v.slots).filter((s) => !s.entitlementId);
  if (missing.length) throw new Error(`「${plan.sheetName}」有 ${missing.length} 個時段對不到額度`);

  // 計數欄位一律由 domain/visits.js 的 recount() 算，不要在這裡自己數 ——
  // 次數的算法只能有一份（ADR-0004）。
  const counts = recount([...idByKey.values()], visits);

  const ops = [
    { op: 'create', path: CUSTOMERS, id: customerId, data: plan.customer },
    ...plan.entitlements.map((e) => ({
      op: 'create',
      path: entPath(customerId),
      id: idByKey.get(e.key),
      data: { ...e.doc, ...counts[idByKey.get(e.key)] },
    })),
    ...visits.map(({ id, ...data }) => ({ op: 'create', path: VISITS, id, data })),
  ];

  if (ops.length * 2 > 500) {
    throw new Error(
      `「${plan.sheetName}」一次要寫 ${ops.length} 筆，超過單次寫入上限。`
      + '請先把這張工作表拆成兩張再匯一次 —— 分批寫會留下半套資料。',
    );
  }

  await repo.commit(ops);
  return { customerId, entitlements: plan.entitlements.length, visits: visits.length };
}

/**
 * 她從行事曆勾起來的個人行程。
 *
 * 跟客戶那一段不一樣，這裡**刻意分批寫**：個人行程彼此獨立（不綁客戶、不扣次數），
 * 少進去一筆就是少一筆，不會留下半套的資料。客戶那一段之所以拒絕分批，
 * 是因為「客戶建好了、額度只進去三筆」沒有人看得出來。
 */
export async function importEvents(docs, onProgress = null) {
  const CHUNK = 100; // repo.commit 的上限是 250 個操作（每筆佔兩個：本體 + 稽核）
  let done = 0;
  for (let i = 0; i < docs.length; i += CHUNK) {
    const slice = docs.slice(i, i + CHUNK);
    await repo.commit(slice.map((data) => ({ op: 'create', path: 'events', data })));
    done += slice.length;
    onProgress?.(done, docs.length);
  }
  return done;
}

/**
 * 一張一張匯。**一位客戶失敗不會拖垮其他人** —— 每位各自一個 commit，
 * 失敗的那位在結果裡指名道姓，其餘照樣進得去。
 *
 * @param {object[]} plans
 * @param {(done: number, total: number, name: string) => void} [onProgress]
 */
export async function importAll(plans, onProgress = null) {
  const todo = plans.filter((p) => !p.skip && p.customer);
  const results = [];

  for (const [i, plan] of todo.entries()) {
    try {
      const done = await importPlan(plan);
      results.push({ sheetName: plan.sheetName, customerName: plan.customerName, ok: true, ...done });
    } catch (err) {
      results.push({
        sheetName: plan.sheetName,
        customerName: plan.customerName,
        ok: false,
        error: err.message,
      });
    }
    onProgress?.(i + 1, todo.length, plan.customerName);
  }

  return results;
}
