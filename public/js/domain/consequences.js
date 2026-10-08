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
// 判斷早就有了（`taskRules.js` 的 `bookingSystemOf()`），只是沒有人用它。
//
// 兩邊各寫一次的下場已經看到了，所以這裡就是那一份。
//
// 見 docs/adr/0056（哪幾句該留）與 `.scratch/followup-and-products/issues/07`。

import {
  bookingSystemOf, isCancelKind, cancelTasksFor, cancelsBooking,
  newRegistrations,
} from './taskRules.js';
import {
  shortStatus, INITIAL_STATUS, formSlotIndexes, isLiveSlot,
  slotStatus, applyConfirmation, closeVisit, slotsToClose, visitsToConfirm, sameDayState, liveSlots,
} from './visits.js';
import {
  pairsOf, REPORT_TASK_KIND, FOLLOWUP_TASK_KIND, SEND_REPORT_TASK_KIND, bookingForExam, syncFollowupTasks,
} from './followups.js';
import { RECORD_TASK_KIND } from './taskRules.js';
import { nthOf, nthLabel, isNthSlot } from './nthFollowup.js';
import { isUncounted } from './masterData.js';
import { shortDate, isValidDate } from './dates.js';
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
 * @param {Record<string, object>} [coursesById]
 * @param {string|null} [today] 給了，那一天過了就一張都不講（ADR-0113，同寫入那一側）
 * @returns {string[]} 任務種類，照 `newRegistrations()` 的順序
 */
function registrationsWhenSettled(visit, indexes, tasks = [], coursesById = {}, today = null) {
  const at = new Set(indexes);
  const settled = {
    ...visit,
    slots: (visit?.slots ?? []).map((s, i) => (at.has(i) ? { ...s, status: 'confirmed' } : s)),
  };
  return newRegistrations(settled, tasks, coursesById, today)
    .filter((t) => t.slotIndexes.some((i) => at.has(i)))
    .map((t) => t.kind);
}

/**
 * 「待辦會多一張 X、一張 Y」。同一種出現好幾次就合起來講（「3 張『Examine』」）——
 * 拍 Abovee 那一道一次講好幾天（`aboveeConsequences()`），其餘入口一種只會出現一次，字跟以前一樣。
 */
function moreTasks(kinds) {
  const counts = new Map();
  for (const k of kinds) counts.set(k, (counts.get(k) ?? 0) + 1);
  return [...counts].map(([k, n]) => (n === 1 ? `一張「${k}」` : `${n} 張「${k}」`)).join('、');
}

/**
 * **補登過去那一天**：確認那一列只收今天以後（`visitsToConfirm()`），那一天直接在「簽療程單」。
 * 判斷借確認那一列的那一支，它改了這裡跟著改。壓表／日曆新增與拍 Abovee 兩道共用。
 */
const pastDay = (visit, today) => Boolean(today)
  && !visitsToConfirm([{ ...visit, status: INITIAL_STATUS }], today).length;

/**
 * 一段併進**已經談定**的那一天時要講的那一句。**三個地方共用**：壓表「加這一筆」底下、
 * 壓表與日曆新增的確認框（`bookingConsequences()`）、拍 Abovee 的確認框（`aboveeConsequences()`）。
 *
 * 以前講「那一天本來是已確認，會退回待確認」—— 整筆那個 `status` 是推導的（ADR-0081），
 * `withExtraSlot()` 先把原本那幾段的狀態落下來，日曆上它們照樣是已確認、確認抽屜也只問新那一段
 *（ADR-0097）。講「退回」是一件不會發生的事（ADR-0070）。她 2026-09-24 晚選了這個說法
 *（`.scratch/asks-2026-09-24-evening/issues/06`）。
 */
export function settledDayLine() {
  return `那一天原本談定的段不動，新的這一段是「${shortStatus(INITIAL_STATUS)}」—— 還沒問過客人`;
}

/**
 * 那一天**已經結案了**（已完成／未到）還要再記一段時要講的那一句（ADR-0083 決定三：那一天不重開，另開一次新的來訪）。
 * 兩個地方共用：壓表「加這一筆」底下、拍 Abovee 的確認框（`aboveeConsequences()`）。
 *
 * 以前只寫在壓表的畫面裡（`schedule.js` 的 `addNote()`），拍 Abovee 那一道一個字都沒講（prelaunch-fixes/11）。
 * 它跟 `settledDayLine()` 是**兩句**：那一句講的是併進一筆還開著、已經談定的來訪；這一句講的是那一天已經收掉了。
 * 「那一天有沒有結案的」問 `domain/visits.js` 的 `sameDayState()`，這裡只管字。
 *
 * @param {number} [count] 這一次記幾段。壓表一次一段，字跟以前一模一樣
 */
export function closedDayLine(count = 1) {
  return `這天已經結案了，所以${count > 1 ? `這 ${count} 段` : '這一段'}會另開一次新的來訪`;
}

