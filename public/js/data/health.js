// 資料健檢的讀取與修正。SPEC 第 6.6 節。
//
// 檢查本身一條規則都不在這裡 —— 那全部在 domain/health.js。這一支只做兩件事：
// 把全庫讀成一份快照，以及把她按下去的那一個修正寫回去。

import * as repo from './repo.js';
import * as config from './config.js';
import { runHealthCheck } from '../domain/health.js';

/** 孤兒檢查要分得出「指向已刪除的」與「指向不存在的」，所以主檔連刪掉的一起讀。 */
const MASTER_FOR_REFS = ['courses', 'rooms', 'staff', 'equipment', 'ivProducts'];

/** 一次 commit 最多幾筆修正。repo 的上限是 500 個操作，每筆修正佔兩個（本體 + 稽核）。 */
const FIX_CHUNK = 200;

/**
 * 全庫讀一次。這是整個 app 最重的一次讀取，所以只有資料健檢頁與啟動時的背景掃描會呼叫它。
 *
 * 客戶與額度連已刪除的一起讀：資料健檢要判斷「這筆來訪指向的東西還在不在」，
 * 而「被軟刪除」與「根本不存在」是兩種不同的問題，讀不到刪掉的那些就分不出來。
 */
export async function loadSnapshot() {
  const [customers, entitlements, availability, visits, tasks, master] = await Promise.all([
    repo.listWithDeleted('customers'),
    repo.listGroup('entitlements', { includeDeleted: true }),
    repo.listGroup('availability'),
    repo.list('visits'),
    repo.list('tasks'),
    loadMaster(),
  ]);

  return {
    customers,
    entitlements: entitlements.map(withCustomerId),
    availability: availability.map(withCustomerId),
    visits,
    tasks,
    master,
  };
}

/** 讀一次、算一次。 */
export async function run(today) {
  return runHealthCheck(await loadSnapshot(), today);
}

/**
 * 套用修正。只有兩種修正做得出來，因為只有它們的正解不需要判斷：
 *
 * - `recount`：計數欄位改成從來訪重算的值。真相永遠是 visits（ADR-0004），
 *   見 docs/adr/0007-health-check-reads-only.md。
 * - `addFollowup`：補上缺的二返額度。次數就是健檢的次數，
 *   見 docs/adr/0023-health-check-can-also-create-the-missing-followup.md。
 *
 * 其餘的檢查一律只顯示差異：過期的來訪該標 done 還是 no_show、撞在一起的
 * 兩筆該動哪一筆，都是 app 看不到 Abovee 就答不出來的問題（ADR-0002）。
 *
 * 一批寫在同一個 commit 裡，所以復原是把整批一起退回去 —— 一次修 12 筆之後
 * 只退得回其中一筆，比不能復原還危險。
 *
 * @param {object[]} fixes domain/health.js 的 finding.fix
 * @returns {Promise<number>} 實際寫了幾筆
 */
export async function applyFixes(fixes) {
  const ops = (fixes ?? []).map(opFor).filter(Boolean);

  for (let i = 0; i < ops.length; i += FIX_CHUNK) {
    await repo.commit(ops.slice(i, i + FIX_CHUNK));
  }
  return ops.length;
}

function opFor(fix) {
  const path = `customers/${fix?.customerId}/entitlements`;

  // 這一個寫的是客戶本人，不是他的額度 —— 所以在算 path 之後就先岔開。
  if (fix?.kind === 'renameChartNo') {
    return {
      op: 'update',
      path: 'customers',
      id: fix.customerId,
      changes: fix.changes,
      note: '資料健檢：備註的「姓名欄的編號」改成「病歷號」',
    };
  }

  if (fix?.kind === 'recount') {
    return {
      op: 'update',
      path,
      id: fix.entitlementId,
      changes: {
        doneCount: fix.to.done,
        bookedCount: fix.to.booked,
        lastReconciledAt: new Date().toISOString(),
      },
      note: '資料健檢：計數欄位改成從來訪重算的值',
    };
  }

  if (fix?.kind === 'addFollowup') {
    return {
      op: 'create',
      path,
      data: fix.draft,
      note: '資料健檢：補上這筆健檢對應的二返額度',
    };
  }

  return null;
}

async function loadMaster() {
  const entries = await Promise.all(
    MASTER_FOR_REFS.map(async (type) => [
      type,
      await config.listAll(type, { includeDeleted: true }),
    ]),
  );
  return Object.fromEntries(entries);
}

function withCustomerId(row) {
  const { parentId, ...rest } = row;
  return { customerId: parentId, ...rest };
}
