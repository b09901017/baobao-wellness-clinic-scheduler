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

import {
  bookingSystemFor, tasksForCategory, isCancelKind, cancelTasksFor, cancelsBooking,
  newRegistrations,
} from './taskRules.js';
import {
  describeStatus, shortStatus, INITIAL_STATUS, formSlotIndexes, isLiveSlot,
  slotStatus, applyConfirmation,
} from './visits.js';
import {
  pairsOf, REPORT_TASK_KIND, FOLLOWUP_TASK_KIND, SEND_REPORT_TASK_KIND, bookingForExam,
} from './followups.js';
import { RECORD_TASK_KIND } from './taskRules.js';
import { nthOf, nthLabel } from './nthFollowup.js';
import { shortDate } from './dates.js';
import { timeLabel } from './visitTime.js';

/** 十秒是 `data/sheetSync.js` 的 `QUIET_MS`。兩邊要一起改。 */
const SHEET_LINE = '十秒後自動同步到試算表';

/**
 * **這幾段談定了，掛號待辦會多哪幾種。** 把那幾段假設成已確認，去問存檔時真的在跑的
 * 那一支（`newRegistrations()`），只留掛到那幾段的（ADR-0070：後果跟寫入共用同一段身體）。
 *
 * 三道確認框共用：確認抽屜（這一次談定的那幾段）、改期（新接在尾巴那一段）、
 * 壓表與來訪編輯器新增（這次新加的那幾段）。以前後兩道各自照課程類別再推一次
 * （`tasksForCategory()`），逐段掛號（ADR-0107）之後兩頭都會講錯
 * （prelaunch-audit-2026-09-23/issues/15、22）。
 *
 * @param {object} visit
 * @param {number[]} indexes 會談定的是第幾段
 * @param {object[]} [tasks] 這一筆身上現有的任務（連軟刪除的，`listByVisitForSync()`）
 * @returns {string[]} 任務種類，照 `newRegistrations()` 的順序
 */
function registrationsWhenSettled(visit, indexes, tasks = [], coursesById = {}) {
  const at = new Set(indexes);
  const settled = {
    ...visit,
    slots: (visit?.slots ?? []).map((s, i) => (at.has(i) ? { ...s, status: 'confirmed' } : s)),
  };
  return newRegistrations(settled, tasks, coursesById)
    .filter((t) => t.slotIndexes.some((i) => at.has(i)))
    .map((t) => t.kind);
}

/** 「待辦會多一張 X、一張 Y」 */
const moreTasks = (kinds) => kinds.map((k) => `一張「${k}」`).join('、');

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
    (visit?.slots ?? [])
      .filter(isLiveSlot)
      .map((s) => bookingSystemFor(coursesById[s.courseId]?.category)),
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
  // **客人退掉的那一段不算**（ADR-0081）。確認動線把它標成取消而不是刪掉，
  // 所以這裡要濾 —— 不濾的話她會看到「待辦會多一張 Examine」，
  // 而那一張永遠不會出現（`tasksForVisit()` 也濾了）。
  for (const slot of (visit?.slots ?? []).filter(isLiveSlot)) {
    for (const kind of tasksForCategory(coursesById[slot.courseId]?.category)) kinds.add(kind);
  }
  return [...kinds];
}

/**
 * 存檔前那一道「這幾段先看一下」。
 *
 * 她 2026-09-08：
 *
 * > 我希望當我按下紀錄這「些」來訪…可以先提醒那個時段會導致超過次數、
 * > 那個時段沒有選醫生診間等等，**如果沒有就可以不用提醒**。然後我按下
 * > 了解之類的，才會再跳出壓 abovee 了嗎 的那些提醒。
 *
 * 所以這是**兩道**不是一道，而且第一道只在真的有東西要講的時候出現。
 *
 * **句子不在這裡組。** `validateVisit()` 的 warnings 本來就是完整的句子
 * （「『復能-三選一(60)』排完這次會超過總次數」），照抄就好 —— 在這裡
 * 重寫一遍等於同一件事有兩種說法，而她會以為那是兩件事。
 *
 * 回 `null` 代表**不用問**（一句提醒都沒有）。呼叫端拿它當閘門，
 * 不要自己數 `warnings.length` —— 「幾句話算需要問」是一條規則。
 *
 * @param {string[]} warnings `validateVisit()` 回的那一份
 * @returns {{title: string, lines: string[], confirmLabel: string,
 *            cancelLabel: string}|null}
 */
