// 額度計算。純函式。
//
// 次數在「已完成」才扣，未到不扣但獨立計數。現行試算表在排定時就扣，
// 導致取消改期後數字與現實脫節 —— 這裡不重蹈覆轍。

import { validateProduct } from './products.js';
import { nameOf, fullNameOf } from './naming.js';
import { durationChoicesOf } from './masterData.js';

// 搬到 `masterData.js` 了（`domain/naming.js` 也要問同一件事，而它不能
// import 這一支 —— 這一支已經 import 了它的 `nameOf()`）。這裡再匯出一次，
// 免得七個呼叫端各改一行 import。
export { durationChoicesOf };

/**
 * 這一個時段實際上算哪一種。次數的算法只認這一支。
 *
 * 放在這裡而不是 `domain/visits.js`：`visits.js` 已經 import 了這一支的 `counts()`，
 * 反過來 import 會變成循環。而這條規則本來就是**計數規則** ——
 * ADR-0004 說計數只能有一份實作，那份實作住在這個檔案。
 *
 * **只有已完成的來訪才逐段看結果。** 客人做了兩段、第三段就走了是會發生的
 * （2026-08-20 使用者確認），那時她在收尾畫面逐段勾，沒勾到的那一段
 * `attended` 是 `false`，不扣次數。
 *
 * `attended` 在別的狀態下沒有意義，一律不看：
 *
 * - `confirmed` 的來訪，匯入器會寫 `attended: false`（`domain/mergeImport.js`），
 *   那句話的意思是「還沒發生」，不是「沒做」。看它就會把還沒到的來訪算成未到。
 * - `no_show` 是整筆沒來，每一段都算未到。
 *
 * **`attended` 沒寫過（`undefined` / `null`）一律當成有做。** 舊資料與匯入的來訪
 * （ADR-0011）都沒有逐段記過，把它們當成沒做會讓所有人的次數一夜之間全部退回去。
 * 只有明確的 `false` 才是「這一段沒做」。
 *
 * @returns {'done'|'no_show'|'booked'|null} null = 這一段不佔任何次數（取消、已刪除）
 */
export function slotOutcome(visit, slot) {
  if (!visit || visit.deletedAt) return null;
  if (visit.status === 'done') return slot?.attended === false ? 'no_show' : 'done';
  if (visit.status === 'no_show') return 'no_show';
  if (visit.status === 'pending_confirm' || visit.status === 'confirmed') return 'booked';
  return null; // cancelled：時段已經還回去了
}

/**
 * 這一筆額度排得進來訪嗎。
 *
 * 營養品排不進去 —— `CONTEXT.md`：「賣給客戶的實體商品……只記錄與顯示，
 * **不佔時段、不排班、不產生任務**」。它之所以還是一筆額度（而不是客戶身上
 * 的一個陣列），是為了共用同一顆「加購」按鈕、同一份稽核紀錄、同一個垃圾桶，
 * 見 ADR-0057。
 *
 * 代價就是這一支：它**不可以流進任何「還要排幾次」的計算**，
 * 否則她的待辦上會冒出「王小明還有 2 次沒壓表」，而那 2 是兩罐夜態美。
 */
export const isProduct = (e) => e?.type === 'product';

/**
 * 一筆額度可以是哪幾種。
 *
 * **`firestore.rules` 的 `validEntitlement()` 有同一份白名單**，而那一份漏掉
 * 一種的症狀特別糟：程式完全正確、測試全綠，只有在真的裝置上按下「加購」
 * 才會看到「Missing or insufficient permissions」。`tests/rules.test.js`
 * 拿這一份去對它。
 */
export const ENTITLEMENT_TYPES = ['single', 'pool', 'product'];

/** 排得進來訪的那幾筆。要給人選「這一段扣哪一筆」的地方一律先過這一支。 */
export const schedulable = (entitlements = []) => entitlements.filter((e) => !isProduct(e));

