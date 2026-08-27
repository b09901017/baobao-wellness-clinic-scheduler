// 健檢 ↔ 二返。純函式。
//
// 二返是客戶做完健檢之後回院聽醫生報告的那一次（見 CONTEXT.md）。它是一個獨立的
// 課程、獨立的來訪、獨立的次數 —— 只有「什麼時候該去約」這件事綁在健檢上。
// 所以這一支不碰健檢本身，它只回答三個問題：
//
//   1. 這位客戶的健檢額度，配到二返額度了沒？（pairsOf / missingPairs）
//   2. 她還欠幾次二返？（owed）
//   3. 那該有幾張待辦、掛在哪幾筆健檢上、現在走到鏈條的哪一站？（syncFollowupTasks）
//
// 第 3 個問題是兩站不是一站：**報告要兩三週才出來**，而報告沒到就不可能約。
// 所以健檢結案先長「追蹤健檢報告」，那一張勾掉了才長「約二返」——
// 見 docs/adr/0042-the-report-comes-before-the-follow-up.md。
//
// 為什麼三段要放在同一個檔案：缺任何一段整條動線都是斷的。額度沒展開，
// 行事曆上那幾筆二返就寫不進去（沒有額度可扣）；任務沒產生，她就得靠腦袋記得
// 「這個人健檢做完了，還沒約報告」—— 而那正是這個 app 要消滅的東西。
//
// 決定與理由見 docs/adr/0022-followup-entitlements-are-expanded-in-pairs.md。

import { counts } from './entitlements.js';
import { addDays, dayOf, shortDate } from './dates.js';

/**
 * 「約二返」的任務種類。
 *
 * 刻意不放進 taskRules.js 的 TASK_KINDS：那四種是掛號類的任務，由課程的類別
 * 推導、死線是來訪日的前一天、取消時要回頭去外部系統收回來。這一種一件都不是——
 * 它由額度推導、死線是健檢日往後算、而且沒有任何外部系統需要收回。
 */
export const FOLLOWUP_TASK_KIND = '約二返';

/**
 * 「追蹤健檢報告」的任務種類。二返前面那一站。
 *
 * 跟 `FOLLOWUP_TASK_KIND` 一樣不放進 `taskRules.js`：它由額度與健檢來訪推導，
 * 死線不是來訪日的前一天，取消時也沒有任何外部系統需要收回。
 */
export const REPORT_TASK_KIND = '追蹤健檢報告';

/**
 * 健檢做完之後幾天內要把二返約好。
 *
 * SPEC 第 13 節本來就把「二返距離健檢的標準間隔」列在待確認清單裡，所以這是
 * 一個可以在設定頁改的預設值，不是寫死的規則。7 天是 2026-08-19 使用者選的。
 */
export const DEFAULT_FOLLOWUP_DUE_DAYS = 7;

/**
 * 健檢做完之後幾天內要去問報告出來了沒。
 *
 * 21 天是 2026-08-23 使用者選的：「通常兩三週會出來」，拿長的那一邊 ——
 * 報告還沒出來就變紅字，紅久了她就不看那個顏色了。設定頁可調。
 */
export const DEFAULT_REPORT_DUE_DAYS = 21;

/**
 * 這個課程做完之後還要再約一次的，是哪個課程。
 *
 * 配對記在課程主檔上（`config/courses/{健檢}.followupCourseId`），不是寫死
 * `course-checkup → course-followup` —— 課程是她自己在主檔建的，id 猜不得。
 * 也刻意不從名字比對：「健檢」在她的資料裡寫成 `0.75萬健檢`、`5萬健檢(心臟)`
 * 這種帶金額等級的字串，用字串包含比對正是舊 Apps Script 靜默失效的原因。
 */
export function followupCourseIdOf(course) {
  return course?.followupCourseId ?? null;
}

/** 這個課程是不是某個課程的二返。設定頁要擋掉「二返自己再配一個二返」。 */
export function isFollowupCourse(courseId, courses = []) {
  return courses.some((c) => !c.deletedAt && followupCourseIdOf(c) === courseId);
}

