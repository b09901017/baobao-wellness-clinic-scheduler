// 額度計算。純函式。
//
// 次數在「已完成」才扣，未到不扣但獨立計數。現行試算表在排定時就扣，
// 導致取消改期後數字與現實脫節 —— 這裡不重蹈覆轍。

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
    if (visit.deletedAt) continue;
    const hits = (visit.slots ?? []).filter((s) => s.entitlementId === entitlementId).length;
    if (!hits) continue;

    if (visit.status === 'done') done += hits;
    else if (visit.status === 'no_show') noShow += hits;
    else if (visit.status === 'pending_confirm' || visit.status === 'confirmed') booked += hits;
    // cancelled 不算任何一種：時段已經還回去了
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
