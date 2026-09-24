// 待辦中心的流程分段。SPEC 第 8.1 節。純函式。
//
// 首頁本來是一排長得一樣的列，順序是**寫死在樣板裡的出現順序** —— 那個順序
// 沒有任何人決定過，它是「先寫的先出現」。而她要的是「下一步是什麼」。
//
// 所以段落的定義放在這裡而不是放在 `views/home.js`：「這件事是流程的第幾步」
// 之後進度追蹤頁也會問同一句，而同一件事在兩個畫面歸到不同的段，
// 她不會知道哪個算數（同 ADR-0028 的理由）。
//
// 見 docs/adr/0043-the-todo-centre-follows-the-flow.md。

import {
  isCancelKind, bookingSystemFor, tasksForCategory, systemOfCancelKind,
  RECORD_TASK_KIND, tasksForVisit, recordTasksForVisit, registrationClosed,
} from './taskRules.js';
import {
  FOLLOWUP_TASK_KIND, REPORT_TASK_KIND, SEND_REPORT_TASK_KIND, followupCourseIdOf,
} from './followups.js';
import { dayOf, shortDate } from './dates.js';
import { formSlotIndexes, slotStatus, isLiveSlot, visitCourseLabel } from './visits.js';
import { timeLabel } from './visitTime.js';

/**
 * 她真的在做的順序。**編號講的是流程的第幾步，不是畫面上的第幾段** ——
 * 中間某一段空了，其餘的編號不重新編。
 *
 * `tone` 對到 `tokens.css` 已經有的來訪狀態色，**一個新色相都不開**
 * （ADR-0039 已經記著色相不夠用了）。而且借得剛好：待辦的階段本來就對應
 * 那一筆來訪當下的狀態 —— 她在待辦上看到琥珀色的那一段，日曆上那幾筆
 * 也正是琥珀色的。
 */
export const STAGES = [
  { id: 'ask', n: 1, label: '問到時間', tone: 'none' },
  { id: 'book', n: 2, label: '壓表', tone: 'none' },
  { id: 'confirm', n: 3, label: '等客人回覆', tone: 'pending' },
  { id: 'before', n: 4, label: '來訪前一天', tone: 'confirmed' },
  { id: 'onday', n: 5, label: '來訪當天', tone: 'onday' },
  { id: 'after', n: 6, label: '來訪之後', tone: 'done' },
  { id: 'undo', n: 7, label: '要收回來的', tone: 'no-show' },
];

/**
 * 拿掉的任務種類。它們不再產生，但 Firestore 裡已經有的不會消失 ——
 * 已完成的是紀錄（SPEC 第 6.1 節），未完成的是她真的還沒做的事。
 *
 * 「壓表就是 Abovee 登記」見 ADR-0041；打電話是 2026-08-23 拿掉的。
 */
export const RETIRED_KINDS = ['打電話', 'Abovee'];

export const isRetired = (kind) => RETIRED_KINDS.includes(kind);

/**
 * 每一種待辦在哪一段、段裡排第幾。**寫成一個有序的陣列而不是一張表**，
 * 因為這兩件事本來就是同一個順序：這一份的先後就是她做事的先後。
 *
 * 段裡的順序不能交給死線 —— 「追蹤健檢報告」的死線是 21 天，「約二返」是
 * 拿到報告之後 7 天，照死線排會把鏈條的第二站排到第一站前面。
 */
const FLOW = [
  // 推導出來的那幾列（不是任務，所以用列的 id 問）
  ['ask', 'ask'],
  ['forms', 'ask'],
  ['book', 'book'],
  ['confirm', 'confirm'],
  // 任務種類
  ['Examine', 'before'],
  ['耀聖', 'before'],
  ['close', 'onday'],
  // 「寫紀錄」排在⑥的最前面。她自己就把它寫成「後」，而它是客人走了之後
  // 立刻做的；追蹤報告是三週後的事（ADR-0043：段裡的順序是她做事的順序）。
  [RECORD_TASK_KIND, 'after'],
  [REPORT_TASK_KIND, 'after'],
  // 寄報告排在約二返前面：她自己標的順序就是「(1) 寄報告 (2) 三系統」，
  // 而約二返比三系統更前面。兩張的死線一樣，所以先後只能由這一份決定
  //（ADR-0043：段裡的順序不能交給死線）。
  [SEND_REPORT_TASK_KIND, 'after'],
  [FOLLOWUP_TASK_KIND, 'after'],
  ['cancel', 'undo'],
];

