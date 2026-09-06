// 額度計算。純函式。
//
// 次數在「已完成」才扣，未到不扣但獨立計數。現行試算表在排定時就扣，
// 導致取消改期後數字與現實脫節 —— 這裡不重蹈覆轍。

import { validateProduct } from './products.js';

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
 * @param {{purchasedAt?:string, expiresAt?:string}} [when]
 *        購買日與到期日。到期日算法見 domain/customers.js 的 membershipExpiry()，
 *        算好之後複製到每一筆額度上 —— 額度自己要知道什麼時候到期，
 *        不能回頭去問方案範本，範本會被改。
 */
export function expandPlan(plan, quantity = 1, { purchasedAt = null, expiresAt = null } = {}) {
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
    purchasedAt,
    expiresAt,
    doneCount: 0,
    bookedCount: 0,
    lastReconciledAt: null,
  }));
}

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
