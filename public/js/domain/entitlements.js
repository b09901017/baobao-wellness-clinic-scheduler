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
 */
export function expandPlan(plan, quantity = 1) {
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
    doneCount: 0,
    bookedCount: 0,
    lastReconciledAt: null,
  }));
}