const STAGE_OF = Object.fromEntries(FLOW);
const ORDER_OF = Object.fromEntries(FLOW.map(([kind], i) => [kind, i]));

/**
 * 一種待辦屬於流程的哪一段。列的 id 與任務種類都吃得下。
 *
 * **認不得的一律回 `before`。** 那不是隨便挑的：認不得的種類只有兩種來源，
 * 已經拿掉的那幾種（打電話、Abovee）與她手動加的，而兩種都是
 * 「來訪之前要去做的事」。回 `undo` 或另開一段「其他」會讓那幾列
 * 排在最後面，而它們可能是今天就該做的。
 */
export function stageOf(kind) {
  if (isCancelKind(kind)) return 'undo';
  return STAGE_OF[kind] ?? 'before';
}

/**
 * 段裡排第幾。**認不得的排最後**（已經拿掉的那幾種、她手動加的）——
 * 它們還在清單上是因為那是她真的還沒做的事，但不該擋在該做的事前面。
 */
export function orderOf(kind) {
  if (isCancelKind(kind)) return ORDER_OF.cancel;
  return ORDER_OF[kind] ?? Number.POSITIVE_INFINITY;
}

/**
 * 把一批列照流程分段。**空的段留在結果裡**（`rows` 是空陣列）——
 * 首頁上有兩三列是等資料回來才補的，段落先在那裡，補進來才有位置放。
 * 要不要畫由畫面決定（CSS 的 `:has()`）。
 *
 * @param {{id: string}[]} rows 每一列至少要有 id
 * @returns {{stage: object, rows: object[]}[]} 照 STAGES 的順序
 */
export function groupByStage(rows = []) {
  return STAGES.map((stage) => ({
    stage,
    rows: rows
      .filter((r) => stageOf(r.id) === stage.id)
      .sort((a, b) => orderOf(a.id) - orderOf(b.id)),
  }));
}

/**
 * 現在最該做的是哪一段。首頁那句「下一步是⋯⋯」用。
 *
 * 「最該做」＝ **流程上最前面那個還有東西的段**，不是數字最大的那一段 ——
 * 她的問題是「接下來做什麼」，而流程的答案是從頭開始。
 * 逾期優先於流程，那一段在畫面上另外處理（三顆大數字）。
 *
 * @returns {object|null} STAGES 裡的一個
 */
export function nextStage(counts = {}) {
  return STAGES.find((s) => (counts[s.id] ?? 0) > 0) ?? null;
}

/**
 * 已經勾掉的照完成那一天分段，新的在前。
 *
 * 「已完成」那一格是條列式往下，中間插日期分隔（她的原話是「會有今天(完成的)
 * 幾月幾號等等」）。分段是規則不是排版：同一天勾掉的要在一起，而「同一天」
 * 的定義是裝置當地的那一天（`dayOf()`，`doneAt` 存的是 ISO 字串）。
 *
 * **讀不出完成時間的收在最後那一組（`day: null`）**，不要丟掉也不要猜一天 ——
 * 猜出來的日期會讓她以為那件事是那天做的。
 *
 * @param {object[]} tasks 已經勾掉的那些
 * @returns {{day: string|null, tasks: object[]}[]}
 */
export function groupByDoneDay(tasks = []) {
  const groups = new Map();

  for (const t of tasks ?? []) {
    const day = dayOf(t?.doneAt);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(t);
  }

  return [...groups.entries()]
    .map(([day, rows]) => ({ day, tasks: rows }))
    .sort((a, b) => {
      if (a.day === b.day) return 0;
      if (a.day === null) return 1;
      if (b.day === null) return -1;
      return b.day.localeCompare(a.day);
    });
}

// ---------------------------------------------------------------------------
// 一筆來訪身上的整份待辦
// ---------------------------------------------------------------------------

/*
 * ## 「這一天共用」那一句去哪了（2026-09-12）
 *
 * 它被標了兩次又收了兩次：2026-09-09 加上標籤（她問「勾一次為什麼兩邊都掉」）、
 * 2026-09-10 收進一顆 `?`（她：「單純誤導使用者且占版面」）、
 * 2026-09-12 整個刪掉（她：「完全沒必要，全部刪除」）。
 *
 * **那句話從頭到尾沒有寫錯，而且那件事還在發生**：任務只掛 `visitId`
 *（`tasksForVisit()` 收整筆、逐段跑完去重），所以在早上那一段勾掉 Examine，
 * 下午那一段也會跟著掉。**畫面上從此不講這件事是一個知情的取捨** ——
 * 她看過三個版本才這樣決定的。規則本身一行都沒有變。
 */

