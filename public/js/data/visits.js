// 來訪的存取。
//
// 寫入一律經過 save()：一筆來訪動到的額度計數與它該產生的任務，必須跟它同進同出。
// 計數欄位是快取，真相是來訪本身（見 docs/adr/0004），但快取寫歪了
// 清單頁就會騙人；任務漏產生更糟，那是使用者最主要的痛點。
// 三件事放在同一個 batch 裡，不會只寫進去一半，也不用靠呼叫端記得。

import { where } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

import * as repo from './repo.js';
import * as config from './config.js';
import * as tasksData from './tasks.js';
import * as customersData from './customers.js';
import {
  touchedEntitlementIds, recount, withSlotNotes, withSlotStatuses, withGiftKinds,
} from '../domain/visits.js';
import { syncTasksForVisit, changedTaskKinds, tasksAfterCourseChange } from '../domain/taskRules.js';
import {
  syncFollowupTasks, DEFAULT_FOLLOWUP_DUE_DAYS, DEFAULT_REPORT_DUE_DAYS, pairsOf,
  FOLLOWUP_TASK_KIND, REPORT_TASK_KIND, chainLeftovers,
} from '../domain/followups.js';
import { todayISO, addDays } from '../domain/dates.js';
import { IncompleteReadError, readsIncomplete, readSource } from '../domain/incompleteRead.js';

const PATH = 'visits';
const TASK_PATH = 'tasks';
const entPath = (customerId) => `customers/${customerId}/entitlements`;

export const get = (id) => repo.getOne(PATH, id);

// ---------- 讀不完整就不存（ADR-0158）----------
//
// 存一筆來訪拿呼叫端傳進來的「這位客戶的全部來訪」重算次數、收健檢鏈的待辦。開著本機快取時，離線讀到的
// 只是快取裡剛好有的那幾筆 —— 拿它去算就是少算、把不在手上的那一次健檢的待辦收掉。
//
// **記在這裡，不掛在陣列上**：呼叫端傳進來的常常是 `.filter()`、spread 過的（`[...visits.filter(…), next]`），
// 陣列上的旗標一抄就掉，掉了等於「完整」放行 —— 錯的方向。所以每一次讀這位客戶的全部來訪都記下來源，
// 寫入那幾支問「這一台最近一次讀到的是不是伺服器的」。**呼叫端要在按下去那一刻讀**（打開時讀一次就沿用的話，
// 那一次是快取的就永遠存不進去）—— 要拿去存的那幾條路走 `listWhole()`。

/** customerId → 最近一次讀全部來訪的來源（`'server'`／`'cache'`）。這一台還沒讀過的沒有這一格 */
const visitsRead = new Map();

/** 從伺服器讀回來的那幾份陣列本身（`isWholeList()`）。抄過、濾過的不在裡面 —— 那種當成不知道 */
const wholeLists = new WeakSet();

/**
 * 手上這一份**就是**一次從伺服器讀回來的全部來訪嗎（同一個陣列，沒抄過）。
 * 打開時讀一次就沿用的畫面（來訪編輯器）拿它決定按下去要不要重讀：是的話不用（確認框不晚一拍），
 * 不是（讀到的是快取、或不知道）才重讀（ADR-0158）。
 */
export const isWholeList = (list) => Array.isArray(list) && wholeLists.has(list);

const offlineNow = () => globalThis.navigator?.onLine === false;

/** 從 `since`（那時候 `repo.cacheReads()` 的值）到現在，有沒有任何一次讀取是快取來的 */
const cachedSince = (since) => repo.cacheReads() !== since;

/** 這位客戶這一趟算得出「全部」嗎：確定離線、全部來訪最近一次讀到快取、或 `since` 之後讀的任何一份是快取 → 不完整 */
function incompleteFor(customerId, since) {
  return readsIncomplete({
    offline: offlineNow(),
    sources: [visitsRead.get(customerId), readSource(cachedSince(since))],
  });
}

/** 不完整就丟（`ui/toast.js` 認得它：照講那一句、不給重試） */
function guardWhole(customerId, customerName, since) {
  if (incompleteFor(customerId, since)) throw new IncompleteReadError(customerName);
}

async function readCustomer(customerId) {
  const { rows, fromCache } = await repo.listFrom(PATH, {
    wheres: [where('customerId', '==', customerId)],
    order: ['date', 'desc'],
  });
  visitsRead.set(customerId, readSource(fromCache));
  if (!fromCache) wholeLists.add(rows);
  return rows;
}

/**
 * 某位客戶的全部來訪，新的在前。
 * 需要 (deletedAt, customerId, date desc) 複合索引，已列在 firestore.indexes.json。
 *
 * 讀到的是快取時照樣回（畫面照畫），但會記下來 —— 之後拿它存的那一下會被擋（ADR-0158）。
 */
export async function listByCustomer(customerId) {
  return readCustomer(customerId);
}

/**
 * 同 `listByCustomer()`，**讀不完整就丟 `IncompleteReadError`**（ADR-0158）。要拿去存的那幾條路在按下去那一刻用它：
 * 擋在確認框之前（不要讓她答完幾道框才說存不了），也不用等 SDK 那十秒才發現離線。
 *
 * @param {string} customerId
 * @param {string} [customerName] 那一句講的是誰
 */