/**
 * 三段式次數。永遠可以從 visits 重算，不依賴任何計數欄位。
 * 這個函式就是對帳的基準：存在 entitlement 上的計數欄位必須等於它。
 *
 * @param {{totalQty:number}} entitlement
 * @param {{status:string, slots:{entitlementId:string, attended?:boolean}[]}[]} visits
 * @param {string} entitlementId
 */
export function counts(entitlement, visits, entitlementId) {
  let done = 0;
  let booked = 0;
  let noShow = 0;

  for (const visit of visits ?? []) {
    for (const slot of visit?.slots ?? []) {
      if (slot.entitlementId !== entitlementId) continue;
      const outcome = slotOutcome(visit, slot);
      if (outcome === 'done') done += 1;
      else if (outcome === 'no_show') noShow += 1;
      else if (outcome === 'booked') booked += 1;
    }
  }

  const total = entitlement?.totalQty ?? 0;
  return {
    total,
    done,
    booked,
    noShow,
    remaining: total - done - booked,
  };
}

/** 剩幾次以內算「快用完」，客戶總覽的篩選用。 */
export const LOW_REMAINING = 2;

/** 這位客戶有沒有任何一池快用完（含已超用）。營養品不算 —— 它扣不掉。 */
export function lowRemaining(entitlements) {
  return schedulable(entitlements ?? []).some(
    (e) => (e.totalQty ?? 0) - (e.doneCount ?? 0) - (e.bookedCount ?? 0) <= LOW_REMAINING,
  );
}

/** 已排 + 已完成超過總數。只提示，不阻擋。 */
/**
 * 客戶詳情那一排額度卡的順序。
 *
 * 那一排是**橫著捲**的（`.scratch/customer-detail-rework/issues/05`），
 * 而橫著捲的東西只有最前面兩三張會被看到 —— 所以順序不是裝飾，是「她會不會
 * 看到那個數字」。三層：
 *
 * 1. **還有剩的排前面。** 用完的她不會去看。
 * 2. **剩得少的更前面。** 那是她要提醒客戶加購的。
 * 3. **健檢與它的二返相鄰**（ADR-0022：買幾次健檢就有幾次二返）。這一層是
 *    最後套上去的，會蓋掉前兩層 —— 健檢卡底下那句「健檢做完 N 次，二返還欠
 *    M 次」要對照著看才有意義，而最需要對照的情況正是**兩者剩餘次數不同**
 *    的時候（欠幾次就是那個差）。只靠前兩層排的話，那正是它們被拆開的時候。
 *
 * 配對走 `followupForEntitlementId`，不是比課程 —— 兩筆健檢時比課程會配錯
 * （`domain/followups.js` 的 `pairsOf()` 同一個理由）。
 *
 * @param {object[]} entitlements
 * @param {object[]} visits 現算剩餘次數要用（ADR-0004：詳情頁現算）
 */
export function sortPools(entitlements = [], visits = []) {
  const remainingOf = (e) => Math.max(0, counts(e, visits, e.id).remaining);

  const sorted = [...entitlements].sort((a, b) => {
    const ra = remainingOf(a);
    const rb = remainingOf(b);
    if ((ra > 0) !== (rb > 0)) return ra > 0 ? -1 : 1;
    if (ra !== rb) return ra - rb;
    return String(a.label ?? '').localeCompare(String(b.label ?? ''), 'zh-TW');
  });

  // 二返搬到它那一筆健檢的正後面。從後往前掃，這樣一次搬一筆不會打亂還沒處理的。
  const out = [];
  const followupsBySource = new Map();
  for (const e of sorted) {
    if (e.followupForEntitlementId) {
      const list = followupsBySource.get(e.followupForEntitlementId) ?? [];
      list.push(e);
      followupsBySource.set(e.followupForEntitlementId, list);
    }
  }

  for (const e of sorted) {
    // 配得到來源的二返不自己排隊，它跟著來源走。配不到的（來源被刪了）照常排 ——
    // 掉出畫面比排在奇怪的位置糟。
    if (e.followupForEntitlementId && sorted.some((x) => x.id === e.followupForEntitlementId)) {
      continue;
    }
    out.push(e);
    for (const f of followupsBySource.get(e.id) ?? []) out.push(f);
  }

  return out;
}