/**
 * 這一筆來訪動到了哪幾個系統的壓表登記，寫成一句人看得懂的話。
 *
 * 一筆來訪可以同時有健檢（Examine）與復能（Abovee）—— 那時候兩個都要講，
 * 因為她真的要去兩個地方壓。
 *
 * **只看指定的那幾段**（`indexes`，ADR-0126）：存檔前那一道問的是「這一次新加的壓好了嗎」，
 * 不是那一天的每一段 —— 她先排了功醫門診、再併一段 HRV 進去時，以前照樣問 Abovee。
 * 沒給就是每一段（新的一天）。**不用壓的課不算**，所以可能回空字串：呼叫端要換一個抬頭，
 * 不可以印成「已經在  壓好表了嗎？」。
 *
 * @param {{slots?: {courseId?: string}[]}} visit
 * @param {Record<string, {category?: string}>} coursesById
 * @param {number[]|null} [indexes] 只看第幾段
 * @returns {string} 例：`Abovee`、`Examine`、`Abovee 與 Examine`；都不用壓是 `''`
 */
export function bookingSystemLabel(visit, coursesById = {}, indexes = null) {
  const at = indexes ? new Set(indexes) : null;
  const names = [...new Set(
    (visit?.slots ?? [])
      .filter((s, i) => (!at || at.has(i)) && isLiveSlot(s))
      .map((s) => bookingSystemOf(coursesById[s.courseId]))
      .filter(Boolean),
  )];
  return names.join(' 與 ');
}

/**
 * 新加的每一段都不用壓時（ADR-0126）那一道的抬頭與確認鈕 —— 沒有東西要她先去壓，
 * 所以不問「壓好了嗎」，按鈕也不寫「已確認」。講法跟拍 Abovee 那一道同一句（`aboveeConsequences()`）。
 */
const nothingToBook = (count) => ({
  title: count === 1 ? '記錄這一段？' : `記錄這 ${count} 段？`,
  confirmLabel: '記錄',
});

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
 * @param {number[]} [o.added] 這次新加的是第幾段。沒給＝每一段都是（新的一筆）
 * @param {object[]} [o.tasks] 那一筆身上現有的任務（併進既有那一天時才有，`listByVisitForSync()`）
 * @param {string|null} [o.today] 補登過去那一天時，「跟客人確認時間」與掛號那兩句都不講（ADR-0113）
 * @returns {{title: string, lines: string[], confirmLabel: string, toBook: number[], free: number[]}}
 *   抬頭與確認鈕的字一起回 —— 新加的每一段都不用壓時兩個都要換（ADR-0126），畫面不自己寫死。
 *   `toBook`／`free`：這一次新加的段裡**哪幾段要壓、哪幾段不用**（那一筆來訪裡的位置）。
 *   抬頭問的是「在 X 壓好了嗎」，所以它底下只能列 `toBook` —— 以前呼叫端把新加的每一段都列上去，
 *   功醫門診＋HRV 一起存時讀起來像在問「HRV 在 Abovee 壓好了嗎」（2026-10-07）。名字由呼叫端組
 */