export async function listWhole(customerId, customerName = '') {
  if (offlineNow()) throw new IncompleteReadError(customerName);
  const rows = await readCustomer(customerId);
  if (visitsRead.get(customerId) !== 'server') throw new IncompleteReadError(customerName);
  return rows;
}

/**
 * 某個狀態的全部來訪，日期近的在前。
 * 待辦中心用它抓「已壓表、還在等客戶回覆」的那些。
 * 需要 (deletedAt, status, date asc) 複合索引，已列在 firestore.indexes.json。
 */
export function listByStatus(status) {
  return repo.list(PATH, {
    wheres: [where('status', '==', status)],
    order: ['date', 'asc'],
  });
}

/**
 * 日子已經過了、卻還沒結案的來訪。待辦中心的「客人來了嗎」用。
 *
 * 刻意**帶上日期上界**：未來的預約一筆都不需要，而她每天開待辦中心十幾次，
 * 一次抓回整個月的預約等於每次都在為畫不出來的東西付流量
 * —— 而她常常是在大樓裡用行動網路（SPEC 第 6.9 節）。
 *
 * 兩種狀態各查一次而不是用 `in`：吃的是同一個 (deletedAt, status, date asc)
 * 複合索引，那個索引已經在用了，不必為這件事多開一個。
 *
 * 哪幾筆真的要收尾由 `domain/visits.js` 的 `visitsToClose()` 決定，
 * 這裡只負責把可能的那些撈回來 —— 規則不寫在 /data。
 */
export function listUnclosed(today, { tomorrow = false } = {}) {
  // `tomorrow`：待辦首頁「明天」那一格要明天的（issue 11，ADR-0162）。只多撈一天 ——
  // 拿去簽的那幾處照舊過 `visitsToClose()`（`date <= today`），明天的不會被簽成做了
  const through = tomorrow ? addDays(today, 1) : today;
  return Promise.all(
    ['confirmed', 'pending_confirm'].map((status) =>
      repo.list(PATH, {
        wheres: [where('status', '==', status), where('date', '<=', through)],
        order: ['date', 'asc'],
      }),
    ),
  ).then((groups) => groups.flat());
}

/**
 * 一段期間內的全部來訪。壓表模式要用：一次算出「這個月誰還沒排」
 * 與「上次來是多久以前」，不要每位客戶各查一次。
 * 用的是 (deletedAt, date) 複合索引。
 */
export function listBetween(from, to) {
  return repo.list(PATH, {
    wheres: [where('date', '>=', from), where('date', '<=', to)],
    order: ['date', 'asc'],
  });
}

/**
 * 同 `listBetween()`，**讀到的是快取（或離線）就丟 `IncompleteReadError`**（before-golive-2026-10-19 issue 16）。
 * 療程單「全部比對一次」用：拿快取裡剛好有的那幾段去比，少了的會被列成「簽了沒記」。
 */
export async function listBetweenWhole(from, to) {
  const since = repo.cacheReads();
  const rows = await listBetween(from, to);
  if (readsIncomplete({
    offline: globalThis.navigator?.onLine === false,
    sources: [readSource(repo.cacheReads() !== since)],
  })) throw new IncompleteReadError('', '網路不穩，讀到的不是全部的來訪 —— 先不比，連上之後再按一次');
  return rows;
}

/** 試算表往後看多遠的來訪（已排未上的那幾欄）。 */
const SHEET_LOOKAHEAD_DAYS = 400;

/**
 * 試算表要的來訪：**過去的全部**，往後 400 天（2026-10-07，issue 13）。
 *
 * 以前往回也只讀 400 天（「會籍是一年」），而每一筆額度的已完成／已排未上／剩餘是拿**讀到的那幾筆**
 * 現算的 —— 一次來訪落在 400 天以前，試算表上「已完成」就少一次、「剩餘」多一次，而 app 裡的數字是對的。
 * 她選了往回不設限（「好幫我改」）；代價是表會慢慢變寬，一位客戶做過幾天就有幾欄。
 *
 * **自動推送（`sheetSync.js`）與手動貼上（`report.js`）都走這一支** —— 各框一段的話，兩條路的次數會不一樣。
 * 用的是 (deletedAt, date) 複合索引，跟 `listBetween()` 同一份。
 */
export function listForSheet(today) {
  return repo.list(PATH, {
    wheres: [where('date', '<=', addDays(today, SHEET_LOOKAHEAD_DAYS))],
    order: ['date', 'asc'],
  });
}

/** 某一天她自己排的全部來訪。診間與治療師的自撞提示要用。 */
export function listByDate(date) {
  return repo.list(PATH, { wheres: [where('date', '==', date)] });
}