/**
 * 這一筆來訪走到哪了 —— 它身上的每一件待辦與各自做完了沒。
 *
 * 來訪的讀取卡片用（`ui/views/calendar.js` 的 `visitReadHtml()`，四個畫面共用）。
 *
 * ## 兩種來源都要列，少一種那張表就在說謊
 *
 * | 來源 | 哪幾種 |
 * |---|---|
 * | `tasks` 集合 | Examine、耀聖、寫紀錄、追蹤健檢報告、約二返、寄報告給醫師、取消 X |
 * | **從來訪推導** | 跟客人確認時間、簽療程單 |
 *
 * 漏掉推導的那兩種是最容易犯的錯：**她每天做最多次的就是那兩件**，
 * 而它們不在 `tasks` 集合裡（CONTEXT.md 的「待辦」條目在講這件事）。
 *
 * 推導那兩種的條件**不自己寫**：確認那一列是 `pending_confirm`（ADR-0001），
 * 簽療程單那一列照 `visitsToClose()` 的三個條件。在這裡另寫一份的話，
 * 同一筆來訪在待辦中心與這張卡片上會給出不同的答案。
 *
 * ## 做完的不消失，畫成劃掉的
 *
 * 她的原話（2026-09-04）：「把所有代辦都列出來，然後完成的不要消失，
 * 而是淡掉劃掉，但我還是需要知道這一場的所有代辦。」
 *
 * 所以推導的那兩列**永遠在**（取消掉的那一筆除外），只是勾起來；
 * 已完成的任務也照樣列。劃掉那一下畫在 `.taskmirror__row.is-done` 上。
 *
 * ## 順序照 `orderOf()`，不照死線
 *
 * 那個順序就是她做事的順序（ADR-0043）。照死線排會把鏈條的第二站排到
 * 第一站前面 —— 追蹤報告的死線是 21 天，約二返是拿到報告之後 7 天。
 *
 * @param {object} visit
 * @param {object} o
 * @param {object[]} [o.tasks] 這一筆來訪的任務（含已完成的）
 * @param {Record<string, object>} [o.coursesById]
 * @param {string|null} [o.today] 「還沒長出來」那幾列要不要補掛號那一族（那一天過了就不會長，ADR-0113）
 * @returns {{key:string, kind:string, done:boolean, dueDate:string|null,
 *            derived:boolean}[]}
 */