export function reviewWarnings(warnings = []) {
  const lines = (warnings ?? []).filter((w) => String(w ?? '').trim());
  if (!lines.length) return null;

  return {
    // 講**幾件**，不要只寫「有一些提醒」—— 她要知道等一下要看幾行。
    // 「這一件」不是「這一段」：在來訪表單上「這一段」一定會被讀成時段（ADR-0087）
    title: lines.length === 1 ? '這一件先看一下' : `這 ${lines.length} 件先看一下`,
    lines,
    // 兩顆都講出按下去會怎樣。「確定／取消」在這一道是模糊的：
    // 這一道不是在問「要不要存」，是在問「你看過了嗎」。
    confirmLabel: '知道了，繼續',
    cancelLabel: '回去改',
  };
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
      `那一天本來是「${describeStatus('confirmed')}」，`
      + `會退回「${describeStatus(INITIAL_STATUS)}」—— 這一段還沒問過客人`,
    );
    lines.push('待辦會重新出現一張「跟客人確認時間」');
  } else {
    lines.push(`這一段會併進同一天已經有的來訪裡，那天變成 ${slots} 段`);
    lines.push('那一天本來就在等客戶回覆，待辦上那一列不變');
  }

  const later = pendingRegistrations(visit, coursesById);
  if (later.length) {
    lines.push(`等客人說可以之後，待辦會再多${later.map((k) => `一張「${k}」`).join('、')}`);
  }

  // n返 是加約的，**不扣任何次數**。這一句是她最會擔心的那件事：
  // 整套系統的核心焦慮就是次數對不對得起來，而一場「不用先加購」的來訪
  // 憑直覺看起來像會偷扣一次。講一次，她就不用回去客戶詳情比對。
  for (const nth of nthLabels(visit)) {
    lines.push(`${nth}是加約的 —— 這一場不扣任何次數，客戶身上的數字一個都不會變`);
  }

  if (sheetSyncOn) lines.push(SHEET_LINE);

  return { title: `已經在 ${where} 壓好表了嗎？`, lines };
}

/** 這一筆來訪裡有哪幾段是 n返，講成「三返」這種話。同一個返數只講一次。 */
function nthLabels(visit) {
  const seen = new Set();
  for (const slot of visit?.slots ?? []) {
    const label = nthLabel(nthOf(slot));
    if (label) seen.add(label);
  }
  return [...seen];
}

/**
 * 勾掉「跟客人確認時間」之後會發生什麼。待辦中心那張「已確認」的卡片用。
 *
 * **不是「加進日曆」** —— 那一筆壓表的時候就已經在日曆上了，這一步改的是
 * 顏色不是有沒有。寫成「加進日曆」會讓她以為在這之前日曆上是空的。
 *
 * **只講這一次從「待確認」走出去的那幾段**（ADR-0097，同 `describeConfirmed()`）。
 * 她在日曆上先確認掉 A 類那一段時，那一段的 Examine／耀聖當場就長了 ——
 * 抽屜裡確認下午那一段再說一次「待辦會多一張 Examine」是假話（ADR-0070）。
 * 所以「會多哪幾張」問的是真的會長它們的那一支（`taskRules.js` 的 `newRegistrations()`）——
 * 掛號逐段長（prelaunch-audit-2026-09-23/issues/02）：同一天早上那一段掛過號，
 * 確認下午那一段照樣會多一張。
 *
 * @param {object[]} visits 這位客戶還在等回覆的那幾筆（**寫入之前的**）
 * @param {Record<string, object>} coursesById
 * @param {boolean} [sheetSyncOn]
 * @param {Set<string>} [rejected] 抽屜裡被退掉的那幾段，key 是 `${visit.id}:${索引}`
 * @param {Record<string, object[]>} [tasksByVisit] 那幾筆身上現有的任務（連軟刪除的，
 *   `listByVisitForSync()`）。沒給就當沒有 —— 只有舊任務（沒有 `slotIndexes`）會因此多講一句
 */