/**
 * 一次抓好幾筆來訪。待辦中心那幾頁要在每一列上寫出「那天壓了幾項」。
 *
 * 任務身上沒有時段數，也**不該有** —— 那會是第二份會對不起來的資料
 *（同 ADR-0004 的判斷：真相是來訪本身）。所以那一頁多讀一次。
 *
 * 讀不到的（被刪了、id 壞了）就少一筆，不要整批失敗：一筆讀不到的代價是
 * 那一列少一個數字，整批失敗的代價是整頁空白。
 *
 * @param {string[]} ids
 * @returns {Promise<Map<string, object>>} id → 來訪
 */
export async function getMany(ids = []) {
  const wanted = [...new Set((ids ?? []).filter(Boolean))];
  const rows = await Promise.all(wanted.map((id) => get(id).catch(() => null)));
  return new Map(rows.filter(Boolean).map((v) => [v.id, v]));
}

/** 已刪除的來訪。設定頁的「已刪除項目」用。 */
export async function listDeleted() {
  return (await repo.listWithDeleted(PATH)).filter((v) => v.deletedAt);
}

// 這些欄位由 repo 維護，不要從畫面上寫回去
function payloadOf(visit) {
  const { id, createdAt, createdBy, updatedAt, deletedAt, ...rest } = visit;
  return rest;
}

/**
 * 存一筆來訪，連同它動到的額度計數。
 *
 * @param {object} visit 要存的內容，沒有 id 就是新增
 * @param {object[]} customerVisits 這位客戶現有的全部來訪（含這一筆的舊版本）
 * @param {{freed?: number[]}} [opts] `freed`：拍 Abovee 時照片上已經放掉的那幾段（位置）——
 *   那幾段的「取消 Abovee」一出生就勾好。**規則在 `taskRules.js` 的 `cancelTasksFor()`**，這裡只負責傳下去
 *   （在這裡事後把任務改成已勾的話，確認框算不到，ADR-0070）
 * @returns {Promise<string>} 來訪 id
 */
export async function save(visit, customerVisits = [], { freed = [] } = {}) {
  // **讀不完整就不存**（ADR-0158）：一進來先問一次（確定離線、這位客戶的全部來訪最近讀到的是快取 → 不讀了，馬上講），
  // 底下自己讀的那幾份（課程、任務、額度）讀完、commit 之前再問一次
  const since = repo.cacheReads();
  guardWhole(visit.customerId, visit.customerName, since);
  const id = visit.id ?? repo.newId(PATH);
  const previous = customerVisits.find((v) => v.id === id) ?? null;
  // **每一段都補上狀態**（ADR-0081）。寫入是唯一的路口，補在這裡就不會有
  // 哪個呼叫端忘了 —— 而少補的那一筆之後逐段取消時，其他段要靠整筆的狀態
  // 去猜，偏偏整筆的狀態正在被改。
  // 三件「她存過一次就補齊」的事走同一個路口：每一段補上狀態（ADR-0081）、
  // 舊資料那一句話搬到第一段（ADR-0084）、送的／體驗寫實（gift-and-trial 01：沒有那一格的舊段
  // 讀的時候照課程猜，存一次就寫死 —— 之後她把那門課的「不算次數」拿掉，那一段照樣存得下去）。
  // 補在這裡就不會有哪個呼叫端忘了。**寫實要課程主檔**，所以課程在這裡先讀（`taskOps()` 接著用同一份）
  const courses = await config.listAll('courses', { includeDeleted: true });
  const coursesById = Object.fromEntries(courses.map((c) => [c.id, c]));
  const next = withGiftKinds(withSlotNotes(withSlotStatuses({ ...visit, id })), coursesById);
  const after = [...customerVisits.filter((v) => v.id !== id), next];

  const ops = [
    previous
      // **手上那一份是什麼時候讀的一起帶下去**：整筆寫回去會把別的地方剛加的那一段蓋掉，
      // `repo.commit()` 看到文件在那之後被改過就不寫（prelaunch-audit-2026-09-23/issues/04）
      ? { op: 'update', path: PATH, id, changes: payloadOf(next), ifUpdatedAt: visit.updatedAt ?? null }
      : { op: 'create', path: PATH, id, data: payloadOf(next) },
    ...countOps(visit.customerId, [previous, next], after),
    ...(await taskOps(next, { isNew: !previous, visitsAfter: after, courses, freed })),
  ];

  guardWhole(visit.customerId, visit.customerName, since);
  await repo.commit(ops);
  return id;
}

/**
 * 「問過了，還在等」那一句（`#/todo/confirm` 那一列上的備註）。
 *
 * **不走 save()。** 那一支的存在理由是「次數與任務必須跟著來訪同進同出」，
 * 而這一句什麼都不動 —— 不改狀態、不扣次數、不產生任務。為了一行字跑一遍
 * 整條管線，要多讀課程、額度、任務三份資料，還會連帶重算計數欄位。
 *
 * 一位客戶好幾天的來訪各自帶一份同樣的字，所以要一次寫完：**一個 commit**
 * 才給得出復原（見 repo.withUndo），分成好幾筆寫的話她按了復原只會退回其中一筆。
 *
 * @param {string[]} visitIds 這位客戶還在等回覆的那幾筆
 * @param {string|null} note 空字串或 null 代表把那一句收掉
 */