export function todosForVisit(visit, {
  tasks = [], coursesById = {}, focusSlot = null, today = null,
} = {}) {
  if (!visit || visit.deletedAt) return [];

  // **她點的是哪一段**（ADR-0080 那條線延伸過來）。沒帶就是整筆 ——
  // 客戶詳情、待辦中心、進度追蹤列的本來就是整筆，它們一個字都不用改。
  // 指到一個不存在的段落也退回整筆（同 `slotsToShow()` 的兩條退路）。
  const slot = Number.isInteger(focusSlot) ? (visit.slots ?? [])[focusSlot] : null;
  if (!slot) return wholeDayTodos(visit, { tasks, coursesById, today });

  // ## 那一段被取消了（`.scratch/asks-2026-09-13/issues/03`）
  //
  // 她 2026-09-13：「可以留著但是就是灰掉就好」「原本的那些一樣有然後灰掉然後多了取消」。
  // 所以原本的待辦照「它還活著的話」列出來、每一列帶 `void`（畫面灰掉，**不劃線** ——
  // 劃線是「做完了」，灰是「不會發生了」），取消類照常。整天取消也走這一條：
  // 那時候每一段都是取消掉的（`slotStatus()`）。
  const voided = slotStatus(visit, slot) === 'cancelled';

  // 「它還活著的話」那一份。活著的段本來就長這樣；取消掉的那一段拿它算原本的待辦。
  // **歸屬也用它算**：二返那一段取消了之後，它的 Examine 仍然是**它的** ——
  // 用只看活著的段去問的話，那一張找不到主人，會掉進「推不出來的一律留著」
  // 而跑到同一天的復能那一段上。
  const asLive = asLiveOf(visit);
  const mineLive = { ...asLive, slots: [asLive.slots[focusSlot]] };
  const scoped = voided ? mineLive : { ...visit, slots: [slot] };

  const mine = ownedKinds(mineLive, asLive, coursesById);
  const rows = [];
  for (const t of tasks ?? []) {
    if (t.deletedAt || t.visitId !== visit.id) continue;
    // 歸屬只有 `ownsTask()` 一支 —— 「詳情」打開哪幾段（`taskSlots()`）問的是同一件事。
    // 取消類不灰：它收的就是取消掉的那一段
    if (ownsTask(t, visit, focusSlot, coursesById, mine)) rows.push(taskRow(t, voided && !isCancelKind(t.kind)));
  }

  // **推導那兩列照她點的那一段算**（ADR-0097）。整筆那個 status 是推導的，
  // 所以同一天加一段還沒問過客人的進去，整筆就退回「待確認」—— 那是對的
  // （`prelaunch-fixes-2026-09-16/issues/08`），但拿它去判「這一段問過了沒」，
  // 早就談定的那幾段會跟著退回未打勾（她 2026-09-16 報的正是這件事）。
  //
  // **取消掉的那一段退回整筆。** 它的 `slot.status` 已經被蓋成 `cancelled`，
  // 那一格再也答不出「它被取消之前談定了沒」（時段上沒有 `confirmedAt`）——
  // 整筆那個 `confirmedAt` 是唯一還問得到的東西，而那一列本來就是灰的。
  rows.push(...derivedRows(visit, scoped, {
    coursesById, focused: true, voided, own: voided ? null : slotStatus(visit, slot),
  }));
  rows.push(...pendingRows(scoped, rows, { coursesById, voided, today }));
  return sortRows(rows);
}

/** 沒指定哪一段：整筆（另外三頁走這一條，2026-09-13 之前的行為一個字都沒動）。 */
function wholeDayTodos(visit, { tasks, coursesById, today }) {
  const rows = (tasks ?? [])
    .filter((t) => !t.deletedAt && t.visitId === visit.id)
    .map((t) => taskRow(t, false));

  // 取消掉的那一筆只剩「取消 X」那幾張還算數 —— 確認與簽單都不會再發生了。
  if (visit.status === 'cancelled') return sortRows(rows);

  rows.push(...derivedRows(visit, visit, { coursesById, focused: false, voided: false }));
  rows.push(...pendingRows(visit, rows, { coursesById, voided: false, today }));
  return sortRows(rows);
}

function taskRow(t, voided) {
  const row = {
    key: t.id,
    kind: t.kind,
    done: Boolean(t.done),
    dueDate: t.dueDate ?? null,
    derived: false,
  };
  if (voided) row.void = true;
  return row;
}

/**
 * 推導的那兩列：跟客人確認時間、簽療程單。
 *
 * @param {object} visit 整筆（`own` 沒給時狀態從它讀）
 * @param {object} scoped 要算哪幾段（點了某一段就只有那一段；取消掉的那一段是「它還活著的話」）
 * @param {{own?: string|null}} o `own` = 她點的那一段自己的狀態（ADR-0097）。
 *   沒給就是整筆 —— 另外三頁列的本來就是整筆來訪，取消掉的那一段也走這一條
 */