/**
 * 一位客戶身上所有「健檢 → 二返」的配對。
 *
 * 一位客戶可能有不只一筆健檢額度（`0.75萬健檢` 與 `5萬健檢(心臟)` 是兩筆），
 * 所以配對是一對一的：一筆健檢額度配一筆二返額度，用二返額度上的
 * `followupForEntitlementId` 指回去。用課程比對會在兩筆健檢時配錯。
 *
 * @param {object[]} entitlements 這位客戶的額度（呼叫端先濾掉已刪除的）
 * @param {Record<string, object>} coursesById 課程主檔，含已刪除的
 * @returns {{source:object, followupCourseId:string, followup:object|null}[]}
 */
export function pairsOf(entitlements = [], coursesById = {}) {
  const alive = entitlements.filter((e) => !e.deletedAt);
  const out = [];

  for (const source of alive) {
    const followupCourseId = followupCourseIdOf(coursesById[source.courseId]);
    if (!followupCourseId) continue;

    out.push({
      source,
      followupCourseId,
      followup: alive.find((e) => e.followupForEntitlementId === source.id) ?? null,
    });
  }

  return out;
}

/**
 * 還沒配到二返額度的健檢額度。資料健檢與「建立健檢額度」兩條路共用。
 *
 * @returns {{source:object, followupCourseId:string, draft:object}[]}
 */
export function missingPairs(entitlements = [], coursesById = {}) {
  return pairsOf(entitlements, coursesById)
    .filter((p) => !p.followup)
    // 二返那個課程被刪掉了就不配。硬配出來的額度會指向一個不存在的課程，
    // 而那在畫面上長得像資料壞了 —— 資料健檢的孤兒檢查也會把它列出來。
    .filter((p) => coursesById[p.followupCourseId] && !coursesById[p.followupCourseId].deletedAt)
    .map((p) => ({
      source: p.source,
      followupCourseId: p.followupCourseId,
      draft: followupDraft(p.source, coursesById[p.followupCourseId]),
    }));
}

/**
 * 配對的次數對不上的那些。只回報，不修 —— 見下面的註解。
 *
 * @returns {{source:object, followup:object, expected:number, actual:number}[]}
 */
export function countMismatches(entitlements = [], coursesById = {}) {
  return pairsOf(entitlements, coursesById)
    .filter((p) => p.followup && (p.followup.totalQty ?? 0) !== (p.source.totalQty ?? 0))
    .map((p) => ({
      source: p.source,
      followup: p.followup,
      expected: p.source.totalQty ?? 0,
      actual: p.followup.totalQty ?? 0,
    }));
}

/**
 * 一筆健檢額度該配的二返額度長什麼樣。沒有 id —— id 由 /data 那一層給。
 *
 * 次數照抄健檢的次數：買了 N 次健檢就有 N 次二返，這是使用者講的規則本身。
 * 到期日與購買日也照抄，因為它們講的是同一次購買。
 *
 * 名稱帶上健檢那一筆的名字（`二返（0.75萬健檢）`）：一位客戶可能有兩筆健檢，
 * 兩筆二返都叫「二返」的話，她在客戶詳情頁分不出哪一筆對哪一筆。
 *
 * @param {object} source 健檢那一筆額度，要有 id
 * @param {object} followupCourse 二返那個課程
 */
export function followupDraft(source, followupCourse) {
  const name = followupCourse?.name ?? '二返';
  const from = String(source?.label ?? '').trim();

  return {
    type: 'single',
    label: from ? `${name}（${from}）` : name,
    courseId: followupCourse?.id ?? null,
    optionEquipmentIds: null,
    totalQty: source?.totalQty ?? 0,
    durationMin: followupCourse?.durationMin ?? null,
    frequencyRule: null,
    // 這一筆是誰配出來的。資料健檢靠它判斷配對在不在，也靠它在兩筆健檢時配對。
    followupForEntitlementId: source?.id ?? null,
    // 額度是展開當下的完整複本，不指回範本（ADR-0003）。二返這一筆的來源
    // 就是那一筆健檢，所以沿用健檢的方案名稱快照。
    sourcePlanName: source?.sourcePlanName ?? null,
    purchasedAt: source?.purchasedAt ?? null,
    expiresAt: source?.expiresAt ?? null,
    doneCount: 0,
    bookedCount: 0,
    lastReconciledAt: null,
  };
}

