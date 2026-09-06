// 一段來訪在畫面上要唸成什麼。純函式。
//
// 她 2026-09-06：
//
// > 日曆以及要通知客戶的 line 草稿等等，就是要寫特定哪一項，而不是說甚麼三選一
// > 四選一，而是特定什麼可以寫復能(sis) 或是 ILIB 這樣，這樣客戶和我才清楚
//
// > 月檢視寫器材名，其餘寫全名，然後其實可以器材名寫 "SIS" 以及全名寫 "復能(SIS)"，
// > 然後設定可以多一個名稱檢視表？就是可以設定課程的全名以及別稱……
// > 以及如果是 line 草稿要怎麼寫名稱等等
//
// ## 為什麼這一支存在
//
// 額度叫什麼是「當初買了什麼」（`復能四選一(60)`），一段叫什麼是
// **「那天真的做了什麼」**（`復能(SIS)`）。兩件事。日曆上寫「復能」而她那天
// 真的做的是超磁場 —— 客戶看不懂，她過幾週也認不出來。
//
// ## 三種寫法，一份資料
//
// 三個地方能放的字數差很多（月檢視一小條、讀取卡片一整列、LINE 一句話），
// 所以每一筆主檔有三格名字，而**組法只有這一支**。
//
//   short  月檢視     有器材就只印器材    `SIS`
//   full   一般       課程全名(器材別稱)  `復能(SIS)`
//   line   LINE 草稿  **只有課程**        `復能`
//
// ## LINE 草稿一個器材字都不寫（2026-09-07，ADR-0077）
//
// 她的原話：
//
// > 我和客人的草稿只會有復能或靜脈雷射
// > 然後我自己看月曆會是當天我壓的器材
//
// 所以 `line` 那一格**不接器材那一半**，`復能 - 三選一（60）` 那天壓了超磁場，
// 貼給客人的還是「復能」。器材主檔上的 `lineName` 因此再也畫不出來，
// 設定 → 名稱怎麼寫那一頁的器材列也就不給那一格了 —— 一個永遠不會出現的
// 輸入框比沒有還糟。
//
// 2026-09-06 那一版寫的是「LINE 草稿預設同一般」，那一條被這裡推翻了。

const trimmed = (v) => String(v ?? '').trim();

/** 三種情境。設定頁那張預覽表照這個順序畫。 */
export const NAME_CONTEXTS = ['short', 'full', 'line'];

export const CONTEXT_LABELS = {
  short: '月檢視',
  full: '一般',
  line: 'LINE 草稿',
};

/**
 * 一筆主檔（課程或器材）在某個情境要唸成什麼。
 *
 * 退回鏈是**兩份不一樣**的，因為那兩半在句子裡的位置不同：
 *
 *   課程  full → 全名；short/line → 自己那一格，空的退回全名
 *   器材  一律別稱退回全名
 *
 * 器材沒有 `line` 這一種：LINE 草稿一個器材字都不寫（ADR-0077），
 * 所以 `slotName()` 根本不會拿 `line` 來問器材。留著這個參數只為了
 * 呼叫端不用先判斷是哪一種。
 *
 * @param {{name?:string, shortName?:string, lineName?:string}|null} row
 * @param {'short'|'full'|'line'} context
 * @param {{as?: 'course'|'equipment'}} [opts]
 */
export function nameOf(row, context, { as = 'course' } = {}) {
  const full = trimmed(row?.name);
  const short = trimmed(row?.shortName) || full;
  const line = trimmed(row?.lineName);

  if (as === 'equipment') return short;
  if (context === 'short') return short;
  if (context === 'line') return line || full;
  return full;
}

/**
 * 一段來訪要唸成什麼。**這一支是唯一的一份。**
 *
 * 四條共同的規則：
 *
 * 1. **沒有器材就只有課程那一半。** 健檢、二返、營養點滴一個字都不會變。
 * 2. **LINE 草稿一律只有課程那一半**（ADR-0077），連查都不查器材。
 * 3. **器材與課程是同一件事時不加括號。** ILIB 那一台在主檔上跟課程同名，
 *    所以是 `ILIB` 不是 `ILIB(ILIB)`，也不是 `ILIB(IL)` —— 她指名這件事。
 *    比的是**全名**：別稱設成 `IL` 之後那兩半印出來就不一樣了，拿印出來的
 *    比會漏掉。
 * 4. **課程先查主檔，查不到才退回 `slot.courseName` 快照。** 匯進來的舊來訪
 *    （ADR-0011）與被刪掉的課程都還印得出名字。
 *
 * @param {{courseId?:string, courseName?:string, equipmentId?:string}} slot
 * @param {{courses?:object[], equipment?:object[]}} master
 * @param {'short'|'full'|'line'} [context]
 */
export function slotName(slot, { courses = [], equipment = [] } = {}, context = 'full') {
  const course = (courses ?? []).find((c) => c.id === slot?.courseId) ?? null;
  const courseHalf = course
    ? nameOf(course, context, { as: 'course' })
    : trimmed(slot?.courseName);

  // 貼給客人的那一句只講課程。器材是她自己要認的東西（ADR-0077）。
  if (context === 'line') return courseHalf;

  const eq = slot?.equipmentId
    ? ((equipment ?? []).find((x) => x.id === slot.equipmentId) ?? null)
    : null;
  if (!eq) return courseHalf;

  const eqHalf = nameOf(eq, context, { as: 'equipment' });
  if (!eqHalf) return courseHalf;
  // 月檢視只放得下幾個字，而她真正要認的是「哪一台」
  if (context === 'short') return eqHalf;
  if (!courseHalf) return eqHalf;
  if (eqHalf === courseHalf || sameThing(eq, course)) return courseHalf;
  return `${courseHalf}(${eqHalf})`;
}

/**
 * 這一台器材與這個課程是不是同一件事。
 *
 * 只有 ILIB 是：它同時是一個課程與器材主檔上的第四台（ADR-0075），
 * 兩邊的**全名**一樣。復能那三台不是 —— 器材叫超磁場、課程叫復能。
 */
function sameThing(eq, course) {
  const a = trimmed(eq?.name);
  return Boolean(a) && a === trimmed(course?.name);
}

/**
 * 一筆來訪要唸成什麼（好幾段時接起來）。
 *
 * 同一個名字只印一次 —— 同一天兩段點滴不該印兩次。
 * 月檢視那一格只放得下一個，呼叫端自己取第一個。
 *
 * @returns {string[]} 去重之後，照時段的順序
 */
export function visitNames(visit, master, context = 'full') {
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
