// 舊試算表匯入的寫入端。解析與判斷全部在 domain/legacyImport.js，這裡只負責
// 「把算好的計畫寫進去」，而且照樣走 repo，所以有稽核也軟刪除得掉。

import * as repo from './repo.js';
import * as config from './config.js';
import * as customers from './customers.js';
import { recount, withSlotStatuses } from '../domain/visits.js';
import { importedTasksFor } from '../domain/taskRules.js';
import { todayISO } from '../domain/dates.js';

const CUSTOMERS = 'customers';
const VISITS = 'visits';
const TASKS = 'tasks';
const entPath = (customerId) => `${CUSTOMERS}/${customerId}/entitlements`;

/**
 * 課程對照表。**連已刪除的一起讀** —— 主檔把課程刪掉，不代表已經排出去的來訪
 * 就不用去掛號了。少讀那一筆的代價是任務被靜默移除，而那正是這個 app 要解決的問題。
 * （同一個判準見 `data/visits.js` 的 `taskOps()`。）
 */
async function loadCoursesById() {
  const courses = await config.listAll('courses', { includeDeleted: true });
  return Object.fromEntries(courses.map((c) => [c.id, c]));
}

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
 * **已經發生的那一筆一張任務都不長，還沒發生的照常長。**
 * 那些掛號在舊系統裡早就做完了，紀錄也早就寫進耀聖了 —— 照常產生會長出
 * 一批一出生就逾期的紅字把待辦中心淹掉。但同一份檔案裡會夾著**還沒發生**的
 * 預約（ADR-0029），而一筆「未來 + 已確認」的來訪正好就是 ADR-0027 說該長
 * 任務的那一種：她要去公司另外兩個系統登記、要確認當天出席簽療程單。
 *
 * 判斷不在這裡寫第二次 —— 這裡呼叫的是 `domain/taskRules.js` 的
 * `importedTasksFor()`，而匯入頁那個數字（`countNewTasks()`）呼叫的是同一支。
 * 2026-09-16 之前這裡直接呼叫 `syncTasksForVisit()`，而紀錄那一族**刻意不走**
 * `acceptsNewTasks()`（ADR-0066）—— 於是她那份 import 會長出 18 張
 * 一出生就逾期的「寫紀錄」，而畫面上那句話寫著「已經發生的一筆都不會長」。
 * 見 `docs/adr/0093-an-imported-visit-grows-no-tasks.md`。
 *
 * @param {ReturnType<import('../domain/legacyImport.js').planForSheet>} plan
 * @param {{coursesById?: Record<string, object>}} [opts] importAll() 讀一次往下傳，省往返
 * @returns {Promise<{customerId: string, entitlements: number, visits: number, tasks: number}>}
 */
export async function importPlan(plan, { coursesById = null } = {}) {
  if (plan.skip || !plan.customer) throw new Error(`「${plan.sheetName}」被跳過，沒有東西可以寫`);

  const customerId = repo.newId(CUSTOMERS);

  // key → 真正的 id。子集合的路徑需要父文件的 id，所以 id 必須先於寫入存在。
  const idByKey = new Map(plan.entitlements.map((e) => [e.key, repo.newId(entPath(customerId))]));

  // 匯進來的每一段也要帶狀態（ADR-0081）。**這一條路不走 `save()`**
  // （它一次寫一整包），所以那個路口補不到它 —— 要在這裡自己補一次。
  const visits = plan.visits.map((visit) => withSlotStatuses({
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

  // 任務跟來訪同一個 commit：分開寫的話來訪進去了、任務失敗，會留下一筆
  // 「看起來已經確認、卻沒有任何登記待辦」的來訪，而那正是她最主要的痛點。
  const today = todayISO();
  const courses = coursesById ?? await loadCoursesById();
  const tasks = visits.flatMap(
    (visit) => importedTasksFor(visit, { coursesById: courses, today }),
  );

  const ops = [
    { op: 'create', path: CUSTOMERS, id: customerId, data: plan.customer },
    ...plan.entitlements.map((e) => ({
      op: 'create',
      path: entPath(customerId),
      id: idByKey.get(e.key),
      data: { ...withFollowupId(e.doc, idByKey), ...counts[idByKey.get(e.key)] },
    })),
    ...visits.map(({ id, ...data }) => ({ op: 'create', path: VISITS, id, data })),
    ...tasks.map((data) => ({ op: 'create', path: TASKS, data })),
  ];

  if (ops.length * 2 > 500) {
    throw new Error(
      `「${plan.customerName || plan.sheetName}」一次要寫 ${ops.length} 筆，超過單次寫入上限。`
      + '整位擋下來是刻意的 —— 分批寫會留下半套資料，而半套沒有人看得出來。'
      + '把這位的資料分成兩份再匯兩次：舊試算表那條路是把工作表拆成兩張，'
      + '合併檔那條路是先刪掉一部分來訪、匯完再貼另一半。',
    );
  }

  await repo.commit(ops);
  return {
    customerId,
    entitlements: plan.entitlements.length,
    visits: visits.length,
    tasks: tasks.length,
  };
}

/**
 * 二返額度指回它是哪一筆健檢配出來的。
 *
 * 計畫裡指的是 key，因為額度的 id 要等這一次寫入才給得出來（子集合的路徑需要
 * 父文件的 id）。指不到的一律寫 null 而不是留著 key —— 存一個換不回 id 的字串，
 * 之後每一次配對比對都會安靜地失敗。
 */
function withFollowupId(doc, idByKey) {
  const { followupForEntitlementKey, ...rest } = doc;
  if (followupForEntitlementKey === undefined) return rest;
  return { ...rest, followupForEntitlementId: idByKey.get(followupForEntitlementKey) ?? null };
}

/**
 * 她從行事曆勾起來的雜事。
 *
 * 跟客戶那一段不一樣，這裡**刻意分批寫**：這些彼此獨立（不綁客戶、不扣次數），
 * 少進去一筆就是少一筆，不會留下半套的資料。客戶那一段之所以拒絕分批，
 * 是因為「客戶建好了、額度只進去三筆」沒有人看得出來。
 */
async function importLoose(path, docs, onProgress = null) {
  const CHUNK = 100; // repo.commit 的上限是 250 個操作（每筆佔兩個：本體 + 稽核）
  let done = 0;
  for (let i = 0; i < docs.length; i += CHUNK) {
    const slice = docs.slice(i, i + CHUNK);
    await repo.commit(slice.map((data) => ({ op: 'create', path, data })));
    done += slice.length;
    onProgress?.(done, docs.length);
  }
  return done;
}

/** 行事備註與休假。兩種都是 `events`，靠 `category` 分（ADR-0045）。 */
export const importEvents = (docs, onProgress = null) => importLoose('events', docs, onProgress);

/**
 * 日曆上的待辦。**它就是隨手記**，所以寫的是 `notes` 不是 `events`
 * —— 日曆上那一類沒有自己的集合（ADR-0044）。
 */
export const importNotes = (docs, onProgress = null) => importLoose('notes', docs, onProgress);

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
  // 21 位客戶讀 21 次主檔只是白跑 20 趟。讀一次往下傳。
  const coursesById = await loadCoursesById();

  for (const [i, plan] of todo.entries()) {
    try {
      const done = await importPlan(plan, { coursesById });
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