/**
 * 匯入計畫用的成對展開。
 *
 * 舊試算表與合併檔的計畫裡，額度還沒有 id —— id 要等 /data 那一層開好客戶文件
 * 才給得出來（子集合的路徑需要父文件的 id）。所以這裡指回去的是 **key**，
 * 由 `data/legacyImport.js` 的 `importPlan()` 在寫入時換成真正的 id。
 *
 * 這一段是那 15 筆補不進來的來訪的解法：她行事曆上記了十筆左右的二返，但舊表的
 * C 欄只有 11 個固定療程列、二返不在裡面，所以匯入時客戶身上根本沒有二返額度，
 * 那些時段對不到額度就被擋下來了。健檢額度一展開就配一筆二返，它們才有得扣。
 *
 * @param {{key:string, doc:object}[]} entries 已經算好的額度計畫
 * @param {object[]} courses 課程主檔
 * @param {object} [extra] 每一筆都要帶的欄位，例如匯入來源 importedFrom
 * @returns {{key:string, productName:null, productId:null, doc:object}[]}
 */
export function followupPlanEntries(entries = [], courses = [], extra = {}) {
  const coursesById = Object.fromEntries((courses ?? []).map((c) => [c.id, c]));
  const out = [];

  for (const entry of entries) {
    const followupCourseId = followupCourseIdOf(coursesById[entry.doc?.courseId]);
    if (!followupCourseId) continue;

    const course = coursesById[followupCourseId];
    if (!course || course.deletedAt) continue;

    // 已經有人指著它了就不要再配一筆（同一份檔案貼兩次也不會長出第二份）
    if (entries.some((e) => e.doc?.followupForEntitlementKey === entry.key)) continue;

    const { followupForEntitlementId, ...draft } = followupDraft(entry.doc, course);
    out.push({
      key: `${entry.key}-followup`,
      productName: null,
      productId: null,
      doc: { ...draft, followupForEntitlementKey: entry.key, ...extra },
    });
  }

  return out;
}

/**
 * 這位客戶還欠幾次二返。
 *
 * 「欠」的定義是**做完的健檢比約掉的二返多**，而不是「二返還有剩餘次數」：
 * 買了 3 次健檢但只做了 1 次的人，現在只欠 1 次，不是 3 次 —— 還沒做的健檢
 * 沒有報告可以聽。
 *
 * 上限夾在二返額度的總次數：健檢做超過買的次數時（app 不擋超用，ADR-0002），
 * 二返不會跟著無限長出來。那種情況資料健檢會另外列成「額度超用」。
 *
 * @param {{source:object, followup:object|null}} pair
 * @param {object[]} visits 這位客戶的全部來訪
 */
export function owed(pair, visits = []) {
  if (!pair?.followup) return 0;

  // 「做完幾次健檢」一律用 counts() 算，不自己數來訪的筆數 ——
  // 次數的算法只能有一份（ADR-0004），而一筆來訪裡有兩個健檢時段時，
  // 數來訪會少算一次。哪幾筆來訪要掛待辦是另一個問題，那才用 doneVisitsFor()。
  const doneCheckups = counts(pair.source, visits, pair.source.id).done;
  const c = counts(pair.followup, visits, pair.followup.id);
  const accounted = c.done + c.booked;

  return Math.max(0, Math.min(doneCheckups, c.total) - accounted);
}

