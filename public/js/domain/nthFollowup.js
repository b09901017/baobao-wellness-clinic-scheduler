// 三返、四返……n返。純函式。
//
// 二返是客戶做完健檢之後回院聽醫生報告的那一次，**一定會有**，所以它有自己的
// 額度、跟著健檢的額度成對建立（ADR-0022）。n返 是同一件事再來一次 ——
// 客戶聽不懂、或者想再聽一遍，她才會另外約一場。
//
// 使用者 2026-09-02 的原話：
//
// > 三返,四返...n返不一樣，他不常發生，通常是客戶要求……
// > **這個 n返 不需要先加購才能有，而是只要有健檢的就可以選**，
// > 但他也沒有次數限制，沒有一定要也沒有只能到幾返。
//
// ## 為什麼它不吃額度
//
// 「額度」在 `CONTEXT.md` 的定義是「某位客戶**買到的**某個課程的次數」。
// n返 沒有被買、沒有次數、扣不掉 —— 它不是額度。硬塞成額度只有兩條路，
// 兩條都會壞：開一筆次數很大的，客戶詳情就多一張寫著「剩 97 次」的卡，
// 而且 `summarize()`、`lowRemaining()`、`customersToBook()` 全部會吃到它
//（ADR-0057 為了營養品打過同一場仗，`schedulable()` 那道閘門就是那次的產物）；
// 每約一次就把 `totalQty` 加一的話，「加購」與「排班」變成同一個動作，
// 稽核紀錄上每一次壓表都會多一筆額度變更。
//
// 所以 n返 的時段 **`entitlementId` 是 null**，靠兩個欄位自己站得住：
//
//   followupNth        3、4、5……（二返身上沒有這個欄位）
//   followupForVisitId 那一次健檢的來訪 id（既有欄位，n返 **必填**）
//
// 系統原本就沒有假設每一段都有額度 —— `domain/visits.js` 的 `recount()` 早就
// 寫著 `if (slot.entitlementId)`，`domain/health.js` 的 `refState()` 對 null
// 回 `'none'` 而且不報孤兒。只有 `validateVisit()` 那一行硬性要求，那一行放寬了。
//
// ## 為什麼是一支新檔案，而不是寫進 domain/followups.js
//
// 那一支的檔頭寫著它回答三個問題，三個都是「額度層級的一對一配對」；
// n返 一個都不是。混在同一支裡，之後改二返的人一定會不小心改到 n返
//（反之亦然），而這一輪最硬的條件就是**二返的東西一個字都不准動**。
//
// 兩者在資料上完全不相交，所以互相看不見：`counts()` 逐段比 `entitlementId`，
// n返 的 null 永遠不相等；`claimedExams()` 以二返那一筆額度的 id 為軸，
// n返 沒有那個 id。判準記在這裡，之後每一行都可以拿來問一次：
//
// > **這一行會不會讓一筆二返的資料被算成 n返，或反過來？**

import { followupCourseIdOf } from './followups.js';

/**
 * 最少三返（2 是二返，那一條路已經有了 —— 兩條路不可以都走得到同一個數字），
 * 最多十返。
 *
 * 她說沒有上限，而這裡還是給了一個：一個沒有上限的數字輸入框只會讓打錯字
 * 變成一筆看不懂的資料（`followupNth: 33`），而十返已經遠超過真的會發生的
 * 次數。真的碰到再放寬 —— 資料層沒有任何欄位會因為改這個數字而要搬。
 */
export const MIN_NTH = 3;
export const MAX_NTH = 10;

/** 二返的返數。它不是 n返，但排序與試算表註記要把兩者放在同一條線上。 */
export const SECOND = 2;

const NUMERALS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

/**
 * 3 → `'三返'`。**範圍外回 `null`，不要猜一個** ——
 * 畫面上寫「undefined返」比什麼都不寫更糟。
 *
 * 二返（2）刻意也答得出來：試算表那一行要把「二返(...) 三返(...)」印在一起，
 * 兩邊各自組字串的話遲早有一邊寫成「2返」。
 */
export function nthLabel(n) {
  const num = Number(n);
  if (!Number.isInteger(num) || num < SECOND || num > MAX_NTH) return null;
  return `${NUMERALS[num]}返`;
}

/** 這一段的返數。不是 n返 就回 `null`（**二返也回 null** —— 它走額度那條路）。 */
export function nthOf(slot) {
  const num = Number(slot?.followupNth);
  return Number.isInteger(num) && num >= MIN_NTH && num <= MAX_NTH ? num : null;
}

/**
 * 這一段是不是一場 n返。
 *
 * 看的是 `followupNth` **有沒有被填過**，不是它合不合法 —— 值壞掉的那幾筆
 * 也要被認出來是 n返，否則 `validateVisit()` 會改成抱怨「要選一個額度」，
 * 而她看著那句話完全不知道真正錯的是返數。
 */