function derivedRows(visit, scoped, { coursesById, focused, voided, own = null }) {
  const rows = [];
  const mark = (row) => (voided ? { ...row, void: true } : row);
  // 「這一列問的是哪一個狀態」只算一次 —— 兩列各寫一份的話，遲早有一列漏掉
  // `own` 而又回去讀整筆，而那正是 2026-09-16 那個 bug 的形狀。
  const status = own ?? visit.status;

  // ①→③ 跟客人確認時間。**從來訪推導**（ADR-0001），不是任務。
  //
  // **做完了也要留著，畫成劃掉的。** 她 2026-09-04 的原話：「我希望的是把
  // 所有代辦都列出來，然後完成的不要消失，而是淡掉劃掉，但我還是需要知道
  // 這一場的所有代辦。」所以這一列不會因為客人已經回覆就整列消失 ——
  // 那會讓一張已確認的卡片看起來像從來沒問過人。
  //
  // 整天取消之後整筆的狀態是 `cancelled`，那時候「問過了沒」看 `confirmedAt`。
  //
  // 指名了哪一段時讀的是**那一段**的狀態（ADR-0097）—— 見上面 `status`。
  rows.push(mark({
    key: 'confirm',
    kind: '跟客人確認時間',
    done: status !== 'pending_confirm'
      && (status !== 'cancelled' || Boolean(visit.confirmedAt)),
    dueDate: null,
    derived: true,
  }));

  // ⑤ 簽療程單。**整筆都不用簽的那一天照樣要結案**（只有二返的那一天），
  // 所以這一列跟「有沒有段要簽」無關 —— 那只影響它印哪一句。
  //
  // 日子還沒到也列（同上：她要看到這一場的**全部**），只是還沒勾。
  const closed = status === 'done' || status === 'no_show';
  const needsForm = formSlotIndexes(scoped, coursesById).length > 0;
  rows.push(mark({
    key: 'close',
    // 「不用簽」是用 `scoped` 算的（點了某一段就只有那一段），所以句子也要講那一段 ——
    // 寫「這一天」的話，同一天別段要簽時她會以為整天都不用（ADR-0087）。
    kind: needsForm
      ? '簽療程單'
      : `簽療程單（${focused ? '這一段' : '這一天'}不用簽，但要結案）`,
    done: closed,
    dueDate: null,
    derived: true,
  }));

  return rows;
}

/**
 * 還沒發生、但一定會發生的那幾張。
 *
 * 已經有的那幾種不再多一列；取消掉的那一段列出來也是灰的（沒有「還沒長出來」這回事）。
 */
function pendingRows(scoped, have, { coursesById, voided, today = null }) {
  // 她 2026-09-08：「我發現沒有寫記錄？我發現我修改課程設定的例如要不要簽
  // 療程單或是寫記錄 這個提醒不會更新誒？」
  //
  // 「寫紀錄」與掛號那一族**在那個時機到之前真的不存在**（ADR-0027、0066）——
  // 不是漏列。但她 2026-09-04 就講過要看的是「**這一場的全部**」，
  // 所以這裡把它們補成「還沒發生」的一列。
  //
  // **只補真的會發生的**（ADR-0070）：課程沒勾「做完要寫紀錄」就不要列，
  // 那是在講一件不會發生的事。判斷全部走 `taskRules.js` 的既有規則，
  // 這裡一條都不自己寫 —— 她改了課程主檔上那個勾，這一列跟著變。
  //
  // **那一天過了，掛號那一族就不會再長**（`registrationClosed()`，ADR-0113）—— 同一支閘門，
  // 不然卡片寫著 Examine「到時候才會長出來」，而它永遠不會來。
  const already = new Set(have.map((r) => r.kind));
  const out = [];
  const registrations = registrationClosed(scoped, today) ? [] : tasksForVisit(scoped, coursesById);
  for (const t of [...registrations, ...pendingRecordTasks(scoped, coursesById)]) {
    if (already.has(t.kind)) continue;
    already.add(t.kind);
    const row = {
      key: `pending:${t.kind}`,
      kind: t.kind,
      done: false,
      dueDate: t.dueDate ?? null,
      derived: true,
    };
    // 呼叫端拿 `pending` 畫得淡一點、旁邊寫一句「到時候才會長出來」
    if (voided) row.void = true;
    else row.pending = true;
    out.push(row);
  }
  return out;
}

/**
 * **這一張待辦屬於第 `index` 段嗎。** 讀取卡片列不列它（`todosForVisit()`）與「詳情」打開哪幾段
 * （`taskSlots()`）問的是同一件事，所以只有這一支 —— 各寫一份的話，詳情打開第 1 段，
 * 第 1 段的卡片上卻沒有那一張（`.scratch/asks-2026-09-24/issues/08`）。
 *
 * 1. 取消類**不問課程，問它收的是哪幾段**（`ownsCancel()`）
 * 2. 記著 `slotIndexes` 的照它（掛號 ADR-0107、寫紀錄 ADR-0112）—— 同一天可以有兩張 Examine
 * 3. 其餘（舊任務、健檢那條鏈）退回「這一段自己長不長得出這一種」（`ownedKinds()`）
 *
 * @param {(kind: string) => boolean} [mine] 呼叫端已經算好的 `ownedKinds()`（一張卡片只算一次）
 */
