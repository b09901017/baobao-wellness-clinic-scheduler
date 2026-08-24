// 額度計算。純函式。
//
// 次數在「已完成」才扣，未到不扣但獨立計數。現行試算表在排定時就扣，
// 導致取消改期後數字與現實脫節 —— 這裡不重蹈覆轍。

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

/** 這位客戶有沒有任何一池快用完（含已超用）。 */
export function lowRemaining(entitlements) {
  return (entitlements ?? []).some(
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
export function validateEntitlement(e, { courses = [], equipment = [] } = {}) {
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

  if (e.type === 'single') {
    if (isBlank(e.courseId)) errors.push('要選一個課程');
    else if (!aliveCourse.some((c) => c.id === e.courseId)) errors.push('指定的課程不存在或已刪除');
  } else if (e.type === 'pool') {
    const opts = e.optionEquipmentIds ?? [];
    if (opts.length < 2) errors.push('擇一池至少要有兩種器材可選');
    else if (opts.some((id) => !aliveEquip.some((x) => x.id === id))) {
      errors.push('指定的器材不存在或已刪除');
    }
  } else {
    errors.push('型態必須是 single 或 pool');
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
  for (const e of entitlements ?? []) {
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
