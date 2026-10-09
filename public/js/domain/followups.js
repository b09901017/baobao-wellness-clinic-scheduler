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
// 而第二站是**兩張**：報告到手的那一刻要做兩件事，約二返與寄一份給醫師
// （她的原話：「除了要約二返，還要寄健檢報告給醫生」）。
// 兩張的死線一樣，但算出它們的是兩圈不同的邏輯，見 `syncFollowupTasks()`
// 與 docs/adr/0065-two-things-happen-when-the-report-arrives.md。
//
// 為什麼三段要放在同一個檔案：缺任何一段整條動線都是斷的。額度沒展開，
// 行事曆上那幾筆二返就寫不進去（沒有額度可扣）；任務沒產生，她就得靠腦袋記得
// 「這個人健檢做完了，還沒約報告」—— 而那正是這個 app 要消滅的東西。
//
// 決定與理由見 docs/adr/0022-followup-entitlements-are-expanded-in-pairs.md。

import { counts, slotOutcome } from './entitlements.js';
import { addDays, dayOf, shortDate } from './dates.js';
// 循環 import（taskRules.js 也 import 這一支的常數）：兩邊都只在函式裡用，模組載入時不碰
import { seenTasks } from './taskRules.js';
// 「這一次健檢現在是什麼狀態」要分得出待確認與已確認，那只有 `slotStatus()` 答得出來。
// visits.js 也 import 這一支（`examStatusIn()`、`PICKABLE_EXAM`）—— 兩邊都只在函式裡用，載入時不互相讀
import { slotStatus, shortStatus } from './visits.js';

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
 * 「寄報告給醫師」的任務種類。**跟「約二返」同一站，不是第三站。**
 *
 * 觸發條件跟約二返一模一樣（報告到手的那一刻），死線也一樣 ——
 * 它們是同一個動作的兩半，給兩個可調的天數只會讓她某天發現兩張的紅字
 * 時間不一樣而想不起來為什麼。
 *
 * 名字用「醫師」不是「醫生」：`CONTEXT.md` 的詞條是醫師，
 * 而「醫生」在那一條的 `_Avoid_` 裡。她口語講醫生沒關係，畫面上要用詞彙表的詞。
 *
 * 見 docs/adr/0065-two-things-happen-when-the-report-arrives.md。
 */
export const SEND_REPORT_TASK_KIND = '寄報告給醫師';

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
    // 二返跟它那一筆健檢是**同一次購買**（買幾次健檢就有幾次二返，ADR-0022），
    // 所以「買過什麼」那一頁上它要跟健檢排在同一組。
    purchaseId: source?.purchaseId ?? null,
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
  // **接在一次還沒做完（或取消、未到）的健檢上、還沒做的那幾場不算約掉**（ADR-0145）：她常在健檢那一刻就把二返一起約好，
  // 那一場是那一次健檢的、不是已經做完的那幾次的 —— 照舊算的話，別次健檢開著的「約二返」會在約好的那一刻被收掉。
  // 指到的那一次**不在手上這一份裡**（刪掉的、或呼叫端只給了部分來訪）就照舊算：當成沒約的話會憑空長出一張「約二返」。
  // 沒連結的照舊算（舊資料一個字都不動）
  const byId = new Map((visits ?? []).filter((v) => v && !v.deletedAt).map((v) => [v.id, v]));
  const early = linksOf(pair.followup.id, visits).filter((l) => l.outcome === 'booked'
    && byId.has(l.examVisitId) && !usedAndDone(byId.get(l.examVisitId), pair.source.id)).length;
  const accounted = c.done + c.booked - early;

  return Math.max(0, Math.min(doneCheckups, c.total) - accounted);
}

/**
 * 這一筆來訪裡，**用這一筆額度的那一段做完了**（ADR-0112）。
 *
 * 以前問整筆 `status === 'done'`：健檢那一段取消了、同一天 SIS 做了時整筆是已完成，
 * 那次被取消的健檢照樣能被二返接上、照樣長追蹤健檢報告（她 2026-09-24：「健檢被取消後
 * 二返還可以連結到那次被取消的健檢?」）。反過來，健檢那一段先結了、同一天別段還開著時
 * 整筆是已確認（ADR-0110），追蹤健檢報告就不長。
 *
 * 「做完了」走 `slotOutcome()`（次數也是它算的，ADR-0025），不自己比 `slot.status`。
 */
export function usedAndDone(visit, entitlementId) {
  return Boolean(visit && !visit.deletedAt)
    && (visit.slots ?? []).some(
      (s) => s?.entitlementId === entitlementId && slotOutcome(visit, s) === 'done',
    );
}

/**
 * 這一段（一場二返或 n返）**佔著**它指的那一次健檢嗎：待確認、已確認、已完成才算（ADR-0112）。
 *
 * - 取消的不佔 —— 那一場沒發生，那一次健檢要放回去讓人重新約
 * - **未到的也不佔** —— 人沒來，要重約一場接回同一次健檢。算它佔著的話，那一次健檢在
 *   「這是哪一次健檢」那一排上永遠是「已約」、按不下去，約二返那張也寫著「已約」
 *
 * 以前問整筆沒取消：二返那一段取消了、同一天別段還在時，它照樣佔著。
 * 走 `slotOutcome()`：`booked` 是待確認／已確認，`done` 是已完成。
 */
