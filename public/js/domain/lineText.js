// 從 LINE 複製出來的一段字。純函式。
//
// 她的筆記本來就記在 LINE 裡，而且是用貼圖排版的：每一段抬頭一顆熊臉，
// 每一件事前面一顆彩色數字。**複製出來的時候貼圖全部變成代碼**：
//
//   (emoji)今天反思：客訴×顧客會點滴（客戶A）
//   (emoji)前情提醒
//   (加1)飯後打針 （通知客人）
//   (2)預約系統註記（*第一針或*血管難打）
//
// 她的原話：「我希望我貼上的時候不要出現 (emoji) 或是 (加1)(2) 這種東西，
// 可以自動替換。」
//
// ## 為什麼不放進 domain/playbook.js
//
// 那一支的職責是「一份備忘錄的規則」（`validatePlaybook`、`previewOf`、
// `deckOrder`）。這一支是「一段從 LINE 複製出來的字」—— 之後隨手記或客戶備註
// 要用得上時，不必把備忘錄整支拖進去。
//
// ## 三件刻意不做的事
//
//   1. **只在貼上的時候清，打字不清。** 她自己打 `(2)` 一定是有意的。
//   2. **只認半形括號。** 她的內文裡到處是全形的（乾淨度）、（通知客人）——
//      認全形等於把她自己的字改掉，那比留著代碼糟得多。
//   3. **不重排段落。** 只做兩件版面的事：行尾空白去掉、連續空行收成一個。
//      縮排一個字都不動（她可能刻意用縮排分層，見 `playbook.js` 的 normalize()）。

/** `(emoji)` 一律換成這一顆。她 2026-09-04 選的。 */
export const EMOJI_PLACEHOLDER = '🐻';

/**
 * `(1)`～`(10)` 與 `(加1)`～`(加10)` 換成的那一組。
 *
 * 她選的是彩色方塊（1️⃣）不是圓圈數字（①）—— 最接近 LINE 原本那些彩色貼圖。
 * **只到 10**：再上去沒有對應的字元，硬拼一個出來會在某些字型上變成豆腐格，
 * 所以 `(11)` 以上原樣留著。
 */
const KEYCAPS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

/**
 * 輸入框底下那一排點得到的 emoji。
 *
 * **跟 `EMOJI_PLACEHOLDER`、`KEYCAPS` 放在同一支**：`(emoji)` 換成的那一顆
 * 就在這一排裡，兩份清單分家的話，她會發現「自動換上的那顆」在下面那一排
 * 找不到，於是想換掉也換不回同一顆。
 *
 * 十七顆，**不給第十八顆，也不做搜尋** —— 一排 emoji 一旦做成「全部的 emoji」
 * 就變成一個選擇器，而她要的是「一點就有」。每一顆都是從她自己那份筆記
 * 反推的，不是憑感覺挑的。
 */
export const EMOJI_ROW = [
  ...KEYCAPS.slice(0, 5),          // 「標記 1 2 3 4 的表情貼」
  EMOJI_PLACEHOLDER, '🔸', '▪️',    // 段落抬頭。熊是預設，另外兩顆給不想用熊的時候
  '⏰', '⚠️', '📌', '✅',            // 她點名的「提醒 ⏰、注意事項 ⚠️」
  '💊', '💉', '🩺', '📋', '🏥',      // 她的內容本身：打針、療程單、房間、檢查
];