/**
 * 有幾筆的計數欄位跟現算對不起來。
 *
 * 那一排卡橫著捲，所以「這張卡的數字可能是錯的」有可能在畫面外 ——
 * 呼叫端把它畫成段落抬頭上的一顆徽章，那句話不能被捲走。
 */
export function offCount(entitlements = [], visits = []) {
  return entitlements.filter((e) => !reconcile(e, visits, e.id).ok).length;
}

export function isOverused(c) {
  return c.done + c.booked > c.total;
}

/**
 * 計數欄位與重算結果是否一致。資料健檢頁用。
 * 發現不一致時顯示差異，不自動偷改。
 */
export function reconcile(entitlement, visits, entitlementId) {
  const actual = counts(entitlement, visits, entitlementId);
  const stored = {
    done: entitlement?.doneCount ?? 0,
    booked: entitlement?.bookedCount ?? 0,
  };
  return {
    ok: stored.done === actual.done && stored.booked === actual.booked,
    stored,
    actual,
  };
}

/**
 * 把方案範本展開成客戶的額度。
 *
 * 展開後與範本完全脫鉤 —— 這是「改範本絕對不能動到已經買的人」的實作。
 * 見 docs/adr/0003-plan-templates-have-no-version.md
 *
 * @param {{name:string, items:object[]}} plan
 * @param {number} quantity 購買數量，各項次數乘上它
 * @param {object} [when]
 * @param {string|null} [when.purchasedAt] 購買日
 * @param {string|null} [when.expiresAt] 到期日。**選填而且預設沒有**（ADR-0074 那一輪
 *        之後她說「基本上不會到期」）。有的話算好之後複製到每一筆額度上 ——
 *        額度自己要知道什麼時候到期，不能回頭去問範本，範本會被改。
 * @param {string|null} [when.purchaseId] 這一次購買的 id。同一次展開出來的每一筆都一樣，
 *        「買過什麼」那一頁靠它分組、也靠它一次改整組的購買日。
 *        呼叫端給（id 在 `data/` 那一層鑄造），沒給就沒有 —— 舊資料退回
 *        「方案名 + 購買日」分組。
 */
export function expandPlan(plan, quantity = 1, {
  purchasedAt = null, expiresAt = null, purchaseId = null,
} = {}) {
  return (plan?.items ?? []).map((item) => ({
    type: item.type,
    label: item.label,
    courseId: item.courseId ?? null,
    optionEquipmentIds: item.optionEquipmentIds ?? null,
    totalQty: (item.qty ?? 0) * quantity,
    durationMin: item.durationMin ?? null,
    frequencyRule: item.frequencyRule ?? null,
    // 文字快照，不是指向範本的連結。範本之後改名或刪掉都不影響這裡。
    sourcePlanName: plan?.name ?? null,
    // **範本本來寫幾次**（乘過購買數量之後）。跟 totalQty 不一樣就是微調過。
    // 存數字不存布林：「15 次（方案本來 20）」講得出改成什麼，布林只講得出「改過」。
    // 同 sourcePlanName 的理由 —— 快照，不回頭問範本。
    sourcePlanQty: (item.qty ?? 0) * quantity,
    purchaseId,
    purchasedAt,
    expiresAt,
    doneCount: 0,
    bookedCount: 0,
    lastReconciledAt: null,
  }));
}

/**
 * 方案展開出來的那幾筆，套上她在確認前的微調。
 *
 * 微調只有兩種（她 2026-09-06 選的）：**改次數**與**加項目**。
 * 次數改成 0 就是不要那一項 —— 不用另外一顆垃圾桶，`[−]` 按到 0 就是同一個意思，
 * 而多一顆刪除鈕等於多一種要學的操作。
 *
 * **範本一個字都不會變**（ADR-0003：展開後與範本脫鉤）。
 *
 * @param {object[]} rows `expandPlan()` 的結果
 * @param {Record<number, number>} qtyByIndex 第幾項 → 改成幾次
 * @returns {object[]} 次數大於 0 的那幾筆
 */