export function holdsExam(visit, slot) {
  const outcome = slotOutcome(visit, slot);
  return outcome === 'booked' || outcome === 'done';
}

/**
 * 這一筆來訪是不是**一次做完的健檢**：用這幾筆健檢額度裡任何一筆的那一段做完了。
 * 追蹤報告那一圈、n返 的候選、n返 的存檔驗證三個地方問的都是這一句 —— 各寫一份的話，
 * 候選清單列得出來、存檔卻擋下來（第一批審查抓到的，`visits.js` 的驗證還在問整筆）。
 *
 * @param {object} visit
 * @param {Iterable<string>} examEntitlementIds 健檢那幾筆額度的 id
 */
export function examDoneIn(visit, examEntitlementIds) {
  return [...examEntitlementIds].some((id) => usedAndDone(visit, id));
}

/**
 * 這一次健檢**現在**是什麼狀態 —— 「這是哪一次健檢」那一排標的那一個（`.scratch/asks-2026-09-24/issues/11`）。
 *
 * 做完了（`examDoneIn()`，跟按不按得下去、存檔驗證同一支）就是已完成；不然取那幾段裡還活著的那一段，
 * 全部取消了才是已取消。二返與 n返 兩排共用。
 *
 * @param {object} visit
 * @param {Iterable<string>} examEntitlementIds 健檢那幾筆額度的 id
 * @returns {string|null}
 */
export function examStatusIn(visit, examEntitlementIds) {
  if (examDoneIn(visit, examEntitlementIds)) return 'done';
  const ids = new Set(examEntitlementIds);
  const each = (visit?.slots ?? []).filter((s) => ids.has(s?.entitlementId)).map((s) => slotStatus(visit, s));
  return each.find((x) => x !== 'cancelled') ?? each[0] ?? null;
}

/**
 * 「這是哪一次健檢」那一顆丸子底下那一小格。被別場二返佔走的寫「已約 9/30」，其餘寫**它自己的狀態**
 * （短字，同日曆圖例）；n返 那一排再接上已經有幾返（`note`）。壓表、來訪編輯器、拍 Abovee 三個入口共用 ——
 * 各寫一份的話同一次健檢在兩個地方標不同的字（issues/11）。
 */
export function examChoiceNote(choice) {
  if (choice?.taken) return choice.bookedOn ? `已約 ${shortDate(choice.bookedOn)}` : '已約';
  return [choice?.status ? shortStatus(choice.status) : '', choice?.note ?? ''].filter(Boolean).join('・');
}

