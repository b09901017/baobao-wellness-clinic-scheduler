// 隨手記。SPEC 第 8.1 節。純函式。
//
// 客人臨時提出的零碎小要求：指定某位治療師、下次記得帶健保卡、幫我問問看能不能約週六。
// 這些沒有死線，也不是來訪產生的，所以它不是任務 —— 見 CONTEXT.md 兩者的分界。
//
// 刻意做得很薄：一行字、一個勾、選填掛在誰身上、選填掛一個日期。
// 它要能在三秒內記完，多一個**必填**欄位就會變成「算了我等一下再記」，
// 然後就忘了 —— 所以後面那兩個永遠是選填的。
//
// ## 掛了日期就上日曆
//
// 有日期的那幾筆會出現在日曆上（`views/calendar.js` 的「待辦」那一類），
// 勾掉了畫成刪除線。**日曆上那一類就是這個集合，不是另一份資料** ——
// 「也必須要同步到隨手記那邊」最可靠的作法是根本沒有第二份。
// 見 docs/adr/0044-a-dated-note-goes-on-the-calendar.md。
//
// 日期**不是死線**。任務要有死線且由來訪產生（CONTEXT.md），
// 隨手記的日期是「我想在這一天處理」——過了也不會變紅字。

import { isValidDate } from './dates.js';

const trimmed = (v) => String(v ?? '').trim();

/** 一筆隨手記最多多長。超過的通常是應該寫進客戶備註的東西。 */
export const MAX_LENGTH = 200;

/**
 * 存檔前的檢查。
 *
 * @returns {{errors: string[]}}
 */
export function validateNote(note) {
  const errors = [];
  const text = trimmed(note?.text);

  if (!text) errors.push('要寫點東西');
  if (text.length > MAX_LENGTH) {
    errors.push(`太長了（${text.length} 字，最多 ${MAX_LENGTH} 字）。這種份量寫進客戶備註比較找得到`);
  }

  // customerId 有填就要連名字一起帶 —— 清單頁不會為了一行字再去讀一次客戶
  if (note?.customerId && !trimmed(note?.customerName)) {
    errors.push('掛了客戶卻沒有名字');
  }

  // 日期是選填的，但填了就要是真的日期。**過去的日期不擋** ——
  // 她會補記昨天那一件。
  const date = trimmed(note?.date);
  if (date && !isValidDate(date)) errors.push('日期看不懂');

  return { errors };
}

/** 這筆還算不算數。 */
export function isLive(note) {
  return Boolean(note) && !note.deletedAt;
}

export function isOpen(note) {
  return isLive(note) && !note.done;
}

/**
 * 排序：沒勾的在上面（新的先），勾掉的沉到最下面。
 *
 * 勾掉的不馬上消失，因為她會勾錯 —— 看得到才點得回來。
 */
export function sortNotes(notes) {
  return [...(notes ?? [])].filter(isLive).sort((a, b) => {
    if (Boolean(a.done) !== Boolean(b.done)) return a.done ? 1 : -1;
    return String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''));
  });
}

/**
 * 依客戶分組。客戶詳情頁與待辦的「依客戶」看法都用這個。
 *
 * 沒掛客戶的收在 null 這一組，不要丟掉 —— 那些通常是最容易忘的雜事。
 *
 * @returns {{customerId: string|null, customerName: string, notes: object[]}[]}
 */
export function groupByCustomer(notes) {
  const groups = new Map();

  for (const note of sortNotes(notes)) {
    const key = note.customerId ?? null;
    if (!groups.has(key)) {
      groups.set(key, {
        customerId: key,
        customerName: key ? (note.customerName ?? '（沒有名字）') : '沒掛客戶',
        notes: [],
      });
    }
    groups.get(key).notes.push(note);
  }

  return [...groups.values()].sort((a, b) => {
    // 沒掛客戶的排最後
    if (!a.customerId !== !b.customerId) return a.customerId ? -1 : 1;
    return String(a.customerName).localeCompare(String(b.customerName), 'zh-TW');
  });
}

/**
 * 有日期、而且落在這段期間裡的。日曆用。
 *
 * **含已經勾掉的** —— 日曆上勾掉的要畫成刪除線，不是消失。
 * 日期舊的在前，同一天照建立時間。
 */
