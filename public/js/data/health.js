// 資料健檢的讀取與修正。SPEC 第 6.6 節。
//
// 檢查本身一條規則都不在這裡 —— 那全部在 domain/health.js。這一支只做兩件事：
// 把全庫讀成一份快照，以及把她按下去的那一個修正寫回去。

import * as repo from './repo.js';
import * as config from './config.js';
import { runHealthCheck } from '../domain/health.js';

/**
 * 孤兒檢查要分得出「指向已刪除的」與「指向不存在的」，所以主檔連刪掉的一起讀。
 *
 * `clinicalFlags` 是 2026-09-06 加的：「器材上的提醒詞不在警示名單裡」那一項
 * 要拿它跟器材上的字比一次（ADR-0074）。
 */
const MASTER_FOR_REFS = [
  'courses', 'rooms', 'staff', 'equipment', 'ivProducts', 'clinicalFlags',
];

/** 一次 commit 最多幾筆修正。repo 的上限是 500 個操作，每筆修正佔兩個（本體 + 稽核）。 */
const FIX_CHUNK = 200;

/**
 * 全庫讀一次。這是整個 app 最重的一次讀取，所以只有資料健檢頁與啟動時的背景掃描會呼叫它。
 *
 * 客戶與額度連已刪除的一起讀：資料健檢要判斷「這筆來訪指向的東西還在不在」，
 * 而「被軟刪除」與「根本不存在」是兩種不同的問題，讀不到刪掉的那些就分不出來。
 */
export async function loadSnapshot() {
  const [customers, entitlements, availability, visits, tasks, notes, master] = await Promise.all([
    repo.listWithDeleted('customers'),
    repo.listGroup('entitlements', { includeDeleted: true }),
    repo.listGroup('availability'),
    repo.list('visits'),
    repo.list('tasks'),
    // 隨手記以前不在快照裡，所以它身上的孤兒**一個都看不到** —— 而它現在
    // 扛著兩個職責（日曆上的「待辦」與營養品的交付觸發，ADR-0044、0059），
    // 合併匯入一次還會寫進兩百多筆。指到已刪除額度的那一筆勾下去
    // 什麼都不會寫，而畫面上看起來就只是勾掉了。
    repo.list('notes'),
    loadMaster(),
  ]);

  return {
    customers,
    entitlements: entitlements.map(withCustomerId),
    availability: availability.map(withCustomerId),
    visits,
    tasks,
    notes,
    master,
  };
}

/** 讀一次、算一次。 */
export async function run(today) {
  return runHealthCheck(await loadSnapshot(), today);
}

