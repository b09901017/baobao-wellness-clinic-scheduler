// 「這一段可以做什麼」只有一支（2026-10-05，issue 05，ADR-0121）。純函式。
//
// 壓表「做什麼」那一排、來訪編輯器的額度那一排、拍 Abovee 的額度丸子，問的是同一句話：
// **這位客戶這一段可以是什麼**。答案有三種：
//
//   額度            她買的，排了就扣（`customerPools()`，二返排最後）
//   ＋ n返          加約的，不扣（ADR-0063，`domain/nthFollowup.js`）
//   送的／體驗      不扣任何一筆額度（時段上的 `giftKind`，gift-and-trial 01）：不算次數的課
//                   （課程主檔上的 `uncounted`，ADR-0121）與「別的課當體驗」（健檢、二返除外）
//
// **送的／體驗那幾顆一律收在最後**（`folded`，gift-and-trial 04）。她的原話：
//
// > 然後我希望這種不算次數的，在壓表或是新增來訪那邊可以先預設不出現先收合或是擺到底下，畢竟不常用
//
// 收起來是畫面的事（`ui/components/giftFold.js` 畫最後那一顆「送的／體驗…」），**哪幾顆收、
// 什麼順序、要不要一打開就展開只在這一支**（`folded`、`arrangeSlotOptions()`、`foldOpen()`）。
//
// 2026-10-05 之前這一排是從額度長出來的：沒有額度就沒有那一顆，所以功醫門診
// （不扣額度）建得起來卻排不進去。n返 是後來塞進去的第一個例外，寫在壓表的畫面裡。
//
// **後兩種的時段 `entitlementId` 都是 null**，所以它們在同一排上的值不能是額度的 id ——
// `NTH_PICK` 與 `giftPick()` 給的那兩種字都帶著底線前綴，Firestore 的自動 id
// （20 個 [A-Za-z0-9] 字元）撞不到。那兩個值只活在畫面上，組時段時換回課程
// （`slotDraft.js` 的 `slotFromPicks()`）。

import { customerPools } from './scheduling.js';
import { coursesForEntitlement } from './visits.js';
import { examChoicesForNth, courseIdForNth } from './nthFollowup.js';
import { isUncounted, canBeGift, groupByCourse } from './masterData.js';

/** 「＋ n返」那一顆的值。**不是任何一筆額度的 id。** */
export const NTH_PICK = '__nth__';

const COURSE_PICK = '__course__:';

/**
 * 「送的／體驗」那一門在那一排上的值（gift-and-trial 01，以前叫 `uncountedPick()`）。
 * 值只有課程：體驗還是送的另外一排選（`slotFromPicks()` 的 `giftKind`）。
 * 字串的前綴沒改（`__course__:`）—— 它只活在畫面上，E2E 拿它找丸子。
 */
export const giftPick = (courseId) => `${COURSE_PICK}${courseId}`;

/** 那一排上的值 → 送的／體驗的那門課的 id。不是那一種就回 `null`。 */
export function giftCourseIdOf(value) {
  return typeof value === 'string' && value.startsWith(COURSE_PICK)
    ? value.slice(COURSE_PICK.length)
    : null;
}

/**
 * 這位客戶這一段可以做什麼。
 *
 * 每一顆的形狀一樣，畫面不用分三種畫：
 *
 *   entitlementId  那一排上的值（額度 id、`NTH_PICK`、或 `giftPick()`）
 *   label          丸子上的字
 *   remaining      剩幾次；不扣次數的兩種是 `'—'`（0 看起來像「用完了」）
 *   course         這一段預設算哪一門課（擇一池挑了器材之後會換，ADR-0075）
 *   entitlement    那一筆額度；不扣次數的兩種是 `null`
 *   isNth／isGift  n返、送的／體驗（`giftOptions()`）
 *   folded         收在「送的／體驗…」後面（送的／體驗那幾顆都是）
 *
 * **送的／體驗那一組每一門課都有一顆**（健檢、二返除外）—— 這位客戶身上如果還有那門課的額度，
 * 額度那一顆照樣在，她選哪一顆就扣不扣（她：「就算他身上有買那門課也不扣」）。
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

  // **一次接得上的健檢都沒有時整顆不畫。** 畫成 disabled 的話她每次都會試一下。
  // 候選連取消、未到的也列（asks-2026-09-24/issues/11），所以問的是有沒有**按得下去**的（排著的與做完的，ADR-0145）
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

  return arrangeSlotOptions([...out, ...giftOptions(courses)], courses);
}

/**
 * 送的／體驗那一組（gift-and-trial 04）：每一門還在用、可以當體驗的課一顆（`canBeGift()`：健檢、二返除外）。
 *
 * - 不算次數的課（`other: false`）：她最常按的那幾門，展開之後第一排
 * - 其餘（`other: true`）：「別的課當體驗」，畫面上照分類 → 課程兩步
 *
 * 順序不在這裡，在 `arrangeSlotOptions()`（呼叫端不用自己排）。
 *
 * @param {object[]} courses 主檔
 * @param {{keep?: object|null}} [o] 這一段現在指著的那一門：停用了也要列，不然那一排一顆都沒按
 */
export function giftOptions(courses = [], { keep = null } = {}) {
  const alive = (courses ?? []).filter((c) => c && !c.deletedAt && c.active !== false);
  const list = keep && !alive.some((c) => c.id === keep.id) ? [...alive, keep] : alive;
  return list.filter((c) => canBeGift(c, courses)).map((course) => ({
    entitlementId: giftPick(course.id),
    label: course.name,
    remaining: '—',
    durationMin: course.durationMin ?? 60,
    course,
    entitlement: null,
    isGift: true,
    folded: true,
    other: !isUncounted(course),
  }));
}

