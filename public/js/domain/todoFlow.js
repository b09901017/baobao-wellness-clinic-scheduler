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
  isCancelKind, cancelKindFor, bookingSystemsForVisit,
  RECORD_TASK_KIND, tasksForVisit, recordTasksForVisit,
} from './taskRules.js';
import {
  FOLLOWUP_TASK_KIND, REPORT_TASK_KIND, SEND_REPORT_TASK_KIND, followupCourseIdOf,
} from './followups.js';
import { dayOf } from './dates.js';
import { formSlotIndexes } from './visits.js';

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
 * @returns {{key:string, kind:string, done:boolean, dueDate:string|null,
 *            derived:boolean}[]}
 */
export function todosForVisit(visit, { tasks = [], coursesById = {}, focusSlot = null } = {}) {
  if (!visit || visit.deletedAt) return [];

  // **她點的是哪一段**（ADR-0080 那條線延伸過來）。沒帶就是整筆 ——
  // 客戶詳情、待辦中心、進度追蹤列的本來就是整筆，它們一個字都不用改。
  // 指到一個不存在的段落也退回整筆（同 `slotsToShow()` 的兩條退路）。
  const scoped = scopeTo(visit, focusSlot);

  const mine = ownedKinds(scoped, visit, coursesById);
  const rows = (tasks ?? [])
    .filter((t) => !t.deletedAt && t.visitId === visit.id)
    .filter((t) => mine(t.kind))
    .map((t) => ({
      key: t.id,
      kind: t.kind,
      done: Boolean(t.done),
      dueDate: t.dueDate ?? null,
      derived: false,
    }));

  // 取消掉的那一筆只剩「取消 X」那幾張還算數 —— 確認與簽單都不會再發生了。
  if (visit.status === 'cancelled') return sortRows(rows);

  // ①→③ 跟客人確認時間。**從來訪推導**（ADR-0001），不是任務。
  //
  // **做完了也要留著，畫成劃掉的。** 她 2026-09-04 的原話：「我希望的是把
  // 所有代辦都列出來，然後完成的不要消失，而是淡掉劃掉，但我還是需要知道
  // 這一場的所有代辦。」所以這一列不會因為客人已經回覆就整列消失 ——
  // 那會讓一張已確認的卡片看起來像從來沒問過人。
  rows.push({
    key: 'confirm',
    kind: '跟客人確認時間',
    done: visit.status !== 'pending_confirm',
    dueDate: null,
    derived: true,
  });

  // ⑤ 簽療程單。**整筆都不用簽的那一天照樣要結案**（只有二返的那一天），
  // 所以這一列跟「有沒有段要簽」無關 —— 那只影響它印哪一句。
  //
  // 日子還沒到也列（同上：她要看到這一場的**全部**），只是還沒勾。
  const closed = visit.status === 'done' || visit.status === 'no_show';
  const needsForm = formSlotIndexes(scoped, coursesById).length > 0;
  rows.push({
    key: 'close',
    // 「不用簽」是用 `scoped` 算的（點了某一段就只有那一段），所以句子也要講那一段 ——
    // 寫「這一天」的話，同一天別段要簽時她會以為整天都不用（ADR-0087）。
    kind: needsForm
      ? '簽療程單'
      : `簽療程單（${Number.isInteger(focusSlot) && visit?.slots?.[focusSlot] ? '這一段' : '這一天'}不用簽，但要結案）`,
    done: closed,
    dueDate: null,
    derived: true,
  });

  // ---------- 還沒發生、但一定會發生的那幾張 ----------
  //
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
  const already = new Set(rows.map((r) => r.kind));
  for (const t of [...tasksForVisit(scoped, coursesById),
    ...pendingRecordTasks(scoped, coursesById)]) {
    if (already.has(t.kind)) continue;
    already.add(t.kind);
    rows.push({
      key: `pending:${t.kind}`,
      kind: t.kind,
      done: false,
      dueDate: t.dueDate ?? null,
      derived: true,
      // 呼叫端拿它畫得淡一點、旁邊寫一句「到時候才會長出來」
      pending: true,
    });
  }

  return sortRows(rows);
}

/**
 * 只留她點的那一段。**沒指定、或指到一個不存在的段落就回整筆**
 * —— 兩條退路跟 `slotsToShow()` 一模一樣（畫成空的比畫太多糟）。
 */
function scopeTo(visit, focusSlot) {
  if (!Number.isInteger(focusSlot)) return visit;
  const one = (visit.slots ?? [])[focusSlot];
  return one ? { ...visit, slots: [one] } : visit;
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
 * | 取消 X | `bookingSystemsForVisit()`（它刻意不濾取消掉的段，所以取消掉的那一段照樣認得回自己那一張） |
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
  // 沒收窄就一張都不用濾。另外三頁走的就是這一條。
  if (scoped === visit) return () => true;

  // 兩份都只算一次 —— 每一列各算一次的話，一張卡片會把整筆來訪掃過十幾遍
  const here = kindsOf(scoped, coursesById);
  const anywhere = kindsOf(visit, coursesById);
  return (kind) => here.has(kind) || !anywhere.has(kind);
}

/** 這幾段長得出哪幾種任務。 */
function kindsOf(visit, coursesById) {
  const out = new Set();
  for (const t of tasksForVisit(visit, coursesById)) out.add(t.kind);
  for (const t of pendingRecordTasks(visit, coursesById)) out.add(t.kind);
  // 取消 X 那幾張有**兩個**來源（`syncTasksForVisit()` 的那兩圈）：壓表登記
  // 本身，加上她確認之後真的去登記過的那幾個。少算第二種的話，A 類那一段
  // 認不回自己的「取消 Examine」。
  //
  // 問之前先把 `status` 拿掉：取消掉的那一段昨天佔的時段還在那裡，
  // 而 `tasksForVisit()` 會濾掉它（同 `bookingSystemsForVisit()` 刻意不濾的理由）。
  const asLive = { ...visit, slots: (visit.slots ?? []).map((s) => ({ ...s, status: null })) };
  for (const system of bookingSystemsForVisit(visit, coursesById)) out.add(cancelKindFor(system));
  for (const t of tasksForVisit(asLive, coursesById)) out.add(cancelKindFor(t.kind));
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
 */
function pendingRecordTasks(visit, coursesById) {
  return recordTasksForVisit({ ...visit, status: 'done' }, coursesById);
}

/** 照 `orderOf()`（＝她做事的順序）。同一階的照種類穩定排。 */
function sortRows(rows) {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (orderOf(keyOf(a.r)) - orderOf(keyOf(b.r))) || (a.i - b.i))
    .map((x) => x.r);
}

/** 排序用的鍵：推導的那兩列用它們自己的 id，任務用種類。 */
const keyOf = (row) => (row.derived ? row.key : row.kind);
