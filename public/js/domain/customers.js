// 客戶主檔的欄位規則與會籍期限。純函式。
//
// 這裡只擋「structurally 錯的」東西。像是同名客戶這種「可能是錯、也可能真的有
// 兩位王小姐」的狀況一律走 warnings()，只提示不阻擋 ——
// 見 docs/adr/0002-app-records-decisions-it-does-not-make-them.md。

import { isValidDate, addMonths, daysBetween } from './dates.js';
import { clinicalTerms } from './masterData.js';
import { acceptsMoreSlots } from './visits.js';

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
  const { name, contact } = fieldWarnings(c, existing);
  return [name, contact].filter(Boolean);
}

/**
 * 同一組提醒，**照它講的是哪一格分開**（issue 08）：新增客戶那一頁把每一句
 * 收成那一格旁邊的一顆 ⚠，存檔前那一道再把 `warnings()` 整份講一次（ADR-0102）。
 * 兩份句子是同一支算的 —— 畫面上的 ⚠ 與存檔前講的不會是兩種說法。
 *
 * @returns {{name: string|null, contact: string|null}}
 */
export function fieldWarnings(c, existing = []) {
  const name = String(c.name ?? '').trim();
  const sameName = existing.filter(
    (e) => e.id !== c.id && !e.deletedAt && String(e.name ?? '').trim() === name,
  );
  return {
    name: name && sameName.length
      ? `已經有 ${sameName.length} 位客戶也叫「${name}」，確認不是同一個人嗎？`
      : null,
    contact: isBlank(c.phone) && isBlank(c.lineId)
      ? '沒有電話也沒有 LINE，之後問時間會找不到人'
      : null,
  };
}

/**
 * 把永久限制拆成兩份，給編輯表單用。
 *
 * `picked` 是**警示**（`clinicalTerms()`，設定 → 警示那一份主檔），做成丸子讓她點：
 * 打錯一個字的症狀是**壓表卡片牆上什麼都不會出現**，而畫面上看起來跟打對了
 * 一模一樣 —— 看不出來的錯比看得出來的危險。
 *
 * `others`（固定禮拜五不行）是她自己的話，句子長什麼樣只有她知道，
 * 只能留自由輸入。
 *
 * 2026-09-06 之前這裡是三份：醫療禁忌、臨床提醒、其餘。醫療禁忌那一層之所以
 * 自成一層，唯一的理由是「它會擋」；不擋之後那條界線就不存在了（ADR-0074）。
 *
 * **`others` 要排掉警示名單**：少排的話，警示會在自由輸入欄裡再出現一次，
 * 存檔時 `validate()` 會因為重複而擋下整張表單，而畫面上沒有一個欄位看起來是錯的。
 *
 * @param {string[]} flags 客戶身上的永久限制
 * @param {string[]} alerts 警示那幾個字（`clinicalTerms()`）
 * @returns {{picked: string[], others: string[]}}
 *          `picked` 照主檔的順序，`others` 照客戶身上的原順序
 */
export function splitFlagsForEdit(flags = [], alerts = []) {
  const has = new Set(flags ?? []);
  const known = new Set(alerts ?? []);
  return {
    picked: (alerts ?? []).filter((t) => has.has(t)),
    others: (flags ?? []).filter((f) => !known.has(f)),
  };
}

/**
 * 拆開的兩份合回一個 flags。**順序就是嚴重程度**：警示、其餘。
 * 客戶詳情那一排照這個順序畫，所以要注意的字永遠先被看到。
 *
 * 去重是必要的而不是保險：她可能在自由輸入那一欄又打了一次「體內金屬」，
 * 而 `validate()` 會因為重複而擋下整張表單，卻沒有任何一個欄位看起來是錯的。
 */
export function mergeFlags(picked = [], others = []) {
  const all = [...(picked ?? []), ...(others ?? [])].map((x) => String(x).trim());
  return [...new Set(all.filter(Boolean))];
}

/**
 * 這位客戶掛了哪幾家合作機構（ADR-0076）。
 *
 * **主檔上沒有的字照樣回**：客戶身上存的是字串，而她可能把主檔那一筆改名了。
 * 掉出畫面比顯示一個陌生的字糟得多 —— 後者她看得出發生了什麼事。
 *
 * 跟永久限制刻意分成兩個欄位：合作機構不是限制，它不影響排班、不擋任何東西，
 * 只是「這一次要多跟一家講一聲」。混在 `flags` 裡的話，那一排丸子就不再
 * 只回答一個問題（同 ADR-0019 對備註與永久限制的判斷）。
 */
export function partnersOf(customer) {
  return (customer?.partners ?? []).map((x) => String(x).trim()).filter(Boolean);
}