export async function setFollowupNote(visitIds, note) {
  const text = String(note ?? '').trim();
  // 收掉的時候連時間戳一起清 —— 留著的話「已等 N 天」會從一個
  // 已經不存在的備註往後算，而畫面上看不出那個數字是打哪來的。
  const changes = text
    ? { followupNote: text, followupAt: new Date().toISOString() }
    : { followupNote: null, followupAt: null };

  await repo.commit(visitIds.map((id) => ({ op: 'update', path: PATH, id, changes })));
}

/** 軟刪除一筆來訪。次數要跟著還回去，任務也要跟著收掉。 */
export async function remove(visit, customerVisits = [], reason = null) {
  // 讀不完整就不寫（ADR-0158，同 `save()`）。現在沒有呼叫端，守門照樣放著
  const since = repo.cacheReads();
  guardWhole(visit.customerId, visit.customerName, since);
  const rest = customerVisits.filter((v) => v.id !== visit.id);
  const ops = [
    { op: 'softDelete', path: PATH, id: visit.id, reason },
    ...countOps(visit.customerId, [visit], rest),
    ...(await taskOps({ ...visit, deletedAt: 'pending' }, { visitsAfter: rest })),
  ];
  guardWhole(visit.customerId, visit.customerName, since);
  await repo.commit(ops);
}

export async function restore(visit, customerVisits = []) {
  // 讀不完整就不寫（ADR-0158，同 `save()`）：還原會把次數一起還原回去
  const since = repo.cacheReads();
  guardWhole(visit.customerId, visit.customerName, since);
  const next = { ...visit, deletedAt: null };
  const after = [...customerVisits.filter((v) => v.id !== visit.id), next];
  const ops = [
    { op: 'update', path: PATH, id: visit.id, changes: { deletedAt: null } },
    ...countOps(visit.customerId, [visit], after),
    ...(await taskOps(next, { visitsAfter: after })),
  ];
  guardWhole(visit.customerId, visit.customerName, since);
  await repo.commit(ops);
}

/**
 * 這筆來訪存下去之後，任務要跟著怎麼動。
 *
 * 課程刻意連已刪除的一起讀：主檔把課程刪掉，不代表已經排出去的來訪就不用去掛號了。
 * 少讀那一筆的代價是任務被靜默移除，那正是這個 app 要解決的問題。
 *
 * **任務也是**（`listByVisitForSync()`，2026-09-16）：她在待辦中心「清掉」的
 * 那幾張是軟刪除，而比對問的是「這件事有沒有人做過」—— 看不到它們的話，
 * 同一筆來訪再存一次就會把已經做過的登記與取消重新長一次。
 */
async function taskOps(visit, { isNew = false, visitsAfter = null, courses: known = null, freed = [] } = {}) {
  const [existing, courses] = await Promise.all([
    isNew ? [] : tasksData.listByVisitForSync(visit.id),
    known ?? config.listAll('courses', { includeDeleted: true }),
  ]);

  const coursesById = Object.fromEntries(courses.map((c) => [c.id, c]));

  const { create, update, remove: gone } = syncTasksForVisit(visit, existing, {
    coursesById,
    today: todayISO(),
    freed,
  });

  return [
    ...toOps({ create, update, remove: gone }),
    ...(visitsAfter ? await followupOps(visit, visitsAfter, coursesById) : []),
  ];
}

/**
 * 「約二返」的待辦。跟上面那一段分開，因為它的視野不一樣。
 *
 * 掛號類的任務只看這一筆來訪：這次來訪有哪些課程，就該有哪些任務。
 * 「約二返」看的是整位客戶：買了 3 次健檢就有 3 次二返，做完第二次健檢時
 * 該不該長出待辦，取決於前面兩次的二返約掉了沒 —— 那是一筆來訪答不出來的問題。
 *
 * 所以這裡多讀三樣東西（這位客戶的額度、這位客戶的任務、設定裡的間隔），
 * 而且**每次存來訪都跑**，不是只在健檢那一筆上跑 —— 二返被約走的時候，
 * 要被收掉的待辦掛在另一筆來訪上（那次健檢），只看眼前這一筆看不到它。
 *
 * 規則本身一條都不在這裡，全部在 domain/followups.js。
 */
async function followupOps(visit, visitsAfter, coursesById) {
  // 主檔裡沒有任何課程設了「做完還要再約一次」就直接跳過，省下三次讀取。
  // 這是唯一安全的提前結束：沒有配對規則就不可能有配對，也就不可能有待辦。
  const hasPairing = Object.values(coursesById).some((c) => c?.followupCourseId);
  if (!hasPairing) return [];

  const [entitlements, tasks, settings] = await Promise.all([
    customersData.listEntitlements(visit.customerId),
    tasksData.listByCustomerForSync(visit.customerId),
    config.getSettings(),
  ]);

  return toOps(
    syncFollowupTasks({
      customer: { id: visit.customerId, name: visit.customerName ?? null },
      entitlements,
      visits: visitsAfter,
      tasks,
      coursesById,
      dueDays: settings.followupDueDays ?? DEFAULT_FOLLOWUP_DUE_DAYS,
      reportDueDays: settings.reportDueDays ?? DEFAULT_REPORT_DUE_DAYS,
    }),
  );
}

