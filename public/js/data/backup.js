// 匯出全部資料為 JSON。SPEC 第 6.8 節。
//
// 這份檔案是最後一道防線：Firestore 的 PITR 要 Blaze 方案，在那之前
// 「每個月手動匯出一份存到雲端硬碟」就是唯一的離線副本。所以它有兩條規矩：
//
// 1. **含已刪除的資料。** 備份漏掉軟刪除的東西，那份備份就救不回誤刪 ——
//    而誤刪正是最需要備份的情境。
// 2. **一筆都不能少。** 舊版只匯出主檔與設定值，客戶、額度、來訪、任務全不在裡面，
//    那份檔案的名字騙人。這裡逐一列出每個集合，新增集合時要回來加。
//
// 稽核紀錄另外算：它每次寫入都追加一筆，累積起來可能比其他資料加起來還大，
// 手機上下載會卡，所以預設不含，由設定頁的勾選框決定。

import * as repo from './repo.js';
import * as config from './config.js';
import { MASTER_TYPES } from '../domain/masterData.js';

/** 匯出格式的版本。之後結構改了，讀舊檔的人要看得出這是哪一版。 */
export const BACKUP_VERSION = 1;

/**
 * @param {{includeAudit?: boolean}} [options]
 * @returns {Promise<object>} 直接 JSON.stringify 就是備份檔
 */
export async function exportAll({ includeAudit = false } = {}) {
  const [master, settings, customers, entitlements, availability, visits, tasks, batches] =
    await Promise.all([
      exportMaster(),
      config.getSettings(),
      repo.listWithDeleted('customers'),
      repo.listGroup('entitlements', { includeDeleted: true }),
      repo.listGroup('availability', { includeDeleted: true }),
      repo.listWithDeleted('visits'),
      repo.listWithDeleted('tasks'),
      repo.listWithDeleted('batches'),
    ]);

  const data = {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    includesDeleted: true,
    settings,
    config: master,
    customers,
    // 子集合攤平存，每筆帶 customerId（listGroup 給的是 parentId），
    // 這樣讀備份的人不用去猜它掛在誰底下。
    entitlements: entitlements.map(withCustomerId),
    availability: availability.map(withCustomerId),
    visits,
    tasks,
    batches,
  };

  if (includeAudit) data.audit = await repo.listWithDeleted('audit', { order: ['at', 'asc'] });

  data.counts = countsOf(data);
  return data;
}

/** 匯出前先讓她知道大概會拿到多大的東西。 */
export function describeCounts(counts) {
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([key, n]) => `${LABELS[key] ?? key} ${n}`)
    .join('・');
}

const LABELS = {
  customers: '客戶',
  entitlements: '額度',
  availability: '可用性收集',
  visits: '來訪',
  tasks: '任務',
  batches: '壓表批次',
  config: '主檔',
  audit: '稽核紀錄',
};

async function exportMaster() {
  const entries = await Promise.all(
    MASTER_TYPES.map(async (type) => [type, await config.listAll(type, { includeDeleted: true })]),
  );
  return Object.fromEntries(entries);
}

function withCustomerId(row) {
  const { parentId, ...rest } = row;
  return { customerId: parentId, ...rest };
}

function countsOf(data) {
  return {
    customers: data.customers.length,
    entitlements: data.entitlements.length,
    availability: data.availability.length,
    visits: data.visits.length,
    tasks: data.tasks.length,
    batches: data.batches.length,
    config: Object.values(data.config).reduce((n, rows) => n + rows.length, 0),
    audit: data.audit?.length ?? 0,
  };
}