export function applyPlanTweak(rows = [], qtyByIndex = {}) {
  return rows
    .map((row, i) => (i in qtyByIndex ? { ...row, totalQty: qtyByIndex[i] } : row))
    .filter((row) => (row.totalQty ?? 0) > 0);
}

/** 這一筆跟方案本來寫的不一樣。「買過什麼」那一頁要標出來。 */
export const isTweaked = (e) =>
  e?.sourcePlanQty != null && e.sourcePlanQty !== (e.totalQty ?? 0);

/**
 * 一筆額度存檔前的驗證。手動加購與從方案展開後的個別修改都走這裡。
 *
 * 與方案範本項目的驗證（domain/masterData.js 的 validate('plans')）是同一組規則，
 * 但欄位名不同（範本是 qty，額度是 totalQty），而且額度多了到期日。
 *
 * @param {object} e
 * @param {{courses?: object[], equipment?: object[]}} [context]
 * @returns {string[]} 空陣列代表可以存
 */
/**
 * 健檢的金額等級。她手上的健檢有 0.75 萬、8 萬、12 萬幾種。
 *
 * **等級只影響顯示名稱**（`CONTEXT.md` 的「健檢」），不影響流程與任務 ——
 * `taskRules.js`、`followups.js`、這一支的計數，一行都不因為它而變。
 * 所以它是額度上的一個欄位，不是三個課程（ADR-0054）。
 *
 * 這一份是**丸子上看得到的那幾顆**，不是可以填的全部：畫面上有一顆「其他」
 * 讓她自己打（她的資料裡有「5萬(心臟)」這種）。要加常用的就改這一行。
 */
export const TIER_PRESETS = ['0.75萬', '8萬', '12萬'];

/**
 * 帶等級的顯示名稱：`'8萬'` + `'健檢'` → `'8萬健檢'`。
 *
 * 沒有等級就是課程本來的名字 —— **不要補一個猜的**。2026-08 以前建的那幾筆
 * 健檢額度身上沒有 `tier`，猜一個金額出來比空白糟得多。
 *
 * 配出來的二返會叫「二返（8萬健檢）」，那一段不用改：`followupDraft()`
 * 本來就抄來源額度的 `label`。
 */
export function tieredLabel(tier, courseName) {
  const level = String(tier ?? '').trim();
  const name = String(courseName ?? '').trim();
  return level ? `${level}${name}` : name;
}

/**
 * 「三」「四」。**寫到十為止**，超過就用阿拉伯數字 ——
 * 「十一選一」讀得懂，「十一」以上她不會有那麼多台機器，真的有的話印數字比較清楚。
 */
const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
export const countWord = (n) => (n >= 0 && n < CN.length ? CN[n] : String(n));

/**
 * 這一池的「家」是哪一個課程。
 *
 * 四選一跨兩個課程（復能與 ILIB，ADR-0075），而她講的是「復能四選一」——
 * 那個「復能」是**分類**，也就是池裡那個需要選器材的課程。
 * 一個都找不到就退回第一個，名字總比空白好。
 */
function homeCourseOf(options, courses = []) {
  const ids = [...new Set(options.map((o) => o.courseId).filter(Boolean))];
  const mine = ids.map((id) => courses.find((c) => c.id === id)).filter(Boolean);
  return mine.find((c) => c.requiresEquipment) ?? mine[0] ?? null;
}