export function bookingConsequences({
  visit, coursesById = {}, merge = null, sheetSyncOn = false, added = null, tasks = [], today = null,
}) {
  // **只問這一次新加的那幾段壓在哪**（ADR-0126）：那一天早就壓好的段不再問一次
  const fresh = added ?? (visit?.slots ?? []).map((_, i) => i);
  const where = bookingSystemLabel(visit, coursesById, fresh);
  const lines = [];
  const slots = (visit?.slots ?? []).length;
  // 補登過去那一天講「會多一張跟客人確認時間」是一句不會發生的話（ADR-0070）
  const past = pastDay(visit, today);
  const toClose = '那一天已經過了，待辦上直接出現在「簽療程單」';

  if (!merge) {
    lines.push('會記到日曆上，標成「待確認」');
    lines.push(past ? toClose : '待辦會多一張「跟客人確認時間」');
  } else if (merge.reopened) {
    lines.push(`這一段會併進同一天已經有的來訪裡，那天變成 ${slots} 段`);
    // 這一句是這一輪的重點：不講的話她會以為新加的那一段也是談定的
    // （見 `.scratch/followup-and-products/issues/05`）。**不講「退回」**：原本那幾段沒有被退回（06）
    lines.push(settledDayLine());
    lines.push(past ? toClose : '待辦會重新出現一張「跟客人確認時間」');
  } else {
    lines.push(`這一段會併進同一天已經有的來訪裡，那天變成 ${slots} 段`);
    lines.push(past ? toClose : '那一天本來就在等客戶回覆，待辦上那一列不變');
  }

  // **只講這次新加的那幾段談定之後會長的**（prelaunch-audit-2026-09-23/issues/22）。
  // 逐段掛號（ADR-0107）之後，整筆有什麼就講什麼兩頭都錯：門診那一段早就掛好號的
  // 那一天加一段復能，它會說「會再多一張 Examine」；再加一段門診，它講對是碰巧。
  const later = registrationsWhenSettled(visit, fresh, tasks, coursesById, today);
  if (later.length) lines.push(`等客人說可以之後，待辦會再多${moreTasks(later)}`);

  // n返 是加約的，**不扣任何次數**。這一句是她最會擔心的那件事：
  // 整套系統的核心焦慮就是次數對不對得起來，而一場「不用先加購」的來訪
  // 憑直覺看起來像會偷扣一次。講一次，她就不用回去客戶詳情比對。
  for (const nth of nthLabels(visit)) {
    lines.push(`${nth}是加約的 —— 這一場不扣任何次數，客戶身上的數字一個都不會變`);
  }
  // 不算次數的課是同一種擔心（ADR-0121）：一段「不用先加購」的來訪看起來像會偷扣一次
  for (const name of uncountedNames(visit, coursesById, added)) {
    lines.push(`${name}不算次數 —— 客戶身上的數字一個都不會變`);
  }

  if (sheetSyncOn) lines.push(SHEET_LINE);

  const live = fresh.filter((i) => isLiveSlot(visit?.slots?.[i]));
  const toBook = live.filter((i) => bookingSystemOf(coursesById[visit.slots[i].courseId]));
  const free = live.filter((i) => !toBook.includes(i));

  if (!where) return { ...nothingToBook(fresh.length), lines, toBook, free };
  return { title: `已經在 ${where} 壓好表了嗎？`, lines, confirmLabel: '已確認，記錄', toBook, free };
}

/** 拍 Abovee 那一道最多列幾句提醒。再多她也不會逐句讀 —— 剩下的指回那幾列。 */
const FLAGGED_MAX = 6;

/**
 * 拍 Abovee 存檔前那一道確認（ADR-0104 第 2 點：十幾段只問一次，一次講完）。
 *
 * 以前這幾句寫在 `ui/components/aboveeConfirm.js` 裡，於是壓表與日曆新增後來跟上的兩件它都沒跟上：
 * 「等客人說可以之後會再多一張 X」（prelaunch-audit-2026-09-23/issues/22）、補登過去那一天
 * 直接在簽療程單（ADR-0113 那一批）。現在判斷一條都不另寫：過了沒借 `visitsToConfirm()`、
 * 會多哪幾張借 `registrationsWhenSettled()`、併進談定那一天借 `settledDayLine()`、那一天已經結案借 `closedDayLine()`
 *（`.scratch/asks-2026-09-24-evening/issues/07`）。
 *
 * **合起來講**，不是一組一段 —— 十幾段各講三句她會閉著眼睛按。掛號照種類合計。
 *
 * @param {object} o
 * @param {{customerId: string, customerName: string, date: string, visit: object,
 *          items: object[], reopened: boolean}[]} o.groups `planAbovee()` 的那幾組（還沒記的）
 * @param {Record<string, object>} o.coursesById
 * @param {string|null} o.today
 * @param {Record<string, object[]>} [o.tasksByVisit] 併進既有那一天的那幾筆身上現有的任務（`listByVisitForSync()`）——
 *   沒帶 `slotIndexes` 的舊任務蓋住整天，少了它會講一張不會長的「會再多一張 X」（ADR-0070）
 * @param {{text: string, name: string}[]} [o.aliases] 會記住的寫法（`aliasWrites()`，畫面換好名字）
 * @param {{names: string[], month: string}[]} [o.marks] 誰在哪個月的壓表清單上標成壓完
 * @param {{customerName: string, date: string, texts: string[]}[]} [o.flagged] **這一次真的要寫的段**裡，
 *   身上有會改變寫入結果的提醒的那幾段（一段一筆；`aboveeImport.js` 的 `warningsByRow()` 的 `mustSee`）。
 *   每一列預設收著、預設打勾，這一道是她一定會經過的地方（ADR-0138）。句子是 `validateVisit()` 那幾句，這裡不重寫
 * @returns {{title: string, lines: string[]}}
 */