export function confirmConsequences(
  visits = [], coursesById = {}, sheetSyncOn = false, rejected = new Set(), tasksByVisit = {},
) {
  // 用短的那一版（`shortStatus`）不用完整那一句：她看的是日曆，而日曆的圖例
  // 上寫的就是「待確認」「已確認」。同一件事在兩個地方用兩種講法會讓她多想一秒。
  const lines = [`日曆上這幾段從「${shortStatus(INITIAL_STATUS)}」變成「${shortStatus('confirmed')}」`];

  // 這一次真的有段談定的那幾天，寫進去之後長什麼樣。**走真的那一支**
  // （`applyConfirmation()`，`home.js` 存的就是它的結果），不在這裡再推一次。
  const settled = [];
  for (const before of visits ?? []) {
    const all = (before.slots ?? []).map((_, i) => i);
    const out = new Set(all.filter((i) => rejected.has(`${before.id}:${i}`)));
    const confirming = all.filter((i) => !out.has(i)
      && slotStatus(before, before.slots[i]) === 'pending_confirm');
    if (confirming.length) settled.push({ before, after: applyConfirmation(before, out) });
  }

  const later = new Set();
  for (const { before, after } of settled) {
    // 只講**這一次才談定**的那幾段長出來的 —— 沒給任務時，早就談定的段看起來也像沒掛過
    const now = (after.slots ?? []).map((_, i) => i).filter((i) =>
      slotStatus(before, before.slots[i]) === 'pending_confirm'
      && slotStatus(after, after.slots[i]) === 'confirmed');
    for (const k of registrationsWhenSettled(after, now, tasksByVisit[before.id], coursesById)) later.add(k);
  }
  if (later.size) lines.push(`待辦會多${moreTasks([...later])}`);

  // 二返不用簽療程單（`needsForm()`），所以整批都是二返的那一天不要講這一句 ——
  // 那一筆照樣要結案，但她那天不用拿單子給客人簽。
  if (settled.some(({ after }) => formSlotIndexes(after, coursesById).length)) {
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
    lines.push(`日曆上這一天改成「${shortStatus('done')}」，做了的那 ${doneCount} 段扣掉次數`);
  } else {
    lines.push(`日曆上這一天改成「${shortStatus('no_show')}」，次數不扣`);
  }

  // 健檢結案才長「追蹤健檢報告」（ADR-0042：報告要兩三週，報告沒到就不可能約）。
  // 判斷走 `pairsOf()` —— 這一頁不認課程名字。
  if (doneCount && hasCheckupSlot(visit, entitlements, coursesById)) {
    lines.push(`待辦會多一張「${REPORT_TASK_KIND}」—— 健檢做完要等報告出來`);
  }

  // 二返與營養師諮詢那一種：客人走了之後要去補一份文字紀錄（ADR-0066）。
  // 判斷走課程主檔上的那個勾，跟「要不要簽療程單」同一種做法。
  // **只在真的有做的時候講** —— 沒來就沒有紀錄要寫，而
  // `recordTasksForVisit()` 也真的不會長出來。
  if (doneCount && (visit?.slots ?? []).some((sl) => coursesById[sl.courseId]?.needsRecord)) {
    lines.push(`待辦會多一張「${RECORD_TASK_KIND}」—— 客人走了之後要補的那一份`);
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

// ---------- 反過來：拿回來、取消 ----------

/**
 * 拿回一張已經勾掉的待辦，會發生什麼。
 *
 * ## 只有兩種要問
 *
 * 鏈上那兩種（追蹤健檢報告、約二返）拿回來會**收掉別的張**，其餘五種
 * （Examine、耀聖、寫紀錄、寄報告給醫師、隨手記）什麼都不會發生。
 * 每一種都問的話她會學會閉著眼睛按，而那正是「批次勾掉」那一段
 * 已經寫過的同一句話 —— 多問一次的代價是真的該停的那次也停不下來。
 *
 * 判準是 `preview.remove` 有沒有東西，而 `preview` 是**同一台引擎**算出來的
 * （`data/visits.js` 的 `previewTaskChange()` → `syncFollowupTasks()`）。
 * 照著規則在這裡再推論一次的話，遲早會出現「說會收掉兩張、實際收掉三張」。
 *
 * ## 不可以嚇她
 *
 * 這一段最重要的一句話：**拿回一張待辦不會動到任何一筆來訪。**
 * 勾選那一路產生的操作全部落在 `tasks` 這個集合裡，一筆 `visits` 都沒碰
 * （ADR-0002：app 記錄決定，不做決定）。
 *
 * 所以二返已經約好的時候要講的是「那一筆來訪**不會被動到**」，
 * 而不是「將會取消已約好的二返」—— 後者是一句假話，而嚇錯一次之後，
 * 真的該停的那一次她也不會停。
 *
 * @param {object} o
 * @param {object} o.task 那一張待辦（勾選之前的樣子）
 * @param {{remove:object[], visits:object[], entitlements:object[],
 *          coursesById:object}} o.preview `previewTaskChange()` 的結果
 * @returns {{title:string, lines:string[], danger:boolean}|null}
 *   `null` 代表**不用問**（不是鏈上那兩種，或者拿回來什麼都不會少）
 */
export function untickConsequences({ task, preview } = {}) {
  const dropped = (preview?.remove ?? []).filter((r) => r.id !== task?.id);
  if (!task || !dropped.length) return null;

  const lines = [];

  const exam = (preview.visits ?? []).find((v) => v.id === task.visitId) ?? null;
  if (exam?.date) lines.push(`那一次健檢是 ${shortDate(exam.date)}`);

  // 會被收走的那幾張，一種一行。逐張講不逐類講 —— 她要看的是「我做過的
  // 哪一件會不見」，而不是「有 2 張會不見」。
  for (const row of dropped) {
    lines.push(`「${row.kind}」還沒勾，這一張會被收走`);
  }

  // **已經約好的那一場二返。** 這一行是整段話的重點：講出日期讓她知道
  // 系統看到了那一場，同時把「來訪不會被動到」講死。
  const booked = bookedFollowupFor(task, preview);
  if (booked) {
    lines.push(
      `${shortDate(booked.visit.date)} 那一場二返已經約好了 —— `
      + '那一天的來訪不會被動到，只有上面那幾張待辦會被收走',
    );
  }

  lines.push('收走的那幾張在「設定 → 已刪除項目」還原得回來');
  lines.push(`「${task.kind}」本身會回到未完成`);

  return {
    title: `拿回「${task.kind}」？`,
    lines,
    // 真的有東西會被收走才染紅。沒有下游的那一次根本不會走到這裡（回 null）。
    danger: true,
  };
}

/**
 * 這一張「追蹤健檢報告」對應的那一次健檢，二返約好了沒。
 *
 * 走 `followups.js` 現成的 `bookingForExam()` —— 「那一場二返約在哪一天」
 * 也不自己算。找不到配對就回 `null`，**不要回「還沒約」**：
 * 那是在斷言一件不知道的事（同 `bookingStateForTask()` 的判斷）。
 */
function bookedFollowupFor(task, preview) {
  if (!task?.visitId) return null;
  const exam = (preview.visits ?? []).find((v) => v.id === task.visitId);
  if (!exam) return null;

  for (const pair of pairsOf(preview.entitlements ?? [], preview.coursesById ?? {})) {
    if (!pair.followup) continue;
    if (!(exam.slots ?? []).some((sl) => sl.entitlementId === pair.source.id)) continue;
    return bookingForExam(task.visitId, pair.followup.id, preview.visits ?? []);
  }
  return null;
}

/** 健檢那條鏈上的三種。取消一筆來訪時要另外講。 */
const CHAIN_KINDS = [REPORT_TASK_KIND, FOLLOWUP_TASK_KIND, SEND_REPORT_TASK_KIND];

/**
 * 取消或刪掉一筆來訪，會發生什麼。
 *
 * 日曆的長按選單與來訪編輯器的狀態卡**共用這一支**（ADR-0056：改得動一筆
 * 來訪的只有日曆，而那兩個入口都算在裡面）。刪除那一道也走它。
 *
 * 以前那兩道各自寫死「如果已經在 Abovee／Examine／耀聖登記過，要回去把舊的
 * 取消掉」—— 三個系統名字並列，而 `bookingSystemsForVisit()` 早就答得出來
 * **是哪一個**。這正是這一支檔案的檔頭抱怨過的同一件事：判斷早就有了，
 * 只是沒有人用它。
 *
 * @param {object} o
 * @param {object} o.visit 要取消的那一筆
 * @param {Record<string, object>} o.coursesById
 * @param {object[]} [o.tasks] 這一筆來訪身上現有的任務（含已完成的）
 * @param {boolean} [o.removing] 走的是刪除不是取消
 * @param {boolean} [o.sheetSyncOn]
 * @param {number|number[]} [o.slotIndex] 只取消其中哪幾段。不帶就是整筆。
 * @returns {string[]}
 */
export function cancelConsequences({
  visit, coursesById = {}, tasks = [], removing = false, sheetSyncOn = false, slotIndex = null,
}) {
  const lines = [];
  const all = visit?.slots ?? [];
  const slots = all.length;

  // ---------- 只取消其中幾段（ADR-0081、0082） ----------
  //
  // 她 2026-09-08：「僅能取消被選中的該筆時段來訪」。所以這幾句話**不可以
  // 提到整天的段數** —— 她看到「3 個時段會退回去」會以為自己按錯了那一顆。
  //
  // **收得下一段也收得下好幾段。** 批次取消一次可能挑走同一天的兩段，而
  // 「剩下幾段」一定要把同一批的其他段也算進去 —— 只傳第一段進來的話，
  // 她會看到「剩下的 2 段不受影響」然後存完剩 1 段。挑到不存在的段落一律
  // 當它不存在（同 `slotsToShow()` 的退路）。
  const picked = new Set(
    (Array.isArray(slotIndex) ? slotIndex : [slotIndex])
      .filter((i) => Number.isInteger(i) && all[i]),
  );

  if (picked.size) {
    // 這幾段取消掉之後，那一天還剩幾段活著。全部沒了就是整筆取消 ——
    // 那時候要講的是整天那一種話，不然她會以為那一天還在。
    const left = all.filter((sl, i) => !picked.has(i) && isLiveSlot(sl)).length;

    lines.push(picked.size === 1
      ? '這一段會退回去，次數也會還回來'
      : `這 ${picked.size} 段會退回去，次數也會還回來`);
    if (left) lines.push(`那一天剩下的 ${left} 段不受影響`);
    else lines.push('那一天就整個取消了 —— 沒有剩下的段');

    // **會多哪幾張，問真的會長出它們的那一支**（`cancelTasksFor()`，ADR-0070）。
    // 以前這裡自己用 `bookingSystemsForVisit()` 算一次，於是兩件事分岔了：
    // 上次那一段的「取消 Abovee」勾掉之後，這裡說「已經有了」而真的會多一張；
    // 只取消二返那一段時，這裡不講 Examine 而真的會長「取消 Examine」
    // （`.scratch/asks-2026-09-13/issues/02`）。
    //
    // 一天同時有健檢（Examine）與復能（Abovee）時，取消復能那一段跟 Examine 一點關係
    // 都沒有 —— 那一支本來就只收取消掉的那幾段。
    //
    // **挑走的是那一天剩下的每一段時，存下去就是整天取消**（`applyStatus()` 推得出整筆
    // cancelled），`cancelTasksFor()` 走的是整天那一條 —— 這裡也要照那一條問，不然
    // 歷史資料裡勾掉的登記（例如舊的「Abovee」任務）框上不講、存完卻多一張。
    const after = {
      ...visit,
      ...(left ? {} : { status: 'cancelled' }),
      slots: all.map((sl, i) => (picked.has(i) ? { ...sl, status: 'cancelled' } : sl)),
    };
    lines.push(...cancelTaskLines(after, tasks, coursesById));

    lines.push('改期不是改日期，是取消後重新排一次');
    if (sheetSyncOn) lines.push(SHEET_LINE);
    return lines;
  }

  // **第一句就講範圍**（ADR-0087）：按鈕寫「取消一整天」，以前跳出來的第一句
  // 卻只講「3 個時段」—— 她得自己推出那是整天。
  lines.push(removing
    ? `這是標記刪除，資料不會真的消失；這一整天的 ${slots} 個時段會退回去，次數也會還回來`
    : `這一整天的 ${slots} 個時段會退回去，次數也會還回來`);

  const alive = (tasks ?? []).filter((t) => !t.deletedAt);

  // **講出是哪一個系統。** 一筆來訪可以同時有健檢（Examine）與復能（Abovee），
  // 那時候兩個都要講，因為她真的要去兩個地方收。
  //
  // **問真的會長出它們的那一支**（`cancelTasksFor()`）：已經有那一張的不再承諾一次，
  // 勾過的 Examine／耀聖要收也講得出來 —— 兩件事都只寫在那裡。
  lines.push(...cancelTaskLines({ ...visit, status: 'cancelled' }, tasks, coursesById));

  const live = alive.filter((t) => !t.done);

  // 掛號與紀錄那兩族：沒做的就不用做了（`syncTasksForVisit()` 的 gone 那一段）。
  //
  // **取消類的那幾張不算。** 那一段的 `auto` 濾掉了它們 —— 它記的是
  // 「當初登記過、現在要收回來」，來訪本身怎麼變都不該動到它。
  // 把它列進「會被收掉」是一句假話，而且方向剛好相反（它是這一下**長出來**的）。
  const ownKinds = [...new Set(
    live
      .filter((t) => !CHAIN_KINDS.includes(t.kind) && !isCancelKind(t.kind))
      .map((t) => t.kind),
  )];
  if (ownKinds.length) {
    lines.push(`還沒做完的${ownKinds.map((k) => `「${k}」`).join('、')}會被收掉`);
  }

  // 健檢那條鏈：那一場沒發生，沒有東西要追（`keepsOpen()` 的 `stillDone`）
  const chainKinds = [...new Set(live.filter((t) => CHAIN_KINDS.includes(t.kind)).map((t) => t.kind))];
  if (chainKinds.length) {
    lines.push(
      `這一次健檢的${chainKinds.map((k) => `「${k}」`).join('、')}也會被收掉`
      + ' —— 那一場沒發生，沒有東西要追',
    );
  }

  lines.push('改期不是改日期，是取消後重新排一次');
  lines.push(removing
    ? '可以在設定 → 已刪除項目 還原'
    : '取消後不能復原成已確認，但日曆上還看得到它（暗掉的那一列）');

  if (sheetSyncOn) lines.push(SHEET_LINE);
  return lines;
}

/**
 * 「改這一段」改了時間或課程（`visits.js` 的 `rebookSlot()`，ADR-0108）存下去之前那一道。
 *
 * 她 2026-09-23：「我希望會提醒回 Abovee／Examine／耀聖改時間以及回去取消已經掛好的號等等」。
 * 要回去做什麼**由真的會長出來的那一份推**（`cancelTaskLines()` → `cancelTasksFor()`）——
 * 沒掛過號的系統不講（ADR-0070）。
 *
 * @param {object} o
 * @param {object} o.before 存下去之前那一筆
 * @param {object} o.after `rebookSlot()` 回的那一筆（舊那一段取消、新的接在尾巴）
 * @param {number} o.index 她改的是哪一段
 * @param {object[]} [o.tasks] 這一筆身上的任務（連軟刪除的，`listByVisitForSync()`）
 * @returns {{title: string, lines: string[]}}
 */
export function rebookConsequences({
  before, after, index, tasks = [], coursesById = {}, sheetSyncOn = false,
}) {
  const old = before?.slots?.[index];
  const fresh = after?.slots?.[after.slots.length - 1];
  const settled = slotStatus(before, old) === 'confirmed';
  const lines = [
    `原本那一段（${timeLabel(old)}）會取消，日曆上變灰`,
    `新的那一段（${timeLabel(fresh)}）接在後面，標成「${shortStatus(INITIAL_STATUS)}」`
      + (settled ? ' —— 原本談定過了，要再問客人一次' : ''),
    ...cancelTaskLines(after, tasks, coursesById),
  ];
  // 新那一段談定之後真的會長的（`registrationsWhenSettled()`）—— 舊的掛號待辦沒有
  // `slotIndexes` 時當成蓋住整天，新那一段就一張都不長，這一句也不講
  const later = registrationsWhenSettled(after, [after.slots.length - 1], tasks, coursesById);
  if (later.length) lines.push(`等客人說可以之後，待辦會再多${moreTasks(later)}`);
  lines.push('改期不是改日期，是取消後重新排一次');
  if (sheetSyncOn) lines.push(SHEET_LINE);
  return {
    title: `新的時間在 ${bookingSystemFor(coursesById[fresh?.courseId]?.category)} 壓好了嗎？`,
    lines,
  };
}

/**
 * 「待辦會多一張『取消 X』」那幾句。**由真的會長出來的那一份推**（`cancelTasksFor()`）——
 * 畫面上的後果只能講真的會發生的事（ADR-0070）。
 *
 * 壓表登記與確認後的登記是兩句話：前者是「那個時段放掉」，後者是「那一段的登記取消掉」。
 *
 * @param {object} after 取消之後的那一筆來訪
 */
function cancelTaskLines(after, tasks, coursesById) {
  return cancelTasksFor(after, tasks ?? [], coursesById).map((t) => (cancelsBooking(after, t, coursesById)
    ? `待辦會多一張「${t.kind}」—— 回去把那個時段放掉`
    // 「那一段」不是「那一筆」：畫面上的單位只有段與天（ADR-0087）
    : `待辦會多一張「${t.kind}」—— 回去把那一段的登記取消掉`));
}