/**
 * 一筆擇一池叫什麼。**課程在前面，破折號後面是哪一種。**
 *
 * | 池裡 | 叫什麼 | 為什麼 |
 * |---|---|---|
 * | 一台 | `復能-SIS` | 前半是分類（`homeCourseOf()`），後半是那一台的**全名** |
 * | N 台 | `復能-三選一` | N 是真的有幾台 |
 *
 * 她 2026-09-07 指名這個格式：
 *
 * > 我希望名稱是 復能 - 三選一/四選一/高能量雷射/SIS/INDIBA （30/60）
 *
 * 兩件事跟 2026-09-06 那一版不一樣，兩件都是照她講的：
 *
 * - **單買一台也帶著「復能」**。以前叫 `超磁場(60)`，跟三選一那一筆並排時
 *   看不出是同一類東西 —— 而它們扣的是同一種次數、走的是同一條排班路。
 * - **後半是器材的全名**，而器材的全名就是「她叫它什麼」（2026-09-08 她選的：
 *   那一台從「超磁場」改名成 `SIS`）。別稱那一格留給**月曆** —— 那裡一格只
 *   放得下幾個字，所以 INDIBA 在月曆上是 `IN`，但額度仍然是 `復能-INDIBA(60)`。
 *   兩邊都讀別稱的話，她列的第三種會變成 `復能-IN(60)`。
 *
 * **數字是算出來的不是寫死的**：她之後在主檔多加一台，「四選一」自己會變成
 * 「五選一」，一行程式都不用改。
 *
 * @param {string[]} optionEquipmentIds
 * @param {object[]} equipment 器材主檔
 * @param {object[]} courses 課程主檔（分類名要用）
 */
export function poolName(optionEquipmentIds = [], equipment = [], courses = []) {
  const options = (optionEquipmentIds ?? [])
    .map((id) => (equipment ?? []).find((e) => e.id === id))
    .filter(Boolean);
  if (!options.length) return '';

  const home = fullNameOf(homeCourseOf(options, courses));
  const only = options.length === 1 ? options[0] : null;
  // **單買一台用器材的全名**（2026-09-08）。器材主檔上兩格名字回答兩個問題：
  // 全名是「她叫它什麼」（SIS、INDIBA、高能量雷射），別稱是「月曆那一格的
  // 縮寫」（IN）。她列的六種用的是前者，月曆用的是後者 ——
  // 兩邊都讀別稱的話，第三種會變成 `復能-IN(60)`。
  const what = only
    ? fullNameOf(only)
    : `${countWord(options.length)}選一`;

  if (!what) return home;
  // 器材與課程是同一件事（ILIB 那一台）就不要接兩次 —— 同 `slotName()` 那一條，
  // 比的一樣是**全名**，不然別稱 `IL` 會讓它印成「ILIB - IL」。
  // 這一種在畫面上按不出來（單買那一排沒有 ILIB），但方案範本與匯進來的
  // 舊資料捏得出來。
  const sameThing = only && fullNameOf(only) === home;
  if (!home || home === what || sameThing) return sameThing ? home : what;
  // **破折號兩邊不留空格**（2026-09-08 她指名的格式：`復能-三選一(60)`）。
  // 上一代是 `復能 - 三選一（60）`，`legacyPoolNames()` 認得出來。
  return `${home}-${what}`;
}

// ---------- 擇一池是怎麼組出來的 ----------
//
// 這幾支 2026-09-08 之前住在 `ui/components/buy.js`。它們是**規則不是畫面**
//（「哪幾台屬於復能」「鄰居課程是誰」），而第二個消費端出現的那一天
//（設定 →「名稱怎麼寫」那六列）它就得從一個 UI 元件借規則 ——
// SPEC 第 10 節說規則住 `/domain`。搬過來之後兩個畫面各自 import。

/** 「哪一種」那一排上，兩顆整組的值。存不進資料庫，只活在表單裡。 */
export const POOL_SET_HOME = '__set_home__';
export const POOL_SET_ALL = '__set_all__';

/**
 * 「復能」是哪一個課程。**不寫死名字** —— 判準是「排班時要選器材」，
 * 跟 `picksEquipment()` 問的是同一件事。
 *
 * 有兩個以上就取第一個：那時候這一排本來就講不清楚，而她會在主檔上看到問題。
 */
export function poolCourseOf(master = {}) {
  return (master.courses ?? []).find((c) => !c.deletedAt && c.requiresEquipment) ?? null;
}