export function datedIn(notes = [], from, to) {
  return notes
    .filter((n) => isLive(n) && n.date && n.date >= from && n.date <= to)
    .sort((a, b) => String(a.date).localeCompare(String(b.date))
      || String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));
}

/** 某位客戶身上還沒處理掉的。客戶詳情頁用。 */
export function openFor(notes, customerId) {
  return sortNotes(notes).filter((n) => n.customerId === customerId && !n.done);
}

/**
 * 這位客戶身上有沒有一筆一模一樣、還沒勾掉的隨手記。
 *
 * 「跟客人確認時間」那張卡片上打的「禮拜一再問問」會同時落進隨手記
 *（`.scratch/asks-2026-08-25/issues/05`），而那個輸入框每按一次「記」就寫一次
 * —— 她改了字又改回來、或者按兩下，都不該長出第二筆。
 *
 * 比的是**還沒勾掉的**：勾掉的那一筆代表那件事處理完了，同一句話再出現一次
 * 是真的又要做一次。
 *
 * @returns {object|null} 找到的那一筆
 */
export function sameOpenNote(notes = [], { customerId = null, text = '' } = {}) {
  const want = trimmed(text);
  if (!want) return null;

  return (notes ?? []).find(
    (n) => isOpen(n)
      && (n.customerId ?? null) === (customerId ?? null)
      && trimmed(n.text) === want,
  ) ?? null;
}

/** 首頁那一列要顯示的數字：還沒勾掉的有幾筆。 */
export function openCount(notes) {
  return (notes ?? []).filter(isOpen).length;
}

/**
 * 送進 data 層之前把形狀整理好。**吃的是一份完整的隨手記**，
 * 沒帶到的欄位一律算成「空的」。新增走這一支，改一筆請走 `normalizePatch()`。
 *
 * 沒掛客戶時兩個欄位一起清成 null，不要留一個空字串 ——
 * 「掛了一位叫空字串的客戶」跟「沒掛客戶」在查詢上是兩件事。
 */
export function normalize(note) {
  const customerId = trimmed(note?.customerId) || null;
  return {
    text: trimmed(note?.text),
    customerId,
    customerName: customerId ? trimmed(note?.customerName) : null,
    // 沒有日期就是 null，不要留空字串 —— 日曆是用
    // `where('date', '>=', ...)` 撈的，空字串會被撈進來而 null 不會。
    date: trimmed(note?.date) || null,
    done: Boolean(note?.done),
    // 這一筆講的是哪一包營養品（`domain/products.js`）。一般的隨手記沒有這個，
    // 所以是 null。**`normalizePatch()` 刻意不碰它** —— 待辦編輯器只問
    // 「記什麼」與「哪一天」，帶不到它，而少帶就等於清空。
    entitlementId: trimmed(note?.entitlementId) || null,
  };
}

/**
 * 改一筆的時候用。**只整理有帶到的那幾個欄位。**
 *
 * `normalize()` 吃的是一份完整的隨手記，所以少帶一個欄位就等於把它清空。
 * 而 `update(id, changes)` 收的天生是一份「只有變了的那幾欄」：日曆上那個
 * 待辦編輯器只問「記什麼」與「哪一天」，於是 2026-08-25 以前**改一件已經
 * 勾掉的待辦會把它變回沒做**（`done` 沒帶到 → 算成 false），而 `doneAt`
 * 還留著上次勾掉的時間，兩個欄位從此對不起來。
 *
 * 那不是有人忘了帶一個欄位，是「完整的文件」與「只有變了的那幾欄」用了
 * 同一支函式。所以這一支只碰 `changes` 裡真的出現過的鍵。
 *
 * @param {object} changes 只有要改的那幾個欄位
 */
export function normalizePatch(changes = {}) {
  const has = (key) => Object.prototype.hasOwnProperty.call(changes ?? {}, key);
  const out = {};

  if (has('text')) out.text = trimmed(changes.text);
  if (has('date')) out.date = trimmed(changes.date) || null;
  if (has('done')) out.done = Boolean(changes.done);

  // 兩個欄位是一組的：掛了人就要有名字，沒掛人兩個一起清成 null。
  // 只帶其中一個過來時，另一個要跟著算出來，不能留著上一版的值。
  if (has('customerId') || has('customerName')) {
    const customerId = trimmed(changes.customerId) || null;
    out.customerId = customerId;
    out.customerName = customerId ? trimmed(changes.customerName) : null;
  }

  return out;
}