export function isNthSlot(slot) {
  return slot?.followupNth != null && slot.followupNth !== '';
}

// ---------- 哪幾筆來訪是健檢 ----------

/**
 * 哪幾筆額度是健檢。
 *
 * 判斷跟 `domain/followups.js` 走**同一條路**：課程主檔上設了
 * `followupCourseId` 的就是健檢（ADR-0022 —— 不從名字比對，
 * 她的資料裡健檢寫成 `0.75萬健檢`、`5萬健檢(心臟)` 這種帶金額等級的字串，
 * 用字串包含比對正是舊 Apps Script 靜默失效的原因）。
 *
 * @returns {Set<string>} 額度 id
 */
export function examEntitlementIds(entitlements = [], coursesById = {}) {
  const out = new Set();
  for (const e of entitlements ?? []) {
    if (!e || e.deletedAt) continue;
    if (followupCourseIdOf(coursesById[e.courseId])) out.add(e.id);
  }
  return out;
}

/**
 * 這一筆來訪是不是一次健檢（有一段扣掉了健檢額度）。
 */
export function isExamVisit(visit, examIds) {
  return (visit?.slots ?? []).some((s) => examIds.has(s.entitlementId));
}

/**
 * 可以接 n返 的健檢來訪，**日期舊的在前**（回訪是照順序約掉的）。
 *
 * **只有已完成的算**：沒做完的健檢沒有報告可以再聽一次。這一條跟二返
 *（`domain/followups.js` 的 `doneVisitsFor()`）是同一個判斷。
 *
 * @param {object[]} entitlements 這位客戶的額度
 * @param {Record<string, object>} coursesById 課程主檔，含已刪除的
 * @param {object[]} visits 這位客戶的全部來訪
 */