/**
 * 擇一池那個課程的「鄰居」是哪幾個課程。
 *
 * 四選一裡那幾台器材身上的 `courseId`，扣掉復能自己那一個 —— 現在就是
 * ILIB 那一個。空的（她還沒把 ILIB 建成器材）就回空的，那時候
 * 資料健檢的「器材主檔少了一台」會講這件事。
 *
 * **兩個畫面問同一句話**：加購那一排（復能與 ILIB 並排）與設定 →「名稱怎麼寫」
 * 那六列的第六列。各判斷一次的話，她之後多接一台新器材、指到一個新課程時，
 * 加購那一排跟著變而名稱那一頁沒有。
 */
export function poolSiblingCourseIds(master = {}) {
  const home = poolCourseOf(master);
  const ids = new Set();
  for (const eq of master.equipment ?? []) {
    if (eq.deletedAt || eq.active === false) continue;
    if (eq.courseId && eq.courseId !== home?.id) ids.add(eq.courseId);
  }
  return ids;
}

/**
 * 「哪一種」那一排有哪幾顆。她 2026-09-07 指名的五顆：
 *
 * > 三選一/四選一/高能量雷射/SIS/INDIBA
 *
 * 前面是**整組**（三選一、四選一），後面是**單買一台**。順序是刻意的：
 * 方案裡的那一項就是三選一，她最常買的排最前面（同 `ivChoicesFor()` 的判斷）。
 *
 * 兩組整組的定義：
 *
 * - **三選一** = 復能那個課程自己的器材（`courseId` 指到它的那幾台）
 * - **四選一** = 全部還在用的器材（多出來的就是 ILIB）
 *
 * 兩組一樣大時只留一顆 —— 畫兩顆一模一樣的丸子等於在問一個沒有答案的問題。
 * 一台器材都沒有指到課程（舊資料）時，「整組」就是全部，只有一顆。
 *
 * **單買那一排只有復能自己的器材**，ILIB 不在裡面：它在「買了什麼」那一排
 * 自己有一顆（就在復能隔壁），而單買 ILIB 是那個課程的 `single` 額度 ——
 * 它要的是診間不是治療師，跟池裡那三台不是同一種東西。同一件事給兩條路買，
 * 兩邊算出來的次數會對不起來。
 *
 * 丸子上印的是器材的**全名**，跟 `poolName()` 算出來的名字同一份 ——
 * 按下去之後名字變成什麼，按之前就看得到。（別稱那一格留給月曆，
 * 那裡 INDIBA 是 `IN`，但這一排要印 `INDIBA`，見 2026-09-08 那一輪。）
 */
export function poolChoices(master = {}) {
  const equipment = (master.equipment ?? []).filter((e) => !e.deletedAt && e.active !== false);
  const home = poolCourseOf(master);
  const tagged = equipment.filter((e) => e.courseId);

  const mine = home && tagged.length
    ? equipment.filter((e) => e.courseId === home.id)
    : equipment;
  const homeIds = mine.map((e) => e.id);
  const allIds = equipment.map((e) => e.id);

  const sets = [];
  if (homeIds.length > 1) sets.push({ value: POOL_SET_HOME, ids: homeIds });
  if (allIds.length > homeIds.length && allIds.length > 1) {
    sets.push({ value: POOL_SET_ALL, ids: allIds });
  }

  return {
    sets: sets.map((x) => ({ ...x, label: `${countWord(x.ids.length)}選一` })),
    singles: mine.map((eq) => ({
      value: eq.id,
      ids: [eq.id],
      label: fullNameOf(eq),
    })),
  };
}

/** 那一顆的值 → 要存進去的那一串器材 id。認不得的回 null（呼叫端當成沒選）。 */
export function idsForPoolKind(value, master = {}) {
  if (!value || value === '__null__') return null;
  const { sets, singles } = poolChoices(master);
  return [...sets, ...singles].find((x) => x.value === value)?.ids ?? null;
}

/**
 * 現在按著的是哪一顆。**比的是那一串 id，不是記她按了什麼** ——
 * 從方案展開出來的額度身上只有 ids，而她點進去調整時那一排也要按對。
 */