/**
 * 健檢或二返的額度變了（加購、補一筆、改次數、刪掉、還原、資料健檢補上）：健檢那條鏈的待辦跟著重算（ADR-0159）。
 *
 * 以前只有存來訪、勾鏈上待辦的那一下才算 —— 補了二返額度之後，那一次健檢的「約二返」要等她下一次存這位客人的某一筆來訪
 * 才長出來；把次數改少，多出來的那一張一直掛著。**寫入與確認框都叫這一支**：寫的那一下把 `ops` 跟額度放進同一個 commit，
 * 確認框拿 `plan` 講（`consequences.js` 的 `chainPlanLines()`，ADR-0070）。
 *
 * - **動到的不是健檢或二返就不讀、不算**（`null`）：加購營養品、改復能的次數跟這一條鏈無關，不多打四次讀取
 * - **讀不完整就不算**（`null`，ADR-0158 反過來用）：寫額度本身不吃來訪，額度照寫；那一串等下一次存來訪再算
 *
 * @param {string} customerId
 * @param {(before: object[]) => object[]} change 讀回來的額度（沒刪掉的）→ 寫完之後的樣子。新建的那幾筆要先有 id
 * @param {{name?: string|null}} [o] 待辦上印的客戶名字
 * @returns {Promise<{ops: object[], plan: object, visits: object[], tasks: object[]}|null>}
 */
export async function chainAfterEntitlements(customerId, change, { name = null } = {}) {
  if (!customerId || offlineNow()) return null;
  const since = repo.cacheReads();
  const courses = await config.listAll('courses', { includeDeleted: true });
  const coursesById = Object.fromEntries(courses.map((c) => [c.id, c]));
  if (!Object.values(coursesById).some((c) => c?.followupCourseId)) return null;

  const before = await customersData.listEntitlements(customerId);
  const after = change(before);
  // 這一下動到的那幾筆（新的、刪掉的、內容變了的）裡有沒有健檢或二返
  const inChain = (list) => new Set(pairsOf(list, coursesById).filter((p) => p.followup)
    .flatMap((p) => [p.source.id, p.followup.id]));
  const chainIds = new Set([...inChain(before), ...inChain(after)]);
  const was = new Map(before.map((e) => [e.id, JSON.stringify(e)]));
  const now = new Map(after.map((e) => [e.id, JSON.stringify(e)]));
  const touched = [...new Set([...was.keys(), ...now.keys()])].filter((id) => was.get(id) !== now.get(id));
  if (!touched.some((id) => chainIds.has(id))) return null;

  const [visits, tasks, settings] = await Promise.all([
    listByCustomer(customerId),
    tasksData.listByCustomerForSync(customerId),
    config.getSettings(),
  ]);
  if (incompleteFor(customerId, since)) return null;

  const plan = syncFollowupTasks({
    customer: { id: customerId, name: name ?? visits.find((v) => v.customerName)?.customerName ?? null },
    entitlements: after,
    visits,
    tasks,
    coursesById,
    dueDays: settings.followupDueDays ?? DEFAULT_FOLLOWUP_DUE_DAYS,
    reportDueDays: settings.reportDueDays ?? DEFAULT_REPORT_DUE_DAYS,
  });
  return { ops: toOps(plan), plan, visits, tasks };
}

/**
 * 確認框要試算健檢那條鏈時讀的那兩份：這位客戶的額度、任務（連清掉的，ADR-0106）——
 * 跟存檔時 `followupOps()` 讀的是同一份（ADR-0070）。**沒有健檢配二返就回 `null`**，不多讀任務；讀不到也是 `null`（少講幾句，不擋）。
 * 用的是 `consequences.js` 的 `cancelConsequences({ chain })` 與 `followupBookingLines()`。
 */
export async function chainInputs(customerId, coursesById = {}) {
  if (!customerId || !Object.values(coursesById).some((c) => c?.followupCourseId)) return null;
  // 讀到快取的也當讀不到（ADR-0158）：少講幾句，不講錯的 —— 真的存的那一下會擋
  const since = repo.cacheReads();
  try {
    const entitlements = await customersData.listEntitlements(customerId);
    if (!pairsOf(entitlements, coursesById).some((p) => p.followup)) return null;
    const tasks = await tasksData.listByCustomerForSync(customerId);
    if (readsIncomplete({ offline: offlineNow(), sources: [readSource(cachedSince(since))] })) return null;
    return { entitlements, tasks };
  } catch {
    return null;
  }
}

/**
 * 拍 Abovee 一位的那幾筆**全部存完之後**，收掉中途長出來、最後的樣子用不到的健檢鏈待辦（規則在 `followups.js` 的 `chainLeftovers()`）。
 * `known`：存之前就有的那幾張的 id（確認層第一次按「記錄」時讀的 `chainInputs()`）。收掉是軟刪除、沒勾過 —— `seenTasks()` 當成沒有過。
 * 讀不到、寫不進去就算了（多一張可以勾掉），不擋已經記好的來訪。
 *
 * @returns {Promise<number>} 收掉幾張
 */