function ownsTask(task, visit, index, coursesById, mine = null) {
  if (isCancelKind(task.kind)) return ownsCancel(task, visit, index, coursesById);
  if (Array.isArray(task.slotIndexes)) return task.slotIndexes.includes(index);
  if (mine) return mine(task.kind);
  const asLive = asLiveOf(visit);
  return ownedKinds({ ...asLive, slots: [asLive.slots[index]] }, asLive, coursesById)(task.kind);
}

/** 「它還活著的話」那一份：每一段的狀態抹掉（歸屬用它算，見 `todosForVisit()`）。 */
const asLiveOf = (visit) => ({ ...visit, slots: (visit?.slots ?? []).map((s) => ({ ...s, status: null })) });

/**
 * **這一張待辦講的是哪幾段**（`visit.slots` 裡的位置）。「詳情」、「N 項」、那一行小字都問它。
 *
 * 她 2026-09-24：「為甚麼不是只呈現真的被取消的那幾段?而是其他段也會顯示出來 ?…
 * 所以幫我全域排查 詳情只呈現和這項有關的而不是整天的」。
 *
 * 歸屬走 `ownsTask()`（讀取卡片同一支）。一段都認不到（她手動加的、指到不存在的段）→ **整天**：
 * 靜默畫成空的比多畫幾段糟。
 *
 * @returns {number[]} 照順序；沒有時段回空陣列
 */
export function taskSlots(task, visit, coursesById = {}) {
  const all = (visit?.slots ?? []).map((_, i) => i);
  const mine = ownedSlots(task, visit, coursesById);
  return mine.length ? mine : all;
}

/**
 * 一列任務要講的三件事：**哪一種、哪一天、哪一場**。
 *
 * 她的原話：「客戶詳情裡的任務目前只會顯示 Examine 或 耀聖，資訊量太少……
 * 例如：Examine・9/1・二返」。
 *
 * 三個地方共用（試算表的 TODO／FINISHED 區、客戶詳情、待辦中心）——
 * 三份寫法遲早會有一份用死線當日期，而那一份會差一天。
 *
 * **日期取來訪那一天，不是死線。** 她認的是「哪一天那一場」，而死線是它的
 * 前一天（`dueDateFor()`），兩個差一天最容易看錯人。來訪找不到（獨立待辦、
 * 來訪被刪了）才退回死線，而且標記 `fromDue` —— 畫面要講明那是死線，
 * 不可以把死線畫成來訪日。
 *
 * **不要拿 `dueDate + 1` 反推來訪日**：取消類的任務不是那樣算的
 *（`cancelTask()` 在今天早於死線時直接用今天），反推出來的日期會有一部分
 * 是錯的，而錯的日期看起來跟對的一模一樣。
 *
 * **只講這一張的那幾段**（`taskSlots()`，`.scratch/asks-2026-09-24/issues/08`）：每一段「開始時間 名字」，
 * 幾段用「、」接（`10:00 門診、15:00 門診`）。同一天分兩次確認會有兩張 Examine（ADR-0107），
 * 逐段取消也是（ADR-0091）—— 印整筆的課程的話兩張長得一模一樣。取消類掛的是取消掉的段，
 * 所以**不濾取消的**。沒記段落的舊任務照課程推（寫紀錄＝要寫紀錄的那一段、健檢鏈＝健檢那一段）；
 * 推不出來、或推出來就是整天的，照舊講整筆（`visitCourseLabel()`，同名去重）。
 *
 * 2026-09-24 從 `taskRules.js` 搬來：它要問 `taskSlots()`，而 `taskRules.js` import 這一支
 * 會在載入時撞到頂層的 `FLOW`（它讀 `taskRules.js` 的 `RECORD_TASK_KIND`）。
 *
 * @param {object} task
 * @param {object|null} [visit] 那一筆來訪。呼叫端手上本來就有，
 *   所以這一支不去讀 —— 任務身上沒有來訪日與課程名，也不該有
 *   （那會是第二份會對不起來的資料，見 `data/tasks.js` 的檔頭）。
 * @param {object|null} [master] 課程與器材主檔。帶了就講**顯示名稱**
 *   （跟日曆同一種寫法），也才推得出舊任務是哪一段；沒帶就退回時段上的快照（`visitCourseLabel()`）。
 * @returns {{kind: string, date: string|null, fromDue: boolean, what: string, lines: string[]}}
 *   `what` 是一行（試算表 TODO 區一格一行）；`lines` 是畫面上那幾行小字，見底下
 */