export function poolPickOf(e, master = {}) {
  const mine = [...(e?.optionEquipmentIds ?? [])].sort().join('|');
  if (!mine) return null;
  const { sets, singles } = poolChoices(master);
  return [...sets, ...singles]
    .find((x) => [...x.ids].sort().join('|') === mine)?.value ?? null;
}

/**
 * 這一池**以前**的自動名字有哪幾種（不含時長）。
 *
 * 只給資料健檢的「復能額度還叫舊名字」用。額度的名字是購買當下的快照
 * （ADR-0003），改了格式之後既有的那幾筆不會自己跟上，而**她自己打的名字
 * 不可以被一顆按鈕改掉**（同 ADR-0050 的判斷）—— 所以那一列只認得出
 * 這幾種形狀，其餘一律不列。
 *
 * 四代格式：
 *
 *   `復能`            最早：擇一池一律叫課程名
 *   `復能三選一`       算得出名字、但還沒有時長的中間狀態
 *   `超磁場`           2026-09-06：單買一台叫器材全名，而那時候它還叫超磁場
 *   `復能 - 三選一`    2026-09-07：破折號兩邊有空格，時長用全形括號
 *
 * 時長那一半由呼叫端自己補（`checkPoolLabels()` 半形與全形都試），
 * 所以這裡只回不帶時長的那幾種。
 *
 * @returns {string[]} 去重、去空白
 */
export function legacyPoolNames(optionEquipmentIds = [], equipment = [], courses = []) {
  const options = (optionEquipmentIds ?? [])
    .map((id) => (equipment ?? []).find((e) => e.id === id))
    .filter(Boolean);
  if (!options.length) return [];

  const home = fullNameOf(homeCourseOf(options, courses));
  const out = new Set([home]);
  if (options.length === 1) {
    const short = nameOf(options[0], 'short', { as: 'equipment' });
    out.add(fullNameOf(options[0]));
    out.add(short);
    // 2026-09-07 那一版：破折號兩邊有空格
    if (home && short) out.add(`${home} - ${short}`);
  } else if (home) {
    const what = `${countWord(options.length)}選一`;
    out.add(`${home}${what}`);
    out.add(`${home} - ${what}`);
  }
  return [...out].filter(Boolean);
}

/**
 * 帶時長的顯示名稱：`'復能-SIS'` + `60` → `'復能-SIS(60)'`。
 *
 * 括號裡只有數字，沒有「分鐘」—— 她自己寫的就是 `sis(60)x5`，
 * 而那一格旁邊的標籤已經說了那是分鐘。
 *
 * **半形括號**（2026-09-08 她寫的格式：`復能-三選一(30)`）。跟月曆那一格
 * 接分鐘的寫法一致 —— 同一個數字在兩個畫面上用兩種括號，看起來像兩種東西。
 * 全形的那一版（2026-09-07）還在既有資料上，資料健檢那一列認得出來
 *（`legacyPoolNames()` 的呼叫端半形與全形都試）。
 *
 * 沒有時長就不加括號（同 `tieredLabel()` 的判斷：**不要補一個猜的**）。
 */
export function timedLabel(name, durationMin) {
  const base = String(name ?? '').trim();
  const n = Number(durationMin);
  return base && Number.isInteger(n) && n > 0 ? `${base}(${n})` : base;
}


/**
 * 帶品項的顯示名稱：`'營養點滴'` + `'雪顏亮彩'` → `'營養點滴 - 雪顏亮彩'`。
 *
 * `CONTEXT.md`：營養點滴品項「各自有各自的次數，不合併計算」，所以一位客戶
 * 身上會有好幾筆營養點滴額度，靠這個名字分辨。
 *
 * **這一支就是那個接法的唯一一份。** 舊試算表匯進來的那幾筆
 *（`domain/legacyImport.js`）與她自己手動加購的走同一支 —— 兩邊各接一次的話，
 * 同一位客戶身上一筆匯進來的、一筆手動加的，長得不一樣她會以為是兩種東西。
 */