export async function dropChainLeftovers(customerId, known, coursesById = {}) {
  if (!customerId || !Object.values(coursesById).some((c) => c?.followupCourseId)) return 0;
  const since = repo.cacheReads();
  const [entitlements, tasks, visits] = await Promise.all([
    customersData.listEntitlements(customerId),
    tasksData.listByCustomerForSync(customerId),
    listByCustomer(customerId),
  ]);
  // 讀不完整就一張都不收（ADR-0158）：不在手上的那一次健檢會被當成「用不到」—— 多一張可以勾掉，收錯的沒人提醒
  if (incompleteFor(customerId, since)) return 0;
  const extra = chainLeftovers({ customer: { id: customerId }, entitlements, visits, tasks, known, coursesById });
  if (!extra.length) return 0;
  await repo.commit(extra.map((t) => ({
    op: 'softDelete', path: TASK_PATH, id: t.id, reason: '拍 Abovee 一次記好幾段，存到一半時長出來、存完用不到',
  })));
  return extra.length;
}

/**
 * 勾掉（或拿回來）一張健檢鏈上的待辦之後，鏈條該變成什麼樣。
 *
 * 這一支存在的理由：`syncFollowupTasks()` 算得出「報告勾掉了 → 該長出約二返」，
 * 但**在 2026-08-25 之前沒有人在勾掉的那一刻叫它** —— 它三個呼叫端全部在
 * `save()` / `remove()` / `restore()` 底下。所以她勾掉「追蹤健檢報告」之後
 * 什麼都不會發生，要等這位客戶下一次有來訪被存檔，「約二返」才會突然冒出來，
 * 而且死線是從報告勾掉那天回推的 —— 它可能一出生就是紅字。
 *
 * 回傳的是**操作**不是寫入，所以呼叫端（`data/tasks.js` 的 `setDone()`）
 * 可以把它跟那幾筆勾選放進同一個 commit：
 *
 * - 不會出現「勾好了但約二返沒長出來」的半套狀態
 * - 復原退得回整組（一個動作一個 commit 才給得出復原，見 repo.withUndo）
 *
 * @param {object[]} changed 這幾筆任務**寫入之後**的樣子（要有 id、kind、
 *   customerId、done、doneAt）
 * @returns {Promise<object[]>} 要一起寫的操作，沒有就是空陣列
 */
export async function followupOpsAfterTaskChange(changed = []) {
  const plans = await chainPlans(changed);
  // 讀不完整就連勾選一起不寫（ADR-0158）：照快取算的鏈條會把不在手上的那一次健檢的待辦收掉
  const partial = plans.find((p) => !p.whole);
  if (partial) throw new IncompleteReadError(partial.customerName);
  return plans.flatMap((p) => toOps(p.plan));
}

/**
 * **同一台引擎，只看不寫。** 二次確認框要講「這一下會少哪幾張」，
 * 而那個答案 `syncFollowupTasks()` 每次勾選都已經在算了。
 *
 * 照著它的規則在畫面上再推論一次是這個 repo 已經付過帳的形狀 ——
 * `domain/consequences.js` 的檔頭就是為了同一件事而存在的（兩個入口各自
 * 寫死「Abovee」，而健檢壓的是 Examine）。所以這一支跟
 * `followupOpsAfterTaskChange()` 共用 `chainPlans()`，差別只有 return 不 commit。
 *
 * 代價是**多打一輪讀取**（確認框一次、真的寫的時候一次）。只有鏈上那兩種
 * 待辦會走到這裡，而她一天拿回來的次數是個位數。
 *
 * @param {object} task 那一張待辦（勾選**之前**的樣子）
 * @param {boolean} done 要變成什麼
 * @returns {Promise<{create:object[], remove:object[], tasksBefore:object[],
 *                    visits:object[], entitlements:object[], coursesById:object}|null>}
 *   不是鏈上那兩種、或主檔裡沒有配對規則時回 `null` —— **那代表「不用問」**，
 *   跟「問完沒有東西會變」是兩件事。
 */
export async function previewTaskChange(task, done) {
  if (!task?.id) return null;
  const after = { ...task, done, doneAt: done ? new Date().toISOString() : null };
  const plans = await chainPlans([after]);
  const mine = plans[0];
  if (!mine) return null;
  // 照快取算的後果不講（ADR-0158）：呼叫端（`confirmUntick()`）讀不到就放行，真的寫的那一下會擋
  if (!mine.whole) throw new IncompleteReadError(mine.customerName);

  return {
    create: mine.plan.create ?? [],
    remove: (mine.plan.remove ?? []).map((r) => ({
      ...r,
      // 收掉的是哪一種、掛在哪一筆來訪上 —— 確認框要講得出來，
      // 而 `remove` 身上只有 id 與理由。
      ...(mine.tasksBefore.find((t) => t.id === r.id) ?? {}),
    })),
    tasksBefore: mine.tasksBefore,
    visits: mine.visits,
    entitlements: mine.entitlements,
    coursesById: mine.coursesById,
  };
}