export function taskLine(task, visit = null, master = null) {
  const hasVisit = Boolean(visit?.date);
  const slots = visit?.slots ?? [];
  const coursesById = Object.fromEntries((master?.courses ?? []).map((c) => [c.id, c]));
  const mine = ownedSlots(task, visit, coursesById);
  // 講「那幾段」的條件：這一張自己記著段落，或推出來的只是其中幾段
  const some = mine.length && (Array.isArray(task?.slotIndexes) || mine.length < slots.length);
  return {
    kind: task?.kind ?? '',
    date: hasVisit ? visit.date : (task?.dueDate ?? null),
    fromDue: !hasVisit,
    // 課程名的去重與「認不出來時退回 N 段」只在 `visitCourseLabel()`，
    // 不要在這裡再寫一次。沒有時段就沒有東西可講。
    what: some
      ? mine.map((i) => `${timeLabel({ startsAt: slots[i].startsAt })} ${
        visitCourseLabel({ slots: [slots[i]] }, master)}`).join('、')
      : (slots.length ? visitCourseLabel(visit, master) : ''),
    lines: hasVisit ? linesOf(visit, mine.length ? mine : slots.map((_, i) => i), master) : [],
  };
}

/**
 * 畫面上那幾行小字：**一段一行**，「9/24(四) SIS(60)」—— 日期與項目，不寫時間。
 *
 * 她 2026-09-24：「如果有兩項…也換行呈現出來不要只呈現一個也不要都擠一起，並且可以只寫日期和項目就好，
 * 不用寫時間，具體的可以看詳情」。**同一天有另一段同名時才補時間**（Q5：「只在這種時候補上時間」）——
 * 10:00 門診、15:00 門診各一張 Examine 時，兩張不補的話長得一模一樣。比的是**那一天的每一段**，
 * 不是這一張蓋的那幾段。待辦中心分類頁與 `tasklist.js` 兩個畫面共用。
 */
function linesOf(visit, at, master) {
  const slots = visit?.slots ?? [];
  const day = shortDate(visit.date);
  if (!slots.length) return [day];
  const names = slots.map((s) => visitCourseLabel({ slots: [s] }, master));
  return at.map((i) => {
    const twin = names.some((n, j) => j !== i && n === names[i]);
    return [day, twin ? timeLabel({ startsAt: slots[i].startsAt }) : '', names[i]].filter(Boolean).join(' ');
  });
}

/** `taskSlots()` 的前半：真的認得到的那幾段（可能是空的）。 */
function ownedSlots(task, visit, coursesById = {}) {
  if (!task) return [];
  return (visit?.slots ?? []).map((_, i) => i).filter((i) => ownsTask(task, visit, i, coursesById));
}

/**
 * 回一支「這一種算不算她點的那一段的」。
 *
 * ## 任務身上沒有段落，所以只能推
 *
 * `tasksForVisit()` 是逐段算完**去重**的（一天兩段健檢只長一張 Examine），
 * 所以任務上沒有、也不該有「第幾段」。歸屬只能問一句：
 * **這一段自己就長得出這一種嗎？**
 *
 * 四族全部走既有的判斷，這裡一條規則都不自己寫：
 *
 * | 種類 | 誰答的 |
 * |---|---|
 * | 掛號（Examine、耀聖） | `tasksForVisit()` |
 * | 寫紀錄 | `recordTasksForVisit()`（借 `pendingRecordTasks()`） |
 * | 健檢那條鏈 | 課程主檔上的 `followupCourseId` |
 *
 * ## 推不出來的一律留著
 *
 * 她自己加的、或已經拿掉的那幾種（`RETIRED_KINDS`）身上沒有課程可以推。
 * 那幾張**在整筆上也歸不到任何一段**，所以判準是「它屬於**別**段嗎」而不是
 * 「它屬於這一段嗎」—— 答不出來就留著。靜默收掉一張她真的還沒做的事，
 * 比多列一張糟得多（同 `syncFollowupTasks()` 那一圈的理由）。
 */
function ownedKinds(scoped, visit, coursesById) {
  // 兩份都只算一次 —— 每一列各算一次的話，一張卡片會把整筆來訪掃過十幾遍
  const here = kindsOf(scoped, coursesById);
  const anywhere = kindsOf(visit, coursesById);
  return (kind) => here.has(kind) || !anywhere.has(kind);
}

