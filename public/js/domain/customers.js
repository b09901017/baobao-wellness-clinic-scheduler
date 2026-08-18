// 客戶主檔的欄位規則與會籍期限。純函式。
//
// 這裡只擋「structurally 錯的」東西。像是同名客戶這種「可能是錯、也可能真的有
// 兩位王小姐」的狀況一律走 warnings()，只提示不阻擋 ——
// 見 docs/adr/0002-app-records-decisions-it-does-not-make-them.md。

import { isValidDate, addMonths, daysBetween } from './dates.js';

/**
 * 喜好程度的上限。排序公式是 w2 × (喜好程度 / 最大喜好值)（SPEC 第 9 節），
 * 沒有上限就算不出那個比值，所以它必須是個常數而不是隨手填的數字。
 * 0 代表還沒評。
 */
export const MAX_PRIORITY = 5;

/** 會籍剩幾天以內算「快到期」。快到期又剩很多次的人要浮上排班佇列（SPEC 第 7 節規則 7）。 */
export const EXPIRING_SOON_DAYS = 30;

const isBlank = (v) => v == null || String(v).trim() === '';

/**
 * 會籍到期日 = 購買日 + 會籍月數。
 * 用月份加而不是加 365 天，因為她口中的「一年」是日曆上的一年。
 * @returns {string|null} 'YYYY-MM-DD'，算不出來時回 null
 */
export function membershipExpiry(purchasedAt, membershipMonths) {
  if (!isValidDate(purchasedAt)) return null;
  if (!Number.isInteger(membershipMonths) || membershipMonths <= 0) return null;
  return addMonths(purchasedAt, membershipMonths);
}

/**
 * 會籍狀態，給 UI 上色與排序用。
 * @param {string|null} expiresAt
 * @param {string} today 'YYYY-MM-DD'，一律由呼叫端傳，才測得了
 * @returns {{state:'none'|'expired'|'soon'|'ok', days:number|null}}
 *          days 是距到期還有幾天，已過期為負數
 */
export function membershipState(expiresAt, today, soonDays = EXPIRING_SOON_DAYS) {
  if (!isValidDate(expiresAt)) return { state: 'none', days: null };
  const days = daysBetween(today, expiresAt);
  if (days < 0) return { state: 'expired', days };
  if (days <= soonDays) return { state: 'soon', days };
  return { state: 'ok', days };
}

/**
 * 存檔前的驗證。回傳訊息陣列，空陣列代表可以存。
 * @param {object} c
 * @returns {string[]}
 */
export function validate(c) {
  const errors = [];

  if (isBlank(c.name)) errors.push('客戶姓名不可空白');

  const priority = c.priority ?? 0;
  if (!Number.isInteger(priority) || priority < 0 || priority > MAX_PRIORITY) {
    errors.push(`喜好程度必須是 0 到 ${MAX_PRIORITY} 的整數`);
  }

  for (const [field, label] of [['purchasedAt', '購買日'], ['membershipExpiresAt', '會籍到期日']]) {
    const v = c[field];
    if (v != null && v !== '' && !isValidDate(v)) errors.push(`${label}的日期格式不對`);
  }

  if (isValidDate(c.purchasedAt) && isValidDate(c.membershipExpiresAt)
      && daysBetween(c.purchasedAt, c.membershipExpiresAt) < 0) {
    errors.push('會籍到期日不可以早於購買日');
  }

  const flags = c.flags ?? [];
  if (!Array.isArray(flags)) errors.push('永久限制格式錯誤');
  else {
    if (flags.some(isBlank)) errors.push('永久限制不可以有空白項目');
    if (new Set(flags).size !== flags.length) errors.push('永久限制不可重複');
  }

  return errors;
}

/**
 * 不阻擋、只提示的事。存檔前顯示，她看了還是可以存。
 * @param {object} c
 * @param {object[]} existing 現有客戶
 * @returns {string[]}
 */
export function warnings(c, existing = []) {
  const out = [];
  const name = String(c.name ?? '').trim();

  const sameName = existing.filter(
    (e) => e.id !== c.id && !e.deletedAt && String(e.name ?? '').trim() === name,
  );
  if (name && sameName.length) {
    out.push(`已經有 ${sameName.length} 位客戶也叫「${name}」，確認不是同一個人嗎？`);
  }

  if (isBlank(c.phone) && isBlank(c.lineId)) {
    out.push('沒有電話也沒有 LINE，之後問時間會找不到人');
  }

  return out;
}

/**
 * 醫療禁忌是永久限制的子集：會讓某個器材完全不能用的那些。
 * 客戶卡片上要把它跟一般限制分開顯示 —— 一般限制是提醒，禁忌是硬性阻擋。
 * @param {object} customer
 * @param {object[]} equipment 器材主檔
 * @returns {{contraindications: string[], others: string[]}}
 */
export function splitFlags(customer, equipment = []) {
  const blocking = new Set(
    equipment.filter((e) => !e.deletedAt).flatMap((e) => e.contraindications ?? []),
  );
  const flags = customer?.flags ?? [];
  return {
    contraindications: flags.filter((f) => blocking.has(f)),
    others: flags.filter((f) => !blocking.has(f)),
  };
}
