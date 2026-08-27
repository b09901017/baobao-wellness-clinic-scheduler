// 「按下去之後會發生什麼」。純函式。
//
// 她的原話：
//
// > 我希望與其寫一些我看不太懂得系統說明，我希望也許可以簡單直白的寫接者會產生甚麼?
//
// 所以每一句後果說明都要回答四件事，有的就寫、沒有的不寫：
//
//   1. **記到哪裡** —— 「會記到日曆上」
//   2. **狀態變成什麼** —— 「標成待確認」
//   3. **產生哪一張待辦** —— 「待辦會多一張『跟客人確認時間』」
//   4. **試算表會不會動** —— 「十秒後自動同步到試算表」
//
// 第 4 項全站從來沒有講過（`data/sheetSync.js` 每次寫入成功後十秒自動推一次
// 整包，但畫面上一個字都沒說）。她問「對了剛剛都沒說到修試算表」。
//
// ## 為什麼是一支 domain 檔而不是各頁自己寫
//
// 同一道確認出現在兩個入口（壓表那一頁與來訪編輯器），而它們**各自寫死了
// 「Abovee」** —— 健檢壓的是 Examine，所以那一句在健檢上是錯的，而且錯了兩次。
// 判斷早就有了（`taskRules.js` 的 `bookingSystemFor()`），只是沒有人用它。
//
// 兩邊各寫一次的下場已經看到了，所以這裡就是那一份。
//
// 見 docs/adr/0056（哪幾句該留）與 `.scratch/followup-and-products/issues/07`。

import { bookingSystemFor, tasksForCategory } from './taskRules.js';
import { describeStatus, shortStatus, INITIAL_STATUS, formSlotIndexes } from './visits.js';
import { pairsOf, REPORT_TASK_KIND } from './followups.js';

/** 十秒是 `data/sheetSync.js` 的 `QUIET_MS`。兩邊要一起改。 */
const SHEET_LINE = '十秒後自動同步到試算表';

/**
 * 這一筆來訪動到了哪幾個系統的壓表登記，寫成一句人看得懂的話。
 *
 * 一筆來訪可以同時有健檢（Examine）與復能（Abovee）—— 那時候兩個都要講，
 * 因為她真的要去兩個地方壓。
 *
 * @param {{slots?: {courseId?: string}[]}} visit
 * @param {Record<string, {category?: string}>} coursesById
 * @returns {string} 例：`Abovee`、`Examine`、`Abovee 與 Examine`
 */
export function bookingSystemLabel(visit, coursesById = {}) {
  const names = [...new Set(
    (visit?.slots ?? []).map((s) => bookingSystemFor(coursesById[s.courseId]?.category)),
  )];
  return names.join(' 與 ');
}

/**
 * 這一筆來訪確認之後會長出哪幾種登記待辦。
 *
 * 講的是**還沒發生但會發生**的事，所以只有真的有東西時才講 ——
 * 健檢（B 類）的 `onConfirm` 是空的，硬寫一句「等客人確認之後才產生」
 * 就是在講一件不會發生的事，而那正是她說看不懂的那一句。
 */
export function pendingRegistrations(visit, coursesById = {}) {
  const kinds = new Set();
  for (const slot of visit?.slots ?? []) {
    for (const kind of tasksForCategory(coursesById[slot.courseId]?.category)) kinds.add(kind);
  }
  return [...kinds];
}

/**
 * 「已經在 X 壓好表了嗎？」那一道確認要講的話。
 *
 * 只回**後果**那幾行，不回「誰、什麼時候、做什麼」那一行 —— 那一行要把課程、
 * 診間、器材、醫師的 id 換成名字，而那份主檔在畫面那一層。呼叫端自己組完
 * 放在前面。
 *
 * @param {object} o
 * @param {object} o.visit 要存下去的那一筆（已經含新加的時段）
 * @param {Record<string, object>} o.coursesById
 * @param {{reopened: boolean}|null} [o.merge] 併進同一天既有的那一筆時給，否則 null
 * @param {boolean} [o.sheetSyncOn] 試算表同步有沒有設定好
 * @returns {{title: string, lines: string[]}}
 */