export function examVisits(entitlements = [], coursesById = {}, visits = []) {
  const examIds = examEntitlementIds(entitlements, coursesById);
  if (!examIds.size) return [];

  return (visits ?? [])
    .filter((v) => v && !v.deletedAt && v.status === 'done' && isExamVisit(v, examIds))
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/**
 * 這一次健檢配的是哪一個回訪課程。
 *
 * **借二返那個課程**，不另外建一個。借了之後這幾件事一行程式都不用寫就成立：
 * 類別 A → 客人確認之後長出 Examine 與耀聖；`needsTreatmentForm: false`
 * → 不用簽療程單但照樣要結案；`picksDoctor()` → 選得到醫師（試算表註記的
 * 括號要它）；`bookingSystemsForVisit()` → 取消時知道要回哪個系統放時段。
 *
 * 開一個新課程的話，上面每一格都要她自己去主檔設定一次，而設錯的症狀是
 * 「三返沒有長出掛號待辦」—— 畫面上什麼都不會說。
 *
 * @returns {string|null} 課程 id。那一次健檢對不到健檢額度就是 null
 */
export function courseIdForNth(examVisit, entitlements = [], coursesById = {}) {
  const byId = new Map((entitlements ?? []).map((e) => [e.id, e]));
  for (const slot of examVisit?.slots ?? []) {
    const course = coursesById[byId.get(slot.entitlementId)?.courseId];
    const followupId = followupCourseIdOf(course);
    if (followupId) return followupId;
  }
  return null;
}

// ---------- 某一次健檢底下有哪幾返 ----------

/**
 * 某一次健檢底下所有的回訪，**二返也算**，照返數由小到大。
 *
 * 兩種來源刻意各走各的，因為它們在資料上就是兩種東西：
 *
 * - **二返**：時段扣掉那一筆二返額度（`entitlementId`），返數固定是 2
 * - **n返**：時段身上有 `followupNth`，沒有額度
 *
 * 已取消／已刪除的來訪不算 —— 那一場沒發生（同 `claimedExams()` 的判斷）。
 *
 * @param {string} examVisitId 那一次健檢的來訪 id
 * @param {object[]} visits 這位客戶的全部來訪
 * @param {Iterable<string>} [followupEntitlementIds] 二返那幾筆額度的 id
 * @returns {{nth:number, visit:object, slot:object}[]}
 */
export function followupsOfExam(examVisitId, visits = [], followupEntitlementIds = []) {
  const second = new Set(followupEntitlementIds ?? []);
  const out = [];

  for (const v of visits ?? []) {
    if (!v || v.deletedAt || v.status === 'cancelled') continue;
    for (const slot of v.slots ?? []) {
      if (slot?.followupForVisitId !== examVisitId) continue;

      if (isNthSlot(slot)) {
        const nth = nthOf(slot);
        // 返數壞掉的那一筆不要靜靜地印成別的數字。它在資料健檢與
        // `validateVisit()` 那邊會被講出來，這裡只是不參與排序。
        if (nth) out.push({ nth, visit: v, slot });
      } else if (second.has(slot.entitlementId)) {
        out.push({ nth: SECOND, visit: v, slot });
      }
    }
  }

  return out.sort((a, b) => a.nth - b.nth
    || String(a.visit.date).localeCompare(String(b.visit.date)));
}

/**
 * 這一次健檢已經約掉哪幾返。**二返算 2**。
 *
 * @returns {number[]} 由小到大
 */
export function nthsBookedFor(examVisitId, visits = [], followupEntitlementIds = []) {
  return [...new Set(
    followupsOfExam(examVisitId, visits, followupEntitlementIds).map((f) => f.nth),
  )].sort((a, b) => a - b);
}

/**
 * 下一場該是第幾返。
 *
 * 二返算進來（所以第一次加約預設就是三返）。已經到十返就停在十返 ——
 * 給一個超出範圍的預設值，她一按存檔就會被擋下來，而錯的是預設值不是她。
 */
export function nextNthFor(examVisitId, visits = [], followupEntitlementIds = []) {
  const used = nthsBookedFor(examVisitId, visits, followupEntitlementIds);
  const next = (used.length ? Math.max(...used) : SECOND) + 1;
  return Math.min(Math.max(next, MIN_NTH), MAX_NTH);
}

/**
 * 壓一場 n返 時「這是哪一次健檢的」那一排要列什麼。
 *
 * **跟二返最大的差別：一個都不會被鎖住。** `examChoicesFor()` 會把被別的
 * 二返認領掉的那幾次標成 `taken` 並且點不下去，因為二返是一對一的；
 * n返 沒有上限，每一次健檢都可以再約一場。
 *
 * 已經有幾返的照樣標出來（`nths`）—— 她要對照的正是這個。
 *
 * @param {object} ctx
 * @param {object[]} ctx.entitlements 這位客戶的額度
 * @param {Record<string, object>} ctx.coursesById 課程主檔，含已刪除的
 * @param {object[]} ctx.visits 這位客戶的全部來訪
 * @param {string} [ctx.excludeVisitId] 正在編輯的那一筆（它自己的那幾段不算數）
 * @returns {{visitId:string, date:string, nths:number[], note:string}[]}
 *   日期舊的在前
 */
export function examChoicesForNth({
  entitlements = [], coursesById = {}, visits = [], excludeVisitId = null,
} = {}) {
  const second = secondFollowupIds(entitlements);
  const others = (visits ?? []).filter((v) => v.id !== excludeVisitId);

  return examVisits(entitlements, coursesById, visits).map((v) => {
    const nths = nthsBookedFor(v.id, others, second);
    return {
      visitId: v.id,
      date: v.date,
      nths,
      // 空字串代表「這一次還沒有任何回訪」。**不要寫成「還沒約」** ——
      // 二返那一排用的就是那三個字，兩個地方講不同的事會讓她以為是同一件。
      note: nths.length ? nths.map((n) => nthLabel(n)).filter(Boolean).join('・') : '',
    };
  });
}

/**
 * 這位客戶身上哪幾筆是二返額度。
 *
 * 靠 `followupForEntitlementId`（它指回那一筆健檢），不是比課程 ——
 * 一位客戶買兩筆健檢時比課程會配錯（`pairsOf()` 同一個理由）。
 *
 * @returns {Set<string>}
 */
export function secondFollowupIds(entitlements = []) {
  return new Set(
    (entitlements ?? [])
      .filter((e) => e && !e.deletedAt && e.followupForEntitlementId)
      .map((e) => e.id),
  );
}

/**
 * 一段 n返 存進資料庫之前長什麼樣。**三個入口共用這一支**（壓表、來訪編輯器，
 * 之後如果有第三個也走這裡）—— 各自組一次的話，遲早有一個忘了把
 * `entitlementId` 設成 null，而那一段會被算進某一筆額度的次數裡。
 *
 * @param {object} args
 * @param {number} args.nth
 * @param {string} args.examVisitId
 * @param {string} args.courseId 二返那個課程的 id
 * @returns {object} 要展開到時段上的那幾個欄位
 */
export function nthSlotFields({ nth, examVisitId, courseId }) {
  return {
    // **一定是 null。** 這一場排不進任何額度，也不扣任何次數。
    entitlementId: null,
    courseId: courseId ?? null,
    // 名字是快照（同一般時段）—— 主檔之後把二返改名，已經排出去的三返
    // 還是叫三返。
    courseName: nthLabel(nth) ?? '',
    followupNth: nth,
    followupForVisitId: examVisitId ?? null,
  };
}
