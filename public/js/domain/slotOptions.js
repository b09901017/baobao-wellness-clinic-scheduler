// 「這一段可以做什麼」只有一支（2026-10-05，issue 05，ADR-0121）。純函式。
//
// 壓表「做什麼」那一排、來訪編輯器的額度那一排、拍 Abovee 的額度丸子，問的是同一句話：
// **這位客戶這一段可以是什麼**。答案有三種：
//
//   額度            她買的，排了就扣（`customerPools()`，二返排最後）
//   ＋ n返          加約的，不扣（ADR-0063，`domain/nthFollowup.js`）
//   不算次數的課    不用加購就排得進去，排了也不扣（課程主檔上的 `uncounted`，ADR-0121）
//
// 2026-10-05 之前這一排是從額度長出來的：沒有額度就沒有那一顆，所以功醫門診
// （不扣額度）建得起來卻排不進去。n返 是後來塞進去的第一個例外，寫在壓表的畫面裡。
//
// **後兩種的時段 `entitlementId` 都是 null**，所以它們在同一排上的值不能是額度的 id ——
// `NTH_PICK` 與 `uncountedPick()` 給的那兩種字都帶著底線前綴，Firestore 的自動 id
// （20 個 [A-Za-z0-9] 字元）撞不到。那兩個值只活在畫面上，組時段時換回課程
// （`slotDraft.js` 的 `slotFromPicks()`）。

import { customerPools } from './scheduling.js';
import { coursesForEntitlement } from './visits.js';
import { examChoicesForNth, courseIdForNth } from './nthFollowup.js';
import { uncountedCourses, groupByCourse } from './masterData.js';

/** 「＋ n返」那一顆的值。**不是任何一筆額度的 id。** */
export const NTH_PICK = '__nth__';

const COURSE_PICK = '__course__:';

/** 一門不算次數的課在那一排上的值。 */
export const uncountedPick = (courseId) => `${COURSE_PICK}${courseId}`;

/** 那一排上的值 → 不算次數的那門課的 id。不是那一種就回 `null`。 */
export function uncountedCourseIdOf(value) {
  return typeof value === 'string' && value.startsWith(COURSE_PICK)
    ? value.slice(COURSE_PICK.length)
    : null;
}

/**
 * 這位客戶這一段可以做什麼。
 *
 * 每一顆的形狀一樣，畫面不用分三種畫：
 *
 *   entitlementId  那一排上的值（額度 id、`NTH_PICK`、或 `uncountedPick()`）
 *   label          丸子上的字
 *   remaining      剩幾次；不扣次數的兩種是 `'—'`（0 看起來像「用完了」）
 *   course         這一段預設算哪一門課（擇一池挑了器材之後會換，ADR-0075）
 *   entitlement    那一筆額度；不扣次數的兩種是 `null`
 *   isNth／isUncounted
 *
 * **不算次數的課一定有那一顆** —— 這位客戶身上如果還有那門課的額度，額度那一顆照樣在，
 * 她選哪一顆就扣不扣（她之後會自己勾營養諮詢，而既有客戶身上有它的額度）。
 *
 * @param {object} ctx
 * @param {object[]} ctx.entitlements 這位客戶的額度
 * @param {object[]} [ctx.visits] 這位客戶的來訪（n返 要靠它找做完的健檢）
 * @param {object[]} ctx.courses
 * @param {object[]} [ctx.equipment]
 * @param {object[]} [ctx.pools] 已經算好的那一份（壓表的佇列算過了）；沒給就現算
 * @param {string|null} [ctx.followupForVisitId] 她已經選了哪一次健檢（n返 借的課程跟著它）
 * @param {{includeUsedUp?: boolean}} [o] 用完的額度列不列。壓表不列；拍 Abovee 列 ——
 *   Abovee 上已經約了，那一段是既成事實
 */
