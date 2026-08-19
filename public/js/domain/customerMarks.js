// 備註：掛在客戶身上的短標記，一位客戶可以有好幾則，各自一個顏色。純函式。
//
// 與另外兩種東西刻意分開，界線寫在 CONTEXT.md：
//
//   永久限制  會影響排班，其中的醫療禁忌是唯一的硬性阻擋。系統看得懂它。
//   隨手記    客人臨時提的小要求，可以勾掉，是另一個集合。
//   備註      她要記得的事。系統不賦予任何意義，顏色也由她自己決定。
//
// 顏色是給她自己分類用的，程式不可以因為顏色而改變任何行為 ——
// 一旦「紅色代表不能排」這種規則出現，它就變成一個沒有人驗證的業務規則。
//
// ## 為什麼同時寫 marks 與 notes
//
// `customer.marks` 是真相（帶顏色的陣列），`customer.notes` 是它換行接起來的
// 純文字鏡像，每次存檔一起寫。這樣試算表報表（`domain/sheetReport.js`）、
// 壓表卡片上的備註（`domain/scheduling.js` 的 `marks`）與舊資料匯入
// 都不必知道 marks 的存在。舊客戶身上只有 notes 沒有 marks，`readMarks()`
// 會把每一行當成一則灰色備註 —— 不需要任何一次性的搬移。
// 見 docs/adr/0019-customer-notes-become-coloured-marks.md

/**
 * 可以挑的顏色。六個 —— 再多她自己也分不清哪個是哪個。
 * `token` 對應 tokens.css 裡的變數，顏色值不寫在這裡。
 */
export const MARK_COLORS = [
  { id: 'grey', label: '灰', token: '--mark-grey' },
  { id: 'green', label: '綠', token: '--mark-green' },
  { id: 'tea', label: '茶', token: '--mark-tea' },
  { id: 'red', label: '紅', token: '--mark-red' },
  { id: 'blue', label: '藍', token: '--mark-blue' },
  { id: 'violet', label: '紫', token: '--mark-violet' },
];

export const DEFAULT_MARK_COLOR = 'grey';

/** 一則備註最多多長。備註是掃過去就看得懂的短句，長的那種要拆開。 */
export const MAX_MARK_LENGTH = 40;

/** 一位客戶最多幾則。超過就掃不完，那等於沒有標記。 */
export const MAX_MARKS = 12;

const trimmed = (v) => String(v ?? '').trim();

const isKnownColor = (id) => MARK_COLORS.some((c) => c.id === id);

/** 顏色 id → CSS 變數名。認不得的一律回灰色，不要讓畫面上出現沒有顏色的圓點。 */
export function colorToken(id) {
  return (MARK_COLORS.find((c) => c.id === id) ?? MARK_COLORS[0]).token;
}

/** 一則備註的標準形狀。空字串會被丟掉，由 `readMarks` / `validateMarks` 處理。 */
export function normalizeMark(mark) {
  const color = trimmed(mark?.color);
  return {
    text: trimmed(mark?.text),
    color: isKnownColor(color) ? color : DEFAULT_MARK_COLOR,
  };
}

/**
 * 讀出這位客戶的備註。
 *
 * 沒有 `marks` 就把舊的 `notes` 逐行拆成灰色備註 —— 舊客戶不必先被搬移過
 * 才看得到東西。空白行丟掉，不然畫面上會出現看不見的空丸子。
 *
 * @param {object} customer
 * @returns {{text: string, color: string}[]}
 */
export function readMarks(customer) {
  if (Array.isArray(customer?.marks)) {
    return customer.marks.map(normalizeMark).filter((m) => m.text);
  }

  return trimmed(customer?.notes)
    .split('\n')
    .map((line) => trimmed(line))
    .filter(Boolean)
    .map((text) => ({ text, color: DEFAULT_MARK_COLOR }));
}

/**
 * 備註換行接起來的純文字。存檔時一起寫進 `customer.notes`，
 * 讓試算表報表與壓表卡片不必認得 marks。
 *
 * @returns {string|null} 沒有備註時回 null，不是空字串 ——
 *   Firestore 上「沒有這件事」與「有一個空字串」是兩回事。
 */
export function marksToText(marks) {
  const text = (marks ?? [])
    .map(normalizeMark)
    .filter((m) => m.text)
    .map((m) => m.text)
    .join('\n');
  return text || null;
}

/**
 * 存檔前的檢查。回傳訊息陣列，空陣列代表可以存。
 *
 * 太長與太多都只在這裡擋 —— 它們不是資料正確性問題，是「這樣做出來的畫面
 * 她掃不完」的問題，所以擋在寫進去之前，而不是畫的時候才截斷。
 */
export function validateMarks(marks) {
  const errors = [];

  if (marks != null && !Array.isArray(marks)) {
    errors.push('備註格式錯誤');
    return errors;
  }

  const list = (marks ?? []).map(normalizeMark);

  if (list.length > MAX_MARKS) {
    errors.push(`備註最多 ${MAX_MARKS} 則（現在有 ${list.length} 則）`);
  }
  if (list.some((m) => !m.text)) {
    errors.push('備註不可以是空白的');
  }

  const tooLong = list.filter((m) => m.text.length > MAX_MARK_LENGTH);
  if (tooLong.length) {
    errors.push(
      `「${tooLong[0].text.slice(0, 12)}…」太長了（最多 ${MAX_MARK_LENGTH} 字）。` +
        '備註是掃過去就看得懂的短句，這種份量拆成兩三則比較讀得完',
    );
  }

  const seen = new Set();
  for (const m of list) {
    if (m.text && seen.has(m.text)) {
      errors.push(`「${m.text}」重複了`);
      break;
    }
    seen.add(m.text);
  }

  return errors;
}

/**
 * 送進 data 層之前把兩個欄位一起整理好。
 *
 * marks 與 notes 永遠一起寫，不要有「改了 marks 忘了改 notes」的路徑存在。
 */
export function toCustomerFields(marks) {
  const list = (marks ?? []).map(normalizeMark).filter((m) => m.text);
  return { marks: list, notes: marksToText(list) };
}