export function aboveeConsequences({
  groups = [], coursesById = {}, today = null, tasksByVisit = {}, aliases = [], marks = [], adopts = [], flagged = [],
}) {
  const n = groups.reduce((sum, g) => sum + (g.items?.length ?? 0), 0);
  const people = new Set(groups.map((g) => g.customerId)).size;
  const ahead = groups.filter((g) => !pastDay(g.visit, today));
  const past = groups.length - ahead.length;

  const lines = n ? [
    `${people} 位・${groups.length} 天・${n} 段`,
    '每一段都記成「待確認」—— Abovee 上寫的「確認前往」不等於問過客人',
  ] : [];
  // 提醒排在最前面（ADR-0138）：它是這一道裡唯一「不看就會記錯」的東西。同一天同一句只講一次
  //（兩列扣同一筆、合起來才超用時那一句兩列都有）；太多就列前幾句 —— 每一項一句話，不塞分隔線
  if (flagged.length) {
    const said = [...new Set(flagged.flatMap((f) => (f.texts ?? [])
      .map((text) => `${f.customerName} ${shortDate(f.date)}：${text}`)))];
    lines.push(`其中 ${flagged.length} 段有提醒 —— 照樣記得進去，記之前看一眼`);
    lines.push(...said.slice(0, FLAGGED_MAX));
    if (said.length > FLAGGED_MAX) lines.push(`還有 ${said.length - FLAGGED_MAX} 句 —— 回去看那幾列底下那一行`);
  }
  // 合併扣課（09）：她 10/5「拍照時要有寫說"合併扣課"或是可以多問一句」
  const merges = groups.flatMap((g) => g.items ?? []).filter((i) => i.merged);
  if (merges.length) {
    const minutes = [...new Set(merges.map((i) => i.merged.minutes).filter(Boolean))];
    lines.push(`其中 ${merges.length} 組合併扣課，各記成一段${minutes.length === 1 ? ` ${minutes[0]} 分` : ''}、扣一次`);
  }
  if (ahead.length) lines.push(`今天起的 ${ahead.length} 天會出現在待辦的「跟客人確認時間」`);
  if (past) lines.push(`已經過了的 ${past} 天，待辦上直接出現在「簽療程單」`);
  for (const g of groups.filter((x) => x.reopened)) {
    lines.push(`${g.customerName} ${shortDate(g.date)}：${settledDayLine()}`);
  }
  // 那一天已經結案了 → 另開一次新的來訪（`planAbovee()` 的 `afterClosed`，prelaunch-fixes/11）
  for (const g of groups.filter((x) => x.afterClosed)) {
    lines.push(`${g.customerName} ${shortDate(g.date)}：${closedDayLine(g.items?.length ?? 1)}`);
  }

  // 新加的段一律接在尾巴（`withExtraSlot()`），所以這一組新加的是最後那幾段
  const addedIn = (g) => {
    const count = (g.visit?.slots ?? []).length;
    return Array.from({ length: g.items?.length ?? 0 }, (_, i) => count - 1 - i);
  };
  const later = ahead.flatMap((g) => registrationsWhenSettled(
    g.visit, addedIn(g), tasksByVisit[g.visit?.id] ?? [], coursesById, today,
  ));
  if (later.length) lines.push(`等客人說可以之後，待辦會再多${moreTasks(later)}`);

  // n返 與不算次數的課：同壓表那一道（`bookingConsequences()`）—— 一段「不用先加購」的來訪
  // 看起來像會偷扣一次。**只講這一次新加的段**：併進的那一天原本就有的三返不是這一次的事
  const nths = new Set();
  const free = new Set();
  for (const g of groups) {
    const added = addedIn(g);
    for (const i of added) {
      const label = nthLabel(nthOf(g.visit?.slots?.[i]));
      if (label) nths.add(label);
    }
    for (const name of uncountedNames(g.visit, coursesById, added)) free.add(name);
  }
  for (const nth of nths) lines.push(`${nth}是加約的 —— 這一場不扣任何次數，客戶身上的數字一個都不會變`);
  for (const name of free) lines.push(`${name}不算次數 —— 客戶身上的數字一個都不會變`);

  // 11：她按了「改成 Abovee 的」的那幾段。講清楚只動那兩格 —— 她最怕的是改了一格、別的跟著跑
  if (adopts.length) {
    const fields = new Set(adopts.flatMap((i) => (i.diffs ?? []).map((d) => d.field)));
    const what = [fields.has('therapistId') ? '治療師' : '', fields.has('roomId') ? '診間' : ''].filter(Boolean).join('與');
    lines.push(`改 ${adopts.length} 段的${what}成 Abovee 上的 —— 只動這兩格，時間、狀態、待辦都不變`);
  }

  for (const a of aliases) lines.push(`以後 Abovee 上的「${a.text}」都認成 ${a.name}`);
  for (const m of marks) lines.push(`${m.names.join('、')} 在 ${m.month}壓表清單上標成壓完`);

  return { title: n ? `記錄這 ${n} 段？` : `改這 ${adopts.length} 段？`, lines };
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
 * 這次新加的段裡，**沒有扣任何額度**的不算次數的課叫什麼（去重）。
 *
 * 同一門課但扣著額度的那一段不算 —— 那一段會扣，講「一個都不會變」就是假話（ADR-0070）。
 */
function uncountedNames(visit, coursesById = {}, added = null) {
  const slots = visit?.slots ?? [];
  const seen = new Set();
  for (const i of added ?? slots.map((_, at) => at)) {
    const slot = slots[i];
    if (!slot || slot.entitlementId || isNthSlot(slot)) continue;
    const course = coursesById[slot.courseId];
    if (isUncounted(course)) seen.add(course.name);
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
 * @param {Set<string>|null} [asked] 有按 ✓ 或 ✗ 的那幾段（ADR-0110），key 同 `rejected`。
 *   沒按的那幾段還在等，不可以講它們會長出什麼。沒給＝每一段都問過了
 */
export function confirmConsequences(
  visits = [], coursesById = {}, sheetSyncOn = false, rejected = new Set(), tasksByVisit = {},
  asked = null,
) {
  // 用短的那一版（`shortStatus`）不用完整那一句：她看的是日曆，而日曆的圖例
  // 上寫的就是「待確認」「已確認」。同一件事在兩個地方用兩種講法會讓她多想一秒。
  const lines = [`日曆上這幾段從「${shortStatus(INITIAL_STATUS)}」變成「${shortStatus('confirmed')}」`];

  // 這一次真的有段談定的那幾天，寫進去之後長什麼樣。**走真的那一支**
  // （`applyConfirmation()`，`home.js` 存的就是它的結果），不在這裡再推一次。
  const settled = [];
  for (const before of visits ?? []) {
    const all = (before.slots ?? []).map((_, i) => i);
    const mine = asked ? all.filter((i) => asked.has(`${before.id}:${i}`)) : all;
    const out = new Set(mine.filter((i) => rejected.has(`${before.id}:${i}`)));
    const confirming = mine.filter((i) => !out.has(i)
      && slotStatus(before, before.slots[i]) === 'pending_confirm');
    if (confirming.length) {
      settled.push({ before, after: applyConfirmation(before, out, undefined, asked ? new Set(mine) : null) });
    }
  }

  const later = new Set();
  for (const { before, after } of settled) {
    // 只講**這一次才談定**的那幾段長出來的 —— 沒給任務時，早就談定的段看起來也像沒掛過
    const now = (after.slots ?? []).map((_, i) => i).filter((i) =>
      slotStatus(before, before.slots[i]) === 'pending_confirm'
      && slotStatus(after, after.slots[i]) === 'confirmed');
    // 不帶 today：抽屜列的是 `visitsToConfirm()`，本來就只收今天以後 —— 日期那一道（ADR-0113）碰不到
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
 * 這一次按了「做了」的段裡，**幾段真的扣次數**。只有扣著額度的段會扣（ADR-0121）——
 * n返 與不算次數的課沒有額度。只看還開著的段（`slotsToClose()`）：已經結掉的不會再被動到。
 *
 * 抽屜上那一句（`closeConsequences()`）與存完的那一句（`closedSay()`）問同一支。
 * 2026-10-07 之前存完那一句在畫面裡自己數「按了 ✓ 的有幾段」，於是抽屜寫「2 段裡 1 段扣掉次數」、
 * toast 寫「扣掉 2 次」。
 */
export function chargedOnClose(visit, picks = []) {
  return slotsToClose(visit)
    .filter(({ index }) => picks[index] === true && visit?.slots?.[index]?.entitlementId)
    .length;
}

/** 簽療程單存完之後那一句的前半。講的是**這一次**，不是整天。 */
export function closedSay(visit, picks = []) {
  const charged = chargedOnClose(visit, picks);
  if (charged) return `記好了，扣掉 ${charged} 次`;
  const did = slotsToClose(visit).filter(({ index }) => picks[index] === true).length;
  if (did) return `記好了，${did === 1 ? '這一段' : '這幾段'}不扣次數`;
  return '記好了，沒來的不扣次數';
}

/**
 * 結案（簽療程單）那一下會發生什麼。收尾抽屜底下那一句預告。
 *
 * **只講這一筆真的會發生的事**：整批都沒做就不要說「次數扣掉」，
 * 沒有健檢就不要說「會多一張追蹤健檢報告」。講一件不會發生的事，
 * 比沒講還糟（那正是她說看不懂的那幾句的毛病）。
 *
 * **照段講**（2026-09-24，ADR-0110）：她可以先結幾段、其餘留著。以前這裡照整天講
 * （「日曆上這一天改成已完成」「會多一張寫紀錄」）—— 營養諮詢沒來、SIS 做了時
 * 也說會多一張寫紀錄。「這一天改成…」只在最後一段也結掉時才講，
 * 結果走 `closeVisit()` 算（跟真的會寫下去的是同一支，ADR-0070）。
 *
 * **「會多一張追蹤健檢報告」問真的會長什麼**（2026-10-08，ADR-0139）：把 `closeVisit()` 的結果換進這位客戶的
 * 來訪裡，叫存檔時真的在跑的 `syncFollowupTasks()`。以前照「打勾的段裡有沒有健檢」自己推 ——
 * 健檢和二返同一次排好時抽屜說會多一張、存完一張都沒有；報告勾過、二返次數用完的那幾種也照講。
 * 所以**這位客戶的全部來訪與任務要一起傳進來**（抽屜打開時跟額度同一趟補讀）；沒傳就當成只有這一筆。
 *
 * **「約二返」長出來或收起來也講**（2026-10-09，ADR-0142）：名額先給報告勾過的那一次之後，簽**這一次**健檢那一下，
 * **另一次**健檢的「約二返」會長出來（二返簽成沒來也會）。同一次試算，一張一行、講出是哪一天那一次健檢的。
 * 追蹤健檢報告照舊只講這一筆的（ADR-0139）。
 *
 * @param {object} o
 * @param {object} o.visit 那一筆來訪
 * @param {(boolean|null)[]} o.picks 逐段：`true` 做了、`false` 沒來、`null` 先不結（`closeVisit()` 收的那一份）
 * @param {object[]} o.entitlements 這位客戶的額度（要判斷有沒有健檢配二返）
 * @param {Record<string, object>} o.coursesById
 * @param {boolean} [o.sheetSyncOn]
 * @param {object[]} [o.visits] 這位客戶的全部來訪（含這一筆現在的樣子）
 * @param {object[]} [o.tasks] 這位客戶的任務，**連清掉的**（`listByCustomerForSync()`，ADR-0106）
 * @returns {string[]}
 */
export function closeConsequences({
  visit, picks = [], entitlements = [], coursesById = {}, sheetSyncOn = false, visits = [], tasks = [],
}) {
  const lines = [];
  const open = slotsToClose(visit).map(({ index }) => index);
  const done = open.filter((i) => picks[i] === true);
  const missed = open.filter((i) => picks[i] === false);
  const left = open.length - done.length - missed.length;

  // **只有扣著額度的段會扣次數**（ADR-0121）。n返 與不算次數的課沒有額度，
  // 講「扣掉次數」是一件不會發生的事（ADR-0070）—— 2026-10-05 之前這一句對 n返 就講錯了
  const charged = chargedOnClose(visit, picks);
  if (done.length && charged === done.length) lines.push(`做了的 ${done.length} 段扣掉次數`);
  else if (charged) lines.push(`做了的 ${done.length} 段裡 ${charged} 段扣掉次數`);
  else if (done.length) lines.push(`做了的 ${done.length} 段記成「${shortStatus('done')}」，不扣次數`);
  if (missed.length) lines.push(`沒來的 ${missed.length} 段記成「${shortStatus('no_show')}」，次數不扣`);
  if (left) {
    lines.push(`還有 ${left} 段先不結，留在這裡`);
  } else if (done.length || missed.length) {
    const after = closeVisit(visit, picks);
    lines.push(`日曆上這一天改成「${shortStatus(after.status)}」`);
  }

  const slots = visit?.slots ?? [];
  // 健檢結案才長「追蹤健檢報告」（ADR-0042：報告要兩三週，報告沒到就不可能約）。
  // **長不長問存檔時真的在跑的那一支**（ADR-0070、0139、0142），這一頁不自己推、也不認課程名字。
  const chain = (done.length || missed.length)
    ? chainAfterClose(visit, picks, { entitlements, coursesById, visits, tasks }) : null;
  if (chain?.create.some((t) => t.kind === REPORT_TASK_KIND && t.visitId === visit?.id)) {
    lines.push(`待辦會多一張「${REPORT_TASK_KIND}」—— 健檢做完要等報告出來`);
  }
  if (chain) lines.push(...bookingLinesOf(chain, chain.visits, tasks));

  // 二返與營養師諮詢那一種：客人走了之後要去補一份文字紀錄（ADR-0066）。
  // 判斷走課程主檔上的那個勾，跟「要不要簽療程單」同一種做法。
  // **只講打勾的那幾段**（ADR-0112）—— 沒來就沒有紀錄要寫，而
  // `recordTasksForVisit()` 也真的不會為它長出來。
  if (done.some((i) => coursesById[slots[i]?.courseId]?.needsRecord)) {
    lines.push(`待辦會多一張「${RECORD_TASK_KIND}」—— 客人走了之後要補的那一份`);
  }

  if (sheetSyncOn) lines.push(SHEET_LINE);
  return lines;
}

/**
 * 存完之後健檢那條鏈上的「約二返」會怎麼動 —— 拿存檔時真的在跑的那一支（`syncFollowupTasks()`）試算，一張一行
 * （ADR-0070、0142）。取消那一道用它；**一次取消好幾筆的入口（批次取消、確認抽屜）全部套上去之後叫一次**，
 * 逐筆算再合起來的話，取消兩場二返每一筆只看得到一場。
 *
 * @param {object} o
 * @param {{id:string, name?:string}} o.customer
 * @param {object[]} o.visits 這位客戶**存完之後**的全部來訪
 * @param {{entitlements:object[], tasks:object[]}|null} o.chain `data/visits.js` 的 `chainInputs()`；`null`＝沒有鏈或讀不到
 * @param {Record<string, object>} o.coursesById
 * @returns {string[]}
 */
export function followupBookingLines({ customer, visits = [], chain = null, coursesById = {} }) {
  if (!chain || !pairsOf(chain.entitlements ?? [], coursesById).some((p) => p.followup)) return [];
  const plan = syncFollowupTasks({
    customer, entitlements: chain.entitlements, visits, tasks: chain.tasks ?? [], coursesById,
  });
  return bookingLinesOf(plan, visits, chain.tasks);
}

/** 一份試算（`create`／`remove`）裡「約二返」那幾張，一張一行、講出是哪一天那一次健檢的。 */
function bookingLinesOf({ create = [], remove = [] }, visits, tasks) {
  const examDay = (id) => {
    const date = (visits ?? []).find((v) => v.id === id)?.date;
    return isValidDate(date) ? `${shortDate(date)} 那一次健檢` : '另一次健檢';
  };
  const lines = create.filter((x) => x.kind === FOLLOWUP_TASK_KIND)
    .map((t) => `待辦會多一張「${FOLLOWUP_TASK_KIND}」—— ${examDay(t.visitId)}的報告拿到了、二返還欠一次`);
  for (const r of remove) {
    const t = (tasks ?? []).find((x) => x.id === r.id);
    if (t?.kind === FOLLOWUP_TASK_KIND) lines.push(`${examDay(t.visitId)}的「${FOLLOWUP_TASK_KIND}」會收起來 —— ${r.reason}`);
  }
  return lines;
}

/**
 * 這一筆照 `picks` 結掉之後，存檔那一下健檢那條鏈會怎麼動（`syncFollowupTasks()` 的 `create`／`remove`），
 * 連同試算用的那一份來訪（講日期用）。沒有配得到二返的健檢額度就是 `null`。
 *
 * 跟 `data/visits.js` 的 `followupOps()` 餵同一支、同一種輸入：這位客戶的來訪裡把這一筆換成結完的樣子。
 * 死線的天數不影響長不長，所以不用讀設定。
 */
function chainAfterClose(visit, picks, { entitlements, coursesById, visits, tasks }) {
  // 沒有配得到二返的健檢額度就不可能有鏈（同 `followupOps()` 的提前結束）
  if (!pairsOf(entitlements, coursesById).some((p) => p.followup)) return null;

  const all = [...(visits ?? []).filter((v) => v.id !== visit?.id), closeVisit(visit, picks)];
  const { create, remove } = syncFollowupTasks({
    customer: { id: visit?.customerId ?? null, name: visit?.customerName ?? null },
    entitlements,
    visits: all,
    tasks,
    coursesById,
  });
  return { create, remove, visits: all };
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
 * @param {object[]} [o.sameDay] 這位客戶的來訪（整份丟進來就好，這裡自己挑同一天的別筆）。
 *   那一天已完成之後再加的段在另一筆裡（ADR-0083）—— 少了它，取消那一段會說「那一天就整個取消了」
 * @param {{entitlements:object[], tasks:object[]}|null} [o.chain] 這位客戶的額度與任務（`data/visits.js` 的 `chainInputs()`）。
 *   帶了才講「約二返」會長出來／收起來（`followupBookingLines()`，拿 `sameDay` 當全部來訪）；
 *   一次取消好幾筆的入口不要帶，全部套上去之後自己叫 `followupBookingLines()` 一次
 * @returns {string[]}
 */
export function cancelConsequences({
  visit, coursesById = {}, tasks = [], removing = false, sheetSyncOn = false, slotIndex = null,
  sameDay = [], chain = null,
}) {
  // 「約二返」那幾句：這一筆換成取消（刪除就拿掉）之後的全部來訪去試算
  const bookingSaid = (after) => followupBookingLines({
    customer: { id: visit?.customerId ?? null, name: visit?.customerName ?? null },
    visits: [...(sameDay ?? []).filter((v) => v.id !== visit?.id), ...(after ? [after] : [])],
    chain,
    coursesById,
  });

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

    // **沒扣額度的段沒有次數可以還**（n返、不算次數的課，ADR-0121）—— 以前一律講會還回來
    const back = picked.size === 1 ? '這一段會退回去' : `這 ${picked.size} 段會退回去`;
    const charged = [...picked].filter((i) => all[i]?.entitlementId).length;
    lines.push(charged ? `${back}，次數也會還回來` : `${back} —— 本來就不扣次數`);
    // **那一天別筆來訪裡還活著的段也算剩下的**（2026-10-07）：這一筆沒有剩下的段，不代表那一天沒有 ——
    // 已完成的那一段在另一筆裡。底下 `after` 與任務那幾句照舊只看這一筆（它確實整筆取消了）
    // 「同一天的別筆」只問 `sameDayState()`（ADR-0083：各寫一份的話遲早有一份漏掉一個狀態）
    const { open, closed } = sameDayState(sameDay, visit.customerId, visit.date, { excludeVisitId: visit.id });
    const elsewhere = [open, ...closed].filter(Boolean).reduce((n, v) => n + liveSlots(v).length, 0);
    if (left + elsewhere) lines.push(`那一天剩下的 ${left + elsewhere} 段不受影響`);
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
    lines.push(...bookingSaid(after));

    lines.push('改期不是改日期，是取消後重新排一次');
    if (sheetSyncOn) lines.push(SHEET_LINE);
    return lines;
  }

  // **第一句就講範圍**（ADR-0087）：按鈕寫「取消一整天」，以前跳出來的第一句
  // 卻只講「3 個時段」—— 她得自己推出那是整天。
  // 那一天一段扣額度的都沒有（全是 n返 或不算次數的課）就不講次數（ADR-0121）
  const refund = all.some((sl) => sl?.entitlementId) ? '，次數也會還回來' : '';
  lines.push(removing
    ? `這是標記刪除，資料不會真的消失；這一整天的 ${slots} 個時段會退回去${refund}`
    : `這一整天的 ${slots} 個時段會退回去${refund}`);

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
  lines.push(...bookingSaid(removing ? null
    : { ...visit, status: 'cancelled', slots: all.map((sl) => ({ ...sl, status: 'cancelled' })) }));

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
 * @param {string|null} [o.today] 改到過去那一天時不講「會多一張 Examine」（ADR-0113）
 * @returns {{title: string, lines: string[]}}
 */
export function rebookConsequences({
  before, after, index, tasks = [], coursesById = {}, sheetSyncOn = false, today = null,
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
  const later = registrationsWhenSettled(after, [after.slots.length - 1], tasks, coursesById, today);
  if (later.length) lines.push(`等客人說可以之後，待辦會再多${moreTasks(later)}`);
  lines.push('改期不是改日期，是取消後重新排一次');
  if (sheetSyncOn) lines.push(SHEET_LINE);
  // 不用壓的課（ADR-0126）沒有地方要她先去改，抬頭不可以印成「在 null 壓好了嗎？」
  const where = bookingSystemOf(coursesById[fresh?.courseId]);
  return {
    title: where ? `新的時間在 ${where} 壓好了嗎？` : '改到新的時間？',
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

// ---------- 存課程之前：談定的那幾天要跟著變（ADR-0140）----------

/**
 * 改了一門課「壓哪幾個系統」或「寫紀錄」，存之前講一次：哪幾天的待辦會跟著變。
 *
 * **數字是試算出來的，不是照規則在這裡推的**（ADR-0070）：`plan` 是 `data/visits.js` 的
 * `courseTaskPlan()` 回的那一份，而存下去的那一支（`saveCourseWithTasks()`）跑的是同一段。
 *
 * 一天都不影響就回 `null` —— 那代表「不用問」。改的是名字、時長、診間那幾格時走的就是這一條。
 *
 * 「天」是來訪（ADR-0087：畫面上不講筆）。同一天兩位客人算兩天，跟簽療程單那一頁的「還有 N 天沒結案」同一種數法。
 *
 * @param {object} o
 * @param {{name?: string}} o.course 要存的那一門
 * @param {{rows: {create:object[], update:object[], remove:{kind?:string}[]}[]}} o.plan
 * @returns {{title:string, consequences:string[], confirmLabel:string}|null}
 */
export function courseChangeConsequences({ course, plan } = {}) {
  const rows = (plan?.rows ?? []).filter(
    (r) => (r.create?.length ?? 0) + (r.update?.length ?? 0) + (r.remove?.length ?? 0) > 0,
  );
  if (!rows.length) return null;

  const tally = (list) => {
    const by = new Map();
    for (const t of list) by.set(t.kind, (by.get(t.kind) ?? 0) + 1);
    return [...by];
  };
  const grown = tally(rows.flatMap((r) => r.create ?? []));
  const gone = tally(rows.flatMap((r) => r.remove ?? []));
  const shrunk = rows.reduce((n, r) => n + (r.update?.length ?? 0), 0);

  const lines = [`會影響 ${rows.length} 天的待辦`];
  for (const [kind, n] of grown) lines.push(`多 ${n} 張「${kind}」`);
  for (const [kind, n] of gone) lines.push(`還沒做的「${kind}」收掉 ${n} 張`);
  if (shrunk) lines.push(`有 ${shrunk} 張改成只掛還要掛的那幾段`);
  if (gone.length || shrunk) lines.push('勾過的不動');

  return { title: `儲存「${course?.name ?? ''}」？`, consequences: lines, confirmLabel: '儲存' };
}