/**
 * 鏈上那幾張待辦被勾／被拿回來之後，每一位客戶的鏈條該長什麼樣。
 *
 * 寫入（`followupOpsAfterTaskChange()`）與預覽（`previewTaskChange()`）
 * **共用這一支**。兩份實作遲早會有一份跟 `syncFollowupTasks()` 分岔，
 * 而分岔的症狀是「確認框說會收掉兩張，實際上收掉三張」—— 那比不講還糟。
 */
async function chainPlans(changed = []) {
  // 寄報告那一張刻意**不在這裡**：勾掉它不會讓鏈條上任何東西改變
  //（`syncFollowupTasks()` 的第二圈只看報告那一張勾了沒），
  // 放進來只會讓每一次勾掉它都多打三次讀取。ADR-0065。
  const chainKinds = [FOLLOWUP_TASK_KIND, REPORT_TASK_KIND];
  const rows = (changed ?? []).filter((t) => t?.customerId && chainKinds.includes(t.kind));
  // 勾一批 Examine 不該為了這件事多打好幾次往返。
  if (!rows.length) return [];
  // 確定離線：鏈上那兩種的勾選要整位客戶的來訪才算得對（ADR-0158）—— 不讀了，馬上講（不等 SDK 那十秒）
  if (offlineNow()) throw new IncompleteReadError(rows[0].customerName);

  const since = repo.cacheReads();
  const courses = await config.listAll('courses', { includeDeleted: true });
  const coursesById = Object.fromEntries(courses.map((c) => [c.id, c]));
  // 主檔裡沒有任何課程設了「做完還要再約一次」就不可能有配對（同 followupOps）。
  if (!Object.values(coursesById).some((c) => c?.followupCourseId)) return [];

  const settings = await config.getSettings();
  const byCustomer = new Map();
  for (const t of rows) {
    if (!byCustomer.has(t.customerId)) byCustomer.set(t.customerId, []);
    byCustomer.get(t.customerId).push(t);
  }

  const out = [];
  for (const [customerId, mine] of byCustomer) {
    // eslint-disable-next-line no-await-in-loop
    const [entitlements, tasks, visits] = await Promise.all([
      customersData.listEntitlements(customerId),
      tasksData.listByCustomerForSync(customerId),
      listByCustomer(customerId),
    ]);

    // **算的是「寫進去之後」的世界**：那幾筆勾選還沒 commit，直接把讀回來的
    // 那一份就地換成新的樣子。不這樣做的話 syncFollowupTasks() 看到的報告
    // 還是未完成的，於是它會說「現在該有的是追蹤報告」，什麼都不長。
    const patched = new Map(mine.map((t) => [t.id, t]));
    const after = tasks.map((t) => (patched.has(t.id) ? { ...t, ...patched.get(t.id) } : t));

    const customerName = mine.find((t) => t.customerName)?.customerName
      ?? visits.find((v) => v.customerName)?.customerName ?? null;
    out.push({
      customerId,
      customerName,
      // 這一位的那幾份（課程、額度、任務、全部來訪）是不是都是伺服器的（ADR-0158）。寫入那一支看到 false 就丟
      whole: !incompleteFor(customerId, since),
      tasksBefore: tasks,
      visits,
      entitlements,
      coursesById,
      plan: syncFollowupTasks({
        customer: { id: customerId, name: customerName },
        entitlements,
        visits,
        tasks: after,
        coursesById,
        dueDays: settings.followupDueDays ?? DEFAULT_FOLLOWUP_DUE_DAYS,
        reportDueDays: settings.reportDueDays ?? DEFAULT_REPORT_DUE_DAYS,
      }),
    });
  }

  return out;
}

// ---------- 改了課程的設定之後回頭重算（ADR-0140）----------

/** 一個 commit 最多放幾個操作。`repo.commit()` 的上限是 250（每一筆連稽核佔兩個），留一點餘裕。 */
const OPS_PER_COMMIT = 200;

/**
 * 一門課「壓哪幾個系統」或「寫紀錄」改了：哪幾筆來訪的待辦要跟著動。**只算不寫。**
 *
 * 待辦是存來訪時才算的，所以改了課程，已經談定的那幾筆要等下次被存 —— 通常就是簽療程單，
 * 而那時那一段已經不是「已確認」，掛號那一族就不長了。這一支替那幾筆先算一次。
 *
 * **只算任務，來訪一個字都不讀來寫**：不走上面存來訪的那條路。那一條會換 `updatedAt`
 * （別台開著的抽屜全部變舊）、補段落狀態、重算次數、每筆多跑一次健檢鏈、每筆一則稽核，
 * 而來訪本身一個字都沒變。任務的規則照舊只在 `domain/taskRules.js`（`tasksAfterCourseChange()`）。
 *
 * 兩側從不同的地方出發：
 *
 * - **長的那一側從還開著的來訪**（已確認＋待確認兩種整筆狀態，沒有日期上界）。整筆的狀態是推導的，
 *   兩種合起來才涵蓋每一段還開著的。不用「今天以前還沒結案」的那一支 —— 它只回今天以前的，
 *   正好是那一天已經過了、不長的那幾天（ADR-0113）
 * - **收的那一側從還沒勾的任務**（→ 它們的來訪）：「寫紀錄」是那一段做完才長的，開著的那幾張多半
 *   掛在已經結案的來訪上，只看還開著的來訪收不到它們。沒有任何一種要收時這一份不讀
 *
 * 任務連清掉的一起讀（ADR-0106），跟存來訪時比對的是同一份。
 *
 * @param {object} before 存之前的課程（要有 id）
 * @param {object} changes 要寫進去的那幾格（`config.update()` 是合併寫入）
 * @returns {Promise<{rows: {visitId:string, create:object[], update:object[],
 *                    remove:{id:string, reason:string, kind:string}[]}[]}>} 只回真的有東西要動的那幾筆
 */
