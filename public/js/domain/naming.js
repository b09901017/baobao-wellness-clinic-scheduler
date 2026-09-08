// 一段來訪在畫面上要唸成什麼。純函式。
//
// 她 2026-09-08：
//
// > app 中只會出現 在額度那邊寫復能-三選一(30)，月曆寫SIS(30)，草稿寫復能
//
// ## 全站只有三種字
//
// | 誰在看 | 哪裡 | 例 | 誰算的 |
// |---|---|---|---|
// | 她（當初買了什麼） | 加購、客戶詳情、壓表的額度丸子、試算表、稽核 | `復能-三選一(30)` | `entitlements.js` 的 `poolName()` + `timedLabel()` |
// | 她（那天做了什麼） | 月檢視、日／週那一列、讀取卡片、來訪編輯器抬頭 | `SIS(30)` | 這一支的 `slotName(…, 'short')` |
// | 客戶 | LINE 草稿 | `復能`、`靜脈雷射` | 這一支的 `slotName(…, 'line')` |
//
// 所以**這一支只有兩種寫法**：第三種字是額度的名字，那不是一段來訪的事。
//
// ## 「一般」那一種是怎麼消失的（2026-09-08）
//
// 2026-09-06 那一輪把一段的名字拆成三種寫法，中間那一種叫「一般」，
// 印的是 `復能(SIS)`。它只活在三個地方：日／週檢視那一列的副標、讀取卡片、
// 來訪編輯器每一段的抬頭。
//
// 她 2026-09-08 說那三個地方也印月曆那一種：
//
// > 我不希望出現復能(器材)，靜脈(IL)等其他格式，只會有以下這六種
//
// 讀取卡片底下本來就有一行「扣 復能-三選一(30)」（ADR-0077 第五點），
// 所以那一張卡片上兩行合起來仍然講得完整：那天做了什麼、扣的是哪一筆。
//
// ADR-0077 的立論一條都沒有被推翻 —— **三個地方三種讀者**還是成立的，
// 只是「她自己看」的那兩個地方（月檢視與讀取卡片）用同一種寫法就夠了。
//
// ## 月檢視為什麼要接分鐘
//
// > 希望可以在月檢視能看出來，分的出來，不用記復能(SIS)而是記 SIS(60)
//
// 同一台機器有 30 與 60 兩種規格，而它們是**兩筆不同的額度**
//（`復能-SIS(30)` 與 `復能-SIS(60)`）。少了那個數字，兩者長得一模一樣。
//
// **只有「這個課程有兩種以上規格」時才接**（`durationChoicesOf()`）——
// 健檢永遠是 120 分，寫出來只是把那一格擠掉一個字。
// 括號用半形：一格是七分之一個螢幕寬，全形括號等於少看到一個字。
//
// **有沒有器材都要接。** 單買 ILIB 那一段身上沒有器材（ILIB 課程的
// `requiresEquipment` 是 false），而她列的第六種正是 `ILIB(30/60) -> IL(30/60)`。
//
// ## 營養點滴印的是品項（2026-09-08）
//
// > 可以把這個營養點滴的品項寫出來，就不用寫營養點滴了，
// > 而是像這樣，誰，品項，診間（王小明/雪顏亮彩/.10）
// > 然後其中每個營養點滴的品項都可以有簡寫（像是雪顏亮彩可以簡稱雪）
//
// 所以「她自己看」那一種的順序是 **品項 → 器材 → 課程**，三者都讀別稱。
// **貼給客人的那一句不變**：那裡只講課程（ADR-0077），品項跟器材一樣
// 是她自己要認的東西。

import { durationChoicesOf } from './masterData.js';
import { toMinutes, isValidTime } from './visitTime.js';

const trimmed = (v) => String(v ?? '').trim();

/** 兩種情境。設定頁那張表照這個順序畫。 */
export const NAME_CONTEXTS = ['short', 'line'];

export const CONTEXT_LABELS = {
  short: '月曆',
  line: 'LINE 草稿',
};

/**
 * 一筆主檔（課程或器材）在某個情境要唸成什麼。
 *
 * 退回鏈是**兩份不一樣**的，因為那兩半在句子裡的位置不同：
 *
 *   課程  short → 別稱，空的退回全名；line → LINE 名，空的退回全名
 *   器材  一律別稱退回全名
 *
 * 器材沒有 `line` 這一種：LINE 草稿一個器材字都不寫（ADR-0077），
 * 所以 `slotName()` 根本不會拿 `line` 來問器材。留著這個參數只為了
 * 呼叫端不用先判斷是哪一種。
 *
 * @param {{name?:string, shortName?:string, lineName?:string}|null} row
 * @param {'short'|'line'} context
 * @param {{as?: 'course'|'equipment'}} [opts]
 */
export function nameOf(row, context, { as = 'course' } = {}) {
  const full = trimmed(row?.name);
  const short = trimmed(row?.shortName) || full;
  const line = trimmed(row?.lineName);

  if (as === 'equipment') return short;
  return context === 'line' ? (line || full) : short;
}

/**
 * 一筆主檔的**全名**。
 *
 * 全名是「她叫它什麼」（`SIS`、`INDIBA`、`點滴2`）—— 額度的名字、主檔清單、
 * 試算表、稽核紀錄讀的都是它，而月曆讀的是別稱（`nameOf(…, 'short')`）。
 *
 * 2026-09-08 拿掉 `full` 那一種情境之後，這一支沒有對應的存取器，於是
 * `String(x.name ?? '').trim()` 散在三個檔案裡。取名字這件事只有一支，
 * 那一支就是這裡。
 */
