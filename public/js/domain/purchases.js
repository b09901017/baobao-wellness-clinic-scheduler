// 「買過什麼」那一頁的算法。純函式。
//
// 她 2026-09-06：
//
// > 我希望在客戶詳情額度那邊，可以多一個看總攬看詳情之類的按鈕或甚麼的之類的?
// > 名子你幫我想，然後點進去可以顯示清單文字等等，看到他購買了甚麼方案
// > (如果有微調的話可以註記)+加購甚麼等等
//
// 那一頁叫**「買過什麼」**：她本來就這樣講，而且跟「今天做了什麼」是同一種
// 命名（這個 app 的頁名是白話問句，不是名詞）。不叫「購買紀錄」——
// 「紀錄」在這個專案已經有兩個意思（寫紀錄、稽核紀錄）。
//
// ## 它跟那一排額度卡是兩件事
//
//   額度卡    「還剩幾次」—— 會一直變，現算（ADR-0004）
//   這一頁    「當初買了什麼」—— 不會變，看的是購買當下的快照
//
// 所以這一頁**不畫剩餘次數**：兩個地方講同一件事，遲早有一邊落後。
//
// ## 一筆都不可以被丟掉
//
// 分組有三層退路（見 `groupKey()`）。舊資料與匯進來的那幾筆身上什麼都沒有，
// 它們歸到最後一組 —— 同 `domain/dayReview.js` 的 `STAGES`：
// 最後一段永遠收得下剩下的。

import { isProduct } from './entitlements.js';
import { isValidDate, daysBetween, addDays } from './dates.js';

/** 沒有方案名的那幾筆叫什麼。 */
export const SINGLE_LABEL = '單項加購';

/** 什麼都對不上的那一組叫什麼。 */
export const UNKNOWN_LABEL = '不知道哪裡來的';

/**
 * 這一筆屬於哪一組。**三層退路**：
 *
 * 1. `purchaseId` —— 2026-09-06 之後建的都有，一次購買一個。**最準**：
 *    同一天買兩套一樣的方案分得開，改了購買日那一組也不會散開。
 * 2. `sourcePlanName` + `purchasedAt` —— 在那之前從方案展開的那幾筆。
 * 3. 只有 `purchasedAt` —— 在那之前的單項加購。
 *
 * 三個都沒有就回 `null`，由呼叫端收進最後一組。
 */
export function groupKey(e) {
  if (e?.purchaseId) return `id:${e.purchaseId}`;
  const plan = String(e?.sourcePlanName ?? '').trim();
  const at = String(e?.purchasedAt ?? '').trim();
  if (plan) return `plan:${plan}|${at}`;
  if (at) return `single:${at}`;
  return null;
}

/**
 * 這一筆跟方案本來寫的不一樣。
 *
 * `sourcePlanQty` 是購買當下的快照（`expandPlan()`），所以之後範本改了它也不會變。
 * 沒有那一欄的（單項加購、舊資料）一律不算微調 —— 它們本來就沒有「本來幾次」。
 */
export const isTweaked = (e) =>
  e?.sourcePlanQty != null && e.sourcePlanQty !== (e?.totalQty ?? 0);

/**
 * 把一位客戶的額度收成幾組購買。
 *
 * **營養品不進來**（ADR-0057：它不是額度那一排的東西，論的是月不是次），
 * 呼叫端自己一段畫。
 *
 * 順序：**購買日新的在前面**。沒有購買日的排最後 —— 那幾筆是舊資料，
 * 她要找的東西不會在那裡。
 *
 * @param {object[]} entitlements 一位客戶的全部額度
 * @returns {{key:string, label:string, purchasedAt:string|null, purchaseId:string|null,
 *            rows:object[], tweaked:boolean, unknown:boolean}[]}
 */
export function groupPurchases(entitlements = []) {
  const groups = new Map();
  const orphans = [];

  for (const e of entitlements ?? []) {
    if (!e || e.deletedAt || isProduct(e)) continue;
    const key = groupKey(e);
    if (!key) {
      orphans.push(e);
      continue;
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }

  const out = [...groups.entries()].map(([key, rows]) => ({
    key,
    label: String(rows[0]?.sourcePlanName ?? '').trim() || SINGLE_LABEL,
    purchasedAt: rows[0]?.purchasedAt ?? null,
    // 一整組共用一個 id，所以改購買日一次改整組。沒有 id 的那幾組不給改。
    purchaseId: rows[0]?.purchaseId ?? null,
    rows,
    tweaked: rows.some(isTweaked),
    unknown: false,
  }));

  out.sort((a, b) => {
    if (!a.purchasedAt !== !b.purchasedAt) return a.purchasedAt ? -1 : 1;
    if (a.purchasedAt !== b.purchasedAt) return a.purchasedAt < b.purchasedAt ? 1 : -1;
    return a.label.localeCompare(b.label, 'zh-TW');
  });

  if (orphans.length) {
    out.push({
      key: 'unknown',
      label: UNKNOWN_LABEL,
      purchasedAt: null,
      purchaseId: null,
      rows: orphans,
      tweaked: false,
      unknown: true,
    });
  }
  return out;
}

/** 營養品那一段。一次購買一筆（ADR-0059），所以不分組。 */
export const productsOf = (entitlements = []) =>
  (entitlements ?? []).filter((e) => e && !e.deletedAt && isProduct(e));

/**
 * 改了購買日之後，那一組每一筆要寫回去什麼。
 *
 * **有到期日的跟著移同樣的天數**（她 2026-09-06 選的），不是重算月數 ——
 * 舊資料的到期日不見得是「購買日 + 整數個月」，重算會把她手填的日期改掉。
 * 沒有到期日的（2026-09-06 之後的預設）什麼都不動。
 *
 * @param {object[]} rows 那一組的那幾筆
 * @param {string} nextDate 改成哪一天
 * @returns {{id:string, changes:{purchasedAt:string, expiresAt?:string}}[]}
 */
export function dateChangePatch(rows = [], nextDate) {
  if (!isValidDate(nextDate)) return [];

  return (rows ?? []).map((e) => {
    const changes = { purchasedAt: nextDate };
    const from = e?.purchasedAt ?? null;
    if (isValidDate(e?.expiresAt) && isValidDate(from)) {
      changes.expiresAt = addDays(e.expiresAt, daysBetween(from, nextDate));
    }
    return { id: e.id, changes };
  });
}

/**
 * 按下去之前那一句話：這一下會改到什麼。
 *
 * 收起來的東西不能安靜地生效 —— 到期日跟著移這件事她沒有按過任何一顆鈕，
 * 所以要先講。
 *
 * @returns {string} 沒有東西要多講就回空字串
 */
export function describeDateChange(rows = [], nextDate) {
  const moved = dateChangePatch(rows, nextDate).filter((p) => p.changes.expiresAt);
  if (!moved.length) return '';
  return moved.length === 1
    ? `到期日跟著移到 ${moved[0].changes.expiresAt}`
    : `${moved.length} 筆的到期日也跟著移同樣的天數`;
}