export async function courseTaskPlan(before, changes) {
  const after = { ...before, ...changes };
  const { grown, dropped } = changedTaskKinds(before, after);
  if (!grown.length && !dropped.length) return { rows: [] };

  const uses = (v) => !v?.deletedAt && (v?.slots ?? []).some((s) => s?.courseId === after.id);

  const [confirmed, pending, openTasks, courses] = await Promise.all([
    listByStatus('confirmed'),
    listByStatus('pending_confirm'),
    dropped.length ? tasksData.listOpen() : [],
    config.listAll('courses', { includeDeleted: true }),
  ]);
  const visits = new Map([...confirmed, ...pending].filter(uses).map((v) => [v.id, v]));

  const elsewhere = openTasks
    .filter((t) => t.autoGenerated && t.visitId && dropped.includes(t.kind) && !visits.has(t.visitId))
    .map((t) => t.visitId);
  for (const v of (await getMany(elsewhere)).values()) if (uses(v)) visits.set(v.id, v);

  const coursesById = { ...Object.fromEntries(courses.map((c) => [c.id, c])), [after.id]: after };
  const today = todayISO();

  const rows = await Promise.all([...visits.values()].map(async (visit) => {
    const existing = await tasksData.listByVisitForSync(visit.id);
    const plan = tasksAfterCourseChange(visit, existing, { before, after, coursesById, today });
    // 收掉的是哪一種 —— 確認框要講得出來，而 `remove` 身上只有 id 與理由
    const kindOf = new Map(existing.map((t) => [t.id, t.kind]));
    return {
      visitId: visit.id,
      ...plan,
      remove: plan.remove.map((r) => ({ ...r, kind: kindOf.get(r.id) })),
    };
  }));

  return { rows: rows.filter((r) => r.create.length + r.update.length + r.remove.length > 0) };
}

/**
 * 存一門既有的課程，連同它讓哪幾張待辦跟著變（ADR-0140）。
 *
 * **寫的那一刻重算一次**，不拿確認框那一份來寫：中間別台可能剛替其中一天掛好號，
 * 照舊的那一份寫會多長一張。重算也讓這一支**按幾次都一樣** —— 長過的那一段已經被蓋到、
 * 收過的那一張已經不在，再跑一次什麼都不動。
 *
 * **課程本身放在最後一個 commit 裡。** 待辦的操作多到一個 commit 放不下時會分批，
 * 而「這門課變了沒」是下一次存檔要不要重算的依據：先寫課程、待辦寫到一半失敗的話，
 * 她再存一次時課程已經是新的、看起來什麼都沒變，剩下的那幾天就再也沒有人去補。
 * 放最後，沒寫完之前課程都還是舊的，重按就接著做完。
 * 放得下的時候（平常都是）整件事是同一個 commit：一起成功、一起失敗、復原退得回整組。
 *
 * @returns {Promise<number>} 幾筆來訪的待辦跟著動了
 */
export async function saveCourseWithTasks(before, changes) {
  const { rows } = await courseTaskPlan(before, changes);
  const ops = [...rows.flatMap((r) => toOps(r)), config.updateOp('courses', before.id, changes)];
  for (let i = 0; i < ops.length; i += OPS_PER_COMMIT) {
    // eslint-disable-next-line no-await-in-loop
    await repo.commit(ops.slice(i, i + OPS_PER_COMMIT));
  }
  return rows.length;
}

function toOps({ create = [], update = [], remove = [] }) {
  return [
    ...create.map((data) => ({ op: 'create', path: TASK_PATH, data })),
    ...update.map((u) => ({ op: 'update', path: TASK_PATH, id: u.id, changes: u.changes })),
    ...remove.map((r) => ({ op: 'softDelete', path: TASK_PATH, id: r.id, reason: r.reason })),
  ];
}

function countOps(customerId, touched, visitsAfter) {
  const ids = touchedEntitlementIds(...touched.filter(Boolean));
  const recounted = recount(ids, visitsAfter);
  const at = new Date().toISOString();
  return ids.map((entId) => ({
    op: 'update',
    path: entPath(customerId),
    id: entId,
    changes: { ...recounted[entId], lastReconciledAt: at },
  }));
}