/**
 * 貼圖代碼。括號裡面是 `emoji` 或（可選的「加」加上）一到兩位數字。
 *
 * ## 全形括號也認，但只有這幾種內容
 *
 * 第一版只認半形，理由是「她的內文到處是全形的（乾淨度）（通知客人），
 * 認全形等於把她自己的字改掉」。那個理由**只對了一半**：真正該擋的是
 * **括號裡的內容**，不是括號本身。`（乾淨度）`、`（通知客人）` 不會被誤傷，
 * 因為裡面既不是 `emoji` 也不是數字。
 *
 * 而 LINE 在不同裝置上複製出來的括號**不一定是半形的** —— 只認半形的話，
 * 她在某一台上貼進來就完全沒反應，而畫面上沒有任何線索說為什麼
 *（2026-09-04 她回報「沒有變成小圖示」）。
 *
 * 兩位數的上限是刻意的：`(123)` 根本不會被認成代碼（她的內文裡可能有數字），
 * 而 `(11)` 會被認出來但因為超出 `KEYCAPS` 的範圍而原樣留著。
 */
const CODE = /[(（]\s*(emoji|加?\d{1,2})\s*[)）]/gi;

/**
 * 換成什麼。認得但換不了（`(11)`、`(0)`）就回 `null`，代表原樣留著。
 */
function replacementFor(body) {
  const value = String(body ?? '').trim();
  if (value.toLowerCase() === 'emoji') return EMOJI_PLACEHOLDER;
  const n = Number(value.replace(/^加/, ''));
  return KEYCAPS[n - 1] ?? null;
}

/**
 * 把一段從 LINE 貼過來的字清乾淨。
 *
 * **冪等**：清過的字再清一次結果一模一樣（`🐻` 與 `1️⃣` 都不會再被認成代碼，
 * 行尾空白與連續空行的處理本身也是冪等的）。這一條有測試 —— 沒有它的話，
 * 她把清過的字複製到另一份再貼一次就會愈變愈奇怪。
 *
 * @param {string} text 剪貼簿裡的原文
 * @returns {string}
 */
export function sanitizeLinePaste(text) {
  const raw = String(text ?? '');

  const swapped = raw.replace(CODE, (match, body, offset, whole) => {
    const to = replacementFor(body);
    if (to === null) return match;
    // 換完補一個半形空格，但**只在下一個字不是空白的時候** ——
    // 「1️⃣ 飯後」不要變成兩個空格。
    const next = whole[offset + match.length];
    return next && !/\s/.test(next) ? `${to} ` : to;
  });

  return swapped
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    // 連續空行收成一個空行。三行以上的空白是複製貼上帶來的，不是她排的版。
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * 清洗完要跟她說的那一句。沒有東西被換就回空字串。
 *
 * **靜靜地改掉她貼進來的字是這個 app 最不該做的事**（SPEC 第 6.9 節）。
 * 一句「換掉 6 個貼圖代碼」讓她知道畫面上少的那些不是她貼漏了。
 * 反過來，每次貼上都跳一句她會學會忽略它，所以沒換就不說。
 *
 * @param {string} before 原文
 * @param {string} after `sanitizeLinePaste()` 的結果
 * @returns {string}
 */
export function describeCleanup(before, after) {
  const n = countCodes(before) - countCodes(after);
  return n > 0 ? `換掉 ${n} 個貼圖代碼` : '';
}

/** 這一段裡有幾個**換得掉**的代碼。`(11)` 認得出來但換不掉，不算。 */
function countCodes(text) {
  let n = 0;
  for (const [, body] of String(text ?? '').matchAll(CODE)) {
    if (replacementFor(body) !== null) n += 1;
  }
  return n;
}

/**
 * 這一段裡還有換得掉的貼圖代碼嗎。
 *
 * **貼上那條路蓋不到已經存在的字。** 她在這個功能上線之前打／貼進去的那幾份
 * 備忘錄裡的代碼，永遠不會經過 `paste` 事件 —— 而開檔就自動改寫她的資料是
 * 這個 app 不做的事（那會是一次沒有人按過的寫入）。
 *
 * 所以編輯的時候多一顆按鈕，**只在真的有代碼的時候出現**：她按了才清。
 * 一顆永遠在那裡的按鈕會變成裝飾，而一顆只在有事做的時候出現的按鈕
 * 本身就是一句提示。
 */
export function hasLineCodes(text) {
  return countCodes(text) > 0;
}