export function slotOptionsFor(
  { entitlements = [], visits = [], courses = [], equipment = [], pools = null, followupForVisitId = null },
  { includeUsedUp = false } = {},
) {
  const coursesById = Object.fromEntries(courses.map((c) => [c.id, c]));
  const out = [];

  for (const pool of pools ?? customerPools({ entitlements }).pools) {
    if (!includeUsedUp && pool.remaining <= 0) continue;
    const entitlement = entitlements.find((e) => e.id === pool.entitlementId);
    if (!entitlement) continue;
    // 四選一會推出兩門課，取第一個當還沒選器材時的預設
    const course = coursesForEntitlement(entitlement, courses, equipment)[0] ?? null;
    if (!course) continue;
    out.push({
      entitlementId: pool.entitlementId,
      label: pool.label,
      remaining: pool.remaining,
      durationMin: entitlement.durationMin ?? course.durationMin ?? 60,
      course,
      entitlement,
    });
  }

  // **一個做完的健檢都沒有時整顆不畫。** 畫成 disabled 的話她每次都會試一下。
  // 候選連沒做完的也列（asks-2026-09-24/issues/11），所以問的是有沒有**按得下去**的
  const exams = examChoicesForNth({ entitlements, coursesById, visits });
  if (exams.some((c) => c.pickable)) {
    // n返 借那一次健檢配的二返課程。已經選好健檢就用那一次的；還沒選就拿第一個候選的
    const wanted = followupForVisitId ?? exams.find((c) => c.pickable)?.visitId ?? null;
    const exam = visits.find((v) => v.id === wanted) ?? null;
    const course = coursesById[exam ? courseIdForNth(exam, entitlements, coursesById) : null] ?? null;
    if (course) {
      out.push({
        entitlementId: NTH_PICK,
        label: '＋ n返',
        remaining: '—',
        durationMin: course.durationMin ?? 30,
        course,
        entitlement: null,
        isNth: true,
      });
    }
  }

  for (const course of uncountedCourses(courses)) {
    out.push({
      entitlementId: uncountedPick(course.id),
      label: course.name,
      remaining: '—',
      durationMin: course.durationMin ?? 60,
      course,
      entitlement: null,
      isUncounted: true,
    });
  }

  return arrangeSlotOptions(out, courses);
}

/** 二返與 n返 那一組的小標。它不是課程的分類 —— 那一組永遠排在最後。 */
export const FOLLOWUP_GROUP = '二返・n返';

const isFollowupOption = (o) => Boolean(o?.isNth || o?.entitlement?.followupForEntitlementId);

/** 一類裡：先額度（照名字）、再不算次數的課（照主檔）、最後 n返。 */
const kindRank = (o) => (o.isNth ? 2 : o.isUncounted ? 1 : 0);

/**
 * 那一排的**順序與小標**（2026-10-06，issue 08）。三個入口都照這一支：壓表（`slotOptionsFor()` 回的就是排好的）、
 * 來訪編輯器（它自己算「剩幾次」—— 把手上這份草稿也算進去 —— 但順序與小標問這裡）、拍 Abovee。她的原話：
 *
 * > 我覺得先照你的建議依照分類排列並加小標，不增加點選步驟，但是要提醒我去測試和你說好不好
 *
 * 1. **照分類**（`courseGroupNames()` 的順序，`masterData.js` 的 `groupByCourse()`）：同一類裡先額度、再那一類不算次數的課。
 *    擇一池的額度算它推出來的第一門課（`option.course`，同 `slotOptionsFor()` 挑預設課程那一條）
 * 2. **同一類裡的額度照名字排**，不照剩幾次：壓表讀快取、編輯器把草稿算進去，兩邊的數字不一樣 ——
 *    拿它排的話同一位客戶在兩個入口的順序不一樣。「快用完的排前面」從此只剩卡片牆上那個數字在講
 * 3. **二返與 n返 一律最後一組**（她 2026-09-24：「跟健檢並排一指就約錯」），不跟著「醫師門診」走；
 *    而且**那一組另起一行**（`breakBefore`）—— 照分類排之後健檢是最後一類，只隔一條線的話兩顆實體上還是隔壁
 *
 * 每一顆多三格：`group`（那一類的名字）、`lead`（每一類第一顆是那一類的名字，**整排只有一類時一個都不畫**——
 * 一個小標等於沒有分類，只多佔一格）、`breakBefore`（二返那一組的第一顆，前面還有別的時）。
 *
 * @param {object[]} options 每一顆至少有 `{ label, course, entitlement, isNth?, isUncounted? }`
 * @param {object[]} courses 主檔（分類的順序要認得她自己開的分類）
 */
export function arrangeSlotOptions(options = [], courses = []) {
  const byName = (a, b) => kindRank(a) - kindRank(b)
    || (kindRank(a) === 0 ? String(a.label).localeCompare(String(b.label), 'zh-TW') : 0);
  const groups = [
    ...groupByCourse(options.filter((o) => !isFollowupOption(o)), (o) => o.course, courses),
    { group: FOLLOWUP_GROUP, items: options.filter(isFollowupOption) },
  ].filter((g) => g.items.length)
    .map(({ group, items }) => ({ group, items: items.slice().sort(byName) }));

  const many = groups.length > 1;
  return groups.flatMap(({ group, items }, at) => items.map((o, i) => ({
    ...o,
    group,
    lead: many && i === 0 ? group : null,
    breakBefore: group === FOLLOWUP_GROUP && at > 0 && i === 0,
  })));
}