/**
 * 永久限制的兩層，見 ADR-0074。
 *
 *   alerts   警示   什麼都不擋，但壓表那一刻要一眼看得到（體內金屬、血管難打）
 *   others   其餘   她自己的話（固定禮拜五不行）。排班相關的由本輪可用性在管
 *
 * 兩層要分開顯示，而且**畫法不一樣**：一張卡上十個紅字等於全都不紅
 * （`ui/components/flags.js` 的檔頭）。每一個警示的顏色與填法記在主檔上，
 * 由她自己挑（`domain/clinicalFlags.js`）。
 *
 * **這一支不再需要器材主檔。** 2026-09-06 之前它拿器材上的禁忌詞當第一層；
 * 現在那些字的用途只剩「選到這一台時要提醒什麼」
 * （`domain/contraindications.js`），而畫在客戶身上的那一排只看警示主檔。
 * 器材上有、警示主檔沒有的那幾個字由資料健檢列出來。
 *
 * @param {object} customer
 * @param {object[]} clinicalFlags 警示主檔
 * @returns {{alerts: string[], others: string[]}}
 */
export function splitFlags(customer, clinicalFlags = []) {
  const known = new Set(clinicalTerms(clinicalFlags));
  const flags = customer?.flags ?? [];
  return {
    alerts: flags.filter((f) => known.has(f)),
    others: flags.filter((f) => !known.has(f)),
  };
}

/**
 * 改名時，哪幾份**名字快照**要跟著換（prelaunch-audit-2026-09-23/issues/09）。
 *
 * 來訪、任務、隨手記身上存的是當時的名字（`customerName`）。只改客戶本人那一份的話，
 * 日曆與待辦上還是舊名字 —— 同名的兩位，她改其中一位的名字想分開他們，
 * 日曆上照樣撞在一起。她 2026-09-23 選的：
 *
 * - **今天以後的來訪、還沒做的任務、還沒勾的隨手記**一起換
 * - 過去的來訪與做完的留著當時的名字（那是歷史）
 *
 * **過去的來訪還掛著沒做完的事就不算歷史**（她 2026-09-23，issues/16）：還沒結案（待確認、已確認），
 * 或身上有一張還沒做的任務。不換的話，那一筆一結案 `syncTasksForVisit()` 就把任務的名字
 * 對齊來訪身上那一份 —— 待辦變回舊名字，新長的「寫紀錄」也是舊名字。
 *
 * 壓表批次的卡片不在這裡：它畫的時候就拿客戶本人的名字蓋掉佇列上那一份（`mergeIntoQueue()`）。
 *
 * @param {{visits?: object[], tasks?: object[], notes?: object[]}} own 這位客戶的
 * @param {string} today
 * @param {string} name 新名字
 * @returns {{path: string, id: string}[]}
 */
export function renameTargets({ visits = [], tasks = [], notes = [] } = {}, today, name) {
  const stale = (x) => !x.deletedAt && (x.customerName ?? null) !== name;
  const openWork = new Set(tasks.filter((t) => !t.done && !t.deletedAt).map((t) => t.visitId));
  const live = (v) => v.date >= today || acceptsMoreSlots(v.status) || openWork.has(v.id);
  return [
    ...visits.filter((v) => stale(v) && live(v)).map((v) => ({ path: 'visits', id: v.id })),
    ...tasks.filter((t) => stale(t) && !t.done).map((t) => ({ path: 'tasks', id: t.id })),
    ...notes.filter((n) => stale(n) && !n.done).map((n) => ({ path: 'notes', id: n.id })),
  ];
}

/**
 * 刪掉這位客戶之前，還掛著他的哪幾件事（prelaunch-audit-2026-09-23/issues/08）。
 *
 * 刪除只寫客戶本人那一份。來訪、任務是頂層集合，讀的時候不問客戶還在不在 ——
 * 日曆、跟客人確認時間、簽療程單、掛號待辦上會留著一個點進去是「找不到這位客戶」的人，
 * 而那幾格在 Abovee 上還佔著、撞期也照樣算他。她 2026-09-23 選的：**還掛著東西就先擋**，
 * 列出來請她先收掉（每一步都看得到、給得出復原），不替她一次收一大批。
 *
 * - 還沒結案的來訪：待確認、已確認（已完成／未到／已取消是歷史，不擋）
 * - 還沒做的待辦
 *
 * @returns {{visits: object[], tasks: object[]}}
 */
export function deleteBlockers({ visits = [], tasks = [] } = {}) {
  return {
    visits: visits.filter((v) => !v.deletedAt && ['pending_confirm', 'confirmed'].includes(v.status)),
    tasks: tasks.filter((t) => !t.deletedAt && !t.done),
  };
}