/**
 * 一張「取消 X」是不是這一段的。
 *
 * **有 `slotIndexes` 就照它**（issue 02）—— 那一張自己記著它收的是哪幾段，不用猜。
 *
 * 沒有的是 2026-09-13 之前長出來的。退路三層，一層比一層寬：
 *
 *   1. 那一天**取消掉的**、用得到那個系統的段
 *   2. 那一天用得到那個系統的段（那一天沒有段取消，卻有這一張 —— 以前「改整天的日期」
 *      那條路會長出這種，ADR-0089 拿掉了）
 *   3. 每一段 —— 靜默藏掉一張她還沒做的事，比多列一張糟
 */
function ownsCancel(task, visit, index, coursesById) {
  if (Array.isArray(task.slotIndexes)) return task.slotIndexes.includes(index);

  const system = systemOfCancelKind(task.kind);
  const slots = visit.slots ?? [];
  const uses = (s) => {
    const category = coursesById[s?.courseId]?.category;
    return bookingSystemFor(category) === system || tasksForCategory(category).includes(system);
  };
  const at = (pred) => slots.map((s, i) => (pred(s) ? i : -1)).filter((i) => i >= 0);

  const dead = at((s) => slotStatus(visit, s) === 'cancelled' && uses(s));
  if (dead.length) return dead.includes(index);
  const any = at(uses);
  return any.length ? any.includes(index) : true;
}

/** 這幾段長得出哪幾種任務（取消類不在這裡問，見 `ownsCancel()`）。 */
function kindsOf(visit, coursesById) {
  const out = new Set();
  for (const t of tasksForVisit(visit, coursesById)) out.add(t.kind);
  for (const t of pendingRecordTasks(visit, coursesById)) out.add(t.kind);
  // 鏈上那三張是健檢額度長出來的，而「這是不是健檢」寫在課程主檔上
  // （`followupCourseIdOf()`：刻意不從名字比對，見 domain/followups.js）。
  if ((visit.slots ?? []).some((s) => followupCourseIdOf(coursesById[s?.courseId]))) {
    for (const k of [REPORT_TASK_KIND, SEND_REPORT_TASK_KIND, FOLLOWUP_TASK_KIND]) out.add(k);
  }
  return out;
}

/**
 * 「做完之後要寫的那一張」，**不看那一場做完了沒**。
 *
 * `recordTasksForVisit()` 刻意看狀態（ADR-0066：那一場沒做完就沒有東西可以
 * 寫），所以它答不出「等一下會有這一張」。這裡借它的另一半判斷 ——
 * 課程主檔上那個勾 —— 而那一半是 `needsRecord()`，不對外開放。
 *
 * 拿「假裝那一場做完了」去問它是刻意的：閘門只有一個（`acceptsRecordTasks()`），
 * 而在這裡另寫一份「哪些課程要寫紀錄」就會有兩份會分岔的判斷。
 *
 * **假裝的是每一段**（2026-09-24，ADR-0112）：那個閘門現在問的是那一段自己的狀態，
 * 只蓋整筆的話還開著的段問出來仍然是「沒做完」。取消掉的（`isLiveSlot()`）與**已經未到的**
 * 那一段不假裝 —— 它們不會有紀錄要寫，講「等一下會有」是假話（ADR-0070）。
 */
function pendingRecordTasks(visit, coursesById) {
  const missed = (s) => s?.status === 'no_show' || s?.attended === false;
  return recordTasksForVisit({
    ...visit,
    status: 'done',
    slots: (visit?.slots ?? []).map((s) => (!isLiveSlot(s) || missed(s) ? s : { ...s, status: 'done' })),
  }, coursesById);
}

/** 照 `orderOf()`（＝她做事的順序）。同一階的照種類穩定排。 */
function sortRows(rows) {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (orderOf(keyOf(a.r)) - orderOf(keyOf(b.r))) || (a.i - b.i))
    .map((x) => x.r);
}

/**
 * 排序用的鍵：推導的那兩列（確認、簽單）用它們自己的 id，其餘一律用種類。
 *
 * 「還沒發生」那幾列也是推導的，但它們的 key 是 `pending:耀聖` —— 拿那個去問 `orderOf()`
 * 永遠對不到，於是它們一律排到最後，連取消類都排在它們前面。以前只有活著的段會有
 * 「還沒發生」的列，看不太出來；被取消的那一段灰掉整份之後就很明顯（2026-09-13）。
 */
const keyOf = (row) => (row.key === 'confirm' || row.key === 'close' ? row.key : row.kind);