/**
 * 套用修正。做得出來的是**正解不需要判斷**的那幾種（SPEC 第 6.6 節那三個條件）：
 *
 * - `recount`：計數欄位改成從來訪重算的值。真相永遠是 visits（ADR-0004），
 *   見 docs/adr/0007-health-check-reads-only.md。
 * - `addFollowup`：補上缺的二返額度。次數就是健檢的次數，
 *   見 docs/adr/0023-health-check-can-also-create-the-missing-followup.md。
 * - `renameChartNo`：備註的「姓名欄的編號：」改成「病歷號」，號碼一個字不動，
 *   見 docs/adr/0050-the-health-check-can-rename-an-imported-note.md。
 * - `renamePool`：以前買的復能額度改成新的名字（`復能-三選一(60)`）。
 *   **只改 label**，而且只改得動認得出「歷代自動名字」的那幾筆。
 * - `addAlert`：器材上登記的提醒詞補進警示主檔（ADR-0074）。少了它，
 *   客戶身上那個字在壓表卡片牆上什麼都不會出現。
 * - `addEquipment`：種子資料裡有、主檔沒有的那一台器材（ILIB）。少了它，
 *   加購那一排的「四選一」按不出來（ADR-0077）。
 * - `setDurations`：復能與 ILIB 補上 30／60 兩種規格。少了它，加購時
 *   「幾分鐘」那一排不出現，月檢視也分不出那天排的是 30 還是 60。
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

  // 復能額度改名（issue 09）。**只改 label**，一個別的欄位都不碰 ——
  // 次數與器材那幾格是她談出來的，不是這一顆按鈕該動的東西。
  if (fix?.kind === 'renamePool') {
    return {
      op: 'update',
      path,
      id: fix.entitlementId,
      changes: { label: fix.to },
      note: '資料健檢：復能額度改成新的名字',
    };
  }

  // 器材上的提醒詞補進警示主檔（ADR-0074）。它寫的是主檔不是客戶的額度，
  // 所以跟 `renameChartNo` 一樣在算 path 之後就先岔開。
  if (fix?.kind === 'addAlert') {
    return {
      op: 'create',
      path: 'config/app/clinicalFlags',
      data: fix.data,
      note: '資料健檢：器材上的提醒詞補進警示名單',
    };
  }

  // 診間清單對到建議的樣子（2026-09-08）。三種形狀走同一個 kind，
  // 因為她在畫面上要處理的是同一件事：「把診間主檔對一次答案」。
  //
  // **刪掉走的是這個 app 既有的軟刪除**：進「已刪除項目」，還原得回來。
  // 既有來訪身上還指著它 —— 那幾筆從此印不出診間名字，她 2026-09-08 選的。
  if (fix?.kind === 'applyRoom') {
    const roomPath = 'config/app/rooms';
    if (fix.mode === 'add') {
      return {
        op: 'create', path: roomPath, id: fix.roomId, data: fix.data,
        note: '資料健檢：補上建議清單裡有、主檔沒有的診間',
      };
    }
    if (fix.mode === 'drop') {
      return {
        op: 'softDelete', path: roomPath, id: fix.roomId,
        reason: '資料健檢：新的診間清單上沒有這一間',
        note: '資料健檢：刪掉新清單上沒有的診間',
      };
    }
    return {
      op: 'update', path: roomPath, id: fix.roomId,
      changes: { shortName: fix.shortName },
      note: '資料健檢：診間補上簡寫',
    };
  }

  // 清掉來訪上的床位（2026-09-08：一間就是一個資源）。
  // **整包 slots 寫回去**：時段是內嵌陣列，Firestore 沒辦法只改其中一格。
  // `checkSlotBeds()` 已經把那一份算好了（只有 `bed` 變成 null，其餘原封不動）。
  if (fix?.kind === 'clearBeds') {
    return {
      op: 'update',
      path: 'visits',
      id: fix.visitId,
      changes: { slots: fix.slots },
      note: '資料健檢：清掉來訪上的床位',
    };
  }

  // 器材改名（2026-09-08：全名＝她叫它的名字、別稱＝月曆縮寫）。
  // **只寫那兩格**，器材的課程與要提醒的狀況一個都不碰。
  if (fix?.kind === 'renameEquipment') {
    return {
      op: 'update',
      path: 'config/app/equipment',
      id: fix.equipmentId,
      changes: { name: fix.name, shortName: fix.shortName ?? null },
      note: '資料健檢：器材的名字改成建議值',
    };
  }

  // 課程的指派改成建議值（她 2026-09-08 的三條規則）。
  // **診間限制要一起清**：`validate('courses')` 擋著「不選診間的課程不該設定
  // 診間限制」，只改 `assigns` 的話那一筆之後她一進設定頁就存不下去。
  if (fix?.kind === 'setAssigns') {
    return {
      op: 'update',
      path: 'config/app/courses',
      id: fix.courseId,
      changes: {
        assigns: fix.assigns,
        allowedRoomTypes: fix.allowedRoomTypes ?? [],
        allowedRoomIds: fix.allowedRoomIds ?? [],
      },
      note: '資料健檢：課程的指派改成建議值',
    };
  }

  // 課程補上可選時長（ADR-0077）。**只寫那一格**，課程的其餘欄位一個都不碰。
  if (fix?.kind === 'setDurations') {
    return {
      op: 'update',
      path: 'config/app/courses',
      id: fix.courseId,
      changes: { durationChoices: fix.durationChoices },
      note: '資料健檢：課程補上可選時長',
    };
  }

  // 種子資料裡有、主檔沒有的那一台器材（ILIB）。**id 用種子上的那一個** ——
  // 隨機生一個的話下一次健檢還是會說少一台，而且會再建出第二台。
  if (fix?.kind === 'addEquipment') {
    return {
      op: 'create',
      path: 'config/app/equipment',
      id: fix.equipmentId,
      data: fix.data,
      note: '資料健檢：補上種子資料裡有、主檔沒有的器材',
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