export function itemisedLabel(courseName, itemName) {
  const name = String(courseName ?? '').trim();
  const item = String(itemName ?? '').trim();
  return item ? `${name} - ${item}` : name;
}

export function validateEntitlement(e, { courses = [], equipment = [], products = [] } = {}) {
  const errors = [];
  const isBlank = (v) => v == null || String(v).trim() === '';
  const positiveInt = (v) => Number.isInteger(Number(v)) && Number(v) > 0;

  if (isBlank(e.label)) errors.push('額度名稱不可空白');
  if (!positiveInt(e.totalQty)) errors.push('總次數必須是大於 0 的整數');
  if (e.durationMin != null && !positiveInt(e.durationMin)) {
    errors.push('時長必須是大於 0 的整數分鐘');
  }

  const aliveCourse = courses.filter((c) => !c.deletedAt);
  const aliveEquip = equipment.filter((x) => !x.deletedAt);
  const aliveProduct = products.filter((x) => !x.deletedAt);

  if (e.type === 'single') {
    if (isBlank(e.courseId)) errors.push('要選一個課程');
    else if (!aliveCourse.some((c) => c.id === e.courseId)) errors.push('指定的課程不存在或已刪除');
  } else if (e.type === 'pool') {
    const opts = e.optionEquipmentIds ?? [];
    // **一種也算數**（ADR-0075）：單買一台超磁場就是「這一池裡只有一台」，
    // 排班時沒得選、預設就是它。零台仍然擋 —— 那一筆額度排不出任何一段。
    if (opts.length < 1) errors.push('要挑至少一種器材');
    else if (opts.some((id) => !aliveEquip.some((x) => x.id === id))) {
      errors.push('指定的器材不存在或已刪除');
    }
  } else if (isProduct(e)) {
    // 營養品那一筆一定要指得出是哪幾款：它沒有課程可以問，名字又是可以改的
    // 顯示字串。指不出來的話，之後主檔改名它就變成一筆沒有人認得的紀錄。
    //
    // 規則本身在 `domain/products.js` 的 `validateProduct()` —— 一次購買
    // 可以有好幾款、還有一個金額，那些只寫在那一支。
    errors.push(...validateProduct(e, { products }));
  } else {
    errors.push(`型態必須是 ${ENTITLEMENT_TYPES.join('、')}`);
  }

  // 等級是選填的，填了就要是一段人看得懂的字。長度上限跟名稱同一個道理：
  // 超過的通常是她把整段方案名稱貼進來了。
  if (e.tier != null && String(e.tier).trim().length > 20) {
    errors.push('金額等級太長了 —— 那一格只放「8萬」這種');
  }

  return errors;
}

/**
 * 一位客戶所有額度的合計，客戶總覽那一列要用。
 *
 * 這裡刻意讀 doneCount / bookedCount 這兩個計數欄位，而不是從 visits 現算：
 * 總覽一次要畫二十幾位客戶，現算等於把全部來訪都拉下來。計數欄位存在的理由
 * 就是這個快路徑（SPEC 第 5.3 節），而它會不會與現實脫節由對帳負責 ——
 * 客戶詳情頁會用 counts() 現算並顯示差異（SPEC 第 6.6 節）。
 *
 * @param {object[]} entitlements
 */
export function summarize(entitlements) {
  const out = { pools: 0, total: 0, done: 0, booked: 0, remaining: 0, overused: false };
  // 營養品不進這個合計：那一列寫的是「剩 N 次」，而兩罐夜態美不是兩次。
  for (const e of schedulable(entitlements ?? [])) {
    const c = {
      total: e.totalQty ?? 0,
      done: e.doneCount ?? 0,
      booked: e.bookedCount ?? 0,
    };
    out.pools += 1;
    out.total += c.total;
    out.done += c.done;
    out.booked += c.booked;
    out.remaining += c.total - c.done - c.booked;
    if (isOverused(c)) out.overused = true;
  }
  return out;
}