/**
 * 「送的／體驗…」那一組要不要一打開就展開（gift-and-trial 04）：
 * 這一排沒有任何一顆**還有剩的**額度（拍 Abovee 列的用完那幾顆不算），不然上面那一排是空的；
 * 或這一段現在就是送的／體驗（收起來的話畫面上是「一顆都沒按」）。
 *
 * @param {object[]} options 那一排（每一顆至少有 `entitlement`、`remaining`）
 * @param {string|null} value 現在按著的那一顆
 */
export function foldOpen(options = [], value = null) {
  if (giftCourseIdOf(value)) return true;
  return !(options ?? []).some((o) => !o.folded && o.entitlement && Number(o.remaining) > 0);
}

/**
 * 沒有額度可以預設時，新的一段預設哪一門（來訪編輯器）：送的／體驗那一組展開之後第一排的第一顆 ——
 * **照舊是功醫門診**（`GIFT_FIRST`）。一門不算次數的課都沒有就是 `null`。
 */
export function defaultGiftCourse(courses = []) {
  return arrangeSlotOptions(giftOptions(courses), courses).find((o) => !o.other)?.course ?? null;
}

/** 二返與 n返 那一組叫什麼（每一顆的 `group`）。它不是課程的分類 —— 那一組永遠排在最後。 */
export const FOLLOWUP_GROUP = '二返・n返';

const isFollowupOption = (o) => Boolean(o?.isNth || o?.entitlement?.followupForEntitlementId);

/** 一類裡：先額度（照名字）、最後 n返。 */
const kindRank = (o) => (o.isNth ? 1 : 0);

/**
 * 送的／體驗那一組展開之後第一排的先後（gift-and-trial 04）：同一類裡照這一份，其餘照名字。
 * 種子的 id —— **不靠主檔讀回來的順序**：Firestore 照文件 id 排，心臟科評估（course-cardio）會排到
 * 功醫門診（course-fm）前面，而沒有額度的客戶新的一段預設的就是第一顆（`defaultGiftCourse()`）。
 */
const GIFT_FIRST = ['course-fm', 'course-hrv', 'course-cardio', 'course-eecp-trial'];

const giftRank = (o) => {
  const i = GIFT_FIRST.indexOf(o.course?.id);
  return i < 0 ? GIFT_FIRST.length : i;
};

/**
 * 那一排的**順序**（2026-10-06，issue 08）。三個入口都照這一支：壓表（`slotOptionsFor()` 回的就是排好的）、
 * 來訪編輯器（它自己算「剩幾次」—— 把手上這份草稿也算進去 —— 但順序問這裡）、拍 Abovee。她的原話：
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
 * 4. **送的／體驗那幾顆（`folded`）一律在最後**（gift-and-trial 04，推翻上面 1 的「類裡再那一類不算次數的課」）：
 *    先不算次數的課、再「別的課當體驗」；兩組各自照分類，同一類裡照 `GIFT_FIRST` → 名字
 *
 * 每一顆多兩格：`group`（那一類的名字）、`breakBefore`（二返那一組的第一顆，前面還有別的時）。
 *
 * **小標 2026-10-07 拿掉了**（issue 16）。她在 staging 試完：
 *
 * > 我覺得壓表或是新增來訪的地方就不用每一類前面有灰色小標，也就是如果是這個人有的，肯定不會很多，
 * > 就和之前一樣一次呈現所有的丸子就好不需要灰色小標。加購的話也就是一次會呈現所有課程的地方，就維持你這次修改的
 *
 * 這一排列的是這位客戶有的，本來就沒幾顆。順序不變；加購那一排（列全部課程）的分類照舊。
 *
 * @param {object[]} options 每一顆至少有 `{ label, course, entitlement, isNth?, folded?, other? }`
 * @param {object[]} courses 主檔（分類的順序要認得她自己開的分類）
 */
export function arrangeSlotOptions(options = [], courses = []) {
  const byName = (a, b) => kindRank(a) - kindRank(b)
    || (kindRank(a) === 0 ? String(a.label).localeCompare(String(b.label), 'zh-TW') : 0);
  const shown = options.filter((o) => !o.folded);
  const groups = [
    ...groupByCourse(shown.filter((o) => !isFollowupOption(o)), (o) => o.course, courses),
    { group: FOLLOWUP_GROUP, items: shown.filter(isFollowupOption) },
  ].filter((g) => g.items.length)
    .map(({ group, items }) => ({ group, items: items.slice().sort(byName) }));

  const byGift = (a, b) => giftRank(a) - giftRank(b) || String(a.label).localeCompare(String(b.label), 'zh-TW');
  const folded = (list) => groupByCourse(list, (o) => o.course, courses)
    .flatMap(({ group, items }) => items.slice().sort(byGift).map((o) => ({ ...o, group, breakBefore: false })));

  return [
    ...groups.flatMap(({ group, items }, at) => items.map((o, i) => ({
      ...o,
      group,
      breakBefore: group === FOLLOWUP_GROUP && at > 0 && i === 0,
    }))),
    ...folded(options.filter((o) => o.folded && !o.other)),
    ...folded(options.filter((o) => o.folded && o.other)),
  ];
}