export function bookingConsequences({ visit, coursesById = {}, merge = null, sheetSyncOn = false }) {
  const where = bookingSystemLabel(visit, coursesById);
  const lines = [];
  const slots = (visit?.slots ?? []).length;

  if (!merge) {
    lines.push('會記到日曆上，標成「待確認」');
    lines.push('待辦會多一張「跟客人確認時間」');
  } else if (merge.reopened) {
    lines.push(`這一段會併進同一天已經有的來訪裡，那天變成 ${slots} 段`);
    // 這一句是這一輪的重點：不講的話她會以為新加的那一段也是談定的
    // （見 `.scratch/followup-and-products/issues/05`）。
    lines.push(
      `那一筆本來是「${describeStatus('confirmed')}」，`
      + `會退回「${describeStatus(INITIAL_STATUS)}」—— 這一段還沒問過客人`,
    );
    lines.push('待辦會重新出現一張「跟客人確認時間」');
  } else {
    lines.push(`這一段會併進同一天已經有的來訪裡，那天變成 ${slots} 段`);
    lines.push('那一筆本來就在等客戶回覆，待辦上那一列不變');
  }

  const later = pendingRegistrations(visit, coursesById);
  if (later.length) {
    lines.push(`等客人說可以之後，待辦會再多${later.map((k) => `一張「${k}」`).join('、')}`);
  }

  if (sheetSyncOn) lines.push(SHEET_LINE);

  return { title: `已經在 ${where} 壓好表了嗎？`, lines };
}

/**
 * 勾掉「跟客人確認時間」之後會發生什麼。待辦中心那張「已確認」的卡片用。
 *
 * **不是「加進日曆」** —— 那一筆壓表的時候就已經在日曆上了，這一步改的是
 * 顏色不是有沒有。寫成「加進日曆」會讓她以為在這之前日曆上是空的。
 *
 * @param {object[]} visits 這一次確認掉的那幾筆
 * @param {Record<string, object>} coursesById
 * @param {boolean} [sheetSyncOn]
 */
export function confirmConsequences(visits = [], coursesById = {}, sheetSyncOn = false) {
  // 用短的那一版（`shortStatus`）不用完整那一句：她看的是日曆，而日曆的圖例
  // 上寫的就是「待確認」「已確認」。同一件事在兩個地方用兩種講法會讓她多想一秒。
  const lines = [`日曆上這幾段從「${shortStatus(INITIAL_STATUS)}」變成「${shortStatus('confirmed')}」`];

  const later = [...new Set(visits.flatMap((v) => pendingRegistrations(v, coursesById)))];
  if (later.length) lines.push(`待辦會多${later.map((k) => `一張「${k}」`).join('、')}`);

  // 二返不用簽療程單（`needsForm()`），所以整批都是二返的那一天不要講這一句 ——
  // 那一筆照樣要結案，但她那天不用拿單子給客人簽。
  if (visits.some((v) => formSlotIndexes(v, coursesById).length)) {
    lines.push('來訪當天會多一張「簽療程單」');
  }

  if (sheetSyncOn) lines.push(SHEET_LINE);
  return lines;
}

/**
 * 結案（簽療程單）那一下會發生什麼。收尾抽屜底下那一句預告。
 *
 * **只講這一筆真的會發生的事**：整批都沒做就不要說「次數扣掉」，
 * 沒有健檢就不要說「會多一張追蹤健檢報告」。講一件不會發生的事，
 * 比沒講還糟（那正是她說看不懂的那幾句的毛病）。
 *
 * @param {object} o
 * @param {object} o.visit 那一筆來訪
 * @param {number} o.doneCount 逐段勾完之後，算「做了」的有幾段
 * @param {object[]} o.entitlements 這位客戶的額度（要判斷有沒有健檢配二返）
 * @param {Record<string, object>} o.coursesById
 * @param {boolean} [o.sheetSyncOn]
 * @returns {string[]}
 */
export function closeConsequences({
  visit, doneCount, entitlements = [], coursesById = {}, sheetSyncOn = false,
}) {
  const lines = [];

  if (doneCount) {
    lines.push(`日曆上這一筆改成「${shortStatus('done')}」，做了的那 ${doneCount} 段扣掉次數`);
  } else {
    lines.push(`日曆上這一筆改成「${shortStatus('no_show')}」，次數不扣`);
  }

  // 健檢結案才長「追蹤健檢報告」（ADR-0042：報告要兩三週，報告沒到就不可能約）。
  // 判斷走 `pairsOf()` —— 這一頁不認課程名字。
  if (doneCount && hasCheckupSlot(visit, entitlements, coursesById)) {
    lines.push(`待辦會多一張「${REPORT_TASK_KIND}」—— 健檢做完要等報告出來`);
  }

  if (sheetSyncOn) lines.push(SHEET_LINE);
  return lines;
}

/** 這一筆來訪裡有沒有一段是「做完之後還要再約一次」的健檢。 */
function hasCheckupSlot(visit, entitlements, coursesById) {
  const sources = new Set(
    pairsOf(entitlements, coursesById).filter((p) => p.followup).map((p) => p.source.id),
  );
  return (visit?.slots ?? []).some((s) => sources.has(s.entitlementId));
}