/** 用這一筆額度的那一段做完了的來訪，日期新的在前（`usedAndDone()`）。 */
function doneVisitsFor(entitlement, visits = []) {
  return visits
    .filter((v) => usedAndDone(v, entitlement?.id))
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

/**
 * 這一筆二返額度底下**有連結、還佔著**（`holdsExam()`：待確認、已確認、已完成）的每一段，接在哪一次健檢上。
 * 取消、未到的那一段不算 —— 它認領的健檢要放回去讓人重新約。
 *
 * 「認領了哪幾次」（`claimedExams()`）、「哪幾次定案了」（`linkedSeconds()`）、「這一次約在哪」（`bookingForExam()`）、
 * 「幾場接在還沒做完的上面」（`owed()`）都從這一份出來 —— 以前前兩支各寫一個幾乎一樣的迴圈，
 * 改「佔不佔」的時候要記得改兩份（prelaunch-fixes 審查記下來的）。
 *
 * @returns {{examVisitId:string, visit:object, slot:object, outcome:'booked'|'done'}[]} 照來訪與段落的順序
 */
function linksOf(followupEntitlementId, visits = []) {
  const out = [];
  for (const v of visits ?? []) {
    for (const slot of v?.slots ?? []) {
      if (slot?.entitlementId !== followupEntitlementId || !slot.followupForVisitId || !holdsExam(v, slot)) continue;
      out.push({ examVisitId: slot.followupForVisitId, visit: v, slot, outcome: slotOutcome(v, slot) });
    }
  }
  return out;
}

/**
 * 這一筆二返額度已經認領掉哪幾次健檢（`linksOf()`）。同一次被兩場認領時留後面那一場（資料健檢會列出來）。
 *
 * @returns {Map<string, object>} 健檢來訪 id → 那一筆二返來訪
 */
export function claimedExams(followupEntitlementId, visits = []) {
  return new Map(linksOf(followupEntitlementId, visits).map((l) => [l.examVisitId, l.visit]));
}

/**
 * 壓二返時「這是哪一次健檢的」那一排要列什麼。
 *
 * **全部列出來，被認領的也列**，只是標記起來 —— 藏掉的話她看不出「另外那一次
 * 已經約過了」，而那正是她要對照的資訊。已經被別人認領的不給選（`taken`），
 * 但**正在編輯的那一段自己認領的那一次要給選**（`selected`），
 * 不然一打開編輯器她就會發現原本選好的那一顆按不下去。
 *
 * 每一次都列、標著它自己的狀態（2026-09-24，issues/11：「可以小小標註他現在的狀態 例如未確認 已確認 已完成 未到 取消」）。
 * **待確認、已確認、已完成都按得下去**（2026-10-09，ADR-0145，推翻 9/24 那一句「只有已完成按得下去」）：
 * 「不要禁止先約，因為客人常當場一起約」。**取消、未到照舊按不下去** —— 那一次不會有報告（`PICKABLE_EXAM`）。
 * 按不按得下去只看 `pickable` —— 三個入口（壓表、來訪編輯器、拍 Abovee）都照它，存檔驗證問同一件事。
 *
 * @param {{source:object, followup:object|null}} pair
 * @param {object[]} visits 這位客戶的全部來訪
 * @param {object} [opts]
 * @param {string|null} [opts.selected] 正在編輯的那一段現在指著哪一次
 * @param {string|null} [opts.excludeVisitId] 正在編輯的那一筆來訪（它自己的認領不算數）
 * @returns {{visitId:string, date:string, status:string|null, taken:boolean, bookedOn:string|null,
 *            pickable:boolean}[]} 日期舊的在前 —— 二返是照順序約掉的
 */
export function examChoicesFor(pair, visits = [], { selected = null, excludeVisitId = null } = {}) {
  // 沒配到二返額度就沒有候選。列出來也選不了 —— 沒有額度可以扣，
  // 那一段根本存不進去（同 `owed()` 的守衛）。
  if (!pair?.source || !pair.followup) return [];
  const claimed = claimedExams(pair.followup.id, visits);
  const ids = [pair.source.id];

  return (visits ?? [])
    .filter((v) => v && !v.deletedAt && (v.slots ?? []).some((s) => s?.entitlementId === pair.source.id))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((v) => {
      const by = claimed.get(v.id) ?? null;
      // 自己認領的那一次不算「被佔走」—— 她正在改的就是那一段。
      const mine = by && (by.id === excludeVisitId || v.id === selected);
      const taken = Boolean(by) && !mine;
      const status = examStatusIn(v, ids);
      return {
        visitId: v.id,
        date: v.date,
        status,
        taken,
        bookedOn: by?.date ?? null,
        pickable: PICKABLE_EXAM.has(status) && !taken,
      };
    });
}

/**
 * 一次健檢在這幾個狀態時接得上二返／n返（ADR-0145）：排著的（待確認、已確認）與做完的。
 * 取消、未到的那一次不會有報告。「這是哪一次健檢的」兩排與存檔驗證都問它 —— 各寫一份的話列得出來的存不下去。
 */
export const PICKABLE_EXAM = new Set(['pending_confirm', 'confirmed', 'done']);

/**
 * 還佔著（`holdsExam()`）、卻接在一次**接不上**（取消、未到，`PICKABLE_EXAM` 以外）的健檢上的二返與 n返（ADR-0145）。
 *
 * 她 10/9：「連結只是記錄，任何一邊被取消或改期都只提醒、不連動」—— 健檢取消之後那一場二返的連結照舊指著它，
 * 另約一次健檢時（`consequences.js`）與資料健檢（`health.js`）講出來，這一支只認出是哪幾場。
 * 認得哪幾段是健檢靠配對（`pairsOf()`）：n返 的那一次健檢也是有配二返的那幾筆。
 *
 * @param {object[]} entitlements 這位客戶的額度
 * @param {Record<string, object>} coursesById
 * @param {object[]} visits 這位客戶的全部來訪
 * @returns {{visit:object, slot:object, slotIndex:number, exam:object, status:string|null}[]} 照來訪的順序
 */
export function strandedFollowups(entitlements = [], coursesById = {}, visits = []) {
  const sources = pairsOf(entitlements, coursesById).map((p) => p.source.id);
  if (!sources.length) return [];
  const byId = new Map((visits ?? []).filter((v) => v && !v.deletedAt).map((v) => [v.id, v]));
  const out = [];
  for (const v of visits ?? []) {
    (v?.slots ?? []).forEach((slot, slotIndex) => {
      const exam = slot?.followupForVisitId && holdsExam(v, slot) ? byId.get(slot.followupForVisitId) : null;
      if (!exam) return;
      const status = examStatusIn(exam, sources);
      if (!PICKABLE_EXAM.has(status)) out.push({ visit: v, slot, slotIndex, exam, status });
    });
  }
  return out;
}

/**
 * 已經做完、接的那一次健檢卻還沒做完（待確認、已確認）的二返與 n返 —— 簽療程單擋住之前就存在的那幾筆（ADR-0145）。
 * 那一次健檢做完時追蹤健檢報告不會長（「二返做完了才不追」，ADR-0139）。資料健檢列出來，只列不修。
 *
 * @returns {{visit:object, slot:object, slotIndex:number, exam:object, status:string|null}[]}
 */
export function doneAheadOfExam(entitlements = [], coursesById = {}, visits = []) {
  const sources = pairsOf(entitlements, coursesById).map((p) => p.source.id);
  if (!sources.length) return [];
  const byId = new Map((visits ?? []).filter((v) => v && !v.deletedAt).map((v) => [v.id, v]));
  const out = [];
  for (const v of visits ?? []) {
    (v?.slots ?? []).forEach((slot, slotIndex) => {
      const exam = slot?.followupForVisitId && slotOutcome(v, slot) === 'done' ? byId.get(slot.followupForVisitId) : null;
      const status = exam ? examStatusIn(exam, sources) : null;
      if (exam && (status === 'pending_confirm' || status === 'confirmed')) out.push({ visit: v, slot, slotIndex, exam, status });
    });
  }
  return out;
}

/**
 * 同一次健檢被**兩場以上活著的二返**接走（一次健檢配一場，ADR-0022）。存檔驗證擋新接上的第二場；這裡列的是那之前就存在的。
 * n返 不算（它本來就可以好幾場）。
 *
 * @returns {{exam:object|null, examVisitId:string, holders:{visit:object, slot:object}[]}[]} holders 照日期
 */
export function doubleClaimedExams(entitlements = [], coursesById = {}, visits = []) {
  const byId = new Map((visits ?? []).filter((v) => v && !v.deletedAt).map((v) => [v.id, v]));
  const out = [];
  for (const pair of pairsOf(entitlements, coursesById)) {
    if (!pair.followup) continue;
    const groups = new Map();
    for (const l of linksOf(pair.followup.id, visits)) groups.set(l.examVisitId, [...(groups.get(l.examVisitId) ?? []), l]);
    for (const [examVisitId, list] of groups) {
      if (list.length < 2) continue;
      out.push({
        exam: byId.get(examVisitId) ?? null,
        examVisitId,
        holders: list.map(({ visit, slot }) => ({ visit, slot }))
          .sort((a, b) => String(a.visit.date).localeCompare(String(b.visit.date))),
      });
    }
  }
  return out;
}

// ---------- 簽療程單：二返不可以比它接的那一次健檢先做完（ADR-0145）----------
//
// 她 10/9：「二返比健檢先簽完成：簽二返時，所接的健檢沒做完就擋」。接得上排著的健檢之後才會發生：
// 二返先 ✓ 的話，那一次健檢被當成「二返做完了」—— 健檢做完時不長追蹤健檢報告，整條鏈安靜地跳過。

/**
 * 這一段（一場二返或 n返）照 `picks` 簽成「做了」的話，它接的那一次健檢還沒做完嗎。
 *
 * 做完了＝那一次健檢那一段已完成（`usedAndDone()`），**或同一張抽屜裡健檢那一段也打了 ✓**（同一天健檢＋二返）。
 * 不擋的：沒連結的（舊資料照舊簽得下去、照舊扣，issue 01 第 6 條）、接的那一次不在手上這一份裡（不知道就不擋）、
 * 認不出是二返還是 n返 的。抽屜那一列、`closeConsequences()`、`closeVisit()` 的 guard 都問這一支。
 *
 * @param {object} visit 要結案的那一筆
 * @param {number} index 哪一段
 * @param {(boolean|null)[]} picks 抽屜上逐段按了什麼（`closeVisit()` 收的那一份；這一段當成 ✓ 來問）
 * @param {{entitlements?:object[], visits?:object[]}} ctx 這位客戶的額度與全部來訪
 * @returns {{examVisitId:string, examDate:string}|null} 擋的話是哪一次健檢
 */
export function cannotClose(visit, index, picks = [], { entitlements = [], visits = [] } = {}) {
  const slot = visit?.slots?.[index];
  if (!slot?.followupForVisitId) return null;
  const ent = (entitlements ?? []).find((e) => e.id === slot.entitlementId) ?? null;
  // 二返問它配的那一筆健檢；n返（沒有額度）問有配二返的那幾筆健檢
  const sources = ent?.followupForEntitlementId ? [ent.followupForEntitlementId]
    : slot.entitlementId ? []
      : [...new Set((entitlements ?? []).filter((e) => !e?.deletedAt && e.followupForEntitlementId).map((e) => e.followupForEntitlementId))];
  if (!sources.length) return null;

  const exam = slot.followupForVisitId === visit.id ? visit
    : (visits ?? []).find((v) => v && !v.deletedAt && v.id === slot.followupForVisitId) ?? null;
  if (!exam) return null;
  if (sources.some((id) => usedAndDone(exam, id))) return null;
  const tickedHere = exam === visit && (visit.slots ?? []).some((s, j) => j !== index && picks[j] === true
    && sources.includes(s?.entitlementId) && ['pending_confirm', 'confirmed'].includes(slotStatus(visit, s)));
  return tickedHere ? null : { examVisitId: exam.id, examDate: exam.date };
}

/**
 * `picks` 裡打了 ✓、卻簽不下去的那幾段（`cannotClose()`）。`closeVisit()` 帶著 guard 時把它們當成先不結。
 *
 * @returns {Map<number, {examVisitId:string, examDate:string}>}
 */
export function closeBlocks(visit, picks = [], ctx = {}) {
  const out = new Map();
  (visit?.slots ?? []).forEach((_, i) => {
    if (picks[i] !== true) return;
    const why = cannotClose(visit, i, picks, ctx);
    if (why) out.set(i, why);
  });
  return out;
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
  const hit = linksOf(followupEntitlementId, visits).find((l) => l.examVisitId === examVisitId);
  return hit ? { visit: hit.visit, slot: hit.slot } : null;
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
 *                                    ┌─▶ 寄報告給醫師 ──寄了──┐
 * 健檢結案 ──▶ 追蹤健檢報告 ──勾掉──┤   死線 勾掉那天+7      ├─▶ 這一次健檢
 *              死線 健檢日+21        └─▶ 約二返 ──約好了─────┘    從此不再出現
 *                                        死線 勾掉那天+7
 * ```
 *
 * **第二站是兩張不是一張**（ADR-0065）。兩張的觸發條件與死線都一樣，
 * 但它們**由兩圈各自算出來**：約二返受「還欠幾次」（`owed()`）管，
 * 寄報告不受 —— 二返一約好 `owed` 就掉到 0，擠在同一圈裡的話，
 * 還沒寄出去的報告會在那一刻被靜默收掉。
 *
 * **第一站那一張「長不長」2026-10-08 起也不受 `owed()` 管**（ADR-0139）：她常在同一次就把
 * 健檢和二返一起排好，以前先約好二返時報告那一張不長，寄報告也跟著不長。
 * 它自己算（`examsAwaitingReport()`）：健檢做完了、這一次的二返還沒**做完**。
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

  const CHAIN = [FOLLOWUP_TASK_KIND, REPORT_TASK_KIND, SEND_REPORT_TASK_KIND];
  // **清掉的（勾過又刪掉的）照樣算做過**（ADR-0106）：她把已完成的「約二返」清掉，
  // 不代表那一次健檢的二返還沒約。沒勾過就被刪掉的（復原、系統收掉）當成不存在。
  // 被刪掉的都是勾過的，所以它們只會落在 done 那幾個 Map 裡 —— `update` 與 `remove`
  // 只從 open 那幾個出來，軟刪除的一個字都不會被改。
  const mine = seenTasks(tasks).filter(
    (t) => t.autoGenerated && CHAIN.includes(t.kind),
  );
  const openTasks = mine.filter((t) => !t.done);
  const byVisit = (kind, done) =>
    new Map(mine.filter((t) => t.kind === kind && Boolean(t.done) === done).map((t) => [t.visitId, t]));

  const openReport = byVisit(REPORT_TASK_KIND, false);
  const doneReport = byVisit(REPORT_TASK_KIND, true);
  const openBooking = byVisit(FOLLOWUP_TASK_KIND, false);
  const openSend = byVisit(SEND_REPORT_TASK_KIND, false);
  const doneSend = byVisit(SEND_REPORT_TASK_KIND, true);

  // 已經勾掉「約二返」的那幾筆健檢整條鏈都結束了 —— 她已經去約了，那一次的
  // 二返會出現在 counts() 裡，不需要任何待辦。
  const settled = new Set(
    mine.filter((t) => t.done && t.kind === FOLLOWUP_TASK_KIND).map((t) => t.visitId),
  );

  // visitId → { kind, dueDate }。跨全部配對算完再一次比對，這樣「健檢被取消了、
  // 待辦還掛在那裡」也會被收掉 —— 那筆來訪不會再出現在任何配對的清單裡。
  const wanted = new Map();
  // 「追蹤健檢報告」**長不長**自己一份，不過 `owed()` 那道閘門（ADR-0139）
  const wantedReport = new Map();

  for (const pair of pairsOf(entitlements, coursesById)) {
    if (!pair.followup) continue;

    for (const visit of examsAwaitingReport(pair, visits, { openReport, doneReport, openBooking, settled })) {
      wantedReport.set(visit.id, reportStation(visit, reportDueDays));
    }

    // ---------- 第一圈：約二返（`owed()` 數幾張，這裡排哪幾次拿到）----------
    //
    // 它排出來的站裡也有「追蹤健檢報告」（還欠二返的那幾次）。留著不拆是因為「約二返」的收與留
    // 都問它：`keepsOpen()` 問這一次健檢現在站在哪、`reasonFor()` 靠「它現在該是報告那一站」
    // 講出「報告那一張被拿回來了」。兩邊排到的報告最後併在一起長（`stations`）。
    const want = owed(pair, visits);
    if (!want) continue;

    // 候選＝做完、沒被有連結的二返佔著（**連結那一層帶來的精準度**：`owed()` 算的是**幾張**不是**哪幾張**，
    // 少了這一道，真的約掉的那一次反而還掛著 —— 她：「我明明約好了，它還在叫我去約」）、沒勾過「約二返」的。
    // 沒連結、做完的二返照位置配給最舊的那幾次（`covered`），跟報告那一圈同一支（`placeSeconds()`）。
    //
    // **名額怎麼排**（ADR-0142，推翻 ADR-0139「還沒有答案的」那一格）：一場沒連結的二返約了、兩次健檢都在路上時，
    // 數得出還欠一次、認不出是誰的。她 2026-10-09：「名額先給報告已勾過的那一次，A 留著「約二返」。
    // 多一張提醒可以勾掉，少一張沒人提醒。」報告那一張不靠名額（ADR-0139），把名額給還在等報告的那一次是浪費。
    //
    // 1. 報告勾過、「約二返」已經開著的 —— 「A 留著」：她一勾別次的報告、或簽掉一場認不出是誰的二返，
    //    開著的這一張都不會被換走或收掉（**連照位置算做完了的也是**：那一場二返可能是跟別次一起約的）
    // 2. 報告勾過的
    // 3. 其他已經有待辦的（**這一輪要長的報告也算**，ADR-0139：不算的話這一輪長、下一輪收）
    // 4. 其餘
    // 5. 照位置算已經做完二返的（`covered`；排最後不剔掉：資料對不上時寧可多一張。它們之間也照 2–4 排）。
    //    **其中從來沒有過任何一張待辦的不進名單**（2026-10-09 審查）：那是切換那天匯進來的舊健檢，名額落到它身上
    //    只會長一張死線是健檢日＋報告天數、一出生就逾期的「追蹤健檢報告」，而它的二返早就做完了。
    //    名額會多出來落到這一層，只有一種情況：別次的「約二返」她先自己勾掉了、那一場還沒記進來
    //
    // 同一層裡新的在前：二返是照順序約掉的，還欠的是最後那幾次。已經有待辦的排前面，是為了不要每存一次檔
    // 就把待辦刪掉重建一張 —— 那會在稽核紀錄裡刷出一整排沒有意義的變更。
    const { open, covered } = placeSeconds(pair, visits, settled);
    const behind = new Set(covered.map((v) => v.id));
    const has = (v) => openReport.has(v.id) || doneReport.has(v.id) || openBooking.has(v.id)
      || wantedReport.has(v.id);
    const rank = (v) => {
      if (doneReport.has(v.id) && openBooking.has(v.id)) return 0;
      const r = doneReport.has(v.id) ? 1 : has(v) ? 2 : 3;
      return behind.has(v.id) ? r + 3 : r;
    };
    const candidates = [...open, ...covered.filter(has)];
    // 照層排，同一層裡維持原本的先後（新到舊）
    const ordered = [0, 1, 2, 3, 4, 5].flatMap((r) => candidates.filter((v) => rank(v) === r));

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

  const visitById = new Map((visits ?? []).map((v) => [v.id, v]));
  // 「那一筆健檢還是已完成的」問**健檢那一段**（`usedAndDone()`，ADR-0112），不問整筆
  const sources = pairsOf(entitlements, coursesById).filter((p) => p.followup).map((p) => p.source.id);
  const examDone = (visit) => examDoneIn(visit, sources);

  // ---------- 第二圈：寄報告給醫師 ----------
  //
  // **它走在 `owed()` 那道閘門外面，這是這一段唯一的重點。**
  //
  // 第一圈是照「還欠幾次二返」決定哪幾次健檢要有待辦。而她一去把二返約好，
  // 那一場就變成 booked、`owed` 掉到 0、那一次健檢整個退出候選 ——
  // 報告寄了沒跟二返約了沒是兩件事，硬擠進第一圈的話，
  // **還沒寄出去的那一張會在她約好二返的那一刻被靜默收掉**，而畫面上什麼都不說。
  // 那正是 ADR-0042 那句「替她刪待辦比留著更糟」講的同一件事。
  //
  // 所以這一圈的條件只有兩個：報告那一張**勾掉了**，而那一筆健檢**還是已完成的**。
  //
  // 舊資料不補產生：這一支上線前就停在「約二返」那一站的健檢，
  // 從來沒有過追蹤報告那一張，也就不在 `doneReport` 裡。方向跟 ADR-0042 相反
  // 但判斷一樣 —— 那一批她多半早就寄出去了，補一批紅字出來，
  // 她第一件事是全部勾掉，而那讓稽核紀錄多了一批假的「做完了」。
  const wantedSend = new Map();

  for (const [visitId, report] of doneReport) {
    // 已經寄過就不用再長一張。這一道不能少 —— 少了的話，
    // 她勾掉之後任何一次存檔都會再長一張出來。
    if (doneSend.has(visitId)) continue;

    const visit = visitById.get(visitId);
    if (!examDone(visit)) continue;

    // 死線跟「約二返」同一個算法：勾掉報告那一天 + dueDays。
    // 讀不出 doneAt（舊資料、手動改過）就退回健檢日 + 報告天數，
    // 不要用今天 —— 用今天的話死線每讀一次就往後跑一天。
    const from = dayOf(report.doneAt) ?? addDays(visit.date, reportDueDays);
    wantedSend.set(visitId, {
      kind: SEND_REPORT_TASK_KIND,
      dueDate: addDays(from, dueDays),
      note: '報告拿到了，寄一份給要看報告的那位醫師',
    });
  }

  // ---------- 兩圈一起變成 create / update ----------

  const existingFor = (kind, visitId) => {
    if (kind === REPORT_TASK_KIND) return openReport.get(visitId);
    if (kind === SEND_REPORT_TASK_KIND) return openSend.get(visitId);
    return openBooking.get(visitId);
  };

  // 同一次健檢兩邊都排到時留第一圈那一站：它是報告的話兩邊算出來一模一樣（`reportStation()`），
  // 它是約二返的話這一次健檢的報告已經勾過了（`examsAwaitingReport()` 不會排它）
  const stations = new Map([...wantedReport, ...wanted]);

  for (const [visitId, station] of [...stations, ...wantedSend]) {
    const existing = existingFor(station.kind, visitId);
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

  for (const t of openTasks) {
    const visit = visitById.get(t.visitId);
    const stillDone = examDone(visit);
    if (keepsOpen(t, { stillDone, wanted, wantedSend, openReport })) continue;
    remove.push({ id: t.id, reason: reasonFor(t.kind, stillDone, wanted.get(t.visitId)?.kind) });
  }

  return { create, update, remove };
}

/**
 * 這一張還沒勾的待辦要不要留著。
 *
 * **「還該不該長出來」跟「還算不算數」是兩條規則，三種待辦三個答案。**
 * 這是 2026-09-04 她回報的那個 bug 的整個內容：她把「追蹤健檢報告」勾回去，
 * 那一張自己被軟刪除了 —— 不在未完成、不在已完成，只在「已刪除項目」裡。
 *
 * 原因是這裡本來只問一句「在不在 `wanted` 裡」，而 `wanted` 的第一道閘門是
 * `owed()`：二返一壓好（`booked`）或一勾掉（`settled`），那一次健檢就整個
 * 退出候選，於是掛在它身上的**每一張**未完成待辦都不在 `wanted` 裡 ——
 * 包含她剛剛才拿回來的那一張報告。
 *
 * ADR-0065 已經替「寄報告」走過同一段推論（擠進第一圈的話，她一約好二返，
 * 還沒寄出去的那一張就被靜默收掉）。同一個閘門對「追蹤健檢報告」也是錯的，
 * 上一輪只是沒有一起看。
 *
 * | 種類 | 長出來要 | 留著要 |
 * |---|---|---|
 * | 追蹤健檢報告 | 這一次的二返還沒做完（2026-10-08，ADR-0139；以前是 `owed > 0`） | **那一筆健檢還是已完成的，就這樣** |
 * | 約二返 | 在 `wanted` 裡 | 在 `wanted` 裡（它本來就是 `owed` 在數的東西） |
 * | 寄報告給醫師 | 報告勾掉了 | 報告還是勾掉的（ADR-0065 的第二圈） |
 *
 * 健檢被取消或刪掉時**三種都要收**（`stillDone`）—— 那才是「替她刪待辦」
 * 唯一站得住的時候：那一場沒發生，沒有東西要追。
 */
function keepsOpen(task, { stillDone, wanted, wantedSend, openReport }) {
  if (!stillDone) return false;
  // 同一筆健檢底下只留一張追蹤報告。`openReport` 是 visitId → 任務的 Map，
  // 所以「不是 Map 裡那一張」就是重複的那一張（併發寫入才生得出來）。
  if (task.kind === REPORT_TASK_KIND) return openReport.get(task.visitId)?.id === task.id;
  if (task.kind === SEND_REPORT_TASK_KIND) return wantedSend.has(task.visitId);
  return wanted.get(task.visitId)?.kind === task.kind;
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

  return reportStation(visit, reportDueDays);
}

/** 「追蹤健檢報告」那一站：死線從健檢那天算。兩圈共用，各寫一份的話同一張會有兩個死線。 */
function reportStation(visit, reportDueDays) {
  return {
    kind: REPORT_TASK_KIND,
    dueDate: addDays(visit.date, reportDueDays),
    note: '健檢做完了，去問報告出來了沒',
  };
}

/**
 * 有連結的那幾場二返（`followupForVisitId`）把哪幾次健檢定案了：做完的、約了還沒做的。
 * 取消與未到的不算（`holdsExam()` 的同一個判斷，走 `slotOutcome()`）。
 *
 * @returns {{done:Set<string>, booked:Set<string>}} 健檢來訪 id；同一次兩種都有時算做完
 */
function linkedSeconds(followupEntitlementId, visits = []) {
  const links = linksOf(followupEntitlementId, visits);
  const done = new Set(links.filter((l) => l.outcome === 'done').map((l) => l.examVisitId));
  const booked = new Set(links.filter((l) => l.outcome === 'booked' && !done.has(l.examVisitId)).map((l) => l.examVisitId));
  return { done, booked };
}

/**
 * 沒有連結、做完的二返照位置配：二返是照順序做的，所以配給**最舊**的那幾次健檢（ADR-0139）。
 * 報告那一圈與約二返那一圈共用（ADR-0142）—— 各算一次的話，報告那一圈當成「這一次的二返做完了」、
 * 約二返那一圈卻把名額給它。
 *
 * **勾過「約二返」的那幾次也佔位置**（2026-10-09 審查）：它們不進回傳的兩份名單（那一條鏈結束了），
 * 但沒連結、做完的二返照樣先配給它們 —— 她自己勾掉「約二返」的那一次，二返多半就是那一場沒連結的
 * （ADR-0142 她接受的代價留下來的正是這個樣子）。先把它們拿掉再配的話，那一場會落到「剩下最舊的」身上：
 * 健檢和二返同一次排好的下一次健檢被當成二返做完了，報告不長、寄報告也等不到。
 *
 * @returns {{exams:object[], linked:{done:Set<string>, booked:Set<string>}, second:object,
 *            open:object[], covered:object[]}} `exams`＝做完的健檢；`open` 與 `covered` 合起來＝其中沒被有連結的二返佔著、
 *   沒勾過「約二返」的那幾次，`covered` 是照位置算已經做完二返的。都是新到舊
 */
function placeSeconds(pair, visits, settled) {
  const exams = doneVisitsFor(pair.source, visits);
  const linked = linkedSeconds(pair.followup.id, visits);
  const loose = exams.filter((v) => !linked.done.has(v.id) && !linked.booked.has(v.id));
  const second = counts(pair.followup, visits, pair.followup.id);
  const finished = exams.filter((v) => linked.done.has(v.id)).length;
  // 新到舊，所以「拿掉最舊的幾次」是從尾巴拿
  const keep = Math.max(0, loose.length - Math.max(0, second.done - finished));
  const unsettled = (list) => list.filter((v) => !settled.has(v.id));
  return { exams, linked, second, open: unsettled(loose.slice(0, keep)), covered: unsettled(loose.slice(keep)) };
}

/**
 * 這一筆配對底下，哪幾次健檢該**長出**「追蹤健檢報告」（ADR-0139）。
 *
 * 她 2026-10-08：「照樣長（報告那一張也不受「約好二返」影響）」。以前這一張也過 `owed()`
 * （還欠幾次二返），而她常在同一次就把健檢和二返一起排好 —— 二返先約好、`owed` 是 0，
 * 報告那一張不長，「寄報告給醫師」等不到它被勾掉，整條都不長。
 *
 * 所以這一張只問：**健檢那一段做完了，而這一次健檢的二返還沒做完**（沒約、或約了還沒做）。
 *
 * | 這一次健檢的二返 | 算不算「還沒做完」 |
 * |---|---|
 * | 有連結、做完了 | 不算 —— 不長 |
 * | 有連結、約了還沒做 | 算，而且**先定案**（不佔下面照位置算的名額） |
 * | 沒有連結（舊資料、健檢還沒做完時就先約好的那一場） | 照位置，見下 |
 *
 * **照位置**：二返是照順序做的，所以沒有連結、做完的那幾場先配給**最舊**的那幾次健檢，
 * 剩下的才是還沒做完的。名額是 `min(做完的健檢, 二返總次數) − 做完的二返 − 先定案的`
 * （上限跟 `owed()` 同一個）；名額不夠分時「已經有待辦的排前面、其餘新到舊」
 * （第一圈 2026-10-09 起多了幾層，ADR-0142；這裡沒有跟 —— 報告那一張不搶「約二返」的名額）。
 * 少了「先配給最舊的」那一步，一次報告已經勾過的舊健檢會佔掉名額，新的那一次就不長。
 * 勾過「約二返」的那幾次不進名單（第一圈也是），**但照樣佔位置**（`placeSeconds()`）。
 *
 * 排到了還要過三道才真的長：報告沒勾過、沒勾過「約二返」、不是上線前就停在「約二返」那一站的舊資料
 * （`stationFor()` 第 2 條：有一張開著的約二返、從來沒有報告）。**二返做完的舊健檢不會因此長出來** ——
 * 切換那天匯進來的幾乎都是這一種。
 *
 * n返 兩邊都不算（它不扣二返那一筆額度）：做完的三返不代表二返做完。
 *
 * @returns {object[]} 健檢來訪
 */
function examsAwaitingReport(pair, visits, { openReport, doneReport, openBooking, settled }) {
  const { exams, linked, second, open } = placeSeconds(pair, visits, settled);
  if (!exams.length) return [];

  const definite = exams.filter((v) => linked.booked.has(v.id));
  const exam = counts(pair.source, visits, pair.source.id);
  const has = (v) => openReport.has(v.id) || doneReport.has(v.id) || openBooking.has(v.id);
  const byPosition = [...open.filter(has), ...open.filter((v) => !has(v))];
  const quota = Math.max(0, Math.min(exam.done, second.total) - second.done - definite.length);

  const pastReport = (v) => doneReport.has(v.id)
    || settled.has(v.id)
    || (openBooking.has(v.id) && !openReport.has(v.id));

  return [...definite, ...byPosition.slice(0, quota)].filter((v) => !pastReport(v));
}

function reasonFor(kind, stillDone, wantedKind) {
  if (!stillDone) return '那一筆健檢不是已完成了';
  // 追蹤報告只剩一種收掉的理由：同一筆健檢底下有兩張，留下另一張。
  // 這裡以前寫的是「報告拿到了」，而那是一句**從來沒有成立過的話** ——
  // 拿到了等於它是已完成的，而已完成的根本不會走到這個迴圈裡（見 keepsOpen）。
  if (kind === REPORT_TASK_KIND) return '這一筆健檢已經有另一張追蹤報告了';
  // 寄報告那一張只有一種收掉的理由：報告那一張被拿回來了，所以還沒有東西可以寄。
  // 它不會因為「二返約好了」而消失 —— 那是另一件事（ADR-0065）。
  if (kind === SEND_REPORT_TASK_KIND) return '報告那一張被拿回來了';
  // 退回上一站：她把「追蹤健檢報告」那一張拿回來了，所以還不到約二返。
  if (wantedKind === REPORT_TASK_KIND) return '報告那一張被拿回來了';
  return '二返已經約好了';
}

/**
 * 客戶詳情頁那一句「健檢做完 3 次：二返做完 1 次、約了 1 次（10/24）、還沒約 1 次」。
 *
 * 只講事實，不講該怎麼辦 —— 要不要現在去約是她的判斷（ADR-0002）。
 */
export function describePair(pair, visits = []) {
  if (!pair?.followup) return null;

  const source = counts(pair.source, visits, pair.source.id);
  const owes = owed(pair, visits);
  const followup = counts(pair.followup, visits, pair.followup.id);
  // 約了的那幾場哪一天（最多三個）。跟 `counts()` 的 booked 同一個判斷（`slotOutcome()`）
  const dates = (visits ?? []).flatMap((v) => (v?.slots ?? [])
    .filter((s) => s?.entitlementId === pair.followup.id && slotOutcome(v, s) === 'booked').map(() => v.date))
    .sort();
  const when = dates.length
    ? `（${dates.slice(0, 3).map((d) => shortDate(d)).join('、')}${dates.length > 3 ? '…' : ''}）` : '';

  // **畫面的字與系統的帳分開**（2026-10-09，ADR-0145）。她：「二返完成才算」—— 以前「二返已經約掉 N 次」把約了的也算進去，
  // 而先約好、接在還沒做完的健檢上的那一場，`owed()` 現在不算約掉。三個數字各講各的：做完的才是做完，
  // 「還沒約」＝`owed()`（跟「約二返」那張待辦同一個數）
  return {
    owed: owes,
    text: `健檢做完 ${source.done} 次：二返做完 ${followup.done} 次、約了 ${followup.booked} 次${when}、還沒約 ${owes} 次`,
  };
}