/** 已完成、而且用掉這一筆額度的來訪，日期新的在前。 */
function doneVisitsFor(entitlement, visits = []) {
  return visits
    .filter(
      (v) =>
        !v.deletedAt
        && v.status === 'done'
        && (v.slots ?? []).some((s) => s.entitlementId === entitlement?.id),
    )
    .slice()
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

// ---------- 一場二返接在哪一次健檢後面 ----------
//
// 配對到這裡為止都只做到**額度**那一層（`followupForEntitlementId`）。
// 額度層答得出「還欠幾次」，答不出「這一次是哪一次的」——
// 而一筆健檢額度買了 3 次就有 3 次健檢來訪對 3 次二返來訪。
//
// 少了那一層的代價，兩個地方都在用猜的補：
//
//   - 試算表的二返註記（`sheetReport.js` 的 `followupNotes()`）**照位置配**：
//     第一次健檢配第一次二返。順序一亂就配錯，而錯了畫面上看不出來。
//   - 「約二返」那張待辦勾得掉，但沒有人檢查世界上真的有那一場。
//
// 所以時段上多一個 `followupForVisitId`：**那一次健檢的來訪 id**。
// 放在時段不放在來訪 —— 一筆來訪可以有好幾段，二返那一段跟同一天別的療程沒關係。
//
// 粒度是**來訪**不是時段：同一天兩段健檢會併在同一筆來訪裡（排班的原子單位是
// 「某人某天來一次」），而她說「理論上我也不會同一天約兩個健檢」。
// 真的發生時那一天只認得出一次，資料健檢會列出來。

/** 這一段是不是一場二返（扣的是二返那一筆額度）。 */
const isFollowupSlot = (slot, followupId) => slot?.entitlementId === followupId;

/**
 * 這一筆二返額度已經認領掉哪幾次健檢。
 *
 * 已取消／已刪除的來訪不算 —— 那一場沒發生，它認領的健檢要放回去讓人重新約。
 *
 * @returns {Map<string, object>} 健檢來訪 id → 那一筆二返來訪
 */
export function claimedExams(followupEntitlementId, visits = []) {
  const out = new Map();
  for (const v of visits ?? []) {
    if (v.deletedAt || v.status === 'cancelled') continue;
    for (const slot of v.slots ?? []) {
      if (!isFollowupSlot(slot, followupEntitlementId)) continue;
      if (slot.followupForVisitId) out.set(slot.followupForVisitId, v);
    }
  }
  return out;
}

/**
 * 壓二返時「這是哪一次健檢的」那一排要列什麼。
 *
 * **全部列出來，被認領的也列**，只是標記起來 —— 藏掉的話她看不出「另外那一次
 * 已經約過了」，而那正是她要對照的資訊。已經被別人認領的不給選（`taken`），
 * 但**正在編輯的那一段自己認領的那一次要給選**（`selected`），
 * 不然一打開編輯器她就會發現原本選好的那一顆按不下去。
 *
 * @param {{source:object, followup:object|null}} pair
 * @param {object[]} visits 這位客戶的全部來訪
 * @param {object} [opts]
 * @param {string|null} [opts.selected] 正在編輯的那一段現在指著哪一次
 * @param {string|null} [opts.excludeVisitId] 正在編輯的那一筆來訪（它自己的認領不算數）
 * @returns {{visitId:string, date:string, taken:boolean, bookedOn:string|null}[]}
 *          日期舊的在前 —— 二返是照順序約掉的
 */
export function examChoicesFor(pair, visits = [], { selected = null, excludeVisitId = null } = {}) {
  // 沒配到二返額度就沒有候選。列出來也選不了 —— 沒有額度可以扣，
  // 那一段根本存不進去（同 `owed()` 的守衛）。
  if (!pair?.source || !pair.followup) return [];
  const claimed = claimedExams(pair.followup.id, visits);

  return doneVisitsFor(pair.source, visits)
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((v) => {
      const by = claimed.get(v.id) ?? null;
      // 自己認領的那一次不算「被佔走」—— 她正在改的就是那一段。
      const mine = by && (by.id === excludeVisitId || v.id === selected);
      return {
        visitId: v.id,
        date: v.date,
        taken: Boolean(by) && !mine,
        bookedOn: by?.date ?? null,
      };
    });
}

/**
 * 這一次健檢的二返約了沒。「約二返」那張待辦要靠它講出「已約 9/3」還是「還沒約」。
 *
 * 找的是**扣二返額度、而且指著這一次健檢**的那一段。指不到的（舊資料、
 * 她在別的地方約的）回 `null` —— 不要退回「照位置猜一個」，
 * 猜出來的日期會讓她以為已經約好了。
 *
 * @returns {{visit:object, slot:object}|null}
 */
export function bookingForExam(examVisitId, followupEntitlementId, visits = []) {
  for (const v of visits ?? []) {
    if (v.deletedAt || v.status === 'cancelled') continue;
    for (const slot of v.slots ?? []) {
      if (isFollowupSlot(slot, followupEntitlementId) && slot.followupForVisitId === examVisitId) {
        return { visit: v, slot };
      }
    }
  }
  return null;
}

/**
 * 「約二返」那一列右邊那一句：約了沒、約在哪天幾點。
 *
 * 她的原話：「我發現這個預約二返我可以直接勾掉但是其實沒有還沒預約」。
 * 那一列以前只寫得出種類與死線，看不出世界上到底有沒有那一場。
 *
 * **這是推導值，不是新欄位** —— 存第二份一定會對不起來（ADR-0004 的同一條判斷）。
 *
 * @param {{visit:object, slot:object}|null} booking `bookingForExam()` 的結果
 * @returns {{booked:boolean, text:string}}
 */
export function describeBooking(booking) {
  if (!booking) return { booked: false, text: '還沒約' };
  const at = booking.slot?.startsAt ? ` ${booking.slot.startsAt}` : '';
  return { booked: true, text: `已約 ${shortDate(booking.visit.date)}${at}` };
}

/**
 * 這一筆「約二返」的待辦，對應的那一次健檢約了沒。
 *
 * 待辦掛在健檢那一筆來訪上（`task.visitId`），所以問的就是那一次健檢。
 * 找不到配對（額度被刪了、種類不對）一律回 `null` —— **不要回「還沒約」**，
 * 那是在斷言一件不知道的事，而她會照著它去多約一場。
 *
 * @returns {{booked:boolean, text:string}|null}
 */
export function bookingStateForTask(task, { entitlements = [], coursesById = {}, visits = [] }) {
  if (task?.kind !== FOLLOWUP_TASK_KIND || !task.visitId) return null;

  const exam = (visits ?? []).find((v) => v.id === task.visitId) ?? null;
  if (!exam) return null;

  for (const pair of pairsOf(entitlements, coursesById)) {
    if (!pair.followup) continue;
    // 這一張待辦掛的那一次健檢，扣的是這一筆配對的健檢額度嗎
    if (!(exam.slots ?? []).some((sl) => sl.entitlementId === pair.source.id)) continue;
    return describeBooking(bookingForExam(task.visitId, pair.followup.id, visits));
  }

  return null;
}

/**
 * 這位客戶身上，每一筆配對的每一次健檢現在是什麼狀態。
 *
 * 待辦中心、客戶詳情、試算表三個地方問的是同一句話，所以只有這一份。
 *
 * @returns {{pair:object, examVisitId:string, examDate:string,
 *            booking:{visit:object, slot:object}|null}[]}
 */
export function examStates(entitlements = [], coursesById = {}, visits = []) {
  const out = [];
  for (const pair of pairsOf(entitlements, coursesById)) {
    if (!pair.followup) continue;
    for (const exam of doneVisitsFor(pair.source, visits).slice().reverse()) {
      out.push({
        pair,
        examVisitId: exam.id,
        examDate: exam.date,
        booking: bookingForExam(exam.id, pair.followup.id, visits),
      });
    }
  }
  return out;
}

/**
 * 這位客戶現在該有哪幾張待辦，以及每一筆健檢走到鏈條的哪一站。
 *
 * ```
 * 健檢結案 ──▶ 追蹤健檢報告 ──勾掉──▶ 約二返 ──約好了──▶ 那一筆健檢從此不再出現
 *              死線 健檢日+21          死線 勾掉那天+7
 * ```
 *
 * 這件事屬於**額度層級**，不是單一來訪層級：買了 3 次健檢就會有 3 次二返，
 * 所以不能做成「每完成一次健檢就無條件長一筆」。也因此它不能塞進
 * `syncTasksForVisit()` —— 那一支的視野只有一筆來訪，看不到「另外那兩次
 * 健檢的二返已經約掉了」。
 *
 * 兩張待辦都掛在健檢那一筆來訪上（`visitId`），因為她點進去要看的就是
 * 「哪一次健檢的報告還沒到／還沒約」。
 *
 * @param {object} ctx
 * @param {{id:string, name?:string}} ctx.customer
 * @param {object[]} ctx.entitlements 這位客戶的額度
 * @param {object[]} ctx.visits       這位客戶的全部來訪（含剛存的那一筆）
 * @param {object[]} ctx.tasks        這位客戶現有的任務（含已完成的）
 * @param {Record<string, object>} ctx.coursesById 課程主檔，含已刪除的
 * @param {number} [ctx.dueDays]       約二返：拿到報告那天往後幾天
 * @param {number} [ctx.reportDueDays] 追蹤報告：健檢那天往後幾天
 * @returns {{create:object[], update:{id:string, changes:object}[],
 *            remove:{id:string, reason:string}[]}}
 */
export function syncFollowupTasks({
  customer,
  entitlements = [],
  visits = [],
  tasks = [],
  coursesById = {},
  dueDays = DEFAULT_FOLLOWUP_DUE_DAYS,
  reportDueDays = DEFAULT_REPORT_DUE_DAYS,
} = {}) {
  const create = [];
  const update = [];
  const remove = [];

  const mine = (tasks ?? []).filter(
    (t) => !t.deletedAt
      && t.autoGenerated
      && (t.kind === FOLLOWUP_TASK_KIND || t.kind === REPORT_TASK_KIND),
  );
  const openTasks = mine.filter((t) => !t.done);
  const byVisit = (kind, done) =>
    new Map(mine.filter((t) => t.kind === kind && Boolean(t.done) === done).map((t) => [t.visitId, t]));

  const openReport = byVisit(REPORT_TASK_KIND, false);
  const doneReport = byVisit(REPORT_TASK_KIND, true);
  const openBooking = byVisit(FOLLOWUP_TASK_KIND, false);

  // 已經勾掉「約二返」的那幾筆健檢整條鏈都結束了 —— 她已經去約了，那一次的
  // 二返會出現在 counts() 裡，不需要任何待辦。
  const settled = new Set(
    mine.filter((t) => t.done && t.kind === FOLLOWUP_TASK_KIND).map((t) => t.visitId),
  );

  // visitId → { kind, dueDate }。跨全部配對算完再一次比對，這樣「健檢被取消了、
  // 待辦還掛在那裡」也會被收掉 —— 那筆來訪不會再出現在任何配對的清單裡。
  const wanted = new Map();

  for (const pair of pairsOf(entitlements, coursesById)) {
    if (!pair.followup) continue;

    const want = owed(pair, visits);
    if (!want) continue;

    // 已經真的約好那一場的健檢也不用待辦了。**這一道是連結那一層帶來的精準度**：
    // `owed()` 早就會因為多一場二返而少算一次，但它算的是**幾張**，不是**哪幾張** ——
    // 所以在這一道之前，被收掉的可能是別的那一次健檢的待辦，而真的約掉的那一次
    // 反而還掛在那裡。她看到的症狀是「我明明約好了，它還在叫我去約」。
    //
    // 舊資料（二返沒指到健檢）走不到這裡，行為跟以前一模一樣。
    const booked = claimedExams(pair.followup.id, visits);
    const candidates = doneVisitsFor(pair.source, visits)
      .filter((v) => !settled.has(v.id) && !booked.has(v.id));

    // 已經有待辦的排前面，其餘照日期新到舊。二返是照順序約掉的，先做的健檢
    // 先約，所以還欠的一定是最後那幾次。已有的排前面則是為了不要每存一次檔
    // 就把待辦刪掉重建一張 —— 那會在稽核紀錄裡刷出一整排沒有意義的變更。
    const has = (v) => openReport.has(v.id) || doneReport.has(v.id) || openBooking.has(v.id);
    const ordered = [...candidates.filter(has), ...candidates.filter((v) => !has(v))];

    for (const visit of ordered.slice(0, want)) {
      wanted.set(visit.id, stationFor(visit, {
        report: doneReport.get(visit.id),
        booking: openBooking.get(visit.id),
        // 「這一筆健檢有沒有追蹤報告的紀錄」—— 勾掉的與還沒勾的都算。
        // 只看勾掉的那一種會讓「把報告那一張拿回來」變成把它刪掉，見 stationFor()。
        hasReport: openReport.has(visit.id) || doneReport.has(visit.id),
        dueDays,
        reportDueDays,
      }));
    }
  }

  for (const [visitId, station] of wanted) {
    const existing = (station.kind === REPORT_TASK_KIND ? openReport : openBooking).get(visitId);
    if (!existing) {
      create.push({
        visitId,
        customerId: customer?.id ?? null,
        customerName: customer?.name ?? null,
        kind: station.kind,
        dueDate: station.dueDate,
        done: false,
        doneAt: null,
        note: station.note,
        autoGenerated: true,
      });
      continue;
    }

    const changes = {};
    if (existing.dueDate !== station.dueDate) changes.dueDate = station.dueDate;
    if ((existing.customerName ?? null) !== (customer?.name ?? null)) {
      changes.customerName = customer?.name ?? null;
    }
    if (Object.keys(changes).length) update.push({ id: existing.id, changes });
  }

  const visitById = new Map((visits ?? []).map((v) => [v.id, v]));

  for (const t of openTasks) {
    if (wanted.get(t.visitId)?.kind === t.kind) continue;
    const visit = visitById.get(t.visitId);
    const stillDone = visit && !visit.deletedAt && visit.status === 'done';
    remove.push({ id: t.id, reason: reasonFor(t.kind, stillDone, wanted.get(t.visitId)?.kind) });
  }

  return { create, update, remove };
}

/**
 * 這一筆健檢現在該有哪一張待辦。
 *
 * 三條路，順序不能換：
 *
 * 1. **報告勾掉了** → 約二返，死線從**勾掉那一天**算。從健檢日算的話
 *    它一出生就是逾期紅字（報告本來就要兩三週），而紅久了她就不看了。
 * 2. **已經有一張未完成的約二返，而這一筆健檢從來沒有過追蹤報告那一張** →
 *    那是這一支上線之前就存在的資料。當作報告那一段已經走過了：不補產生
 *    追蹤報告，也不動那張約二返（連死線都不改）。**不這樣做的話，她手上真的
 *    還沒做的那幾件會在第一次存檔時被默默收掉。**
 *
 *    「從來沒有過」要連**還沒勾的**那一張一起看（`hasReport`），不能只看勾掉的
 *    ——她把報告那一張**拿回來**（取消勾選）的時候，勾掉的那一份就不見了，
 *    只看勾掉的會讓這裡誤判成舊資料，於是把她剛拿回來的那一張刪掉。
 *    正確的行為是退回第 3 站：報告那一張留著，約二返收起來。
 * 3. 其餘 → 追蹤健檢報告，死線從健檢那天算。
 */
function stationFor(visit, { report, booking, hasReport, dueDays, reportDueDays }) {
  if (report) {
    // doneAt 讀不出來（舊資料、手動改過）就退回「健檢日 + 報告天數 + 約的天數」。
    // 不用今天 —— 用今天的話，死線每讀一次就往後跑一天。
    const from = dayOf(report.doneAt) ?? addDays(visit.date, reportDueDays);
    return {
      kind: FOLLOWUP_TASK_KIND,
      dueDate: addDays(from, dueDays),
      note: '報告拿到了，回去跟客人約二返的時間',
    };
  }

  if (booking && !hasReport) {
    return { kind: FOLLOWUP_TASK_KIND, dueDate: booking.dueDate, note: booking.note };
  }

  return {
    kind: REPORT_TASK_KIND,
    dueDate: addDays(visit.date, reportDueDays),
    note: '健檢做完了，去問報告出來了沒',
  };
}

function reasonFor(kind, stillDone, wantedKind) {
  if (!stillDone) return '那一筆健檢不是已完成了';
  if (kind === REPORT_TASK_KIND) return '報告拿到了';
  // 退回上一站：她把「追蹤健檢報告」那一張拿回來了，所以還不到約二返。
  if (wantedKind === REPORT_TASK_KIND) return '報告那一張被拿回來了';
  return '二返已經約好了';
}

/**
 * 客戶詳情頁那一句「健檢 3 次 → 二返還欠 2 次」。
 *
 * 只講事實，不講該怎麼辦 —— 要不要現在去約是她的判斷（ADR-0002）。
 */
export function describePair(pair, visits = []) {
  if (!pair?.followup) return null;

  const source = counts(pair.source, visits, pair.source.id);
  const owes = owed(pair, visits);
  const followup = counts(pair.followup, visits, pair.followup.id);

  return {
    owed: owes,
    text: owes
      ? `健檢做完 ${source.done} 次，二返還欠 ${owes} 次`
      : `健檢做完 ${source.done} 次，二返已經約掉 ${followup.done + followup.booked} 次`,
  };
}
