// 一次性客人的健檢那一串（2026-11-05，ADR-0172 決定三）。純函式。
//
// 健檢那一串（追蹤健檢報告 → 寄報告給醫師＋約二返、二返接哪一次健檢、二返簽不簽得成、取消之後還接著誰）
// 整條以**額度**為軸：`pairsOf()` 從「健檢額度＋指回它的二返額度」配對，「做完一次健檢」問的是那一段用的是不是那一筆健檢額度
// （`usedAndDone()`、`counts()`）。一次性客人沒有額度（他的段 `entitlementId` 是 null），不處理的話那一串一張都不會長。她：
//
// > 他之前有用卷換了健檢，所以我要幫她排二返，雖然這次失約，但是之後還是會幫他排……
// > 約完二返後的寫紀錄等等待辦，我也還是都要做，就和一般來訪一樣
//
// 所以**算那一串的時候**，一次性的健檢段與接在一次性健檢上的一次性二返段，當成用一對額度：
//
//   健檢那一筆   id `oneTime:exam:<健檢課程>`，總數＝他還算數的一次性健檢段有幾段
//   二返那一筆   id `oneTime:followup:<健檢課程>`，指回健檢那一筆，總數一樣 → `owed()` 的
//                「min(做完的健檢, 二返總數)」就是**一次健檢欠一場二返**
//
// 來訪抄一份、只在那一份裡填上那一對的 id。**那一份只拿來算、絕不存**（`data/visits.js` 的 `countOps()` 擋 `assertNoOneTimeIds()`）。
// 既有的鏈（ADR-0022、0139、0142、0145、0159）一個字都不改就套得上。
//
// **不填的段**：
// - n返（它本來就靠返數、不靠額度認；填了會被 `counts()`、`linksOf()`、`doubleClaimedExams()` 當成二返）——
//   找健檢的那幾支（`examChoicesForNth()`、`courseIdForNth()`、驗證）吃投影過的那一份，認得出一次性的健檢段
// - `examNotMine` 的段（它不接健檢、不扣，ADR-0169）
// - 已經帶著一筆真的額度的段（壞資料：驗證另外擋，這裡不蓋掉）
//
// **不變量：沒有一次性的段時，原封不動交回輸入**（同一個陣列、同一個物件）—— 一般客人算出來的每一格跟這一支之前一模一樣。
// **冪等**：投影過的再投影一次一樣（呼叫鏈上可能套兩次：`chainInputs()` 套了、`syncFollowupTasks()` 又套）。
//
// 判準（ADR-0172）：**這一行會不會讓一位一般客戶或一段沒有標記的段被放寬，或讓一次性的段被算進任何一筆真的額度？**

import { isOneTimeSlot, isExamNotMine } from './masterData.js';
import { slotOutcome } from './entitlements.js';

/** 那一對額度的 id 前綴。Firestore 的自動 id（20 個 [A-Za-z0-9] 字元）撞不到。 */
export const ONE_TIME_ID_PREFIX = 'oneTime:';

/** 這個 id 是不是那一對（只在記憶體裡的）額度。 */
export const isOneTimeEntitlementId = (id) => typeof id === 'string' && id.startsWith(ONE_TIME_ID_PREFIX);

const examIdFor = (courseId) => `${ONE_TIME_ID_PREFIX}exam:${courseId}`;
const followupIdFor = (courseId) => `${ONE_TIME_ID_PREFIX}followup:${courseId}`;

/** 這門課是健檢（自己有 `followupCourseId`，同 `followups.js` 的 `followupCourseIdOf()`）。 */
const isExamCourse = (course) => Boolean(course?.followupCourseId);

/** 一次性的段、沒有真的額度（空的、或已經是那一對的 id）、不是 n返、不是健檢不是她排的。 */
function fillable(slot) {
  if (!isOneTimeSlot(slot) || isExamNotMine(slot)) return false;
  if (slot.followupNth != null && slot.followupNth !== '') return false;
  return slot.entitlementId == null || isOneTimeEntitlementId(slot.entitlementId);
}

/**
 * 那一段在投影裡該用哪一筆的 id：一次性的健檢段 → 健檢那一筆；接在一次性健檢上的一次性二返段 → 二返那一筆。
 * 其餘回 `null`（沒有那一對的 id）。
 *
 * @param {object} slot
 * @param {Map<string, object>} byId 來訪 id → 來訪（找二返接的那一次健檢）
 * @param {Record<string, object>} coursesById
 */
function targetOf(slot, byId, coursesById) {
  if (!fillable(slot)) return null;
  const course = coursesById?.[slot.courseId];
  if (isExamCourse(course)) return examIdFor(course.id);
  if (!slot.followupForVisitId) return null;
  // 二返接的那一天裡的一次性健檢段。同一天有兩門健檢時，挑二返課程跟這一段一樣的那一門
  const exams = (byId.get(slot.followupForVisitId)?.slots ?? [])
    .filter((s) => fillable(s) && isExamCourse(coursesById?.[s.courseId]));
  const exam = exams.find((s) => coursesById[s.courseId].followupCourseId === slot.courseId) ?? exams[0] ?? null;
  return exam ? followupIdFor(exam.courseId) : null;
}

