// 醫療禁忌。這是整個系統唯一的硬性阻擋。
//
// 為什麼只有這一條擋、其他都只提示：見
// docs/adr/0002-app-records-decisions-it-does-not-make-them.md
//
// 它不需要推算，只是比對客戶身上有沒有那個標記，不存在資料不完整的問題，
// 而且錯了會造成實際傷害。

/**
 * 這位客戶能不能用這個器材。
 * @param {{flags?: string[]}} customer
 * @param {{contraindications?: string[]}} equipment
 */
export function isBlocked(customer, equipment) {
  return blockingFlags(customer, equipment).length > 0;
}

/** 造成阻擋的是哪幾個標記。UI 要顯示原因，不能只說「不能選」。 */
export function blockingFlags(customer, equipment) {
  const flags = customer?.flags ?? [];
  const contra = equipment?.contraindications ?? [];
  return flags.filter((f) => contra.includes(f));
}

/**
 * 把擇一池的器材選項標上可否使用。
 * 回傳的順序與輸入相同 —— UI 上被劃掉的項目要留在原位，
 * 讓她看得到「這裡本來有東西，是被擋掉了」。
 *
 * @param {{flags?: string[]}} customer
 * @param {{id:string, name:string, contraindications?: string[]}[]} equipmentOptions
 */
export function annotateOptions(customer, equipmentOptions) {
  return equipmentOptions.map((eq) => {
    const reasons = blockingFlags(customer, eq);
    return { ...eq, blocked: reasons.length > 0, reasons };
  });
}

/**
 * 送出前的最後一道檢查。回傳錯誤陣列，空陣列代表可以存。
 * 前端擋一次，Firestore Rules 再擋一次 —— 這是前端這一次。
 */
export function validateSlots(customer, slots, equipmentById) {
  const errors = [];
  for (const [i, slot] of (slots ?? []).entries()) {
    if (!slot.equipmentId) continue;
    const eq = equipmentById[slot.equipmentId];
    if (!eq) continue;
    const reasons = blockingFlags(customer, eq);
    if (reasons.length) {
      errors.push({
        slotIndex: i,
        equipmentId: slot.equipmentId,
        message: `${eq.name} 與「${reasons.join('、')}」衝突，不可使用`,
      });
    }
  }
  return errors;
}

/**
 * 這位客戶的擇一池還剩下什麼可以用，講成一句話。
 *
 * 壓表卡片牆上那顆紅丸子（SPEC 第 8.2 節）。**它是算出來的，不是打字打的** ——
 * 器材主檔上的禁忌一改，這句話跟著改。
 *
 * 三種說法，而不是一種，因為那三種的後果完全不同：
 *
 * | 剩下 | 說法 | 她要做什麼 |
 * |---|---|---|
 * | 一台 | `只能 INDIBA` | 記錄時沒得選，照著填 |
 * | 兩台以上但有被擋的 | `不能用 超磁場` | 記錄時要避開那一台 |
 * | 一台都不剩 | `三台都不能用` | **壓不下去**，她要在點進去之前就知道 |
 *
 * 沒有任何一台被擋就回 `null` —— 卡片牆上那一顆丸子只在有東西被硬性擋住時
 * 才出現，不然它會變成每一張卡都有的裝飾。
 *
 * @param {{flags?: string[]}} customer
 * @param {{id:string, name:string, contraindications?: string[]}[]} equipmentOptions
 *   這位客戶擇一池裡的那幾台。沒有擇一池就傳空陣列，回 null。
 * @returns {{text: string, blockedCount: number, leftCount: number}|null}
 *   兩個數字帶 `Count` 是刻意的 —— 呼叫端拿它們當「還剩幾台」用，
 *   而 `blocked` / `left` 這種名字讀起來像器材的清單。
 */
export function equipmentLimitLabel(customer, equipmentOptions = []) {
  const annotated = annotateOptions(customer, equipmentOptions);
  if (!annotated.length) return null;

  const blocked = annotated.filter((eq) => eq.blocked);
  if (!blocked.length) return null;

  const left = annotated.filter((eq) => !eq.blocked);
  const text = (() => {
    if (!left.length) return `${annotated.length} 台都不能用`;
    if (left.length === 1) return `只能 ${left[0].name}`;
    return `不能用 ${blocked.map((eq) => eq.name).join('、')}`;
  })();

  return { text, blockedCount: blocked.length, leftCount: left.length };
}

/**
 * 目前所有器材宣告的禁忌詞，去重，維持器材主檔上的順序。
 *
 * 這是「哪些字會真的擋下器材」的唯一來源 —— 客戶身上的永久限制要變成可以
 * 點的丸子，選項就得從這裡長出來，不能另外維護一份清單。多一份清單就會
 * 出現「丸子上有、器材上沒有」的字，點了卻什麼都擋不住。
 *
 * @param {{contraindications?: string[], deletedAt?: any}[]} equipment 器材主檔
 * @returns {string[]}
 */
export function contraindicationTerms(equipment = []) {
  const alive = (equipment ?? []).filter((e) => e && !e.deletedAt);
  return [...new Set(alive.flatMap((e) => e.contraindications ?? []))];
}