export const fullNameOf = (row) => trimmed(row?.name);

/**
 * 一段來訪要唸成什麼。**這一支是唯一的一份。**
 *
 * 四條規則：
 *
 * 1. **LINE 草稿只有課程那一半**（ADR-0077），連查都不查器材。
 * 2. **她自己看的那一種印器材的別稱**，沒有器材就印課程的別稱 ——
 *    健檢、二返、單買 ILIB 一個字都不會變。
 * 3. **課程先查主檔，查不到才退回 `slot.courseName` 快照。** 匯進來的舊來訪
 *    （ADR-0011）與被刪掉的課程都還印得出名字。
 * 4. **認不得的情境退回她自己看的那一種**，不要吐空字串 ——
 *    漏改一個呼叫端的症狀會是「那一列整個沒有名字」，那比多印幾個字糟得多。
 *
 * 2026-09-08 之前這裡還有一種「課程全名(器材別稱)」的接法（`復能(SIS)`）。
 * 她明確不要，所以那一段連同它的 `sameThing()` 一起拿掉了 ——
 * `ILIB(IL)` 那個問題也就不存在了。
 *
 * @param {{courseId?:string, courseName?:string, equipmentId?:string}} slot
 * @param {{courses?:object[], equipment?:object[]}} master
 * @param {'short'|'line'} [context]
 */
export function slotName(
  slot, { courses = [], equipment = [], ivProducts = [] } = {}, context = 'short',
) {
  const course = (courses ?? []).find((c) => c.id === slot?.courseId) ?? null;
  const snapshot = trimmed(slot?.courseName);

  // **n返 的名字不在主檔上。** 它借二返那個課程（ADR-0063），而畫面上要印的是
  // 返數 —— `nthSlotFields()` 已經把「三返」寫進快照了，所以這裡優先讀它。
  //
  // 判準跟 `isNthSlot()` 一樣是「`followupNth` 有沒有被填過」，不是它合不合法。
  // **不 import `nthFollowup.js`**：那一支經由 `followups.js` → `entitlements.js`
  // 繞回這裡，會變成循環。這裡要的只是「這一段是不是 n返」，一個欄位就答得出來。
  //
  // 快照是空的（資料壞了）就退回主檔 —— 印成空白比印「二返」糟。
  // 二返本身不走這條路（它的 `followupNth` 是 null），所以主檔改名之後
  // 已經排出去的二返照樣跟著改名。
  if (slot?.followupNth != null && slot.followupNth !== '' && snapshot) return snapshot;

  // 貼給客人的那一句只講課程。器材是她自己要認的東西（ADR-0077）。
  if (context === 'line') {
    return course ? nameOf(course, 'line', { as: 'course' }) : snapshot;
  }

  // **營養點滴印的是那天打的品項**（她 2026-09-08）：
  //
  // > 可以把這個營養點滴的品項寫出來，就不用寫營養點滴了，
  // > 而是像這樣，誰，品項，診間（王小明/雪顏亮彩/.10）
  //
  // 品項排在器材前面只是為了把順序釘死 —— 一個課程不會同時要選器材又要選
  // 品項（`validate('courses')` 擋著）。**兩邊都印簡寫**（她那天定的），
  // 沒設簡寫就退回全名，跟器材與診間同一條規矩（`nameOf()`）。
  const iv = slot?.ivProductId
    ? ((ivProducts ?? []).find((x) => x.id === slot.ivProductId) ?? null)
    : null;

  const eq = slot?.equipmentId
    ? ((equipment ?? []).find((x) => x.id === slot.equipmentId) ?? null)
    : null;

  const base = (iv ? nameOf(iv, 'short', { as: 'equipment' }) : '')
    || (eq ? nameOf(eq, 'short', { as: 'equipment' }) : '')
    || (course ? nameOf(course, 'short', { as: 'course' }) : '')
    || snapshot;

  return base ? withMinutes(base, slot, course) : '';
}

/**
 * 後面要不要接分鐘。
 *
 * 兩個條件都成立才接：
 *
 * 1. **這個課程有兩種以上規格**（`durationChoicesOf()`）。只有一種的話那個
 *    數字不提供任何資訊，而那一格每一個字都很貴。
 * 2. **算得出這一段多長**（起訖時間都有）。匯進來的舊來訪沒有時間
 *    （ADR-0011），那時候不要補一個猜的 —— 同 `timedLabel()` 的判斷。
 *
 * **不問有沒有器材**（2026-09-08）：單買 ILIB 那一段身上沒有器材，
 * 而她要的第六種正是 `IL(60)`。
 */
function withMinutes(base, slot, course) {
  if (durationChoicesOf(course).length < 2) return base;
  // `toMinutes()` 收到 null 會炸（它 `.split` 那個字串），所以先問過再算
  if (!isValidTime(slot?.startsAt) || !isValidTime(slot?.endsAt)) return base;
  const min = toMinutes(slot.endsAt) - toMinutes(slot.startsAt);
  return min > 0 ? `${base}(${min})` : base;
}

/**
 * 一筆來訪要唸成什麼（好幾段時接起來）。
 *
 * 同一個名字只印一次 —— LINE 草稿上同一天兩段點滴不該說兩次。
 *
 * **月檢視不再用這一支**：那裡改成一段一條色條（`domain/calendar.js` 的
 * `monthBars()`），而在那裡去重是錯的 —— 兩段點滴就是兩條。
 *
 * @returns {string[]} 去重之後，照時段的順序
 */
export function visitNames(visit, master, context = 'short') {
  const seen = new Set();
  const out = [];
  for (const slot of visit?.slots ?? []) {
    const name = slotName(slot, master, context);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}