/**
 * 算健檢那一串之前的那一步：替一次性的段生一對只在記憶體裡的額度、來訪抄一份填上那一對的 id。
 *
 * **一位客戶的**來訪與額度（同那幾支鏈的函式）。`coursesById` 要含已刪除的（同 `pairsOf()`）。
 *
 * @param {{entitlements?: object[], visits?: object[], coursesById?: Record<string, object>}} input
 * @returns {{entitlements: object[], visits: object[]}} 沒有一次性的段時就是傳進來的那兩個陣列
 */
export function withOneTimeChain({ entitlements = [], visits = [], coursesById = {} } = {}) {
  const ents = entitlements ?? [];
  const list = visits ?? [];
  const real = ents.filter((e) => !isOneTimeEntitlementId(e?.id));
  const any = list.some((v) => (v?.slots ?? []).some(fillable));
  if (!any) {
    // 一次性的段一段都沒有：原封不動（之前投影過、後來那幾段沒了的，把那一對拿掉）
    return real.length === ents.length ? { entitlements: ents, visits: list } : { entitlements: real, visits: list };
  }

  // 後面的蓋前面的（驗證把正在存的那一份接在最後，它比資料庫裡的舊版本新）
  const byId = new Map(list.filter((v) => v?.id).map((v) => [v.id, v]));
  const projected = list.map((v) => {
    const slots = v?.slots ?? [];
    let changed = false;
    const next = slots.map((s) => {
      if (!fillable(s)) return s;
      const id = targetOf(s, byId, coursesById);
      if ((s.entitlementId ?? null) === id) return s;
      changed = true;
      return { ...s, entitlementId: id };
    });
    return changed ? { ...v, slots: next } : v;
  });

  // 健檢那一筆的總數＝還算數的一次性健檢段（`slotOutcome()` 不是 null：取消的、刪掉的那一天不算）。
  // 同一份來訪 `counts()` 也看得到，所以做完＋排著＋沒來 ≤ 總數；同一個 id 出現兩次（驗證時舊的與正在存的）只算後面那一份
  const unique = [...new Map(projected.map((v, i) => [v?.id ?? `#${i}`, v])).values()];
  const totals = new Map();
  for (const v of unique) {
    for (const s of v?.slots ?? []) {
      const course = coursesById?.[s?.courseId];
      if (!fillable(s) || !isExamCourse(course) || slotOutcome(v, s) == null) continue;
      totals.set(course.id, (totals.get(course.id) ?? 0) + 1);
    }
  }
  // 一段都還算數的時候也要有那一對（取消掉的健檢，二返的連結照樣指著它 —— `strandedFollowups()` 要認得出來）
  for (const v of unique) {
    for (const s of v?.slots ?? []) {
      const course = coursesById?.[s?.courseId];
      if (fillable(s) && isExamCourse(course) && !totals.has(course.id)) totals.set(course.id, 0);
    }
  }

  const virtual = [...totals].flatMap(([courseId, n]) => {
    const course = coursesById[courseId];
    return [
      { id: examIdFor(courseId), type: 'single', label: `${course?.name ?? '健檢'}（一次性）`, courseId, totalQty: n },
      {
        id: followupIdFor(courseId), type: 'single',
        label: `${coursesById[course?.followupCourseId]?.name ?? '二返'}（一次性）`,
        courseId: course?.followupCourseId ?? null, followupForEntitlementId: examIdFor(courseId), totalQty: n,
      },
    ];
  });

  return { entitlements: [...real, ...virtual], visits: projected };
}

/**
 * 把投影裡的結果換回她資料裡的那一份：**照位置**（`withOneTimeChain()` 回的來訪跟傳進去的同一個順序；還沒有 id 的那一筆也換得回來）。
 * 鏈的函式回給呼叫端的 `visit`／`slot`／`exam` 一律走這一支 —— 拿投影那一份去存，計數那一步會去改一筆不存在的額度。
 *
 * @param {object[]} visits 呼叫端給的那一份（沒投影過的）
 * @param {object[]} projected `withOneTimeChain()` 回的那一份
 * @returns {{visit: (v: object|null) => object|null, slot: (v: object|null, s: object|null) => object|null}}
 *   `slot`：投影那一筆裡的那一段 → 原本那一筆同一個位置的那一段
 */
export function originalOf(visits = [], projected = visits) {
  const map = new Map((projected ?? []).map((p, i) => [p, (visits ?? [])[i] ?? p]));
  const visit = (v) => (v && map.has(v) ? map.get(v) : v);
  const slot = (v, s) => {
    const at = (v?.slots ?? []).indexOf(s);
    return at >= 0 ? (visit(v)?.slots?.[at] ?? s) : s;
  };
  return { visit, slot };
}

/**
 * **存檔那一道防線**（ADR-0172 決定三）：任何一段帶著那一對的 id → 丟錯（不是悄悄清掉）。
 * 發生了就是投影那一份被拿去存了 —— 計數那一步（`data/visits.js` 的 `countOps()`）還會去改一筆不存在的額度。
 *
 * @param {object[]} visits
 */
export function assertNoOneTimeIds(visits = []) {
  for (const v of visits ?? []) {
    for (const s of v?.slots ?? []) {
      if (isOneTimeEntitlementId(s?.entitlementId)) {
        throw new Error(`一次性客人的段帶著算健檢那一串時才有的額度（${s.entitlementId}），不可以存進去`);
      }
    }
  }
}
